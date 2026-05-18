"""Platform database time-series loader.

Loads market data from the platform's own ``market_data`` table via
async SQLAlchemy.  This is the authoritative source for data that has been
ingested and validated by the platform (e.g. data from Bloomberg, custom
feeds, or manually uploaded CSVs).

For external series that are not yet in the DB (e.g. SOFR before ingestion),
use FREDLoader instead and ingest the result via MarketDataService.
"""
from __future__ import annotations

from datetime import date

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.forecasting.base import (
    AssetClass,
    DataSource,
    DateRange,
    SeriesFrequency,
    SeriesMetadata,
)
from app.forecasting.data.loaders.base import (
    LoaderError,
    SeriesNotFoundError,
    TimeSeriesLoader,
)
from app.models.market_data import MarketData

logger = get_logger(__name__)

# Column used as the primary value for time-series modelling.
# Adjusted close is preferred where available; raw close as fallback.
_VALUE_COLUMN = "close_price"


class DBLoader(TimeSeriesLoader):
    """Loads time-series from the platform's ``market_data`` table.

    Parameters
    ----------
    session:
        Async SQLAlchemy session.  The caller is responsible for lifecycle
        management (commit / rollback / close).
    """

    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    # ── Public interface ──────────────────────────────────────────────────────

    def supports(self, series_id: str) -> bool:
        # The DB loader is source-agnostic: it trusts that any ticker stored in
        # the market_data table can be retrieved.  Unknown tickers return an
        # empty series rather than raising (see `load`).
        return True

    def get_metadata(self, series_id: str) -> SeriesMetadata:
        # DB loader cannot supply rich metadata without a round-trip to the DB.
        # Callers that need full metadata should query the series registry, which
        # has static definitions for all known platform tickers.
        return SeriesMetadata(
            series_id=series_id,
            name=series_id,
            asset_class=AssetClass.EQUITY,   # unknown until registry lookup
            frequency=SeriesFrequency.DAILY,
            source=DataSource.PLATFORM,
            units="unknown",
            source_id=series_id,
        )

    async def load(
        self,
        series_id: str,
        date_range: DateRange,
    ) -> pd.Series:
        """Query ``market_data`` for *series_id* within *date_range*.

        The ``ticker`` column is matched case-sensitively against *series_id*.
        ``close_price`` is used as the series value; rows with NULL close_price
        are included as NaN so the caller's cleaner can decide how to handle
        them.

        Returns
        -------
        pd.Series
            Float64 series with DatetimeIndex; name = *series_id*.
            Empty series (len=0) if no rows are found — caller must decide
            whether to fall back to another loader.
        """
        logger.info(
            "db_loader.load.start",
            series_id=series_id,
            start=str(date_range.start),
            end=str(date_range.end),
        )

        try:
            stmt = (
                select(MarketData.data_date, MarketData.close_price)
                .where(MarketData.ticker == series_id)
                .where(MarketData.data_date >= date_range.start)
                .where(MarketData.data_date <= date_range.end)
                .order_by(MarketData.data_date.asc())
            )
            result = await self._db.execute(stmt)
            rows   = result.all()
        except Exception as exc:
            raise LoaderError(
                series_id,
                f"DB query failed: {exc}",
                upstream=exc,
            ) from exc

        if not rows:
            logger.warning(
                "db_loader.load.empty",
                series_id=series_id,
                start=str(date_range.start),
                end=str(date_range.end),
            )
            return pd.Series(dtype="float64", name=series_id)

        dates  = [pd.Timestamp(r.data_date) for r in rows]
        values = [float(r.close_price) if r.close_price is not None else float("nan")
                  for r in rows]

        series = pd.Series(
            values,
            index=pd.DatetimeIndex(dates, name="date"),
            dtype="float64",
            name=series_id,
        )

        logger.info(
            "db_loader.load.complete",
            series_id=series_id,
            n_rows=len(series),
            n_missing=int(series.isna().sum()),
        )

        return series
