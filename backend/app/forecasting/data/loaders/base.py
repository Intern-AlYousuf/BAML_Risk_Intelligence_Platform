"""Abstract base loader for all time-series data sources.

All loaders — FRED, platform DB, Bloomberg adapters — must implement this
interface so that the preprocessing pipeline and forecasting service can
consume any source without coupling to its retrieval details.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date

import pandas as pd

from app.forecasting.base import DateRange, SeriesMetadata


class TimeSeriesLoader(ABC):
    """Contract for a time-series data source.

    Implementations should be stateless with respect to individual requests.
    HTTP / DB connections are injected at construction time and reused across
    multiple `load` calls to amortise connection overhead.

    Return convention
    -----------------
    `load` must return a pd.Series whose:
    - index is a ``pd.DatetimeIndex`` in ascending order
    - name is the ``series_id`` argument
    - values are floats (NaN allowed; callers clean separately)
    """

    @abstractmethod
    async def load(
        self,
        series_id: str,
        date_range: DateRange,
    ) -> pd.Series:
        """Fetch raw observations for *series_id* within *date_range*.

        Parameters
        ----------
        series_id:
            Vendor-specific identifier (e.g. FRED series code ``"SOFR"``).
        date_range:
            Inclusive start/end.  Loaders should pass these bounds to the
            upstream API rather than post-filtering a larger fetch.

        Returns
        -------
        pd.Series
            Float series with DatetimeIndex; name set to *series_id*.
            Missing values encoded as NaN, not as 0 or sentinel strings.
        """
        ...

    @abstractmethod
    def get_metadata(self, series_id: str) -> SeriesMetadata:
        """Return static metadata for *series_id* known to this loader.

        Does not make a network call — metadata is defined in the loader's
        internal catalogue or the global series registry.
        """
        ...

    @abstractmethod
    def supports(self, series_id: str) -> bool:
        """Return True if this loader knows how to fetch *series_id*."""
        ...


class LoaderError(Exception):
    """Raised when a loader cannot retrieve data.

    Wraps upstream HTTP errors, DB errors, or data-quality failures so that
    callers have a single exception type to handle.
    """

    def __init__(
        self,
        series_id: str,
        reason: str,
        *,
        upstream: Exception | None = None,
    ) -> None:
        self.series_id = series_id
        self.reason    = reason
        self.upstream  = upstream
        super().__init__(f"[{series_id}] {reason}")


class SeriesNotFoundError(LoaderError):
    """Raised when the upstream API has no data for the requested series."""
