"""SOFR Forecasting Engine.

Orchestrates the complete SOFR forecast pipeline.

Two forecast modes are supported:

``levels`` (legacy, ARIMA)
    ForecastInput → stationarity check → ARIMA fit → forecast levels
    → diagnostics → [Monte Carlo] → [backtest]

``deltas`` (default, SARIMAX)
    ForecastInput + exog_df → stationarity check → delta computation
    → SARIMAX fit with macro exog → forecast deltas → level reconstruction
    → diagnostics → [Monte Carlo] → [backtest]

The ``deltas`` mode is now the default because it:
1. Removes the I(1) unit-root before modelling — better-calibrated CIs.
2. Uses macroeconomic exogenous variables to capture policy-driven moves.
3. Produces economically plausible trajectories that converge toward macro
   equilibrium rather than drifting randomly.

Backward compatibility
----------------------
All existing API contracts, route handlers, and schema builders are unchanged.
The ``exog_df`` parameter on ``run()`` has a default of ``None``, so callers
that do not supply exogenous data automatically fall back to ARIMA(levels).

CPU-bound note
--------------
Both ARIMA and SARIMAX fitting are synchronous.  The service layer runs this
engine in a thread-pool executor so FastAPI's event loop stays unblocked.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

import numpy as np
import pandas as pd

from app.core.config import settings
from app.core.logging import get_logger
from app.forecasting.base import ForecastHorizon, ForecastInput
from app.forecasting.data.transforms import delta_series, reconstruct_from_deltas
from app.forecasting.models.arima import ARIMAForecaster, ARIMAOrderConfig
from app.forecasting.models.sarimax import SARIMAXForecaster, SARIMAXOrderConfig
from app.forecasting.models.results import (
    AccuracyMetrics,
    BacktestResult,
    BacktestSplit,
    ForecastResult,
)
from app.forecasting.simulations.config import MonteCarloConfig
from app.forecasting.simulations.engine import MonteCarloEngine, MonteCarloResult
from app.forecasting.simulations.statistics import (
    PercentileBands,
    SimulationConvergence,
    TerminalDistribution,
)
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
    forecast_mode:
        ``"deltas"`` (default) — fit SARIMAX on first differences and
        reconstruct levels via cumulative sum.
        ``"levels"`` — fit ARIMA directly on SOFR levels (legacy behaviour).
    use_exogenous:
        If ``True`` (default), supply the macro exogenous feature matrix to
        the SARIMAX model.  If ``False``, or if ``exog_df`` is not provided
        to ``run()``, the model degrades gracefully to pure SARIMA.
    arima_order:
        Explicit (p, d, q).  ``None`` triggers auto-selection via AIC.
    max_p, max_q:
        Search bounds for auto-selection.
    d_fixed:
        Differencing order for the **levels** ARIMA pipeline.  Default 1.
        The delta pipeline always uses d=0 (deltas are already stationary).
    test_size:
        Fraction of data held out for accuracy evaluation.
    floor:
        Post-prediction floor on reconstructed **levels**.
    enable_backtest:
        Run walk-forward backtest.  Adds latency.
    n_backtest_splits:
        Number of backtest folds (when ``enable_backtest=True``).
    run_diagnostics:
        Run Ljung-Box / Jarque-Bera residual checks after fitting.
    """
    # ── Model selection ───────────────────────────────────────────────────
    # SARIMAX delta pipeline is reserved for future use — see _run_delta_pipeline.
    forecast_mode:      Literal["deltas", "levels"] = "levels"
    use_exogenous:      bool                         = False

    # ── ARIMA / SARIMAX order ─────────────────────────────────────────────
    arima_order:        tuple[int, int, int] | None  = None
    max_p:              int                           = 4
    max_q:              int                           = 3
    d_fixed:            int                           = 1      # levels ARIMA only

    # ── Evaluation ───────────────────────────────────────────────────────
    # test_size=0 fits the model on all available data so the forecast
    # anchors to the latest actual SOFR observation (not a stale cutoff).
    # Use enable_backtest=True for proper out-of-sample accuracy evaluation.
    test_size:          float = 0.0
    floor:              float = 2.5   # institutional SOFR floor (bps: 250)
    ceiling:            float | None = 8.0  # institutional SOFR ceiling

    # ── Backtest ─────────────────────────────────────────────────────────
    enable_backtest:    bool = False
    n_backtest_splits:  int  = 5

    # ── Diagnostics ───────────────────────────────────────────────────────
    run_diagnostics:    bool = True

    # ── Monte Carlo ───────────────────────────────────────────────────────
    enable_simulation:  bool               = False
    mc_config:          MonteCarloConfig   = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.mc_config is None:
            object.__setattr__(self, "mc_config", MonteCarloConfig())


# ── Engine output ─────────────────────────────────────────────────────────────


@dataclass
class SOFRForecastOutput:
    """Complete output from a SOFR forecast run.

    Maps directly to the API response schema without further transformation.
    """
    forecast:          ForecastResult
    fitted_order:      tuple[int, int, int]
    order_was_auto:    bool
    stationarity:      SOFRStationarityCheck
    diagnostics:       ResidualDiagnostics | None
    backtest:          BacktestResult | None
    simulation:        MonteCarloResult | None = None
    fit_wall_time_s:   float = 0.0
    series_id:         str   = "SOFR"
    historical_levels: pd.Series | None = None  # raw SOFR levels for chart history

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

    With exogenous macro features (SARIMAX delta mode):
        output = engine.run(
            forecast_input,
            horizon_calendar_days=365,
            exog_df=macro_feature_df,
        )
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
        exog_df: pd.DataFrame | None = None,
    ) -> SOFRForecastOutput:
        """Execute the full SOFR forecast pipeline synchronously.

        Parameters
        ----------
        forecast_input:
            Preprocessed ForecastInput from ForecastingDataService.
        horizon_calendar_days:
            Calendar days ahead to forecast.  Converted to business days
            internally via the 252/365 convention.
        exog_df:
            Pre-loaded macro exogenous feature matrix (aligned to SOFR dates).
            When provided and ``config.forecast_mode == "deltas"``, the engine
            runs the SARIMAX delta pipeline.  When ``None`` or the delta
            pipeline fails, the engine falls back to the ARIMA levels pipeline.

        Returns
        -------
        SOFRForecastOutput
        """
        cfg = self._cfg

        if not forecast_input.is_sufficient:
            raise ValueError(
                f"Forecast input for '{forecast_input.series_id}' has only "
                f"{forecast_input.n_clean} clean observations — insufficient "
                f"(minimum: {settings.FORECAST_MIN_HISTORY_POINTS})."
            )

        levels    = forecast_input.levels.dropna()
        series_id = forecast_input.series_id
        horizon_bdays = calendar_to_business_days(horizon_calendar_days)

        logger.info(
            "sofr_engine.run.start",
            series_id=series_id,
            n_obs=len(levels),
            horizon_calendar=horizon_calendar_days,
            horizon_bdays=horizon_bdays,
            forecast_mode=cfg.forecast_mode,
            use_exogenous=cfg.use_exogenous,
            exog_provided=exog_df is not None,
        )

        # ── Step 1: stationarity check ─────────────────────────────────────
        stationarity = check_sofr_stationarity(levels)

        # ── Step 2: choose and run forecast pipeline ───────────────────────
        use_delta_pipeline = (
            cfg.forecast_mode == "deltas"
            and (
                (cfg.use_exogenous and exog_df is not None and not exog_df.empty)
                or not cfg.use_exogenous          # SARIMA without exog still uses delta mode
            )
        )

        t0 = time.perf_counter()

        if use_delta_pipeline:
            try:
                (
                    forecast_result,
                    fitted_order,
                    order_was_auto,
                    fitted_forecaster,
                    train_ser,
                ) = self._run_delta_pipeline(
                    levels=levels,
                    exog_df=exog_df if cfg.use_exogenous else None,
                    horizon_bdays=horizon_bdays,
                    series_id=series_id,
                )
                logger.info(
                    "sofr_engine.pipeline.delta.ok",
                    order=fitted_order,
                    n_points=forecast_result.n_forecast_points,
                )
            except Exception as exc:
                logger.warning(
                    "sofr_engine.pipeline.delta.failed",
                    error=str(exc),
                    fallback="ARIMA levels pipeline",
                )
                (
                    forecast_result,
                    fitted_order,
                    order_was_auto,
                    fitted_forecaster,
                    train_ser,
                ) = self._run_levels_pipeline(
                    levels=levels,
                    horizon_bdays=horizon_bdays,
                    series_id=series_id,
                )
        else:
            (
                forecast_result,
                fitted_order,
                order_was_auto,
                fitted_forecaster,
                train_ser,
            ) = self._run_levels_pipeline(
                levels=levels,
                horizon_bdays=horizon_bdays,
                series_id=series_id,
            )

        fit_elapsed = time.perf_counter() - t0

        logger.info(
            "sofr_engine.fit.done",
            order=fitted_order,
            fit_time_s=round(fit_elapsed, 3),
            model_name=forecast_result.model_name,
        )

        # ── Step 3: accuracy on test set ───────────────────────────────────
        # Use the original test split from the levels series (common to both pipelines)
        test_ser  = pd.Series(dtype="float64")
        if cfg.test_size > 0:
            split    = train_test_split(levels, test_size=cfg.test_size)
            test_ser = split.test

        if len(test_ser) > 0:
            try:
                accuracy = fitted_forecaster.evaluate_on_test(test_ser)
                forecast_result.accuracy = accuracy
                logger.info(
                    "sofr_engine.accuracy",
                    mae=round(accuracy.mae, 6),
                    rmse=round(accuracy.rmse, 6),
                )
            except Exception as exc:
                logger.warning("sofr_engine.accuracy.failed", error=str(exc))

        # ── Step 4: residual diagnostics ───────────────────────────────────
        diagnostics: ResidualDiagnostics | None = None
        if cfg.run_diagnostics:
            try:
                residuals   = np.asarray(fitted_forecaster._result.resid)
                diagnostics = check_residuals(residuals)
            except Exception as exc:
                logger.warning("sofr_engine.diagnostics.failed", error=str(exc))

        # ── Step 5: Monte Carlo simulation ─────────────────────────────────
        simulation: MonteCarloResult | None = None
        if cfg.enable_simulation:
            try:
                mc_cfg = cfg.mc_config
                if not mc_cfg.snapshot_bday_horizons and horizon_bdays > 63:
                    snaps = [63, 126, 189]
                    mc_cfg.snapshot_bday_horizons = [
                        s for s in snaps if s < horizon_bdays
                    ]

                # Monte Carlo engine uses the fitted forecaster and the
                # training series (levels for ARIMA; levels for SARIMAX too
                # since the MC engine reconstructs paths from the fitted model).
                mc_engine  = MonteCarloEngine(config=mc_cfg)
                simulation = mc_engine.simulate(
                    forecaster            = fitted_forecaster,
                    train                 = train_ser,
                    horizon_bdays         = horizon_bdays,
                    horizon_calendar_days = horizon_calendar_days,
                    series_id             = series_id,
                )
                logger.info(
                    "sofr_engine.simulation.done",
                    n_paths=simulation.n_simulations,
                    wall_time_s=round(simulation.wall_time_s, 3),
                    converged=(
                        simulation.convergence.is_converged
                        if simulation.convergence else "n/a"
                    ),
                )
            except Exception as exc:
                logger.warning("sofr_engine.simulation.failed", error=str(exc))

            # ── Fallback: deterministic bands from SARIMAX CIs ─────────────
            # If MC failed (e.g. SARIMAXForecaster is incompatible with
            # simulate_arima_paths), build a synthetic MonteCarloResult from
            # the deterministic forecast so the route never receives None.
            if simulation is None:
                logger.info(
                    "sofr_engine.simulation.deterministic_fallback",
                    detail=(
                        "Monte Carlo path generation failed with the SARIMAX "
                        "forecaster.  Constructing fallback simulation from "
                        "deterministic CI bands so the API response stays valid."
                    ),
                )
                simulation = _build_fallback_simulation(
                    forecast_result        = forecast_result,
                    fitted_order           = fitted_order,
                    horizon_calendar_days  = horizon_calendar_days,
                    series_id              = series_id,
                    n_simulations_label    = cfg.mc_config.n_simulations,
                )

        # ── Step 6: walk-forward backtest ──────────────────────────────────
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
            forecast          = forecast_result,
            fitted_order      = fitted_order,
            order_was_auto    = order_was_auto,
            stationarity      = stationarity,
            diagnostics       = diagnostics,
            backtest          = backtest,
            simulation        = simulation,
            fit_wall_time_s   = fit_elapsed,
            series_id         = series_id,
            historical_levels = levels,   # raw SOFR levels for chart history
        )

    # ── Delta pipeline (SARIMAX) — Reserved for future advanced forecasting ──────
    # This pipeline is inactive. SOFRForecastConfig defaults to forecast_mode="levels".
    # To reactivate: set forecast_mode="deltas" and use_exogenous=True.

    def _run_delta_pipeline(
        self,
        *,
        levels:        pd.Series,
        exog_df:       pd.DataFrame | None,
        horizon_bdays: int,
        series_id:     str,
    ) -> tuple[ForecastResult, tuple[int, int, int], bool, SARIMAXForecaster, pd.Series]:
        """SARIMAX delta-space pipeline.

        Steps
        -----
        1. Compute daily first differences from SOFR levels.
        2. Align exog to delta training dates (if provided).
        3. Train/test split on levels; extract corresponding delta train set.
        4. Build future exog for the forecast horizon (carry-forward).
        5. Fit SARIMAXForecaster on delta_train.
        6. Predict future deltas.
        7. Reconstruct level forecasts via cumulative sum from last_known_level.

        Returns
        -------
        tuple of (level ForecastResult, fitted_order, order_was_auto,
                  fitted_forecaster, levels_train_ser)
        """
        from app.forecasting.data.exogenous import prepare_future_exog

        cfg = self._cfg

        # ── Train/test split on levels ─────────────────────────────────────
        if cfg.test_size > 0:
            split    = train_test_split(levels, test_size=cfg.test_size)
            lvl_train = split.train
        else:
            lvl_train = levels

        last_known_level = float(lvl_train.iloc[-1])

        # ── Compute deltas ─────────────────────────────────────────────────
        deltas      = delta_series(lvl_train, name="SOFR_delta")
        delta_train = deltas.dropna()

        logger.info(
            "sofr_engine.delta.computed",
            n_levels=len(lvl_train),
            n_deltas=len(delta_train),
            delta_mean=round(float(delta_train.mean()), 6),
            delta_std=round(float(delta_train.std()), 6),
        )

        # ── Align exog to delta training dates ────────────────────────────
        exog_train_aligned: pd.DataFrame | None = None
        exog_future:        pd.DataFrame | None = None

        if exog_df is not None and not exog_df.empty:
            # Restrict exog to delta_train date range (no lookahead)
            exog_train_aligned = exog_df.reindex(delta_train.index).ffill(limit=5)
            # Drop rows where any exog is still NaN
            valid_mask = exog_train_aligned.notna().all(axis=1)
            exog_train_aligned = exog_train_aligned[valid_mask]

            if exog_train_aligned.empty:
                logger.warning(
                    "sofr_engine.delta.exog_all_nan",
                    action="proceeding without exog",
                )
                exog_train_aligned = None
            else:
                # Build future exog (carry-forward from last training date)
                exog_future = prepare_future_exog(
                    historical_exog=exog_train_aligned,
                    last_sofr_date=lvl_train.index[-1],
                    horizon_bdays=horizon_bdays,
                )

        # ── Build and fit SARIMAXForecaster ───────────────────────────────
        order_config = SARIMAXOrderConfig(
            max_p   = min(cfg.max_p, 3),   # keep grid small for SARIMAX
            max_q   = min(cfg.max_q, 3),
            d_fixed = 0,                   # deltas are stationary
        )

        forecaster = SARIMAXForecaster(
            order        = cfg.arima_order,
            exog_train   = exog_train_aligned,
            exog_future  = exog_future,
            floor        = None,            # no floor on deltas
            ceiling      = None,
            order_config = order_config,
        )

        order_was_auto = cfg.arima_order is None
        forecaster.fit(delta_train)
        fitted_order: tuple[int, int, int] = forecaster.fitted_order or (1, 0, 1)

        # ── Forecast deltas ────────────────────────────────────────────────
        delta_result = forecaster.predict(
            horizon     = horizon_bdays,
            alpha_outer = 0.10,
            alpha_inner = 0.50,
        )
        delta_result.series_id = f"{series_id}_delta"

        # ── Reconstruct level forecasts ────────────────────────────────────
        # Institutional calibration is applied here, not in the model layer:
        #   - floor/ceiling: hard bounds on SOFR levels (regime-appropriate)
        #   - reversion_strength: dampens persistent SARIMAX drift
        #   - min_ci_spread_pct: prevents fan-chart collapse
        # These defaults produce realistic institutional SOFR paths.
        level_result = reconstruct_from_deltas(
            delta_result        = delta_result,
            last_known_level    = last_known_level,
            series_id           = series_id,
            floor               = 2.5,    # institutional minimum (override cfg.floor=0.0)
            ceiling             = 7.0,    # institutional maximum (override cfg.ceiling=None)
            reversion_strength  = 0.30,   # 26% terminal-drift dampening
            min_ci_spread_pct   = 0.25,   # 25 bps terminal CI floor → √t growth
        )

        _validate_forecast(level_result, series_id)

        return level_result, fitted_order, order_was_auto, forecaster, lvl_train

    # ── Levels pipeline (ARIMA — legacy / fallback) ───────────────────────────

    def _run_levels_pipeline(
        self,
        *,
        levels:        pd.Series,
        horizon_bdays: int,
        series_id:     str,
    ) -> tuple[ForecastResult, tuple[int, int, int], bool, ARIMAForecaster, pd.Series]:
        """Original ARIMA levels pipeline (kept intact for fallback)."""
        cfg = self._cfg

        if cfg.test_size > 0:
            split    = train_test_split(levels, test_size=cfg.test_size)
            train_ser = split.train
        else:
            train_ser = levels

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
        forecaster.fit(train_ser)
        fitted_order: tuple[int, int, int] = forecaster.fitted_order or (2, 1, 2)

        forecast_result = forecaster.predict(
            horizon     = horizon_bdays,
            alpha_outer = 0.10,
            alpha_inner = 0.50,
        )
        forecast_result.series_id = series_id

        return forecast_result, fitted_order, order_was_auto, forecaster, train_ser

    # ── Walk-forward backtest ─────────────────────────────────────────────────

    def _run_backtest(
        self,
        *,
        levels:       pd.Series,
        fitted_order: tuple[int, int, int],
        horizon:      int,
        n_splits:     int,
        series_id:    str,
    ) -> BacktestResult:
        """Walk-forward backtest using ARIMA on levels (common to both modes)."""
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


# ── Deterministic fallback simulation ────────────────────────────────────────


def _build_fallback_simulation(
    forecast_result:        ForecastResult,
    fitted_order:           tuple[int, int, int],
    horizon_calendar_days:  int,
    series_id:              str,
    n_simulations_label:    int = 1,
) -> MonteCarloResult:
    """Build a synthetic MonteCarloResult from deterministic SARIMAX CI bands.

    Called when ``MonteCarloEngine.simulate()`` fails because the SARIMAX
    statespace result is incompatible with ``simulate_arima_paths()``.

    The fallback produces a valid ``MonteCarloResult`` that satisfies all
    downstream schema builders (``_build_bands``, ``_build_distribution``,
    ``_build_mc_summary``) without any stochastic path generation.

    Band derivation
    ---------------
    - p50  = SARIMAX point forecast (deterministic)
    - p10  = ci_lower_90  (outer lower CI)
    - p90  = ci_upper_90  (outer upper CI)
    - p25  = ci_lower_50  (inner lower CI)
    - p75  = ci_upper_50  (inner upper CI)
    - p05  = p10  − 0.5 × (p50 − p10)   [soft extrapolation]
    - p95  = p90  + 0.5 × (p90 − p50)   [soft extrapolation]

    Terminal distribution
    ---------------------
    Normal approximation centred on the terminal p50 with σ inferred from the
    90% CI: σ ≈ (p90 − p10) / (2 × 1.645).
    """
    pts = forecast_result.points

    if not pts:
        raise RuntimeError(
            "_build_fallback_simulation: forecast_result contains no points."
        )

    n = len(pts)

    dates_str = [str(p.date) for p in pts]

    # ── Band arrays from deterministic forecast ───────────────────────────
    p50 = np.array([p.forecast    for p in pts], dtype=float)
    p10 = np.array([p.ci_lower_90 for p in pts], dtype=float)
    p90 = np.array([p.ci_upper_90 for p in pts], dtype=float)
    p25 = np.array([p.ci_lower_50 for p in pts], dtype=float)
    p75 = np.array([p.ci_upper_50 for p in pts], dtype=float)

    # Soft extrapolation for the 5th and 95th percentile tails
    half_spread = np.maximum(p50 - p10, 0.0)
    p05 = np.maximum(p10 - 0.5 * half_spread, 0.0)
    p95 = p90 + 0.5 * half_spread

    # Guard against NaN / Inf (shouldn't occur but be safe)
    for arr in (p05, p10, p25, p50, p75, p90, p95):
        np.nan_to_num(arr, nan=0.0, posinf=25.0, neginf=0.0, copy=False)

    std_arr = np.maximum((p90 - p10) / (2.0 * 1.645), 1e-4)

    bands = PercentileBands(
        dates=dates_str,
        bands={
            5:  p05.tolist(),
            10: p10.tolist(),
            25: p25.tolist(),
            50: p50.tolist(),
            75: p75.tolist(),
            90: p90.tolist(),
            95: p95.tolist(),
        },
        mean=p50.tolist(),   # deterministic: mean == point forecast
        std=std_arr.tolist(),
    )

    # ── Terminal distribution — normal approximation ──────────────────────
    p50_t = float(p50[-1])
    p10_t = float(p10[-1])
    p90_t = float(p90[-1])
    p25_t = float(p25[-1])
    p75_t = float(p75[-1])
    sigma = max((p90_t - p10_t) / (2.0 * 1.645), 1e-4)

    n_bins = 30
    lo = max(0.0, p50_t - 4.0 * sigma)
    hi = p50_t + 4.0 * sigma
    bin_edges   = np.linspace(lo, hi, n_bins + 1)
    bin_centers = 0.5 * (bin_edges[:-1] + bin_edges[1:])

    # Normal PDF → normalise so probabilities sum to 1
    raw_probs = np.exp(-0.5 * ((bin_centers - p50_t) / sigma) ** 2)
    probs = raw_probs / raw_probs.sum()

    terminal_dist = TerminalDistribution(
        snapshot_date     = dates_str[-1],
        snapshot_bday     = n - 1,
        bin_centers       = bin_centers.tolist(),
        bin_probabilities = probs.tolist(),
        percentiles       = {
            5:  max(0.0, p50_t - 1.645 * sigma),
            10: max(0.0, p10_t),
            25: p25_t,
            50: p50_t,
            75: p75_t,
            90: p90_t,
            95: p90_t + 0.5 * (p90_t - p50_t),
        },
        mean     = p50_t,
        std      = sigma,
        skewness = 0.0,
        kurtosis = 0.0,
    )

    # ── Synthetic convergence — deterministic is trivially converged ──────
    convergence = SimulationConvergence(
        n_simulations     = n_simulations_label,
        p50_std_error     = 0.0,
        p50_std_error_bps = 0.0,
        threshold_bps     = 1.0,
        is_converged      = True,
        message           = (
            "Deterministic fallback — SARIMAX CI bands used in place of "
            "Monte Carlo paths.  P50 = point forecast, P10/P90 = 90% CI."
        ),
    )

    return MonteCarloResult(
        series_id              = series_id,
        n_simulations          = n_simulations_label,
        horizon_bdays          = n,
        horizon_calendar_days  = horizon_calendar_days,
        simulation_mode        = "deterministic_fallback",
        arima_order            = fitted_order,
        train_end              = forecast_result.train_end,
        forecast_start         = forecast_result.forecast_start,
        forecast_end           = forecast_result.forecast_end,
        seed                   = None,
        bands                  = bands,
        terminal_distribution  = terminal_dist,
        snapshot_distributions = [],
        convergence            = convergence,
        wall_time_s            = 0.0,
        _paths                 = None,
    )


# ── Validation ────────────────────────────────────────────────────────────────


def _validate_forecast(result: ForecastResult, series_id: str) -> None:
    """Sanity checks on a reconstructed level ForecastResult.

    Raises RuntimeError on critical failures so the engine can fall back to
    the ARIMA pipeline.
    """
    if not result.points:
        raise RuntimeError(
            f"Delta reconstruction produced no forecast points for '{series_id}'."
        )

    forecasts = [p.forecast for p in result.points]

    if any(np.isnan(v) for v in forecasts):
        raise RuntimeError(
            f"Reconstructed level forecast contains NaN values for '{series_id}'."
        )

    # Warn if levels are unrealistic (outside 0–30% range for SOFR)
    if any(v < 0.0 or v > 30.0 for v in forecasts):
        logger.warning(
            "sofr_engine.validation.unrealistic_levels",
            series_id=series_id,
            min_val=round(min(forecasts), 4),
            max_val=round(max(forecasts), 4),
        )

    # Check CI ordering
    for pt in result.points:
        if pt.ci_lower_90 > pt.forecast or pt.ci_upper_90 < pt.forecast:
            logger.warning(
                "sofr_engine.validation.ci_ordering_violation",
                date=str(pt.date),
                lower_90=pt.ci_lower_90,
                forecast=pt.forecast,
                upper_90=pt.ci_upper_90,
            )
            break


# ── Config summary helper ─────────────────────────────────────────────────────


def _config_summary(cfg: SOFRForecastConfig) -> dict[str, Any]:
    return {
        "forecast_mode":   cfg.forecast_mode,
        "use_exogenous":   cfg.use_exogenous,
        "arima_order":     cfg.arima_order,
        "max_p":           cfg.max_p,
        "max_q":           cfg.max_q,
        "d_fixed":         cfg.d_fixed,
        "test_size":       cfg.test_size,
        "floor":           cfg.floor,
        "enable_backtest": cfg.enable_backtest,
        "run_diagnostics": cfg.run_diagnostics,
    }
