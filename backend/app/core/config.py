"""Centralized application configuration.

All runtime settings are resolved in this order (highest priority first):
  1. Environment variables (set by Railway, Docker, or the shell)
  2. .env file (local development only)
  3. Field defaults defined below

Railway injects DATABASE_URL and PORT automatically; both are handled here
without any manual wiring in deployment scripts.
"""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import List, Literal
from urllib.parse import urlparse, urlunparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Sentinel used in the production guard; never a valid secret.
_INSECURE_SECRET = "change-this-in-production"

# Minimum acceptable SECRET_KEY length for HMAC-SHA256 token signing.
_MIN_SECRET_LENGTH = 32

# Absolute path to backend/.env — resolved relative to this file so the server
# loads the correct .env regardless of which directory uvicorn is launched from.
# config.py lives at backend/app/core/config.py → three parents up = backend/
_ENV_FILE: Path = Path(__file__).resolve().parent.parent.parent / ".env"


# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        # Extra env vars (e.g. RAILWAY_*) are ignored rather than raising.
        extra="ignore",
    )

    # ── Application metadata ──────────────────────────────────────────────────
    APP_NAME: str = "BAML Risk Intelligence Platform"
    APP_ENV: Literal["development", "staging", "production"] = "development"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # ── Server ────────────────────────────────────────────────────────────────
    # PORT is injected by Railway. Uvicorn reads it at startup.
    HOST: str = "0.0.0.0"
    PORT: int = Field(default=8000, ge=1, le=65535)

    # ── API ───────────────────────────────────────────────────────────────────
    API_V1_PREFIX: str = "/api/v1"
    SECRET_KEY: str = _INSECURE_SECRET
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60, ge=1, le=10080)
    API_REQUEST_TIMEOUT_SECONDS: int = Field(default=30, ge=1, le=300)

    # ── Database — primary connection ─────────────────────────────────────────
    # Railway provides DATABASE_URL as a standard postgresql:// URI.
    # Individual components are used when DATABASE_URL is absent (local / Docker
    # Compose). The computed `async_database_url` property always yields the
    # correct asyncpg scheme regardless of how the URL was supplied.
    DATABASE_URL: str | None = None
    POSTGRES_USER: str = "baml_user"
    POSTGRES_PASSWORD: str = "baml_password"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = Field(default=5432, ge=1, le=65535)
    POSTGRES_DB: str = "baml_risk_db"

    # Connection pool — size depends on worker count; tune per deployment tier.
    DB_POOL_SIZE: int = Field(default=10, ge=1, le=100)
    DB_MAX_OVERFLOW: int = Field(default=20, ge=0, le=100)
    DB_POOL_TIMEOUT: int = Field(default=30, ge=1, le=120)
    # Enable SQLAlchemy query logging only when DEBUG is true.
    DB_ECHO: bool = False

    # ── Redis (future: caching, Celery broker, rate-limit store) ─────────────
    REDIS_URL: str | None = None

    # ── CORS ──────────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]
    # TrustedHostMiddleware — use ["*"] to disable (not recommended for prod).
    ALLOWED_HOSTS: List[str] = ["*"]

    @field_validator("ALLOWED_ORIGINS", "ALLOWED_HOSTS", mode="before")
    @classmethod
    def _parse_csv_list(cls, v: str | List[str]) -> List[str]:
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    # ── Security ──────────────────────────────────────────────────────────────
    # Cost factor for bcrypt; 12 is a safe default, raise to 13-14 for prod.
    BCRYPT_ROUNDS: int = Field(default=12, ge=10, le=16)

    # ── Rate limiting (applied per-IP at the route layer) ─────────────────────
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = Field(default=100, ge=1)
    RATE_LIMIT_WINDOW_SECONDS: int = Field(default=60, ge=1)

    # ── Market data integrations ──────────────────────────────────────────────
    MARKET_DATA_API_KEY: str = ""
    MARKET_DATA_BASE_URL: str = ""
    MARKET_DATA_TIMEOUT_SECONDS: int = Field(default=10, ge=1, le=60)

    # ── FRED API (St. Louis Fed — SOFR, FX, macro series) ────────────────────
    # Register at https://fred.stlouisfed.org/docs/api/api_key.html
    # Free-tier: 120 requests/min, up to 50 series per request.
    FRED_API_KEY: str = ""
    FRED_BASE_URL: str = "https://api.stlouisfed.org/fred"
    FRED_REQUEST_TIMEOUT_SECONDS: int = Field(default=30, ge=5, le=120)

    # ── Forecasting data configuration ────────────────────────────────────────
    # Default lookback window used when no explicit start date is provided.
    FORECAST_DEFAULT_LOOKBACK_YEARS: int = Field(default=5, ge=1, le=20)
    # Minimum number of clean data points required before preprocessing passes.
    FORECAST_MIN_HISTORY_POINTS: int = Field(default=60, ge=10, le=500)

    # ── Feature flags ─────────────────────────────────────────────────────────
    ENABLE_MONTE_CARLO: bool = False
    ENABLE_LIVE_FEEDS: bool = False
    ENABLE_ML_FORECASTING: bool = False

    # ── Observability ─────────────────────────────────────────────────────────
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # Force JSON log output regardless of APP_ENV (useful in staging).
    LOG_JSON: bool = False
    SENTRY_DSN: str | None = None

    # ── Railway metadata (read-only, injected by the platform) ───────────────
    RAILWAY_ENVIRONMENT: str | None = None
    RAILWAY_SERVICE_NAME: str | None = None
    RAILWAY_DEPLOYMENT_ID: str | None = None

    # ── FRED API — validation ─────────────────────────────────────────────────

    @field_validator("FRED_API_KEY", mode="after")
    @classmethod
    def _validate_fred_api_key(cls, v: str) -> str:
        """Reject obviously invalid key values without crashing startup.

        A missing or placeholder key is allowed (the API returns 503); but a
        key that is clearly not a FRED key surfaces a clear startup message
        rather than a cryptic 400 from the FRED API at request time.
        """
        placeholder = "your_fred_api_key_here"
        if v and v == placeholder:
            raise ValueError(
                f"FRED_API_KEY is still set to the placeholder '{placeholder}'. "
                "Replace it with your real key from https://fred.stlouisfed.org/docs/api/api_key.html"
            )
        return v

    # ── Production guards ─────────────────────────────────────────────────────

    @model_validator(mode="after")
    def _enforce_production_constraints(self) -> "Settings":
        if self.APP_ENV == "production":
            if self.SECRET_KEY == _INSECURE_SECRET:
                raise ValueError(
                    "SECRET_KEY must be changed before running in production. "
                    f"Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
                )
            if len(self.SECRET_KEY) < _MIN_SECRET_LENGTH:
                raise ValueError(
                    f"SECRET_KEY must be at least {_MIN_SECRET_LENGTH} characters in production"
                )
            if self.DEBUG:
                raise ValueError("DEBUG must be False in production")
            if self.ALLOWED_HOSTS == ["*"]:
                raise ValueError(
                    "ALLOWED_HOSTS must list explicit hostnames in production — ['*'] is not permitted"
                )
        return self

    # ── Computed properties ───────────────────────────────────────────────────

    @property
    def async_database_url(self) -> str:
        """SQLAlchemy async URL (asyncpg driver).

        Resolves in this order:
          1. DATABASE_URL env var (Railway) — scheme is normalized to asyncpg.
          2. Individual POSTGRES_* components (Docker Compose / local).
        """
        if self.DATABASE_URL:
            return _normalize_db_scheme(self.DATABASE_URL, driver="asyncpg")
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def sync_database_url(self) -> str:
        """SQLAlchemy sync URL (psycopg2 driver) — used by Alembic only."""
        if self.DATABASE_URL:
            return _normalize_db_scheme(self.DATABASE_URL, driver="psycopg2")
        return (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def fred_configured(self) -> bool:
        """True when a non-empty FRED API key is present."""
        return bool(self.FRED_API_KEY)

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"

    @property
    def is_railway(self) -> bool:
        return self.RAILWAY_ENVIRONMENT is not None

    @property
    def docs_enabled(self) -> bool:
        """Disable OpenAPI docs in production to prevent schema exposure."""
        return not self.is_production

    @property
    def effective_log_level(self) -> str:
        return "DEBUG" if self.DEBUG else self.LOG_LEVEL

    @property
    def json_logs(self) -> bool:
        """Use structured JSON logs in production and on Railway."""
        return self.is_production or self.is_railway or self.LOG_JSON


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_db_scheme(url: str, driver: str) -> str:
    """Replace any postgresql/postgres scheme variant with the requested driver.

    Handles:
      postgresql://   → postgresql+{driver}://
      postgres://     → postgresql+{driver}://   (Heroku/Railway legacy alias)
      postgresql+*:// → postgresql+{driver}://   (already has a driver suffix)
    """
    parsed = urlparse(url)
    scheme_base = parsed.scheme.split("+")[0]  # strip existing driver suffix
    if scheme_base in ("postgresql", "postgres"):
        normalized = parsed._replace(scheme=f"postgresql+{driver}")
        return urlunparse(normalized)
    return url


# ── Singleton ─────────────────────────────────────────────────────────────────

@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
