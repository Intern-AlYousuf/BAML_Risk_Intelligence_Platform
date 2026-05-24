"""Health probe routes.

DEPLOYMENT MODE:
  Database dependency removed for Render deployment.
  /health/ready returns "ok" unconditionally — it no longer checks the DB.

  Re-enable the DB check once DATABASE_URL is set:
    1. Uncomment `from app.db.session import db_manager`
    2. Restore `db_ok = await db_manager.health_check()` in readiness()
    3. Update the checks dict accordingly
"""
from datetime import datetime, timezone

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.core.config import settings

# ── DISABLED: DB session manager ──────────────────────────────────────────────
# Importing db_manager triggers create_async_engine(asyncpg_url) at module
# level.  On Render without DATABASE_URL, asyncpg engine creation fails and
# crashes the entire import chain before uvicorn can accept connections.
#
# from app.core.logging import get_logger
# from app.db.session import db_manager
# logger = get_logger(__name__)

router = APIRouter(prefix="/health", tags=["Health"])


@router.get(
    "/live",
    summary="Liveness probe",
    description="Returns 200 if the process is alive. No dependency checks.",
)
async def liveness() -> dict:
    return {
        "status": "alive",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get(
    "/ready",
    summary="Readiness probe",
    description="Returns 200. DB check disabled until DATABASE_URL is provisioned.",
)
async def readiness() -> JSONResponse:
    # ── DISABLED: DB connectivity check ───────────────────────────────────────
    # Re-enable once DATABASE_URL is set on Render:
    #
    # db_ok = await db_manager.health_check()
    # checks = {"database": "ok" if db_ok else "unreachable"}
    # all_healthy = all(v == "ok" for v in checks.values())
    # http_status = status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    #
    # For now: always ready (no external dependency required at boot).
    checks = {"database": "disabled"}
    http_status = status.HTTP_200_OK

    return JSONResponse(
        status_code=http_status,
        content={
            "status": "ready",
            "checks": checks,
            "app": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "env": settings.APP_ENV,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
