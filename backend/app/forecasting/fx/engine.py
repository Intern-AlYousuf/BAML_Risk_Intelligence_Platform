"""FX Forecasting Engine.

Orchestrates the full pipeline for a single FX pair:

    ForecastInput (preprocessed FX levels)
        → log-return computation
        → ARIMA(p, 0, q) fit on log returns
        → level reconstruction via cumulative exp
        → [Monte Carlo simulation on log-return paths → level paths]
        → FXForecastOutput

Log-return modelling
--------------------
FX rates are modelled as geometric random walks:
    P_t = P_{t-1} · exp(r_t)     where  r_t = log(P_t / P_{t-1})

Log returns r_t are typically stationary (I(0)), so ARIMA is fit with d=0.
Future levels are recovered as:
    P_{t+k} = P_last · exp(Σ r_{t+1..t+k})

Monte Carlo
-----------
``simulate_arima_paths`` is called on the log-return series.  Because d=0 the
function returns raw ARMA values — i.e. the simulated log returns — NOT level
paths.  Level reconstruction is performed here before the statistics layer.

Output compatibility
--------------------
``FXForecastOutput.simulation`` is a standard ``MonteCarloResult`` (the same
type produced by the SOFR engine).  This means the API builder functions in
``forecast.py`` can reuse ``_build_bands``, ``_build_distribution``, etc.
without modification.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from app.core.config import settings
from app.core.logging import get_logger
from app.forecasting.base import ForecastInput
from app.forecasting.fx.registry import FXPairConfig
from app.forecasting.models.arima import ARIMAForecaster, ARIMAOrderConfig
from app.forecasting.models.results import ForecastPoint, ForecastResult, ModelFitMetrics
from app.forecasting.simulations.config import MonteCarloConfig
from app.forecasting.simulations.engine import MonteCarloResult
from app.forecasting.simulations.paths import simulate_arima_paths
from app.forecasting.simulations.statistics import (
    PercentileBands,
    SimulationConvergence,
    TerminalDistribution,
    check_convergence,
    compute_percentile_bands,
    compute_terminal_distribution,
)
from app.utils.timeseries import business_days_ahead, calendar_to_business_days

logger = get_logger(__name__)


# ── Engine configuration ──────────────────────────────────────────────────────


@dataclass
class FXForecastConfig:
    """Runtime configuration for an FX forecast run.

    Attributes
    ----------
    arima_order:
        Explicit (p, 0, q).  ``None`` triggers AIC-based auto-selection.
        ``d`` is always 0 for log returns (already stationary).
    max_p, max_q:
        Search bounds for auto-selection.
    enable_simulation:
        Whether to run Monte Carlo simulation after fitting.
    mc_config:
        Monte Carlo configuration.  Defaults to ``MonteCarloConfig()``.
    """
    arima_order:       tuple[int, int, int] | None = None
    max_p:             int                         = 4
    max_q:             int                         = 3
    enable_simulation: bool                        = False
    mc_config:         MonteCarloConfig            = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.mc_config is None:
            object.__setattr__(self, "mc_config", MonteCarloConfig())


# ── Engine output ─────────────────────────────────────────────────────────────


@dataclass
class FXForecastOutput:
    """Complete output from an FX forecast run.

    ``forecast`` holds the ARIMA point-forecast in level space (already
    reconstructed from log returns).  ``simulation`` is a standard
    ``MonteCarloResult`` identical in structure to the SOFR simulation result,
    enabling full schema reuse in the API layer.
    """
    pair_id:         str
    forecast:        ForecastResult
    fitted_order:    tuple[int, int, int]
    order_was_auto:  bool
    simulation:      MonteCarloResult | None
    fit_wall_time_s: float


# ── Engine ────────────────────────────────────────────────────────────────────


class FXForecastEngine:
    """End-to-end FX forecasting engine.

    Usage
    -----
        engine = FXForecastEngine(config=FXForecastConfig())
        output = engine.run(forecast_input, pair_config, horizon_calendar_days=365)
    """

    def __init__(self, config: FXForecastConfig | None = None) -> None:
        self._cfg = config or FXForecastConfig()

    def run(
        self,
        forecast_input:        ForecastInput,
        pair_config:           FXPairConfig,
        horizon_calendar_days: int,
    ) -> FXForecastOutput:
        """Execute the full FX forecast pipeline synchronously.

        Parameters
        ----------
        forecast_input:
            Preprocessed ``ForecastInput`` containing ``levels`` and
            ``log_returns`` (produced by the preprocessing pipeline).
        pair_config:
            Static pair metadata including floor / ceiling bounds.
        horizon_calendar_days:
            Calendar days to forecast ahead.

        Returns
        -------
        FXForecastOutput
        """
        cfg      = self._cfg
        pair_id  = pair_config.pair_id
        levels   = forecast_input.levels.dropna()

        if len(levels) < settings.FORECAST_MIN_HISTORY_POINTS:
            raise ValueError(
                f"FX pair '{pair_id}' has only {len(levels)} clean observations "
                f"(minimum: {settings.FORECAST_MIN_HISTORY_POINTS})."
            )

        horizon_bdays = calendar_to_business_days(horizon_calendar_days)

        # ── Step 1: derive log returns ─────────────────────────────────────
        # log_returns are precomputed by PreprocessingPipeline, but we
        # recompute here from the cleaned levels to guarantee alignment.
        log_returns = _compute_log_returns(levels)

        if len(log_returns) < 30:
            raise ValueError(
                f"Insufficient log-return observations for '{pair_id}' "
                f"(got {len(log_returns)}, need ≥ 30)."
            )

        last_level = float(levels.iloc[-1])

        logger.info(
            "fx_engine.run.start",
            pair_id=pair_id,
            n_levels=len(levels),
            n_returns=len(log_returns),
            last_level=round(last_level, 4),
            horizon_calendar=horizon_calendar_days,
            horizon_bdays=horizon_bdays,
        )

        # ── Step 2: fit ARIMA on log returns ──────────────────────────────
        # Use pair's preferred order if no explicit override, else auto-select.
        order = cfg.arima_order or pair_config.preferred_order

        order_config = ARIMAOrderConfig(
            max_p   = cfg.max_p,
            max_q   = cfg.max_q,
            d_fixed = 0,   # log returns are stationary; d is always 0
        )

        forecaster = ARIMAForecaster(
            order        = order,
            order_config = order_config,
            floor        = None,   # no bounds on log-return predictions
            ceiling      = None,
        )

        order_was_auto = order is None
        t0 = time.perf_counter()
        forecaster.fit(log_returns)
        fit_elapsed = time.perf_counter() - t0

        fitted_order: tuple[int, int, int] = forecaster.fitted_order or (1, 0, 1)

        logger.info(
            "fx_engine.fit.done",
            pair_id=pair_id,
            order=fitted_order,
            fit_time_s=round(fit_elapsed, 3),
        )

        # ── Step 3: predict log returns and reconstruct levels ─────────────
        return_result = forecaster.predict(
            horizon     = horizon_bdays,
            alpha_outer = 0.10,
            alpha_inner = 0.50,
        )

        forecast_result = _reconstruct_level_forecast(
            return_result  = return_result,
            last_level     = last_level,
            pair_config    = pair_config,
            pair_id        = pair_id,
        )

        logger.info(
            "fx_engine.levels_reconstructed",
            pair_id=pair_id,
            first_forecast=round(forecast_result.points[0].forecast, 4),
            last_forecast=round(forecast_result.points[-1].forecast, 4),
        )

        # ── Step 4: Monte Carlo simulation ────────────────────────────────
        simulation: MonteCarloResult | None = None
        if cfg.enable_simulation:
            try:
                simulation = _run_fx_simulation(
                    forecaster            = forecaster,
                    log_returns           = log_returns,
                    last_level            = last_level,
                    horizon_bdays         = horizon_bdays,
                    horizon_calendar_days = horizon_calendar_days,
                    mc_config             = cfg.mc_config,
                    pair_config           = pair_config,
                    pair_id               = pair_id,
                )
                logger.info(
                    "fx_engine.simulation.done",
                    pair_id=pair_id,
                    n_paths=simulation.n_simulations,
                    wall_time_s=round(simulation.wall_time_s, 3),
                )
            except Exception as exc:
                logger.warning(
                    "fx_engine.simulation.failed",
                    pair_id=pair_id,
                    error=str(exc),
                )

        logger.info(
            "fx_engine.run.done",
            pair_id=pair_id,
            total_time_s=round(time.perf_counter() - t0, 3),
        )

        return FXForecastOutput(
            pair_id         = pair_id,
            forecast        = forecast_result,
            fitted_order    = fitted_order,
            order_was_auto  = order_was_auto,
            simulation      = simulation,
            fit_wall_time_s = fit_elapsed,
        )


# ── Private helpers ───────────────────────────────────────────────────────────


def _compute_log_returns(levels: pd.Series) -> pd.Series:
    """Compute daily log returns from a levels series.

    Returns a series of the same length minus 1, dropping the first NaN.
    """
    log_ret = np.log(levels / levels.shift(1)).dropna()
    log_ret.name = f"{levels.name}_log_return"
    return log_ret


def _reconstruct_level_forecast(
    return_result:  ForecastResult,
    last_level:     float,
    pair_config:    FXPairConfig,
    pair_id:        str,
) -> ForecastResult:
    """Reconstruct FX level forecasts from predicted log returns.

    Applies cumulative exponentiation:
        level_t = last_level * exp(Σ returns[0:t+1])

    CI bands are reconstructed analogously using their respective return CIs.
    All level paths are clamped to [pair_config.floor, pair_config.ceiling].
    """
    pts = return_result.points
    n   = len(pts)

    # Extract return arrays
    ret_fc    = np.array([p.forecast    for p in pts], dtype=float)
    ret_lo90  = np.array([p.ci_lower_90 for p in pts], dtype=float)
    ret_hi90  = np.array([p.ci_upper_90 for p in pts], dtype=float)
    ret_lo50  = np.array([p.ci_lower_50 for p in pts], dtype=float)
    ret_hi50  = np.array([p.ci_upper_50 for p in pts], dtype=float)

    # Cumulative log returns → level paths
    def _to_levels(ret_arr: np.ndarray) -> np.ndarray:
        cum = np.cumsum(ret_arr)
        levels = last_level * np.exp(cum)
        return np.clip(levels, pair_config.floor, pair_config.ceiling)

    lvl_fc   = _to_levels(ret_fc)
    lvl_lo90 = _to_levels(ret_lo90)
    lvl_hi90 = _to_levels(ret_hi90)
    lvl_lo50 = _to_levels(ret_lo50)
    lvl_hi50 = _to_levels(ret_hi50)

    # Guard against NaN (defensive — cumsum of finite returns is always finite)
    for arr in (lvl_fc, lvl_lo90, lvl_hi90, lvl_lo50, lvl_hi50):
        np.nan_to_num(arr, nan=last_level, posinf=pair_config.ceiling, neginf=pair_config.floor, copy=False)

    # Build date index: same dates as the return forecast
    dates = [p.date for p in pts]

    level_points = [
        ForecastPoint(
            date        = dates[i],
            forecast    = float(lvl_fc[i]),
            ci_lower_90 = float(lvl_lo90[i]),
            ci_upper_90 = float(lvl_hi90[i]),
            ci_lower_50 = float(lvl_lo50[i]),
            ci_upper_50 = float(lvl_hi50[i]),
        )
        for i in range(n)
    ]

    return ForecastResult(
        series_id      = pair_id,
        model_name     = return_result.model_name,
        order          = return_result.order,
        train_start    = return_result.train_start,
        train_end      = return_result.train_end,
        n_train        = return_result.n_train,
        forecast_start = return_result.forecast_start,
        forecast_end   = return_result.forecast_end,
        points         = level_points,
        fit_metrics    = return_result.fit_metrics,
    )


def _run_fx_simulation(
    *,
    forecaster:            ARIMAForecaster,
    log_returns:           pd.Series,
    last_level:            float,
    horizon_bdays:         int,
    horizon_calendar_days: int,
    mc_config:             MonteCarloConfig,
    pair_config:           FXPairConfig,
    pair_id:               str,
) -> MonteCarloResult:
    """Run Monte Carlo simulation for an FX pair.

    Pipeline
    --------
    1. ``simulate_arima_paths`` on the *log-return* series (d=0).
       Output paths[:, t] = simulated log returns (ARMA values, not levels).
    2. Reconstruct level paths via cumulative exp:
       level_paths[:, t] = last_level * exp(cumsum(return_paths[:, :t+1], axis=1)[:, -1])
    3. Clamp level paths to [floor, ceiling].
    4. Pass level paths to standard statistics functions.
    5. Wrap in ``MonteCarloResult`` — identical structure to SOFR MC output.
    """
    t0  = time.perf_counter()
    rng = np.random.default_rng(mc_config.seed)

    fitted_order: tuple[int, int, int] = forecaster.fitted_order or (1, 0, 1)

    logger.info(
        "fx_engine.simulation.start",
        pair_id=pair_id,
        n_simulations=mc_config.n_simulations,
        horizon_bdays=horizon_bdays,
        mode=mc_config.mode,
        order=fitted_order,
    )

    # ── Simulate log-return paths ──────────────────────────────────────────
    # floor=None, ceiling=None: no bounds on log returns (constraints applied
    # after level reconstruction).
    return_paths: np.ndarray = simulate_arima_paths(
        arima_result  = forecaster._result,
        train         = log_returns,
        horizon       = horizon_bdays,
        n_simulations = mc_config.n_simulations,
        mode          = mc_config.mode,
        rng           = rng,
        floor         = None,
        ceiling       = None,
    )
    # return_paths shape: (n_sims, horizon) — log returns for d=0 ARMA

    # ── Reconstruct level paths ────────────────────────────────────────────
    # level_paths[:, t] = last_level * exp(sum of log returns 0..t)
    cum_returns  = np.cumsum(return_paths, axis=1)
    level_paths  = last_level * np.exp(cum_returns)

    # Clamp to institutional bounds
    level_paths = np.clip(level_paths, pair_config.floor, pair_config.ceiling)

    # ── Build forecast date index ──────────────────────────────────────────
    fcast_idx: pd.DatetimeIndex = business_days_ahead(
        log_returns.index[-1], horizon_bdays
    )
    if len(fcast_idx) > horizon_bdays:
        fcast_idx = fcast_idx[:horizon_bdays]

    # ── Percentile bands (on level paths) ─────────────────────────────────
    bands = compute_percentile_bands(level_paths, fcast_idx, mc_config.percentiles)

    # ── Terminal distribution ──────────────────────────────────────────────
    terminal_dist = compute_terminal_distribution(
        paths         = level_paths,
        dates         = fcast_idx,
        snapshot_bday = horizon_bdays - 1,
        n_bins        = mc_config.n_distribution_bins,
        percentiles   = mc_config.percentiles,
    )

    # ── Snapshot distributions (3M / 6M / 9M checkpoints) ─────────────────
    snap_dists: list[TerminalDistribution] = []
    if not mc_config.snapshot_bday_horizons and horizon_bdays > 63:
        snaps = [63, 126, 189]
        mc_config.snapshot_bday_horizons = [s for s in snaps if s < horizon_bdays]

    for snap_bday in mc_config.snapshot_bday_horizons:
        clamped = min(snap_bday - 1, horizon_bdays - 1)
        if clamped < 0:
            continue
        snap_dists.append(
            compute_terminal_distribution(
                paths         = level_paths,
                dates         = fcast_idx,
                snapshot_bday = clamped,
                n_bins        = mc_config.n_distribution_bins,
                percentiles   = mc_config.percentiles,
            )
        )

    # ── Convergence check ──────────────────────────────────────────────────
    convergence: SimulationConvergence | None = None
    if mc_config.convergence_check and mc_config.n_simulations >= 200:
        convergence = check_convergence(
            paths           = level_paths,
            threshold_bps   = 100.0,   # 100 units (NGN/INR are large numbers)
            n_bootstrap     = 100,
            sub_sample_size = min(1_000, mc_config.n_simulations // 2),
            rng             = np.random.default_rng(
                mc_config.seed + 999 if mc_config.seed is not None else None
            ),
        )

    wall_time = time.perf_counter() - t0

    logger.info(
        "fx_engine.simulation.paths_done",
        pair_id=pair_id,
        wall_time_s=round(wall_time, 3),
        p50_terminal=round(float(np.percentile(level_paths[:, -1], 50)), 4),
        p10_terminal=round(float(np.percentile(level_paths[:, -1], 10)), 4),
        p90_terminal=round(float(np.percentile(level_paths[:, -1], 90)), 4),
    )

    return MonteCarloResult(
        series_id              = pair_id,
        n_simulations          = mc_config.n_simulations,
        horizon_bdays          = horizon_bdays,
        horizon_calendar_days  = horizon_calendar_days,
        simulation_mode        = mc_config.mode,
        arima_order            = fitted_order,
        train_end              = log_returns.index[-1].date(),
        forecast_start         = fcast_idx[0].date(),
        forecast_end           = fcast_idx[-1].date(),
        seed                   = mc_config.seed,
        bands                  = bands,
        terminal_distribution  = terminal_dist,
        snapshot_distributions = snap_dists,
        convergence            = convergence,
        wall_time_s            = wall_time,
        _paths                 = level_paths,
    )
