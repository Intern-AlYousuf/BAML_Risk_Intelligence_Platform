"""Forecasting data service — the orchestration layer.

This service sits between the API routes (or future background job workers)
and the low-level data loaders / preprocessing pipeline.  Routes should call
this service; they should never instantiate loaders or pipelines directly.

Responsibilities
----------------
1. Resolve the series registry entry for a requested ``series_id``.
2. Select and instantiate the correct loader (FRED vs. DB).
3. Execute the loader to get raw data.
4. Run the preprocessing pipeline appropriate for the asset class.
5. Return a ``ForecastInput`` ready for model consumption.

Dependency injection
--------------------
``ForecastingDataService`` is constructed with the HTTP client and (optionally)
the DB session so that both can be managed by FastAPI's dependency system
without tight coupling.  See ``get_forecasting_data_service`` at the bottom.

Usage in a route
----------------
    @router.get("/sofr/history")
    async def sofr_history(
        service: ForecastingDataService = Depends(get_forecasting_data_service),
    ) -> dict:
        result = await service.load_sofr(lookback_years=5)
        return result.summary
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import AsyncIterator

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ExternalServiceError, NotFoundError
from app.core.logging import get_logger
from app.forecasting.base import AssetClass, DateRange, ForecastHorizon, ForecastInput
from app.forecasting.data.loaders.base import LoaderError, SeriesNotFoundError
from app.forecasting.data.loaders.db import DBLoader
from app.forecasting.data.loaders.fred import FREDLoader
from app.forecasting.data.preprocessing.pipeline import PreprocessingPipeline
from app.forecasting.data.registry import SeriesConfig, get_series_config

logger = get_logger(__name__)


class ForecastingDataService:
    """Orchestrates data loading and preprocessing for the forecasting engine.

    Parameters
    ----------
    http_client:
        Shared httpx.AsyncClient.  Do not close it inside this class; the
        caller / lifespan handler owns its lifecycle.
    db:
        Optional async SQLAlchemy session.  Required only when loading series
        with ``loader="db"`` from the registry.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        db:          AsyncSession | None = None,
    ) -> None:
        self._http = http_client
        self._db   = db

    # ── Primary interface ─────────────────────────────────────────────────────

    async def load_and_preprocess(
        self,
        series_id:      str,
        start:          date,
        end:            date,
    ) -> ForecastInput:
        """Load *series_id* for [start, end] and run the preprocessing pipeline.

        Parameters
        ----------
        series_id:
            Platform-internal series identifier (e.g. ``"SOFR"``, ``"USD_INR"``).
        start, end:
            Inclusive date range.

        Returns
        -------
        ForecastInput
            Cleaned levels + derived features, ready for model consumption.

        Raises
        ------
        NotFoundError
            Series is not in the registry.
        ExternalServiceError
            Loader failed (network error, FRED 5xx, DB unreachable).
        ValueError
            Preprocessed series has fewer points than the configured minimum.
        """
        try:
            config = get_series_config(series_id)
        except KeyError as exc:
            raise NotFoundError(str(exc)) from exc

        date_range = DateRange(start=start, end=end)

        logger.info(
            "forecasting_data.load.start",
            series_id=series_id,
            loader=config.loader,
            start=str(start),
            end=str(end),
        )

        raw = await self._load_raw(config, date_range)
        result = self._preprocess(config, raw)

        logger.info(
            "forecasting_data.load.done",
            series_id=series_id,
            **{k: v for k, v in result.summary.items() if k not in ("series_id", "flags")},
            flags=result.summary["flags"],
        )

        return result

    # ── Convenience methods for known series ─────────────────────────────────

    async def load_sofr(
        self,
        *,
        lookback_years: int | None = None,
        start:          date | None = None,
        end:            date | None = None,
    ) -> ForecastInput:
        """Load and preprocess SOFR overnight rate.

        At least one of *lookback_years* or *start* must be provided.

        Parameters
        ----------
        lookback_years:
            Calendar years of history to load (counted back from today / *end*).
            Defaults to ``settings.FORECAST_DEFAULT_LOOKBACK_YEARS``.
        start, end:
            Explicit date range.  *end* defaults to today.
        """
        start, end = _resolve_date_range(
            start=start,
            end=end,
            lookback_years=lookback_years
            or settings.FORECAST_DEFAULT_LOOKBACK_YEARS,
        )
        return await self.load_and_preprocess("SOFR", start=start, end=end)

    async def load_sofr_averages(
        self,
        *,
        lookback_years: int | None = None,
        start:          date | None = None,
        end:            date | None = None,
    ) -> dict[str, ForecastInput]:
        """Load SOFR overnight + three compounded averages concurrently.

        Returns a dict keyed by series_id: ``SOFR``, ``SOFR_30D``, ``SOFR_90D``,
        ``SOFR_180D``.
        """
        import asyncio

        start, end = _resolve_date_range(
            start=start,
            end=end,
            lookback_years=lookback_years
            or settings.FORECAST_DEFAULT_LOOKBACK_YEARS,
        )

        tasks = {
            sid: self.load_and_preprocess(sid, start=start, end=end)
            for sid in ["SOFR", "SOFR_30D", "SOFR_90D", "SOFR_180D"]
        }

        results: dict[str, ForecastInput] = {}
        for sid, coro in tasks.items():
            try:
                results[sid] = await coro
            except (NotFoundError, ExternalServiceError, ValueError) as exc:
                logger.warning(
                    "forecasting_data.sofr_averages.partial_failure",
                    series_id=sid,
                    error=str(exc),
                )
        return results

    async def load_fx_rate(
        self,
        series_id: str,
        *,
        lookback_years: int | None = None,
        start:          date | None = None,
        end:            date | None = None,
    ) -> ForecastInput:
        """Load and preprocess an FX spot rate (``USD_INR``, ``USD_NGN``).

        Parameters
        ----------
        series_id:
            ``"USD_INR"`` or ``"USD_NGN"``.  Both must be in the registry.
        """
        config = get_series_config(series_id)
        if config.metadata.asset_class != AssetClass.FX:
            raise ValueError(
                f"'{series_id}' is asset class "
                f"'{config.metadata.asset_class.value}', not FX"
            )

        start, end = _resolve_date_range(
            start=start,
            end=end,
            lookback_years=lookback_years
            or settings.FORECAST_DEFAULT_LOOKBACK_YEARS,
        )
        return await self.load_and_preprocess(series_id, start=start, end=end)

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _load_raw(
        self,
        config:     SeriesConfig,
        date_range: DateRange,
    ):
        """Dispatch to the right loader and return a raw pd.Series."""
        try:
            if config.loader == "fred":
                loader = FREDLoader(client=self._http)
                return await loader.load(
                    series_id=config.fred_series_id,  # type: ignore[arg-type]
                    date_range=date_range,
                )
            else:  # "db"
                if self._db is None:
                    raise RuntimeError(
                        f"Series '{config.series_id}' requires a DB session "
                        "but none was provided to ForecastingDataService"
                    )
                loader = DBLoader(session=self._db)
                return await loader.load(
                    series_id=config.db_ticker,  # type: ignore[arg-type]
                    date_range=date_range,
                )

        except SeriesNotFoundError as exc:
            raise NotFoundError(
                f"Series '{config.series_id}' not found upstream: {exc}"
            ) from exc

        except LoaderError as exc:
            raise ExternalServiceError(
                f"Failed to load '{config.series_id}': {exc}"
            ) from exc

    def _preprocess(
        self,
        config: SeriesConfig,
        raw,
    ) -> ForecastInput:
        """Run the pipeline appropriate for the series' asset class."""
        pipeline = PreprocessingPipeline.for_asset_class(
            asset_class=config.metadata.asset_class,
            metadata=config.metadata,
        )
        return pipeline.run(raw, series_id=config.series_id)


# ── Date range helpers ────────────────────────────────────────────────────────


def _resolve_date_range(
    *,
    start:          date | None,
    end:            date | None,
    lookback_years: int,
) -> tuple[date, date]:
    """Resolve optional start/end into a concrete date range.

    Logic:
    - ``end`` defaults to today.
    - ``start`` defaults to ``end - lookback_years * 365 days``.
    """
    resolved_end   = end   or date.today()
    resolved_start = start or (resolved_end - timedelta(days=lookback_years * 365))
    return resolved_start, resolved_end


# ── FastAPI dependency factory ────────────────────────────────────────────────


async def get_forecasting_data_service(
    # db: AsyncSession = Depends(get_db),  # uncomment when DB is available
) -> AsyncIterator[ForecastingDataService]:
    """FastAPI dependency that provides a scoped ForecastingDataService.

    The HTTP client is created per-request and closed on exit.  In production,
    replace this with a lifespan-managed client shared across requests.

    Usage in a route
    ----------------
        from fastapi import Depends
        from app.services.forecasting_data_service import (
            ForecastingDataService, get_forecasting_data_service
        )

        @router.get("/sofr/history")
        async def get_sofr(
            service: ForecastingDataService = Depends(get_forecasting_data_service)
        ):
            result = await service.load_sofr(lookback_years=5)
            return result.summary
    """
    async with httpx.AsyncClient(
        timeout=settings.FRED_REQUEST_TIMEOUT_SECONDS,
        headers={"User-Agent": f"{settings.APP_NAME}/{settings.APP_VERSION}"},
    ) as client:
        yield ForecastingDataService(http_client=client, db=None)
