from datetime import datetime, timezone

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging import get_logger
from app.db.session import db_manager

logger = get_logger(__name__)

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
    description="Returns 200 only when all critical dependencies are reachable.",
)
async def readiness() -> JSONResponse:
    """Calls db_manager.health_check() directly — no session allocation overhead."""
    db_ok = await db_manager.health_check()

    checks = {"database": "ok" if db_ok else "unreachable"}
    all_healthy = all(v == "ok" for v in checks.values())
    http_status = status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(
        status_code=http_status,
        content={
            "status": "ready" if all_healthy else "degraded",
            "checks": checks,
            "app": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "env": settings.APP_ENV,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
