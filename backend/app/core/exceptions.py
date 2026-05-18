from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

logger = get_logger(__name__)


# ── Domain exception hierarchy ────────────────────────────────────────────────

class BAMLBaseException(Exception):
    """Root for all domain-specific exceptions."""
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    detail: str = "An unexpected error occurred"

    def __init__(self, detail: str | None = None) -> None:
        self.detail = detail or self.__class__.detail
        super().__init__(self.detail)


class NotFoundError(BAMLBaseException):
    status_code = status.HTTP_404_NOT_FOUND
    detail = "Resource not found"


class ConflictError(BAMLBaseException):
    status_code = status.HTTP_409_CONFLICT
    detail = "Resource already exists"


class ValidationError(BAMLBaseException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    detail = "Validation failed"


class FeatureDisabledError(BAMLBaseException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    detail = "This feature is not enabled on this instance"


class ExternalServiceError(BAMLBaseException):
    status_code = status.HTTP_502_BAD_GATEWAY
    detail = "External service unavailable"


# ── Error response shape ──────────────────────────────────────────────────────

def _error_body(status_code: int, detail: object, request: Request) -> dict:
    return {
        "error": {
            "status": status_code,
            "detail": detail,
            "path": str(request.url.path),
            "request_id": request.state.request_id
            if hasattr(request.state, "request_id")
            else None,
        }
    }


# ── Exception handlers ────────────────────────────────────────────────────────

async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    logger.warning(
        "http_exception",
        status_code=exc.status_code,
        detail=exc.detail,
        path=request.url.path,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.status_code, exc.detail, request),
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger.warning(
        "validation_error",
        errors=exc.errors(),
        path=request.url.path,
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_error_body(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            exc.errors(),
            request,
        ),
    )


async def domain_exception_handler(request: Request, exc: BAMLBaseException) -> JSONResponse:
    logger.warning(
        "domain_exception",
        exc_type=type(exc).__name__,
        detail=exc.detail,
        path=request.url.path,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.status_code, exc.detail, request),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "unhandled_exception",
        exc_type=type(exc).__name__,
        path=request.url.path,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_error_body(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Internal server error",
            request,
        ),
    )
