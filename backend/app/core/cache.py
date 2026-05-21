"""In-memory TTL forecast cache.

Design goals
------------
- Zero external infrastructure (no Redis, no Celery, no DB).
- Thread-safe: a ``threading.Lock`` guards all mutations so the cache is safe
  when uvicorn runs concurrent requests or dispatches blocking calls to the
  default thread-pool executor.
- Single shared instance per process: imported once at module load time and
  reused across all requests in the same uvicorn worker.
- Caches the final serialised Pydantic schema object so the entire ARIMA +
  Monte Carlo pipeline is bypassed on cache hits.

Cache key contract
------------------
Keys are plain tuples — callers choose the fields.  Recommended conventions:

    SOFR Monte Carlo : ("sofr", horizon_days: int, n_simulations: int)
    FX   Monte Carlo : ("fx",   pair: str, horizon_days: int, n_simulations: int)

Usage
-----
    from app.core.cache import forecast_cache_get, forecast_cache_set

    key    = ("sofr", 365, 10_000)
    cached = forecast_cache_get(key)
    if cached is None:
        cached = expensive_computation()
        forecast_cache_set(key, cached)
    return cached
"""
from __future__ import annotations

import threading
from typing import Any, Hashable

from cachetools import TTLCache

# ── Configuration ─────────────────────────────────────────────────────────────

#: Maximum distinct entries to hold in memory at once.
#: 64 entries is generous — the frontend uses fewer than 10 distinct param combos
#: (3 horizons × 3 FX pairs + SOFR × 3 horizons = 12 at most).
_MAX_ENTRIES: int = 64

#: Seconds before a cached entry expires and triggers recomputation on the next
#: request.  10 minutes balances freshness vs. cost of ARIMA + MC recomputation.
FORECAST_CACHE_TTL: int = 600  # 10 minutes

# ── Module-level singleton ────────────────────────────────────────────────────

_cache: TTLCache = TTLCache(maxsize=_MAX_ENTRIES, ttl=FORECAST_CACHE_TTL)

# stdlib Lock is used rather than asyncio.Lock because the cache may be
# accessed from both the async event loop and uvicorn's thread-pool executor
# (e.g. if a sync database call is awaited via run_in_executor).
_lock: threading.Lock = threading.Lock()


# ── Public API ────────────────────────────────────────────────────────────────


def forecast_cache_get(key: Hashable) -> Any | None:
    """Return the cached value for *key*, or ``None`` if absent or expired."""
    with _lock:
        return _cache.get(key)


def forecast_cache_set(key: Hashable, value: Any) -> None:
    """Store *value* under *key* with the module-level TTL.

    If the cache is at capacity, cachetools evicts the entry whose TTL
    expires soonest (TTLCache inherits LRU eviction on overflow).
    """
    with _lock:
        _cache[key] = value


def forecast_cache_clear() -> int:
    """Evict all entries and return the count removed.

    Useful in development / tests when you want to force recomputation
    without restarting the server.
    """
    with _lock:
        count: int = len(_cache)
        _cache.clear()
        return count


def forecast_cache_info() -> dict[str, Any]:
    """Return a snapshot of current cache stats.

    Suitable for a /health or /debug endpoint.
    """
    with _lock:
        return {
            "size":     len(_cache),
            "maxsize":  _cache.maxsize,
            "ttl_s":    _cache.ttl,
            "currsize": _cache.currsize,
        }
