"""SOFR Forecasting Service — async orchestration layer.

Sits between the API routes and the CPU-bound engine.  The data loading step
is async (FRED HTTP call); the ARIMA fitting step is synchronous and CPU-bound.
Fitting is offloaded to the default thread-pool executor so FastAPI's async
event loop is never blocked.

Dependency injection
--------------------
``get_sofr_forecast_service`` is a FastAPI dependency factory.  Routes should
declare it as a ``Depends()`` parameter rather than constructing the service
directly.

Typical route usage
-------------------
    @router.get("/sofr/forecast")
    async def get_sofr_forecast(
        horizon: int = Query(365),
        service: SOFRForecastService = Depends(get_sofr_forecast_service),
    ) -> dict:
        output = await service.run_forecast(horizon_calendar_days=horizon)
        return output.to_dict()
"""
from __future__ import annotations

import asyncio
import functools
from datetime import date
from typing import AsyncIterator

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.forecasting.simulations.config import MonteCarloConfig
from app.forecasting.sofr.engine import (
    SOFRForecastConfig,
    SOFRForecastEngine,
    SOFRForecastOutput,
)
from app.services.forecasting_data_service import ForecastingDataService

logger = get_logger(__name__)

# Named horizons for validation and logging.
VALID_HORIZONS_CALENDAR: frozenset[int] = frozenset({90, 180, 365, 730})


class SOFRForecastService:
    """Async wrapper around the synchronous ``SOFRForecastEngine``.

    Parameters
    ----------
    data_service:
        ``ForecastingDataService`` for loading and preprocessing SOFR data
        from FRED.
    config:
        Engine configuration.  The endpoint can override this per-request by
        constructing a new service with a custom config.
    """

    def __init__(
        self,
        data_service: ForecastingDataService,
        config:       SOFRForecastConfig | None = None,
    ) -> None:
        self._data   = data_service
        self._config = config or SOFRForecastConfig()

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
        """Load SOFR data and run the forecast engine.

        Parameters
        ----------
        horizon_calendar_days:
            Calendar days to forecast ahead.  Converted to business days
            inside the engine.  Typical values: 90, 180, 365, 730.
        lookback_years:
            Years of history to load for model training.  Defaults to
            ``settings.FORECAST_DEFAULT_LOOKBACK_YEARS``.
        start, end:
            Override the date range explicitly.  ``end`` defaults to today.
        arima_order:
            Force a specific (p, d, q) order.  ``None`` = auto-select via AIC.
        enable_backtest:
            Run walk-forward backtest in addition to the primary forecast.
        run_diagnostics:
            Run residual diagnostics on the fitted model.

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

        # ── Step 1: load + preprocess SOFR (async — FRED HTTP call) ───────
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

        # ── Step 2: build engine config ────────────────────────────────────
        mc_cfg = MonteCarloConfig(
            n_simulations=n_simulations,
            mode=simulation_mode,
            seed=simulation_seed,
            floor=self._config.floor,
            ceiling=self._config.ceiling,
        ) if enable_simulation else MonteCarloConfig.fast()

        engine_config = SOFRForecastConfig(
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

        # ── Step 3: run engine in thread pool (CPU-bound) ─────────────────
        loop = asyncio.get_running_loop()

        logger.info("sofr_service.engine.submit")

        output: SOFRForecastOutput = await loop.run_in_executor(
            None,
            functools.partial(
                engine.run,
                forecast_input=forecast_input,
                horizon_calendar_days=horizon_calendar_days,
            ),
        )

        logger.info(
            "sofr_service.engine.done",
            fitted_order=output.fitted_order,
            n_forecast=output.forecast.n_forecast_points,
            fit_time_s=output.fit_wall_time_s,
        )

        return output

    # ── Convenience thin wrappers ─────────────────────────────────────────────

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
    1. Opens an httpx.AsyncClient for the FRED loader.
    2. Constructs ForecastingDataService and SOFRForecastService.
    3. Yields the service to the route handler.
    4. Closes the HTTP client on exit (even on exception).

    In production, replace the per-request client with a lifespan-managed
    client to reduce TLS handshake overhead on burst traffic.
    """
    async with httpx.AsyncClient(
        timeout=settings.FRED_REQUEST_TIMEOUT_SECONDS,
        headers={"User-Agent": f"{settings.APP_NAME}/{settings.APP_VERSION}"},
    ) as http_client:
        data_service   = ForecastingDataService(http_client=http_client)
        forecast_service = SOFRForecastService(data_service=data_service)
        yield forecast_service
