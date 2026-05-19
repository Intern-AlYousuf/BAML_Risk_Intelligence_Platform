"""FX Forecasting Service — async orchestration layer.

Sits between the API routes and the CPU-bound FX engine.

Data loading (async)  →  preprocessing  →  engine.run() in thread pool

The service owns the full request lifecycle:
1. Validate the pair against the registry.
2. Load FX history from Yahoo Finance (async, thread pool).
3. Run the preprocessing pipeline on the raw series.
4. Build engine configuration from request parameters.
5. Run the engine synchronously in ``loop.run_in_executor``.
6. Return ``FXForecastOutput``.
"""
from __future__ import annotations

import asyncio
import functools
from datetime import date

from app.core.config import settings
from app.core.logging import get_logger
from app.forecasting.base import AssetClass, DataSource, DateRange, SeriesFrequency, SeriesMetadata
from app.forecasting.data.preprocessing.pipeline import PreprocessingPipeline
from app.forecasting.fx.engine import FXForecastConfig, FXForecastEngine, FXForecastOutput
from app.forecasting.fx.loader import load_fx_levels
from app.forecasting.fx.registry import FXPairConfig, get_pair_config
from app.forecasting.simulations.config import MonteCarloConfig

logger = get_logger(__name__)

VALID_HORIZONS_CALENDAR: frozenset[int] = frozenset({90, 180, 365, 730})


class FXForecastService:
    """Async wrapper around the synchronous ``FXForecastEngine``.

    Parameters
    ----------
    lookback_years:
        Default years of FX history to load when not overridden per request.
    """

    def __init__(self, lookback_years: int | None = None) -> None:
        self._lookback_years = (
            lookback_years
            or getattr(settings, "FORECAST_DEFAULT_LOOKBACK_YEARS", 5)
        )

    async def run_forecast(
        self,
        *,
        pair:                  str,
        horizon_calendar_days: int = 365,
        lookback_years:        int | None = None,
        arima_order:           tuple[int, int, int] | None = None,
        enable_simulation:     bool = False,
        n_simulations:         int = 10_000,
        simulation_mode:       str = "bootstrap",
        simulation_seed:       int | None = None,
    ) -> FXForecastOutput:
        """Load FX data and run the forecast engine.

        Parameters
        ----------
        pair:
            Registered pair ID (e.g. ``"INRUSD"``, ``"NGNUSD"``).
        horizon_calendar_days:
            Calendar days ahead to forecast (90 / 180 / 365 / 730).
        lookback_years:
            Years of history to load.
        arima_order:
            Force ARIMA(p, 0, q).  ``None`` = auto-select.
        enable_simulation:
            Run Monte Carlo after fitting.
        n_simulations:
            Path count for MC.
        simulation_mode:
            ``"bootstrap"`` or ``"parametric"``.
        simulation_seed:
            RNG seed for reproducibility.
        """
        if horizon_calendar_days not in VALID_HORIZONS_CALENDAR:
            logger.warning(
                "fx_service.non_standard_horizon",
                horizon=horizon_calendar_days,
                valid=sorted(VALID_HORIZONS_CALENDAR),
            )

        # ── Resolve pair config ────────────────────────────────────────────
        pair_config: FXPairConfig = get_pair_config(pair)
        effective_lookback = lookback_years or self._lookback_years

        logger.info(
            "fx_service.run_forecast.start",
            pair=pair,
            horizon=horizon_calendar_days,
            lookback_years=effective_lookback,
            enable_simulation=enable_simulation,
        )

        # ── Load FX levels from Yahoo Finance (async) ─────────────────────
        raw_levels = await load_fx_levels(
            yahoo_symbol   = pair_config.yahoo_symbol,
            lookback_years = effective_lookback,
        )

        # ── Preprocess into ForecastInput ──────────────────────────────────
        metadata = SeriesMetadata(
            series_id   = pair,
            name        = pair_config.display_name,
            asset_class = AssetClass.FX,
            frequency   = SeriesFrequency.DAILY,
            source      = DataSource.MANUAL,  # Yahoo Finance
            units       = "local_currency_per_usd",
        )
        pipeline = PreprocessingPipeline.for_fx_rate(metadata)
        forecast_input = pipeline.run(raw_levels, series_id=pair)

        logger.info(
            "fx_service.preprocess.done",
            pair=pair,
            n_clean=forecast_input.n_clean,
            n_gaps_filled=forecast_input.n_gaps_filled,
            sufficient=forecast_input.is_sufficient,
        )

        if not forecast_input.is_sufficient:
            raise ValueError(
                f"FX pair '{pair}' has only {forecast_input.n_clean} clean observations "
                f"(minimum: {settings.FORECAST_MIN_HISTORY_POINTS}).  "
                "Increase lookback_years or verify the Yahoo Finance symbol."
            )

        # ── Build engine config ────────────────────────────────────────────
        mc_cfg = (
            MonteCarloConfig(
                n_simulations = n_simulations,
                mode          = simulation_mode,
                seed          = simulation_seed,
                floor         = pair_config.floor,
                ceiling       = pair_config.ceiling,
            )
            if enable_simulation
            else MonteCarloConfig.fast()
        )

        engine_config = FXForecastConfig(
            arima_order       = arima_order or pair_config.preferred_order,
            enable_simulation = enable_simulation,
            mc_config         = mc_cfg,
        )

        engine = FXForecastEngine(config=engine_config)

        # ── Run engine in thread pool (CPU-bound) ──────────────────────────
        loop = asyncio.get_running_loop()

        logger.info(
            "fx_service.engine.submit",
            pair=pair,
            order=engine_config.arima_order,
            n_simulations=n_simulations if enable_simulation else 0,
        )

        output: FXForecastOutput = await loop.run_in_executor(
            None,
            functools.partial(
                engine.run,
                forecast_input        = forecast_input,
                pair_config           = pair_config,
                horizon_calendar_days = horizon_calendar_days,
            ),
        )

        logger.info(
            "fx_service.engine.done",
            pair=pair,
            fitted_order=output.fitted_order,
            n_forecast=output.forecast.n_forecast_points,
            fit_time_s=output.fit_wall_time_s,
        )

        return output
