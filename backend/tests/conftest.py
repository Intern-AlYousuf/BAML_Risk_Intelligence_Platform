"""Test configuration and shared fixtures.

Uses an in-memory SQLite database via aiosqlite so tests run without a
live PostgreSQL instance.  The `DatabaseSessionManager` is instantiated
with the test URL, then the FastAPI `get_db` dependency is overridden so
every route handler receives a session from this test engine.

Fixture scopes:
  session  — engine + schema setup once per test run
  function — db_session rolls back after each test (isolation)
  function — client rebuilds dependency overrides per test
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models.hedge_configuration  # noqa: F401 — populate Base.metadata
import app.models.market_data  # noqa: F401
import app.models.scenario  # noqa: F401
import app.models.simulation_result  # noqa: F401
from app.db.base import Base
from app.db.session import get_db, get_db_readonly
from app.main import app

_TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

_test_engine = create_async_engine(_TEST_DB_URL, echo=False)
_TestSessionFactory = async_sessionmaker(
    bind=_test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


# ── Schema lifecycle (once per test session) ──────────────────────────────────

@pytest_asyncio.fixture(scope="session", autouse=True)
async def _create_tables():
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await _test_engine.dispose()


# ── Per-test DB session with automatic rollback ───────────────────────────────

@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Yield a session that is rolled back after each test.

    This keeps tests fully isolated without dropping and recreating tables.
    """
    async with _TestSessionFactory() as session:
        yield session
        await session.rollback()


# ── HTTP client with overridden DB dependency ─────────────────────────────────

@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """AsyncClient wired to the test database.

    Both `get_db` (read-write) and `get_db_readonly` are overridden so every
    route handler — regardless of which dependency it uses — receives the
    same in-memory session.
    """
    async def _override():
        yield db_session

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_db_readonly] = _override

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
