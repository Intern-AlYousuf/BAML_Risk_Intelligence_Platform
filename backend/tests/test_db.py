"""Tests for the database session layer.

These tests run against the same SQLite in-memory engine used by conftest.py.
They verify session behaviour, rollback semantics, and manager interface
without touching real business logic.
"""
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import DatabaseSessionManager
from app.core.config import settings


# ── Session interface ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_db_session_yields_async_session(db_session: AsyncSession) -> None:
    assert isinstance(db_session, AsyncSession)


@pytest.mark.asyncio
async def test_db_session_executes_query(db_session: AsyncSession) -> None:
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar() == 1


# ── Manager health check ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_manager_health_check_with_sqlite() -> None:
    """Health check works with any supported async driver."""
    manager = DatabaseSessionManager.__new__(DatabaseSessionManager)
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

    manager._settings = settings
    manager._engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    manager._session_factory = async_sessionmaker(
        bind=manager._engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    result = await manager.health_check()
    assert result is True
    await manager.close()


# ── Session context manager — rollback semantics ──────────────────────────────

@pytest.mark.asyncio
async def test_session_context_manager_commits_on_success() -> None:
    manager = DatabaseSessionManager.__new__(DatabaseSessionManager)
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

    manager._settings = settings
    manager._engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    manager._session_factory = async_sessionmaker(
        bind=manager._engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with manager.session() as session:
        result = await session.execute(text("SELECT 42"))
        assert result.scalar() == 42

    await manager.close()


@pytest.mark.asyncio
async def test_session_context_manager_rolls_back_on_exception() -> None:
    manager = DatabaseSessionManager.__new__(DatabaseSessionManager)
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

    manager._settings = settings
    manager._engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    manager._session_factory = async_sessionmaker(
        bind=manager._engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    with pytest.raises(ValueError):
        async with manager.session() as session:
            await session.execute(text("SELECT 1"))
            raise ValueError("intentional failure")

    await manager.close()


# ── Read-only session ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_readonly_session_yields_session(db_session: AsyncSession) -> None:
    assert db_session is not None
    result = await db_session.execute(text("SELECT 'readonly'"))
    assert result.scalar() == "readonly"
