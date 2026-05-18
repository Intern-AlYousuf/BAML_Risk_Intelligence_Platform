"""Monte Carlo simulation engine.

Orchestrates the full simulation pipeline:

    ARIMAForecaster (fitted) + ForecastInput
        → simulate_arima_paths()     (vectorized path generation)
        → compute_percentile_bands() (fan-chart data)
        → compute_terminal_distribution() (histogram)
        → check_convergence()        (stability diagnostics)
        → MonteCarloResult

Integration with the ARIMA pipeline
-------------------------------------
The engine accepts a *fitted* ``ARIMAForecaster`` and the training series.
It does NOT re-fit the model.  The caller is responsible for fitting the ARIMA
(via ``SOFRForecastEngine`` or directly) and passing the result here.

This keeps the simulation engine stateless: the same engine instance can be
called multiple times with different forecasters or horizons without side effects.

Typical usage inside SOFRForecastEngine
----------------------------------------
    forecaster = ARIMAForecaster(order=(2, 1, 2), floor=0.0)
    forecaster.fit(train_series)

    mc_engine = MonteCarloEngine(config=MonteCarloConfig())
    mc_result  = mc_engine.simulate(
        forecaster=forecaster,
        train=train_series,
        horizon_bdays=252,
    )
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from app.core.logging import get_logger
from app.forecasting.models.arima import ARIMAForecaster
from app.forecasting.simulations.config import MonteCarloConfig
from app.forecasting.simulations.paths import simulate_arima_paths
from app.forecasting.simulations.statistics import (
    PercentileBands,
    SimulationConvergence,
    TerminalDistribution,
    check_convergence,
    compute_percentile_bands,
    compute_terminal_distribution,
    probability_above,
    probability_below,
    probability_in_range,
)
from app.utils.timeseries import business_days_ahead

logger = get_logger(__name__)


# ── Result type ────────────────────────────────────────────────────────────────


@dataclass
class MonteCarloResult:
    """Complete output of a Monte Carlo simulation run.

    Attributes
    ----------
    series_id:
        Identifier of the series that was simulated.
    n_simulations:
        Number of independent paths generated.
    horizon_bdays:
        Length of each path in business days.
    horizon_calendar_days:
        Approximate calendar-day equivalent (informational).
    simulation_mode:
        ``"bootstrap"`` or ``"parametric"``.
    arima_order:
        (p, d, q) of the source ARIMA model.
    train_end:
        Last date in the training series (path t=0 starts the next business day).
    forecast_start, forecast_end:
        First and last business day in the forecast horizon.
    seed:
        RNG seed used (None = non-deterministic).

    bands:
        Fan-chart-ready percentile curves at every forecast date.
    terminal_distribution:
        Probability histogram at the terminal forecast date.
    snapshot_distributions:
        Distributions at intermediate horizons (from ``config.snapshot_bday_horizons``).
    convergence:
        Convergence check (None if ``config.convergence_check=False``).
    wall_time_s:
        Wall-clock time for the simulation run (path generation + stats).

    _paths:
        Raw path matrix (N × H).  *Not* serialised by default (too large for
        API responses).  Access via ``include_paths=True`` in ``to_dict()``,
        or use it directly for custom analysis.
    """
    series_id:               str
    n_simulations:            int
    horizon_bdays:            int
    horizon_calendar_days:    int
    simulation_mode:          str
    arima_order:              tuple[int, int, int]
    train_end:                date
    forecast_start:           date
    forecast_end:             date
    seed:                     int | None

    bands:                   PercentileBands
    terminal_distribution:   TerminalDistribution
    snapshot_distributions:  list[TerminalDistribution]
    convergence:             SimulationConvergence | None
    wall_time_s:             float

    # Internal — not in to_dict() unless explicitly requested
    _paths: np.ndarray = field(repr=False, default=None)   # type: ignore[assignment]

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self, include_paths: bool = False) -> dict[str, Any]:
        d: dict[str, Any] = {
            "series_id":            self.series_id,
            "n_simulations":        self.n_simulations,
            "horizon_bdays":        self.horizon_bdays,
            "horizon_calendar_days": self.horizon_calendar_days,
            "simulation_mode":      self.simulation_mode,
            "arima_order":          list(self.arima_order),
            "train_end":            str(self.train_end),
            "forecast_start":       str(self.forecast_start),
            "forecast_end":         str(self.forecast_end),
            "seed":                 self.seed,
            "wall_time_s":          round(self.wall_time_s, 3),
            "bands":                self.bands.to_dict(),
            "terminal_distribution": self.terminal_distribution.to_dict(),
            "snapshot_distributions": [s.to_dict() for s in self.snapshot_distributions],
        }
        if self.convergence:
            d["convergence"] = self.convergence.to_dict()
        if include_paths and self._paths is not None:
            d["paths"] = self._paths.tolist()
        return d

    # ── Probability helpers ───────────────────────────────────────────────────

    def p_above(self, threshold: float, bday_idx: int = -1) -> float:
        """P(rate > threshold) at the given horizon step."""
        if self._paths is None:
            raise RuntimeError("Path matrix not available on this result.")
        return probability_above(self._paths, threshold, bday_idx)

    def p_below(self, threshold: float, bday_idx: int = -1) -> float:
        """P(rate < threshold) at the given horizon step."""
        if self._paths is None:
            raise RuntimeError("Path matrix not available on this result.")
        return probability_below(self._paths, threshold, bday_idx)

    def p_in_range(self, low: float, high: float, bday_idx: int = -1) -> float:
        """P(low ≤ rate ≤ high) at the given horizon step."""
        if self._paths is None:
            raise RuntimeError("Path matrix not available on this result.")
        return probability_in_range(self._paths, low, high, bday_idx)


# ── Engine ────────────────────────────────────────────────────────────────────


class MonteCarloEngine:
    """Stateless Monte Carlo simulation engine for ARIMA-based forecasts.

    Parameters
    ----------
    config:
        Simulation configuration.  Defaults to ``MonteCarloConfig.standard()``
        (10,000 paths, bootstrap mode).
    """

    def __init__(self, config: MonteCarloConfig | None = None) -> None:
        self._cfg = config or MonteCarloConfig()

    def simulate(
        self,
        forecaster:             ARIMAForecaster,
        train:                  pd.Series,
        horizon_bdays:          int,
        horizon_calendar_days:  int | None = None,
        series_id:              str = "SOFR",
    ) -> MonteCarloResult:
        """Run Monte Carlo simulation from a fitted ARIMAForecaster.

        Parameters
        ----------
        forecaster:
            A *fitted* ARIMAForecaster.  Raises if not fitted.
        train:
            Training series used to fit the forecaster (provides initial
            conditions and historical residuals for bootstrap).
        horizon_bdays:
            Number of business days to simulate ahead.
        horizon_calendar_days:
            Optional calendar-day label (informational only).
        series_id:
            Identifier embedded in the result.

        Returns
        -------
        MonteCarloResult
        """
        forecaster._require_fitted()

        cfg = self._cfg
        t0  = time.perf_counter()

        fitted_order: tuple[int, int, int] = forecaster.fitted_order or (2, 1, 2)

        logger.info(
            "mc_engine.simulate.start",
            series_id=series_id,
            n_simulations=cfg.n_simulations,
            horizon_bdays=horizon_bdays,
            mode=cfg.mode,
            arima_order=fitted_order,
        )

        # ── RNG ────────────────────────────────────────────────────────────
        rng = np.random.default_rng(cfg.seed)

        # ── Generate paths ─────────────────────────────────────────────────
        paths: np.ndarray = simulate_arima_paths(
            arima_result  = forecaster._result,
            train         = train,
            horizon       = horizon_bdays,
            n_simulations = cfg.n_simulations,
            mode          = cfg.mode,
            rng           = rng,
            floor         = cfg.floor,
            ceiling       = cfg.ceiling,
        )

        # ── Build forecast date index ──────────────────────────────────────
        fcast_idx: pd.DatetimeIndex = business_days_ahead(
            train.index[-1], horizon_bdays
        )

        if len(fcast_idx) > horizon_bdays:
            fcast_idx = fcast_idx[:horizon_bdays]

        # ── Percentile bands ───────────────────────────────────────────────
        bands = compute_percentile_bands(paths, fcast_idx, cfg.percentiles)

        # ── Terminal distribution ──────────────────────────────────────────
        terminal_dist = compute_terminal_distribution(
            paths          = paths,
            dates          = fcast_idx,
            snapshot_bday  = horizon_bdays - 1,
            n_bins         = cfg.n_distribution_bins,
            percentiles    = cfg.percentiles,
        )

        # ── Snapshot distributions ─────────────────────────────────────────
        snap_dists: list[TerminalDistribution] = []
        for snap_bday in cfg.snapshot_bday_horizons:
            clamped = min(snap_bday - 1, horizon_bdays - 1)
            if clamped < 0:
                continue
            snap_dists.append(
                compute_terminal_distribution(
                    paths         = paths,
                    dates         = fcast_idx,
                    snapshot_bday = clamped,
                    n_bins        = cfg.n_distribution_bins,
                    percentiles   = cfg.percentiles,
                )
            )

        # ── Convergence check ──────────────────────────────────────────────
        convergence: SimulationConvergence | None = None
        if cfg.convergence_check and cfg.n_simulations >= 200:
            convergence = check_convergence(
                paths           = paths,
                threshold_bps   = 1.0,
                n_bootstrap     = 100,
                sub_sample_size = min(1_000, cfg.n_simulations // 2),
                rng             = np.random.default_rng(
                    cfg.seed + 999 if cfg.seed is not None else None
                ),
            )

        wall_time = time.perf_counter() - t0

        logger.info(
            "mc_engine.simulate.done",
            series_id=series_id,
            wall_time_s=round(wall_time, 3),
            p50_terminal=round(float(np.percentile(paths[:, -1], 50)), 4),
            p10_terminal=round(float(np.percentile(paths[:, -1], 10)), 4),
            p90_terminal=round(float(np.percentile(paths[:, -1], 90)), 4),
            converged=convergence.is_converged if convergence else "n/a",
        )

        return MonteCarloResult(
            series_id               = series_id,
            n_simulations           = cfg.n_simulations,
            horizon_bdays           = horizon_bdays,
            horizon_calendar_days   = horizon_calendar_days or horizon_bdays,
            simulation_mode         = cfg.mode,
            arima_order             = fitted_order,
            train_end               = train.index[-1].date(),
            forecast_start          = fcast_idx[0].date(),
            forecast_end            = fcast_idx[-1].date(),
            seed                    = cfg.seed,
            bands                   = bands,
            terminal_distribution   = terminal_dist,
            snapshot_distributions  = snap_dists,
            convergence             = convergence,
            wall_time_s             = wall_time,
            _paths                  = paths,
        )
