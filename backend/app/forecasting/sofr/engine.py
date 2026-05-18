"""SOFR Forecasting Engine.

Orchestrates the complete SOFR forecast pipeline:

    ForecastInput  →  stationarity check
                   →  train / test split
                   →  ARIMA fit (auto-order or explicit)
                   →  forecast generation (future horizon)
                   →  residual diagnostics
                   →  optional Monte Carlo simulation
                   →  optional walk-forward backtest
                   →  SOFRForecastOutput

Design decisions
----------------
SOFR is a short-end interest rate anchored by Fed policy.  The series:

1. Is I(1) — first differencing yields approximate stationarity.
2. Has no intraday seasonal pattern at the daily frequency.
3. Occasionally has step-changes (Fed meeting days) that create heavy-tailed
   residuals — accepted rather than modelled.
4. Floor at 0% applies under current conventions.

The engine uses ARIMA(p, 1, q) with auto-selected p, q via AIC minimisation.
A SARIMA extension can be dropped in by subclassing the engine.

Walk-forward backtest
---------------------
When ``enable_backtest=True``, the engine runs 5 expanding-window splits,
each fitting a fresh ARIMA on the training window and forecasting the test
window.  Aggregate and per-split metrics are returned in ``BacktestResult``.

CPU-bound note
--------------
The fitting and backtest steps are synchronous (statsmodels is not async-aware).
The service layer runs this engine in a thread-pool executor so that FastAPI
can continue serving other requests during fitting.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from app.core.config import settings
from app.core.logging import get_logger
from app.forecasting.base import ForecastHorizon, ForecastInput
from app.forecasting.models.arima import ARIMAForecaster, ARIMAOrderConfig
from app.forecasting.models.results import (
    AccuracyMetrics,
    BacktestResult,
    BacktestSplit,
    ForecastResult,
)
from app.forecasting.simulations.config import MonteCarloConfig
from app.forecasting.simulations.engine import MonteCarloEngine, MonteCarloResult
from app.forecasting.sofr.diagnostics import (
    ResidualDiagnostics,
    SOFRStationarityCheck,
    check_residuals,
    check_sofr_stationarity,
)
from app.utils.timeseries import (
    calendar_to_business_days,
    mean_absolute_error,
    mean_absolute_percentage_error,
    root_mean_squared_error,
    train_test_split,
    walk_forward_splits,
)

logger = get_logger(__name__)


# ── Engine configuration ──────────────────────────────────────────────────────


@dataclass
class SOFRForecastConfig:
    """Runtime configuration for a SOFR forecast run.

    Attributes
    ----------
    arima_order:
        Explicit (p, d, q).  ``None`` triggers auto-selection via AIC search.
    max_p, max_q:
        Search bounds for auto-selection.  Ignored when ``arima_order`` is set.
    d_fixed:
        Differencing order.  Default 1 (SOFR levels are I(1)).  Override only
        if a long flat-rate window produces a stationary ADF test.
    test_size:
        Fraction of data held out for accuracy evaluation.  0.0 = no test set.
    floor:
        Post-prediction floor applied to forecasts and CIs.  Default 0.0 —
        SOFR cannot be negative under current monetary policy conventions.
    enable_backtest:
        Run walk-forward backtest in addition to the main forecast.  Adds
        latency; disable for latency-sensitive real-time endpoints.
    n_backtest_splits:
        Number of walk-forward splits (applies only when enable_backtest=True).
    run_diagnostics:
        Run residual diagnostics after fitting.  Negligible overhead.
    """
    arima_order:        tuple[int, int, int] | None = None
    max_p:              int   = 4
    max_q:              int   = 3
    d_fixed:            int   = 1
    test_size:          float = 0.15
    floor:              float = 0.0
    ceiling:            float | None = None
    enable_backtest:    bool  = False
    n_backtest_splits:  int   = 5
    run_diagnostics:    bool  = True

    # ── Monte Carlo simulation ────────────────────────────────────────────
    enable_simulation:  bool               = False
    mc_config:          MonteCarloConfig   = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.mc_config is None:
            object.__setattr__(self, "mc_config", MonteCarloConfig())


# ── Engine output ─────────────────────────────────────────────────────────────


@dataclass
class SOFRForecastOutput:
    """Complete output from a SOFR forecast run.

    Structured to map directly to the API response schema without further
    transformation — the service layer returns this object verbatim.
    """
    # Core forecast
    forecast:          ForecastResult

    # Model configuration
    fitted_order:      tuple[int, int, int]
    order_was_auto:    bool

    # Pre-fit checks
    stationarity:      SOFRStationarityCheck

    # Post-fit checks
    diagnostics:       ResidualDiagnostics | None

    # Optional backtest
    backtest:          BacktestResult | None

    # Optional Monte Carlo simulation
    simulation:        MonteCarloResult | None = None

    # Engine performance
    fit_wall_time_s:   float = 0.0
    series_id:         str   = "SOFR"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "series_id":       self.series_id,
            "fitted_order":    list(self.fitted_order),
            "order_was_auto":  self.order_was_auto,
            "fit_wall_time_s": round(self.fit_wall_time_s, 3),
            "stationarity":    self.stationarity.to_dict(),
            "forecast":        self.forecast.to_dict(),
        }
        if self.diagnostics:
            d["diagnostics"] = self.diagnostics.to_dict()
        if self.backtest:
            d["backtest"] = self.backtest.to_dict()
        if self.simulation:
            d["simulation"] = self.simulation.to_dict()
        return d


# ── Engine ────────────────────────────────────────────────────────────────────


class SOFRForecastEngine:
    """End-to-end SOFR forecasting engine.

    Usage
    -----
        engine = SOFRForecastEngine(config=SOFRForecastConfig())
        output = engine.run(forecast_input, horizon_calendar_days=365)
    """

    def __init__(
        self,
        config: SOFRForecastConfig | None = None,
    ) -> None:
        self._cfg = config or SOFRForecastConfig()

    def run(
        self,
        forecast_input: ForecastInput,
        horizon_calendar_days: int,
    ) -> SOFRForecastOutput:
        """Execute the full SOFR forecast pipeline synchronously.

        Parameters
        ----------
        forecast_input:
            Preprocessed ``ForecastInput`` from ``ForecastingDataService``.
        horizon_calendar_days:
            Calendar days ahead to forecast.  Converted to business days
            internally (252 / 365 convention).

        Returns
        -------
        SOFRForecastOutput
            Full forecast result with metrics and diagnostics.
        """
        cfg = self._cfg

        if not forecast_input.is_sufficient:
            raise ValueError(
                f"Forecast input for '{forecast_input.series_id}' has only "
                f"{forecast_input.n_clean} clean observations — insufficient "
                f"for ARIMA fitting (minimum: {settings.FORECAST_MIN_HISTORY_POINTS})."
            )

        levels = forecast_input.levels.dropna()
        series_id = forecast_input.series_id
        horizon_bdays = calendar_to_business_days(horizon_calendar_days)

        logger.info(
            "sofr_engine.run.start",
            series_id=series_id,
            n_obs=len(levels),
            horizon_calendar=horizon_calendar_days,
            horizon_bdays=horizon_bdays,
            config=_config_summary(cfg),
        )

        # ── Step 1: stationarity check ─────────────────────────────────────
        stationarity = check_sofr_stationarity(levels)

        # ── Step 2: train / test split ─────────────────────────────────────
        if cfg.test_size > 0:
            split     = train_test_split(levels, test_size=cfg.test_size)
            train_ser = split.train
            test_ser  = split.test
        else:
            train_ser = levels
            test_ser  = pd.Series(dtype="float64")

        logger.info(
            "sofr_engine.split",
            n_train=len(train_ser),
            n_test=len(test_ser),
            train_end=str(train_ser.index[-1].date()),
        )

        # ── Step 3: build forecaster ───────────────────────────────────────
        order_config = ARIMAOrderConfig(
            max_p=cfg.max_p,
            max_q=cfg.max_q,
            d_fixed=cfg.d_fixed,
        )

        forecaster = ARIMAForecaster(
            order=cfg.arima_order,
            order_config=order_config,
            floor=cfg.floor,
            ceiling=cfg.ceiling,
        )

        order_was_auto = cfg.arima_order is None

        # ── Step 4: fit ────────────────────────────────────────────────────
        t0 = time.perf_counter()
        forecaster.fit(train_ser)
        fit_elapsed = time.perf_counter() - t0

        fitted_order = forecaster.fitted_order or (2, 1, 2)

        logger.info(
            "sofr_engine.fit.done",
            order=fitted_order,
            fit_time_s=round(fit_elapsed, 3),
            aic=round(forecaster.get_fit_metrics().aic, 3),
        )

        # ── Step 5: generate forecast ──────────────────────────────────────
        forecast_result = forecaster.predict(
            horizon=horizon_bdays,
            alpha_outer=0.10,
            alpha_inner=0.50,
        )
        forecast_result.series_id = series_id

        # ── Step 6: accuracy on test set ───────────────────────────────────
        accuracy: AccuracyMetrics | None = None
        if len(test_ser) > 0:
            try:
                accuracy = forecaster.evaluate_on_test(test_ser)
                forecast_result.accuracy = accuracy
                logger.info(
                    "sofr_engine.accuracy",
                    mae=round(accuracy.mae, 6),
                    rmse=round(accuracy.rmse, 6),
                    mape=round(accuracy.mape, 4),
                )
            except Exception as exc:
                logger.warning("sofr_engine.accuracy.failed", error=str(exc))

        # ── Step 7: residual diagnostics ───────────────────────────────────
        diagnostics: ResidualDiagnostics | None = None
        if cfg.run_diagnostics:
            try:
                residuals    = np.array(forecaster._result.resid)
                diagnostics  = check_residuals(residuals)
            except Exception as exc:
                logger.warning("sofr_engine.diagnostics.failed", error=str(exc))

        # ── Step 8: Monte Carlo simulation ─────────────────────────────────
        simulation: MonteCarloResult | None = None
        if cfg.enable_simulation:
            try:
                mc_cfg = cfg.mc_config
                # Auto-populate snapshot horizons for multi-band fan charts
                # if not explicitly configured.
                if not mc_cfg.snapshot_bday_horizons and horizon_bdays > 63:
                    from app.utils.timeseries import calendar_to_business_days as _c2b
                    snaps = [63, 126, 189]  # 3M, 6M, 9M checkpoints
                    mc_cfg.snapshot_bday_horizons = [
                        s for s in snaps if s < horizon_bdays
                    ]

                mc_engine  = MonteCarloEngine(config=mc_cfg)
                simulation = mc_engine.simulate(
                    forecaster            = forecaster,
                    train                 = train_ser,
                    horizon_bdays         = horizon_bdays,
                    horizon_calendar_days = horizon_calendar_days,
                    series_id             = series_id,
                )
                logger.info(
                    "sofr_engine.simulation.done",
                    n_paths=simulation.n_simulations,
                    wall_time_s=round(simulation.wall_time_s, 3),
                    converged=simulation.convergence.is_converged
                              if simulation.convergence else "n/a",
                )
            except Exception as exc:
                logger.warning("sofr_engine.simulation.failed", error=str(exc))

        # ── Step 9: walk-forward backtest ──────────────────────────────────
        backtest: BacktestResult | None = None
        if cfg.enable_backtest:
            backtest = self._run_backtest(
                levels=levels,
                fitted_order=fitted_order,
                horizon=horizon_bdays,
                n_splits=cfg.n_backtest_splits,
                series_id=series_id,
            )
            forecast_result.backtest = backtest

        logger.info(
            "sofr_engine.run.done",
            series_id=series_id,
            total_time_s=round(time.perf_counter() - t0, 3),
            n_forecast_points=forecast_result.n_forecast_points,
        )

        return SOFRForecastOutput(
            forecast         = forecast_result,
            fitted_order     = fitted_order,
            order_was_auto   = order_was_auto,
            stationarity     = stationarity,
            diagnostics      = diagnostics,
            backtest         = backtest,
            simulation       = simulation,
            fit_wall_time_s  = fit_elapsed,
            series_id        = series_id,
        )

    # ── Backtest ──────────────────────────────────────────────────────────────

    def _run_backtest(
        self,
        *,
        levels:       pd.Series,
        fitted_order: tuple[int, int, int],
        horizon:      int,
        n_splits:     int,
        series_id:    str,
    ) -> BacktestResult:
        """Walk-forward backtest: fit fresh ARIMA on each expanding window."""
        cfg    = self._cfg
        splits = walk_forward_splits(
            levels,
            n_splits=n_splits,
            min_train=max(120, len(levels) // (n_splits + 2)),
            horizon=horizon,
        )

        if not splits:
            logger.warning("sofr_engine.backtest.no_splits")
            return BacktestResult(
                series_id=series_id,
                order=fitted_order,
                n_splits=0,
                horizon_days=horizon,
                mae=float("nan"),
                rmse=float("nan"),
                mape=float("nan"),
            )

        logger.info(
            "sofr_engine.backtest.start",
            n_splits=len(splits),
            horizon=horizon,
        )

        split_results: list[BacktestSplit] = []
        maes: list[float] = []
        rmses: list[float] = []
        mapes: list[float] = []

        for i, split in enumerate(splits):
            try:
                f = ARIMAForecaster(
                    order=fitted_order,
                    floor=cfg.floor,
                    ceiling=cfg.ceiling,
                )
                f.fit(split.train)
                acc = f.evaluate_on_test(split.test)

                maes.append(acc.mae)
                rmses.append(acc.rmse)
                mapes.append(acc.mape)

                split_results.append(BacktestSplit(
                    split_index=i,
                    cutoff=split.cutoff.date(),
                    n_train=len(split.train),
                    n_test=len(split.test),
                    mae=acc.mae,
                    rmse=acc.rmse,
                    mape=acc.mape,
                    order_used=fitted_order,
                ))
            except Exception as exc:
                logger.warning(
                    "sofr_engine.backtest.split_failed",
                    split=i,
                    error=str(exc),
                )
                continue

        if not maes:
            return BacktestResult(
                series_id=series_id,
                order=fitted_order,
                n_splits=0,
                horizon_days=horizon,
                mae=float("nan"),
                rmse=float("nan"),
                mape=float("nan"),
            )

        result = BacktestResult(
            series_id=series_id,
            order=fitted_order,
            n_splits=len(split_results),
            horizon_days=horizon,
            mae=float(sum(maes) / len(maes)),
            rmse=float(sum(rmses) / len(rmses)),
            mape=float(sum(mapes) / len(mapes)),
            splits=split_results,
        )

        logger.info(
            "sofr_engine.backtest.done",
            n_valid_splits=len(split_results),
            mae=round(result.mae, 6),
            rmse=round(result.rmse, 6),
        )

        return result


# ── Helpers ───────────────────────────────────────────────────────────────────


def _config_summary(cfg: SOFRForecastConfig) -> dict[str, Any]:
    return {
        "arima_order":     cfg.arima_order,
        "max_p":           cfg.max_p,
        "max_q":           cfg.max_q,
        "d_fixed":         cfg.d_fixed,
        "test_size":       cfg.test_size,
        "floor":           cfg.floor,
        "enable_backtest": cfg.enable_backtest,
        "run_diagnostics": cfg.run_diagnostics,
    }
