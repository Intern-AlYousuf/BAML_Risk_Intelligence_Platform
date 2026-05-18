"""Monte Carlo simulation configuration.

All tunable parameters are collected here so that callers — routes, services,
and tests — never hardcode simulation settings inline.

Default values are calibrated for the SOFR use case:
- 10,000 paths gives stable percentile estimates (P5/P95 std < 0.5 bps)
- Bootstrap mode preserves the heavy-tail structure of SOFR residuals
- 50 histogram bins is sufficient for smooth distribution rendering
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class MonteCarloConfig:
    """Runtime configuration for a Monte Carlo simulation run.

    Attributes
    ----------
    n_simulations:
        Number of independent paths to generate.  10,000 gives well-converged
        P5/P95 estimates; reduce to 1,000 for faster development feedback.
    mode:
        ``"bootstrap"`` — resample actual model residuals (captures fat tails
        and regime asymmetry; preferred for financial rate series).
        ``"parametric"`` — draw shocks from N(0, σ²) using the model's
        residual std.  Faster; appropriate if normality holds.
    seed:
        NumPy random seed for reproducibility.  ``None`` = non-deterministic.
    percentiles:
        Percentiles to compute from the path ensemble.  Must include 50 for
        median.  Standard financial fan-chart set: [5, 10, 25, 50, 75, 90, 95].
    n_distribution_bins:
        Number of histogram bins for the terminal-rate distribution.
        50 gives smooth rendering without over-smoothing.
    floor:
        Hard lower bound applied to every simulated rate.  Use 0.0 for SOFR
        (cannot be negative in the current monetary policy regime).
    ceiling:
        Optional upper bound.  ``None`` = no ceiling.
    snapshot_bday_horizons:
        Business-day horizons at which to extract distribution snapshots in
        addition to the terminal date.  Useful for multi-horizon fan charts.
        Example: [63, 126] gives 3M and 6M snapshots for a 12M simulation.
    convergence_check:
        If True, compute a bootstrap std-error of the median to flag whether
        n_simulations is sufficient.
    """
    n_simulations:            int                          = 10_000
    mode:                     Literal["bootstrap",
                                      "parametric"]        = "bootstrap"
    seed:                     int | None                   = None
    percentiles:              list[int]                    = field(
        default_factory=lambda: [5, 10, 25, 50, 75, 90, 95]
    )
    n_distribution_bins:      int                          = 50
    floor:                    float                        = 0.0
    ceiling:                  float | None                 = None
    snapshot_bday_horizons:   list[int]                    = field(
        default_factory=list
    )
    convergence_check:        bool                         = True

    def __post_init__(self) -> None:
        if self.n_simulations < 100:
            raise ValueError(
                f"n_simulations must be at least 100 (got {self.n_simulations})"
            )
        if 50 not in self.percentiles:
            self.percentiles = sorted(set(self.percentiles) | {50})
        if self.mode not in ("bootstrap", "parametric"):
            raise ValueError(
                f"mode must be 'bootstrap' or 'parametric' (got '{self.mode}')"
            )

    # ── Convenience constructors ──────────────────────────────────────────────

    @classmethod
    def fast(cls) -> "MonteCarloConfig":
        """1,000-path config for development and testing."""
        return cls(n_simulations=1_000, convergence_check=False)

    @classmethod
    def standard(cls) -> "MonteCarloConfig":
        """10,000-path production config (default)."""
        return cls()

    @classmethod
    def high_precision(cls) -> "MonteCarloConfig":
        """50,000-path config for publication-quality estimates."""
        return cls(n_simulations=50_000)
