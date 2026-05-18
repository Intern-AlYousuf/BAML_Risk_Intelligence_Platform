import pytest
from pydantic import ValidationError

from app.core.config import Settings, _normalize_db_scheme


# ── URL normalization ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("input_url,driver,expected_scheme", [
    ("postgresql://u:p@host:5432/db",       "asyncpg",  "postgresql+asyncpg"),
    ("postgres://u:p@host:5432/db",         "asyncpg",  "postgresql+asyncpg"),
    ("postgresql+psycopg2://u:p@host/db",   "asyncpg",  "postgresql+asyncpg"),
    ("postgresql+asyncpg://u:p@host/db",    "psycopg2", "postgresql+psycopg2"),
    ("postgresql://u:p@host:5432/db",       "psycopg2", "postgresql+psycopg2"),
])
def test_normalize_db_scheme(input_url: str, driver: str, expected_scheme: str) -> None:
    result = _normalize_db_scheme(input_url, driver=driver)
    assert result.startswith(expected_scheme + "://")


# ── async_database_url assembly ───────────────────────────────────────────────

def test_async_url_built_from_components() -> None:
    s = Settings(
        DATABASE_URL=None,
        POSTGRES_USER="user",
        POSTGRES_PASSWORD="pass",
        POSTGRES_HOST="dbhost",
        POSTGRES_PORT=5432,
        POSTGRES_DB="mydb",
    )
    assert s.async_database_url == "postgresql+asyncpg://user:pass@dbhost:5432/mydb"


def test_async_url_normalized_from_railway_url() -> None:
    s = Settings(DATABASE_URL="postgresql://u:p@railway-host:5432/prod_db")
    assert s.async_database_url.startswith("postgresql+asyncpg://")


def test_sync_url_for_alembic() -> None:
    s = Settings(DATABASE_URL="postgresql://u:p@host:5432/db")
    assert s.sync_database_url.startswith("postgresql+psycopg2://")


# ── CSV list parsing ──────────────────────────────────────────────────────────

def test_allowed_origins_from_csv_string() -> None:
    s = Settings(ALLOWED_ORIGINS="http://localhost:3000, https://app.example.com")
    assert s.ALLOWED_ORIGINS == ["http://localhost:3000", "https://app.example.com"]


# ── Derived properties ────────────────────────────────────────────────────────

def test_docs_disabled_in_production() -> None:
    s = Settings(
        APP_ENV="production",
        SECRET_KEY="a-secure-secret-key-that-is-long-enough-32c",
        DEBUG=False,
        ALLOWED_HOSTS=["api.example.com"],
    )
    assert s.docs_enabled is False
    assert s.is_production is True


def test_railway_detection() -> None:
    s = Settings(RAILWAY_ENVIRONMENT="production")
    assert s.is_railway is True
    assert s.json_logs is True


def test_json_logs_forced_in_production() -> None:
    s = Settings(
        APP_ENV="production",
        SECRET_KEY="a-secure-secret-key-that-is-long-enough-32c",
        DEBUG=False,
        ALLOWED_HOSTS=["api.example.com"],
    )
    assert s.json_logs is True


# ── Production guards ─────────────────────────────────────────────────────────

def test_insecure_secret_rejected_in_production() -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(APP_ENV="production", SECRET_KEY="change-this-in-production", DEBUG=False)


def test_debug_true_rejected_in_production() -> None:
    with pytest.raises(ValidationError, match="DEBUG"):
        Settings(
            APP_ENV="production",
            SECRET_KEY="a-secure-secret-key-that-is-long-enough-32c",
            DEBUG=True,
        )


def test_wildcard_allowed_hosts_rejected_in_production() -> None:
    with pytest.raises(ValidationError, match="ALLOWED_HOSTS"):
        Settings(
            APP_ENV="production",
            SECRET_KEY="a-secure-secret-key-that-is-long-enough-32c",
            DEBUG=False,
            ALLOWED_HOSTS=["*"],
        )
