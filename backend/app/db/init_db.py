"""Database initialization utilities.

`check_connection()` — used at application startup to fail fast if the DB
is unreachable before accepting traffic.

`create_all_tables()` — dev/test convenience; production schema changes are
exclusively managed through Alembic migrations.

`drop_all_tables()` — test teardown only; never called in application code.
"""
from __future__ import annotations

# Import every model module so Base.metadata is fully populated before any
# DDL operation runs.  New models must be registered here.
import app.models.hedge_configuration  # noqa: F401
import app.models.market_data  # noqa: F401
import app.models.scenario  # noqa: F401
import app.models.simulation_result  # noqa: F401
from app.core.logging import get_logger
from app.db.base import Base
from app.db.session import db_manager

logger = get_logger(__name__)


async def check_connection() -> None:
    """Verify DB connectivity at startup.

    Raises `RuntimeError` if the database is unreachable so the process exits
    with a non-zero code rather than silently serving 503s.
    """
    logger.info("db.connection.checking")
    ok = await db_manager.health_check()
    if not ok:
        raise RuntimeError(
            "Cannot connect to the database. "
            "Check DATABASE_URL / POSTGRES_* environment variables."
        )
    logger.info("db.connection.ok")


async def create_all_tables() -> None:
    """Create tables for all registered models (dev / test only).

    In production, run `alembic upgrade head` instead.
    """
    async with db_manager.connect() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("db.tables.created")


async def drop_all_tables() -> None:
    """Drop all tables — test teardown only.

    This function is intentionally not exported from the package __init__
    to reduce the risk of accidental calls in application code.
    """
    async with db_manager.connect() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    logger.info("db.tables.dropped")
