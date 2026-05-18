"""Database session management.

`DatabaseSessionManager` owns the engine lifecycle and exposes:
- `session()` — async context manager yielding a transactional AsyncSession
- `health_check()` — lightweight liveness probe used by /health/ready
- `close()` — disposes the connection pool on shutdown (SIGTERM / lifespan exit)

A module-level `db_manager` singleton is created at import time using the
settings from `app.core.config`.  Tests replace this singleton by calling
`override_db_manager()` with an in-memory SQLite instance.
"""
from __future__ import annotations

import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import AsyncAdaptedQueuePool

from app.core.config import Settings, settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Queries slower than this threshold are logged at WARNING level.
_SLOW_QUERY_MS = 500


class DatabaseSessionManager:
    """Encapsulates the SQLAlchemy async engine and session factory.

    Designed for use inside FastAPI's lifespan context manager:

        async with lifespan_context:
            await db_manager.connect()
            yield
            await db_manager.close()
    """

    def __init__(self, db_settings: Settings) -> None:
        self._settings = db_settings
        self._engine: AsyncEngine = self._build_engine()
        self._session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            bind=self._engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
        self._register_pool_events()

    # ── Engine construction ───────────────────────────────────────────────────

    def _build_engine(self) -> AsyncEngine:
        s = self._settings
        return create_async_engine(
            s.async_database_url,
            echo=s.DB_ECHO or s.DEBUG,
            # Verify stale connections before use — prevents "server closed
            # the connection unexpectedly" errors after idle periods on Railway.
            pool_pre_ping=True,
            pool_size=s.DB_POOL_SIZE,
            max_overflow=s.DB_MAX_OVERFLOW,
            pool_timeout=s.DB_POOL_TIMEOUT,
            # Recycle connections every 30 minutes to avoid hitting server-side
            # idle timeouts (PgBouncer default is 600 s).
            pool_recycle=1800,
            poolclass=AsyncAdaptedQueuePool,
        )

    # ── Pool event hooks ──────────────────────────────────────────────────────

    def _register_pool_events(self) -> None:
        sync_engine = self._engine.sync_engine

        @event.listens_for(sync_engine, "connect")
        def _on_connect(dbapi_conn, connection_record) -> None:
            logger.debug("db.pool.connect", pid=id(dbapi_conn))

        @event.listens_for(sync_engine, "checkout")
        def _on_checkout(dbapi_conn, connection_record, connection_proxy) -> None:
            connection_record.info["checkout_time"] = time.monotonic()

        @event.listens_for(sync_engine, "checkin")
        def _on_checkin(dbapi_conn, connection_record) -> None:
            elapsed = time.monotonic() - connection_record.info.get("checkout_time", time.monotonic())
            elapsed_ms = round(elapsed * 1000, 2)
            if elapsed_ms >= _SLOW_QUERY_MS:
                logger.warning("db.pool.slow_connection", held_ms=elapsed_ms)

        @event.listens_for(sync_engine, "invalidate")
        def _on_invalidate(dbapi_conn, connection_record, exception) -> None:
            logger.warning(
                "db.pool.connection_invalidated",
                error=str(exception) if exception else None,
            )

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def close(self) -> None:
        """Dispose the connection pool.

        Must be called during application shutdown so asyncpg does not leak
        open connections into the event loop after the process exits.
        """
        await self._engine.dispose()
        logger.info("db.pool.disposed")

    # ── Session context manager ───────────────────────────────────────────────

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        """Yield a transactional AsyncSession.

        Commits on clean exit, rolls back and re-raises on any exception.
        Do not call session.commit() / rollback() inside the `with` block —
        let the context manager handle it.
        """
        async with self._session_factory() as session:
            try:
                yield session
                await session.commit()
            except SQLAlchemyError as exc:
                await session.rollback()
                logger.error("db.session.rollback", error=str(exc))
                raise
            except Exception:
                await session.rollback()
                raise

    @asynccontextmanager
    async def session_readonly(self) -> AsyncGenerator[AsyncSession, None]:
        """Yield a read-only AsyncSession (no commit, no rollback overhead).

        Use this for all GET / query paths that do not mutate state.
        The session is still closed on exit so connections return to the pool.
        """
        async with self._session_factory() as session:
            yield session

    # ── Raw connection ────────────────────────────────────────────────────────

    @asynccontextmanager
    async def connect(self) -> AsyncGenerator[AsyncConnection, None]:
        """Yield a raw AsyncConnection — used by Alembic and bulk operations."""
        async with self._engine.begin() as conn:
            yield conn

    # ── Health check ──────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Execute a trivial query to confirm the DB is reachable.

        Returns True on success, False on any error.  Used by /health/ready.
        """
        try:
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception as exc:
            logger.error("db.health_check.failed", error=str(exc))
            return False

    # ── Engine / factory accessors (needed by tests) ─────────────────────────

    @property
    def engine(self) -> AsyncEngine:
        return self._engine

    @property
    def session_factory(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory


# ── Module-level singleton ────────────────────────────────────────────────────

db_manager = DatabaseSessionManager(settings)


# ── FastAPI dependency functions ──────────────────────────────────────────────

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Read-write session dependency.

    FastAPI calls this as a generator dependency; the session is committed
    (or rolled back) when the response is sent.
    """
    async with db_manager.session() as session:
        yield session


async def get_db_readonly() -> AsyncGenerator[AsyncSession, None]:
    """Read-only session dependency.

    Skips commit/rollback overhead for endpoints that only read data.
    """
    async with db_manager.session_readonly() as session:
        yield session
