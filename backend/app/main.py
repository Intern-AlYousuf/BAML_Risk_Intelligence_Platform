from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.exceptions import (
    BAMLBaseException,
    domain_exception_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from app.core.logging import configure_logging, get_logger
from app.db.init_db import check_connection
from app.db.session import db_manager
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.timing import TimingMiddleware

logger = get_logger(__name__)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    configure_logging()

    logger.info(
        "application.startup",
        name=settings.APP_NAME,
        version=settings.APP_VERSION,
        env=settings.APP_ENV,
        debug=settings.DEBUG,
    )

    # Fail fast: raise RuntimeError if DB is unreachable before accepting traffic.
    #await check_connection()
    

    if settings.is_production and settings.ENABLE_LIVE_FEEDS:
        logger.info("market_feeds.connecting")

    yield

    # Graceful shutdown: return all connections to the pool before the process exits.
    await db_manager.close()
    logger.info("application.shutdown", name=settings.APP_NAME)


# ── Application factory ───────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description=(
            "Institutional financial analytics platform — "
            "treasury risk, FX forecasting, Monte Carlo simulation, "
            "hedging analysis, and live market data."
        ),
        # Disable interactive docs in production to prevent schema exposure.
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json" if settings.docs_enabled else None,
        docs_url=f"{settings.API_V1_PREFIX}/docs" if settings.docs_enabled else None,
        redoc_url=f"{settings.API_V1_PREFIX}/redoc" if settings.docs_enabled else None,
        lifespan=lifespan,
    )

    _register_middleware(app)
    _register_exception_handlers(app)
    _register_routers(app)

    return app


# ── Middleware registration ───────────────────────────────────────────────────
#
# Starlette processes middleware in LIFO order relative to add_middleware calls:
# the last-added middleware is outermost (first to see the request).
#
# Stack (outermost → innermost):
#   RequestID → Timing → TrustedHost → CORS → GZip → route handler

def _register_middleware(app: FastAPI) -> None:
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
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
    # Root-level health check — used by Render and other platform health probes.
    @app.get("/health", tags=["Health"], include_in_schema=True)
    async def root_health() -> dict:
        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/healthz")
def health_check():
    return {"status": "ok"}

# ── Module-level app instance (used by uvicorn / gunicorn) ───────────────────

app = create_app()
