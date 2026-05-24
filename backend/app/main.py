"""
BAML Risk Intelligence Platform — FastAPI entry point.

DEPLOYMENT MODE (Render):
  All database initialization, lifespan hooks, and non-essential startup
  logic are disabled below.  Re-enable them once a database is provisioned.

  Active routes:
    GET  /                  root ping
    GET  /health            Render health probe
    GET  /healthz           Render health probe (alias)
    *    /api/v1/health/*   liveness + readiness probes
    *    /api/v1/sofr/*     SOFR ARIMA + Monte Carlo (FRED API)
    *    /api/v1/forecast/* Typed SOFR + FX Monte Carlo endpoints
    *    /api/v1/forecasting/* Data series catalogue

  Commented-out routes (require DATABASE_URL to be set on Render):
    /api/v1/dashboard/*    — placeholder, DB-backed
    /api/v1/scenarios/*    — full CRUD, DB-backed
    /api/v1/hedges/*       — full CRUD, DB-backed
    /api/v1/instruments/*  — market data, DB-backed
    /api/v1/simulations/*  — job queue, DB-backed
    /api/v1/fx/*           — live rates, DB-backed

uvicorn command:
  uvicorn app.main:app --host 0.0.0.0 --port $PORT
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

# ── Core config (no DB, no logging setup — safe at import time) ───────────────
from app.core.config import settings
from app.core.exceptions import (
    BAMLBaseException,
    domain_exception_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)

# ── Lightweight middleware (no DB, no heavy deps) ─────────────────────────────
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.timing import TimingMiddleware

# ── API router (only non-DB routes are active — see router.py) ────────────────
from app.api.router import api_router

# ── DISABLED: DB session manager — re-enable when DATABASE_URL is set ─────────
# Importing db_manager triggers create_async_engine(asyncpg_url) at module
# level, before uvicorn has an event loop.  This crashes the process on Render
# when no database is provisioned.
# from app.db.session import db_manager

# ── DISABLED: structured logging setup (called in lifespan below) ─────────────
# from app.core.logging import configure_logging, get_logger
# logger = get_logger(__name__)


# ── Application factory ───────────────────────────────────────────────────────

def create_app() -> FastAPI:
    _app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description=(
            "Institutional financial analytics platform — "
            "treasury risk, FX forecasting, Monte Carlo simulation, "
            "hedging analysis, and live market data."
        ),
        # ── DISABLED: lifespan ────────────────────────────────────────────────
        # Lifespan was used for DB connection checks and log setup.
        # Re-enable once a database is provisioned and asyncpg is verified.
        #
        # lifespan=lifespan,
        #
        # ── What lifespan did (for reference): ───────────────────────────────
        # 1. configure_logging()          — structlog setup
        # 2. await check_connection()     — fail-fast DB probe (commented out)
        # 3. await db_manager.close()     — graceful pool disposal on shutdown
        #
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json" if settings.docs_enabled else None,
        docs_url=f"{settings.API_V1_PREFIX}/docs" if settings.docs_enabled else None,
        redoc_url=f"{settings.API_V1_PREFIX}/redoc" if settings.docs_enabled else None,
    )

    _register_middleware(_app)
    _register_exception_handlers(_app)
    _register_routers(_app)

    return _app


# ── DISABLED: lifespan context manager ───────────────────────────────────────
# Re-enable when database is provisioned on Render.
#
# @asynccontextmanager
# async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
#     configure_logging()
#     logger.info("application.startup", name=settings.APP_NAME,
#                 version=settings.APP_VERSION, env=settings.APP_ENV)
#     # await check_connection()           # DB connectivity probe
#     yield
#     await db_manager.close()            # dispose connection pool
#     logger.info("application.shutdown", name=settings.APP_NAME)


# ── Middleware registration ───────────────────────────────────────────────────
#
# Starlette processes middleware LIFO: last added = outermost wrapper.
# Stack (outermost → innermost):
#   RequestID → Timing → TrustedHost → CORS → GZip → route handler

def _register_middleware(app: FastAPI) -> None:
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    # When ALLOWED_ORIGINS=["*"], credentials must be False.
    # The browser rejects "Access-Control-Allow-Origin: *" + credentials.
    allow_credentials = "*" not in settings.ALLOWED_ORIGINS

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Process-Time-Ms"],
    )

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)
    app.add_middleware(TimingMiddleware)
    app.add_middleware(RequestIDMiddleware)


# ── Exception handler registration ───────────────────────────────────────────

def _register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(BAMLBaseException, domain_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)


# ── Router registration ───────────────────────────────────────────────────────

def _register_routers(app: FastAPI) -> None:
    # ── Root ping — confirms the process is alive ─────────────────────────────
    @app.get("/", tags=["Root"])
    def root() -> dict:
        return {"status": "backend running"}

    # ── Health probes — used by Render platform health checks ─────────────────
    @app.get("/health", tags=["Health"])
    async def root_health() -> dict:
        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @app.get("/healthz", tags=["Health"])
    async def root_healthz() -> dict:
        return {"status": "ok"}

    # ── Versioned API (active routes only — see router.py for disabled list) ──
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)


# ── Module-level app instance ─────────────────────────────────────────────────
# MUST appear after create_app() is defined.
# uvicorn resolves "app.main:app" to this object.

app = create_app()
