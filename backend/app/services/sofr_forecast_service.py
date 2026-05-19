"""SOFR Forecasting Service — async orchestration layer.

Sits between the API routes and the CPU-bound engine.

Data loading steps are async (FRED HTTP calls); SARIMAX/ARIMA fitting is
synchronous and CPU-bound.  Fitting is offloaded to the default thread-pool
executor so FastAPI's async event loop is never blocked.

Exogenous loading (Phase 2)
---------------------------
When ``config.use_exogenous=True`` (the default), the service loads six macro
variables from FRED concurrently alongside SOFR.  The resulting DataFrame is
passed to ``engine.run()`` so the engine can use SARIMAX delta forecasting.

If any exogenous load fails (network error, missing FRED key for a series)
the service logs a warning and passes ``exog_df=None``.  The engine detects
this and automatically falls back to the ARIMA levels pipeline — existing
API behaviour is preserved.

Dependency injection
--------------------
``get_sofr_forecast_service`` is a FastAPI dependency factory that manages
httpx client lifecycle and injects a ``FREDLoader`` alongside the existing
``ForecastingDataService``.
"""
from __future__ import annotations

import asyncio
import functools
from datetime import date
from typing import AsyncIterator

import httpx
import pandas as pd

from app.core.config import settings
from app.core.logging import get_logger
from app.forecasting.data.exogenous import build_exogenous_dataframe
from app.forecasting.data.loaders.fred import FREDLoader
from app.forecasting.simulations.config import MonteCarloConfig
from app.forecasting.sofr.engine import (
    SOFRForecastConfig,
    SOFRForecastEngine,
    SOFRForecastOutput,
)
from app.services.forecasting_data_service import ForecastingDataService

logger = get_logger(__name__)

VALID_HORIZONS_CALENDAR: frozenset[int] = frozenset({90, 180, 365, 730})


class SOFRForecastService:
    """Async wrapper around the synchronous ``SOFRForecastEngine``.

    Parameters
    ----------
    data_service:
        ``ForecastingDataService`` for loading and preprocessing SOFR.
    fred_loader:
        Authenticated ``FREDLoader`` used for macro exogenous variables.
        When ``None``, exogenous loading is skipped and the engine uses
        the ARIMA fallback.
    config:
        Engine configuration.
    """

    def __init__(
        self,
        data_service: ForecastingDataService,
        fred_loader:  FREDLoader | None         = None,
        config:       SOFRForecastConfig | None = None,
    ) -> None:
        self._data        = data_service
        self._fred_loader = fred_loader
        self._config      = config or SOFRForecastConfig()

    # ── Primary method ────────────────────────────────────────────────────────

    async def run_forecast(
        self,
        *,
        horizon_calendar_days: int = 365,
        lookback_years:        int | None = None,
        start:                 date | None = None,
        end:                   date | None = None,
        arima_order:           tuple[int, int, int] | None = None,
        enable_backtest:       bool = False,
        run_diagnostics:       bool = True,
        enable_simulation:     bool = False,
        n_simulations:         int  = 10_000,
        simulation_mode:       str  = "bootstrap",
        simulation_seed:       int | None = None,
    ) -> SOFRForecastOutput:
        """Load SOFR (+ macro features) and run the forecast engine.

        Parameters
        ----------
        horizon_calendar_days:
            Calendar days ahead to forecast.  Converted to business days
            inside the engine.
        lookback_years:
            Years of SOFR history to load.  Defaults to
            ``settings.FORECAST_DEFAULT_LOOKBACK_YEARS``.
        start, end:
            Explicit date range override.
        arima_order:
            Force ARIMA(p,d,q).  ``None`` = auto-select via AIC.
        enable_backtest:
            Walk-forward backtest (adds latency).
        run_diagnostics:
            Residual diagnostics (negligible overhead).
        enable_simulation:
            Monte Carlo simulation with n_simulations paths.

        Returns
        -------
        SOFRForecastOutput
        """
        if horizon_calendar_days not in VALID_HORIZONS_CALENDAR:
            logger.warning(
                "sofr_service.non_standard_horizon",
                horizon=horizon_calendar_days,
                valid=sorted(VALID_HORIZONS_CALENDAR),
            )

        # ── Step 1: load SOFR (async FRED call) ───────────────────────────
        logger.info(
            "sofr_service.data_load.start",
            horizon=horizon_calendar_days,
            lookback_years=lookback_years,
        )

        forecast_input = await self._data.load_sofr(
            lookback_years=lookback_years,
            start=start,
            end=end,
        )

        logger.info(
            "sofr_service.data_load.done",
            n_clean=forecast_input.n_clean,
            series_start=str(forecast_input.date_range.start),
            series_end=str(forecast_input.date_range.end),
        )

        # ── Step 2: load macro exogenous features (async, concurrent) ─────
        exog_df: pd.DataFrame | None = None
        if self._config.use_exogenous and self._fred_loader is not None:
            exog_df = await self._load_exogenous(
                sofr_index    = forecast_input.levels.dropna().index,
                lookback_years= lookback_years or getattr(
                    settings, "FORECAST_DEFAULT_LOOKBACK_YEARS", 5
                ),
            )

        # ── Step 3: build engine config ────────────────────────────────────
        mc_cfg = (
            MonteCarloConfig(
                n_simulations = n_simulations,
                mode          = simulation_mode,
                seed          = simulation_seed,
                floor         = self._config.floor,
                ceiling       = self._config.ceiling,
            )
            if enable_simulation
            else MonteCarloConfig.fast()
        )

        engine_config = SOFRForecastConfig(
            forecast_mode     = self._config.forecast_mode,
            use_exogenous     = self._config.use_exogenous,
            arima_order       = arima_order or self._config.arima_order,
            max_p             = self._config.max_p,
            max_q             = self._config.max_q,
            d_fixed           = self._config.d_fixed,
            test_size         = self._config.test_size,
            floor             = self._config.floor,
            ceiling           = self._config.ceiling,
            enable_backtest   = enable_backtest,
            n_backtest_splits = self._config.n_backtest_splits,
            run_diagnostics   = run_diagnostics,
            enable_simulation = enable_simulation,
            mc_config         = mc_cfg,
        )

        engine = SOFRForecastEngine(config=engine_config)

        # ── Step 4: run engine in thread pool (CPU-bound) ─────────────────
        loop = asyncio.get_running_loop()

        logger.info(
            "sofr_service.engine.submit",
            forecast_mode=engine_config.forecast_mode,
            exog_features=(
                list(exog_df.columns) if exog_df is not None else None
            ),
        )

        output: SOFRForecastOutput = await loop.run_in_executor(
            None,
            functools.partial(
                engine.run,
                forecast_input        = forecast_input,
                horizon_calendar_days = horizon_calendar_days,
                exog_df               = exog_df,
            ),
        )

        logger.info(
            "sofr_service.engine.done",
            fitted_order = output.fitted_order,
            model_name   = output.forecast.model_name,
            n_forecast   = output.forecast.n_forecast_points,
            fit_time_s   = output.fit_wall_time_s,
        )

        return output

    # ── Exogenous loading ─────────────────────────────────────────────────────

    async def _load_exogenous(
        self,
        sofr_index:     pd.DatetimeIndex,
        lookback_years: int,
    ) -> pd.DataFrame | None:
        """Load macro exogenous features from FRED.

        Returns ``None`` on failure so the engine falls back to ARIMA.
        """
        try:
            exog_df = await build_exogenous_dataframe(
                fred_loader    = self._fred_loader,
                sofr_index     = sofr_index,
                lookback_years = max(lookback_years, 7),  # CPI YoY needs ≥12M
            )
            logger.info(
                "sofr_service.exog.loaded",
                shape=str(exog_df.shape),
                features=list(exog_df.columns),
            )
            return exog_df if not exog_df.empty else None
        except Exception as exc:
            logger.warning(
                "sofr_service.exog.load_failed",
                error=str(exc),
                fallback="ARIMA levels pipeline (no exog)",
            )
            return None

    # ── Convenience wrappers ──────────────────────────────────────────────────

    async def forecast_3m(self, **kwargs) -> SOFRForecastOutput:
        return await self.run_forecast(horizon_calendar_days=90, **kwargs)

    async def forecast_6m(self, **kwargs) -> SOFRForecastOutput:
        return await self.run_forecast(horizon_calendar_days=180, **kwargs)

    async def forecast_12m(self, **kwargs) -> SOFRForecastOutput:
        return await self.run_forecast(horizon_calendar_days=365, **kwargs)

    async def forecast_24m(self, **kwargs) -> SOFRForecastOutput:
        return await self.run_forecast(horizon_calendar_days=730, **kwargs)


# ── FastAPI dependency factory ────────────────────────────────────────────────


async def get_sofr_forecast_service() -> AsyncIterator[SOFRForecastService]:
    """FastAPI dependency — provides a scoped SOFRForecastService.

    Lifecycle:
    1. Opens a single httpx.AsyncClient (reused for SOFR + all exog loaders).
    2. Constructs ForecastingDataService and FREDLoader sharing the client.
    3. Constructs SOFRForecastService with both.
    4. Yields the service.
    5. Closes the HTTP client on exit (even on exception).
    """
    async with httpx.AsyncClient(
        timeout=settings.FRED_REQUEST_TIMEOUT_SECONDS,
        headers={"User-Agent": f"{settings.APP_NAME}/{settings.APP_VERSION}"},
    ) as http_client:
        data_service     = ForecastingDataService(http_client=http_client)
        fred_loader      = FREDLoader(client=http_client)   # shares the client
        forecast_service = SOFRForecastService(
            data_service = data_service,
            fred_loader  = fred_loader,
        )
        yield forecast_service
