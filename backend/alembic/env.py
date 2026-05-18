"""Alembic migration environment.

Uses the async SQLAlchemy engine from `app.db.session` but wraps it in a
synchronous runner so Alembic's internal migration machinery can call it.

Key flags:
  compare_type=True          — detect column type changes (e.g. String(50)→String(100))
  compare_server_defaults=True — detect server_default changes
  include_schemas=False      — single-schema setup; set True for multi-tenant schemas
"""
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Register all models so Base.metadata is fully populated for autogenerate.
from app.db.base import Base
import app.models.scenario             # noqa: F401
import app.models.hedge_configuration  # noqa: F401
import app.models.simulation_result    # noqa: F401
import app.models.market_data          # noqa: F401

from app.core.config import settings

alembic_config = context.config

# Use the sync psycopg2 URL — Alembic's migration runner is synchronous.
alembic_config.set_main_option("sqlalchemy.url", settings.sync_database_url)

if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name)

target_metadata = Base.metadata


# ── Offline migration (generates SQL without connecting) ──────────────────────

def run_migrations_offline() -> None:
    url = alembic_config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_defaults=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online migration (connects to DB and applies changes) ─────────────────────

def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_defaults=True,
        # Render server defaults as text so they appear in migration diffs.
        render_as_batch=False,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        alembic_config.get_section(alembic_config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
