import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger

logger = get_logger(__name__)

PROCESS_TIME_HEADER = "X-Process-Time-Ms"


class TimingMiddleware(BaseHTTPMiddleware):
    """Record wall-clock latency for every request.

    Adds X-Process-Time-Ms to the response and emits a structured log line
    so latency is observable in both the client and the log aggregator.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

        response.headers[PROCESS_TIME_HEADER] = str(elapsed_ms)

        logger.info(
            "request.completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=elapsed_ms,
            request_id=getattr(request.state, "request_id", None),
        )
        return response
