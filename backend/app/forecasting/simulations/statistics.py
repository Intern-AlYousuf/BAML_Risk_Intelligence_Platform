"""Statistical post-processing for Monte Carlo path ensembles.

Converts the raw (N × H) paths matrix into the pre-computed summaries
consumed by the API and frontend:

- ``PercentileBands``       — fan-chart-ready arrays at each date
- ``TerminalDistribution``  — probability histogram at a snapshot date
- ``SimulationConvergence`` — stability check (is N sufficient?)
- ``probability_above``     — P(terminal rate > threshold)
- ``probability_below``     — P(terminal rate < threshold)
- ``probability_in_range``  — P(a ≤ terminal rate ≤ b)

All functions operate on the raw paths matrix and return plain Python objects
(dataclasses with ``to_dict()`` methods), keeping the statistics layer free
of FastAPI / Pydantic dependencies.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np
import pandas as pd


# ── Percentile bands ──────────────────────────────────────────────────────────


@dataclass
class PercentileBands:
    """Pre-computed percentile curves at each forecast date.

    Designed for direct rendering as a fan / confidence-band chart.
    Each list has length equal to the number of forecast steps (horizon).

    The ``bands`` dict maps percentile integer keys (e.g. 5, 10, …) to the
    corresponding value arrays, enabling callers to request arbitrary
    percentile subsets without recomputing.
    """
    dates:   list[str]                  # ISO date strings for x-axis
    bands:   dict[int, list[float]]     # {percentile: [val_t0, val_t1, …]}
    mean:    list[float]
    std:     list[float]

    # Convenience aliases for the standard fan-chart bands
    @property
    def p05(self) -> list[float]: return self.bands.get(5,  [])
    @property
    def p10(self) -> list[float]: return self.bands.get(10, [])
    @property
    def p25(self) -> list[float]: return self.bands.get(25, [])
    @property
    def p50(self) -> list[float]: return self.bands.get(50, [])
    @property
    def p75(self) -> list[float]: return self.bands.get(75, [])
    @property
    def p90(self) -> list[float]: return self.bands.get(90, [])
    @property
    def p95(self) -> list[float]: return self.bands.get(95, [])

    def to_dict(self) -> dict[str, Any]:
        return {
            "dates": self.dates,
            "bands": {str(k): [round(v, 4) for v in vals]
                      for k, vals in self.bands.items()},
            "mean":  [round(v, 4) for v in self.mean],
            "std":   [round(v, 4) for v in self.std],
        }


# ── Terminal / snapshot distribution ─────────────────────────────────────────


@dataclass
class TerminalDistribution:
    """Probability distribution of simulated rates at a single forecast date.

    Represents the probability mass function of the terminal (or snapshot)
    SOFR rate across the N simulation paths at a given horizon.

    The ``bin_centers`` / ``bin_probabilities`` pair is a normalized histogram
    suitable for bar-chart rendering.  ``percentiles`` gives the exact empirical
    quantiles for tooltip overlays.
    """
    snapshot_date:     str           # ISO date string
    snapshot_bday:     int           # business-day index from forecast start
    bin_centers:       list[float]   # x-axis values (rate levels)
    bin_probabilities: list[float]   # probability mass per bin (sums to ≈1.0)
    percentiles:       dict[int, float]   # {5: x, 10: x, …, 95: x}
    mean:              float
    std:               float
    skewness:          float
    kurtosis:          float         # excess kurtosis (normal → 0)

    def to_dict(self) -> dict[str, Any]:
        return {
            "snapshot_date":     self.snapshot_date,
            "snapshot_bday":     self.snapshot_bday,
            "bin_centers":       [round(v, 4) for v in self.bin_centers],
            "bin_probabilities": [round(v, 6) for v in self.bin_probabilities],
            "percentiles":       {str(k): round(v, 4)
                                  for k, v in self.percentiles.items()},
            "mean":              round(self.mean, 4),
            "std":               round(self.std, 4),
            "skewness":          round(self.skewness, 4),
            "kurtosis":          round(self.kurtosis, 4),
        }


# ── Convergence check ─────────────────────────────────────────────────────────


@dataclass
class SimulationConvergence:
    """Bootstrap convergence check: is N sufficient for stable estimates?

    Uses a simple 1,000-path sub-sample bootstrap to estimate the standard
    error of the P50 median across repeated draws.  If the std-error exceeds
    the threshold (default 1 bps = 0.01% for rates), more paths are needed.

    This is a rough heuristic, not a formal convergence criterion.
    """
    n_simulations:     int
    p50_std_error:     float    # std of P50 across 100 bootstrap sub-samples
    p50_std_error_bps: float    # same, in basis points
    threshold_bps:     float    # convergence threshold
    is_converged:      bool
    message:           str

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_simulations":     self.n_simulations,
            "p50_std_error":     round(self.p50_std_error, 6),
            "p50_std_error_bps": round(self.p50_std_error_bps, 3),
            "threshold_bps":     round(self.threshold_bps, 3),
            "is_converged":      self.is_converged,
            "message":           self.message,
        }


# ── Builder functions ─────────────────────────────────────────────────────────


def compute_percentile_bands(
    paths:      np.ndarray,         # (n_sims, horizon)
    dates:      pd.DatetimeIndex,
    percentiles: list[int],
) -> PercentileBands:
    """Compute cross-sectional percentile bands at each forecast step.

    Parameters
    ----------
    paths:
        Raw path matrix of shape ``(n_simulations, horizon)``.
    dates:
        Business-day DatetimeIndex of length ``horizon``.
    percentiles:
        Integer percentile list (e.g. [5, 10, 25, 50, 75, 90, 95]).
    """
    # Compute all percentiles in one vectorized call — much faster than
    # calling np.percentile in a loop.
    # pct_matrix shape: (len(percentiles), horizon)
    pct_matrix = np.percentile(paths, percentiles, axis=0)

    bands: dict[int, list[float]] = {
        pct: pct_matrix[i].tolist()
        for i, pct in enumerate(percentiles)
    }

    mean_arr = paths.mean(axis=0).tolist()
    std_arr  = paths.std(axis=0).tolist()
    date_strs = [str(d.date()) for d in dates]

    return PercentileBands(
        dates=date_strs,
        bands=bands,
        mean=mean_arr,
        std=std_arr,
    )


def compute_terminal_distribution(
    paths:       np.ndarray,         # (n_sims, horizon)
    dates:       pd.DatetimeIndex,
    snapshot_bday: int,              # 0-based index into horizon
    n_bins:      int,
    percentiles: list[int],
) -> TerminalDistribution:
    """Build the probability distribution of rates at a given snapshot.

    Parameters
    ----------
    snapshot_bday:
        0-based column index into *paths*.  Use ``-1`` for the terminal date.
    n_bins:
        Number of histogram bins.  50 is a good default for financial rates.
    """
    col_idx   = snapshot_bday if snapshot_bday >= 0 else (paths.shape[1] - 1)
    col_idx   = min(col_idx, paths.shape[1] - 1)
    terminal  = paths[:, col_idx]

    snap_date = dates[col_idx]

    # Histogram with auto bin range
    hist_counts, bin_edges = np.histogram(terminal, bins=n_bins, density=False)
    bin_centers   = 0.5 * (bin_edges[:-1] + bin_edges[1:])
    probabilities = hist_counts / float(hist_counts.sum())

    # Empirical percentiles
    pct_values: dict[int, float] = {
        p: float(np.percentile(terminal, p))
        for p in percentiles
    }

    # Moments (scipy-free implementation)
    mu     = float(np.mean(terminal))
    sigma  = float(np.std(terminal))
    if sigma > 0:
        skew = float(np.mean(((terminal - mu) / sigma) ** 3))
        kurt = float(np.mean(((terminal - mu) / sigma) ** 4) - 3.0)
    else:
        skew, kurt = 0.0, 0.0

    return TerminalDistribution(
        snapshot_date=str(snap_date.date()),
        snapshot_bday=col_idx,
        bin_centers=bin_centers.tolist(),
        bin_probabilities=probabilities.tolist(),
        percentiles=pct_values,
        mean=mu,
        std=sigma,
        skewness=skew,
        kurtosis=kurt,
    )


def check_convergence(
    paths:           np.ndarray,
    threshold_bps:   float = 1.0,    # 1 basis point
    n_bootstrap:     int   = 100,
    sub_sample_size: int   = 1_000,
    rng:             np.random.Generator | None = None,
) -> SimulationConvergence:
    """Estimate convergence via bootstrap sub-sampling of the terminal median.

    Draws *n_bootstrap* sub-samples of size *sub_sample_size* from the full
    path ensemble, computes the terminal P50 for each, and reports the std.

    A std-error < threshold_bps (default 1 bps) indicates convergence.
    """
    if rng is None:
        rng = np.random.default_rng()

    n_sims    = paths.shape[0]
    terminal  = paths[:, -1]
    sub_n     = min(sub_sample_size, n_sims)

    medians: list[float] = []
    for _ in range(n_bootstrap):
        idx    = rng.integers(0, n_sims, size=sub_n)
        medians.append(float(np.median(terminal[idx])))

    p50_se     = float(np.std(medians))
    p50_se_bps = p50_se * 100.0      # convert % to bps (1% = 100 bps)
    converged  = p50_se_bps < threshold_bps

    if converged:
        msg = (
            f"Simulation converged: P50 std-error = {p50_se_bps:.2f} bps "
            f"(threshold: {threshold_bps:.1f} bps, n={n_sims})."
        )
    else:
        needed = int(n_sims * (p50_se_bps / threshold_bps) ** 2) + 1
        msg = (
            f"Simulation may not have converged: P50 std-error = {p50_se_bps:.2f} bps "
            f"exceeds threshold {threshold_bps:.1f} bps.  "
            f"Consider increasing n_simulations to ~{needed:,}."
        )

    return SimulationConvergence(
        n_simulations=n_sims,
        p50_std_error=p50_se,
        p50_std_error_bps=p50_se_bps,
        threshold_bps=threshold_bps,
        is_converged=converged,
        message=msg,
    )


# ── Probability queries ───────────────────────────────────────────────────────


def probability_above(
    paths:     np.ndarray,
    threshold: float,
    bday_idx:  int = -1,
) -> float:
    """P(terminal rate > threshold) across all simulations."""
    col = paths[:, bday_idx]
    return float((col > threshold).mean())


def probability_below(
    paths:     np.ndarray,
    threshold: float,
    bday_idx:  int = -1,
) -> float:
    """P(terminal rate < threshold) across all simulations."""
    col = paths[:, bday_idx]
    return float((col < threshold).mean())


def probability_in_range(
    paths:     np.ndarray,
    low:       float,
    high:      float,
    bday_idx:  int = -1,
) -> float:
    """P(low ≤ terminal rate ≤ high) across all simulations."""
    col = paths[:, bday_idx]
    return float(((col >= low) & (col <= high)).mean())
