"""Vectorized ARIMA Monte Carlo path generator.

Generates N independent future rate paths from a fitted ARIMA(p, d, q) model
using a vectorized numpy implementation.

Parallelization strategy
-------------------------
The recurrence relation has a temporal dependency (step t depends on step t-1),
so we cannot vectorize over the horizon dimension H.  We *can* vectorize over
the N simulations axis.  The outer loop iterates over H steps (≤ 252 for a
12M forecast); each iteration performs O(N·(p+q)) numpy multiply-add operations.

For N=10,000, p=2, q=2, H=252:
  252 Python iterations × 40,000 numpy ops = 10M numpy ops total.
  Wall time: ~50–150ms on a modern CPU (numpy BLAS-accelerated).

Memory
------
The paths matrix is (N × H) float64:
  10,000 × 252 × 8 bytes = ~20MB per simulation run.
The matrix is held in RAM only for the duration of the run; the statistics
layer reduces it to band arrays and histograms before the result is returned.

ARIMA parameter extraction
--------------------------
From a statsmodels ARIMAResultsWrapper:

  arparams   → shape (p,)   AR coefficients φ₁…φₚ  (lag-1 first)
  maparams   → shape (q,)   MA coefficients θ₁…θq  (lag-1 first)
  resid      → shape (T,)   Training residuals
  sigma2     → float        MLE residual variance estimate

The MA convention in statsmodels is:
  w_t = ε_t + θ₁ε_{t-1} + θ₂ε_{t-2} + …
so theta coefficients are added (not subtracted) to the MA sum.

Differencing
------------
For d=1 (standard SOFR case):
  - Compute first differences of the training series: w_t = y_t − y_{t-1}
  - The ARMA recurrence operates on w_t
  - Level path: y_t = y_{t-1} + w_t

For d=0 (stationary ARMA):
  - The recurrence operates directly on y_t
  - No cumulation needed
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.core.logging import get_logger

logger = get_logger(__name__)


def simulate_arima_paths(
    arima_result:  Any,         # statsmodels ARIMAResultsWrapper
    train:         pd.Series,   # cleaned training series (DatetimeIndex)
    horizon:       int,         # business days ahead
    n_simulations: int,
    mode:          str,         # "bootstrap" | "parametric"
    rng:           np.random.Generator,
    floor:         float | None = None,
    ceiling:       float | None = None,
) -> np.ndarray:
    """Generate *n_simulations* future ARIMA paths of length *horizon*.

    Parameters
    ----------
    arima_result:
        Fitted statsmodels ARIMAResultsWrapper.
    train:
        Training series used to fit the model (provides initial conditions).
    horizon:
        Number of steps (business days) to simulate.
    n_simulations:
        Number of independent paths.
    mode:
        ``"bootstrap"`` — resample historical residuals.
        ``"parametric"`` — draw from N(0, σ²).
    rng:
        NumPy Generator (seeded or not) for reproducibility control.
    floor, ceiling:
        Domain constraints applied elementwise at each step.

    Returns
    -------
    np.ndarray
        Shape ``(n_simulations, horizon)``.  Values are level rates (not
        differences), in the same units as the training series.
    """
    # ── Extract ARIMA parameters ───────────────────────────────────────────
    order   = tuple(arima_result.model.order)    # (p, d, q)
    p, d, q = int(order[0]), int(order[1]), int(order[2])

    ar_params: np.ndarray = np.asarray(
        arima_result.arparams if p > 0 else [], dtype=np.float64
    )
    ma_params: np.ndarray = np.asarray(
        arima_result.maparams if q > 0 else [], dtype=np.float64
    )

    residuals: np.ndarray = np.asarray(arima_result.resid, dtype=np.float64)
    residuals = residuals[np.isfinite(residuals)]   # drop leading NaN from ARI

    sigma: float = float(np.sqrt(arima_result.sigma2)) if hasattr(arima_result, "sigma2") \
                   else float(np.std(residuals))

    train_vals: np.ndarray = train.values.astype(np.float64)

    logger.debug(
        "mc_paths.simulate.start",
        order=order,
        n_simulations=n_simulations,
        horizon=horizon,
        mode=mode,
        n_residuals=len(residuals),
        sigma=round(sigma, 6),
    )

    # ── Shock matrix: (n_sims, horizon) ───────────────────────────────────
    if mode == "parametric":
        shocks: np.ndarray = rng.normal(0.0, sigma, size=(n_simulations, horizon))
    else:  # bootstrap
        if len(residuals) < 10:
            logger.warning("mc_paths.bootstrap.too_few_residuals_fallback_to_parametric")
            shocks = rng.normal(0.0, sigma, size=(n_simulations, horizon))
        else:
            idx    = rng.integers(0, len(residuals), size=(n_simulations, horizon))
            shocks = residuals[idx]

    # ── Compute initial difference series ─────────────────────────────────
    if d == 1:
        train_diffs: np.ndarray = np.diff(train_vals)   # length T-1
    elif d == 0:
        train_diffs = train_vals.copy()
    else:
        # Higher-order differencing: apply diff d times
        train_diffs = train_vals.copy()
        for _ in range(d):
            train_diffs = np.diff(train_diffs)

    # ── Initialize rolling buffers ─────────────────────────────────────────
    # ar_buf[n, i] = w_{t-1-i} for simulation n  (shape: n_sims × p)
    # ma_buf[n, j] = ε_{t-1-j} for simulation n  (shape: n_sims × q)
    #
    # All paths start from the same initial conditions (last p/q observations
    # from training).  The [::-1] reversal puts the most-recent lag at index 0.
    if p > 0:
        init_ar = train_diffs[-p:][::-1].copy()          # shape (p,)
        ar_buf  = np.tile(init_ar, (n_simulations, 1))  # shape (n_sims, p)
    else:
        ar_buf = np.empty((n_simulations, 0), dtype=np.float64)

    if q > 0:
        init_ma_len = min(q, len(residuals))
        init_ma = np.zeros(q, dtype=np.float64)
        init_ma[:init_ma_len] = residuals[-init_ma_len:][::-1]
        ma_buf  = np.tile(init_ma, (n_simulations, 1))  # shape (n_sims, q)
    else:
        ma_buf = np.empty((n_simulations, 0), dtype=np.float64)

    # ── Allocate output ────────────────────────────────────────────────────
    paths: np.ndarray = np.empty((n_simulations, horizon), dtype=np.float64)

    last_level: float = float(train_vals[-1])

    # ── Main simulation loop (H iterations, vectorized over N) ────────────
    for t in range(horizon):
        eps_t: np.ndarray = shocks[:, t]               # (n_sims,)

        # w_t = ε_t + Σ φᵢ·w_{t-i} + Σ θⱼ·ε_{t-j}
        w_t = eps_t.copy()

        if p > 0:
            # ar_buf @ ar_params: (n_sims, p) · (p,) → (n_sims,)
            w_t += ar_buf @ ar_params

        if q > 0:
            # ma_buf @ ma_params: (n_sims, q) · (q,) → (n_sims,)
            w_t += ma_buf @ ma_params

        # Accumulate to level
        if d >= 1:
            prev = paths[:, t - 1] if t > 0 else last_level
            level_t = prev + w_t
        else:
            level_t = w_t

        # Apply domain constraints
        if floor is not None:
            level_t = np.maximum(level_t, floor)
        if ceiling is not None:
            level_t = np.minimum(level_t, ceiling)

        paths[:, t] = level_t

        # Effective w_t after constraint clamping (for AR feedback)
        if d >= 1:
            prev_for_diff = paths[:, t - 1] if t > 0 else last_level
            actual_w_t = level_t - prev_for_diff
        else:
            actual_w_t = w_t

        # Update rolling buffers (newest lag goes to index 0)
        if p > 0:
            if p > 1:
                ar_buf = np.roll(ar_buf, 1, axis=1)
            ar_buf[:, 0] = actual_w_t

        if q > 0:
            if q > 1:
                ma_buf = np.roll(ma_buf, 1, axis=1)
            ma_buf[:, 0] = eps_t   # original shock (not clamp-adjusted)

    logger.debug(
        "mc_paths.simulate.done",
        paths_shape=paths.shape,
        path_mean=round(float(paths[:, -1].mean()), 4),
        path_std=round(float(paths[:, -1].std()), 4),
    )

    return paths
