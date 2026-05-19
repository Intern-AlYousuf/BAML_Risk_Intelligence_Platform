"""Delta-level transforms for the SARIMAX SOFR delta-forecasting pipeline.

Provides two complementary operations:

1. ``delta_series``         — convert SOFR levels → daily first differences
2. ``reconstruct_from_deltas`` — cumulate predicted deltas back into levels,
                                  with institutional calibration to produce
                                  realistic SOFR trajectories.

Calibration
-----------
Naïve cumulative summation of SARIMAX delta forecasts can produce unrealistic
level trajectories: persistent small negative drift compounds over a 12-month
horizon to drive SOFR toward zero, and confidence intervals can collapse to
near-zero width.

``reconstruct_from_deltas`` applies four post-processing steps after the raw
cumulative sum:

1. **Drift dampening** — exponential decay of the cumulative drift toward the
   anchor (last observed level).  The decay factor is ``exp(-κ·t/H)`` where
   ``κ`` is the reversion strength and ``H`` is the full horizon.  This
   preserves near-term structure while preventing long-run collapse.

2. **Hard bounds** — institutional floor (2.5%) and ceiling (7.0%) applied to
   the forecast and both CI bands.

3. **CI ordering** — lower ≤ forecast ≤ upper is enforced after clipping,
   which can invert when the forecast touches a boundary.

4. **Volatility floor** — confidence bands are widened symmetrically around the
   forecast if they fall below a minimum spread that grows with √t.  This
   ensures the fan chart remains visible throughout the horizon.

No lookahead: the only external input is ``last_known_level``, which is the
last *training-set* observation — never a future value.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.forecasting.models.results import ForecastPoint, ForecastResult


# ── Public API ────────────────────────────────────────────────────────────────


def delta_series(levels: pd.Series, name: str | None = None) -> pd.Series:
    """Compute daily first differences (SOFR levels → SOFR changes).

    Parameters
    ----------
    levels:
        Cleaned SOFR level series with a DatetimeIndex in ascending order.
        Must be free of NaN (dropna() is applied internally).
    name:
        Name for the output series.  Defaults to ``"{levels.name}_delta"``.

    Returns
    -------
    pd.Series
        Daily changes: Δt = level_t − level_{t-1}.
        The first observation is NaN and is *not* dropped here — callers that
        pass this to a model should call ``.dropna()`` themselves so that the
        index alignment with exogenous features is preserved until the very
        last moment.

    Notes
    -----
    - For SOFR, typical deltas are ±0.25 pp on FOMC meeting days and near-zero
      otherwise.
    - The resulting series is approximately stationary (ADF-rejectable at 1%).
    """
    if name is None:
        src  = levels.name or "series"
        name = f"{src}_delta"

    deltas      = levels.diff()
    deltas.name = name
    return deltas


def reconstruct_from_deltas(
    delta_result:      ForecastResult,
    last_known_level:  float,
    *,
    series_id:         str          = "SOFR",
    # ── Hard institutional bounds ─────────────────────────────────────────
    floor:             float        = 2.5,    # minimum SOFR % (ZLB regime floor)
    ceiling:           float        = 7.0,    # maximum SOFR % (extreme scenario cap)
    # ── Drift dampening — prevents linear collapse over long horizons ─────
    reversion_strength: float       = 0.30,   # κ: 0 = no dampening, 1 = strong
    # ── CI volatility floor — keeps fan chart visible throughout horizon ──
    min_ci_spread_pct: float        = 0.25,   # min 90% CI spread at terminal (%)
) -> ForecastResult:
    """Reconstruct level forecasts from predicted daily deltas with calibration.

    Transforms a **delta-space** ForecastResult (from ``SARIMAXForecaster``)
    into a **level-space** ForecastResult compatible with the existing API
    schema builders and Monte Carlo engine.

    Reconstruction pipeline
    -----------------------
    Step 1 — Raw cumulative sum::

        cumsum_fc[t] = Σᵢ₌₁ᵗ delta_forecast_i

    Step 2 — Drift dampening (mean reversion toward anchor)::

        decay[t] = exp(−κ · t / H)
        level_fc[t] = anchor + cumsum_fc[t] · decay[t]

    where κ = ``reversion_strength`` and H = horizon length.  The same decay
    is applied to every CI band so the bands remain coherent with the forecast.

    Step 3 — Hard bounds: clip all arrays to [floor, ceiling].

    Step 4 — Restore CI ordering: lower ≤ forecast ≤ upper.

    Step 5 — Volatility floor: widen CI bands if they fall below::

        min_half_spread_90[t] = (min_ci_spread_pct / 2) · √(t / H)

    Parameters
    ----------
    delta_result:
        ForecastResult in **delta space** (percentage-point changes per day).
    last_known_level:
        Last observed SOFR level in the training set.  Anchor for reconstruction.
    series_id:
        Name stamped on the returned ForecastResult.
    floor:
        Hard minimum reconstructed SOFR level (%).  Default 2.5 — consistent
        with effective lower bound under the current policy regime.
    ceiling:
        Hard maximum reconstructed SOFR level (%).  Default 7.0 — well above
        the current spot rate but allows for shock scenarios.
    reversion_strength:
        Drift-dampening parameter κ.  Controls how aggressively the cumulative
        drift is pulled back toward the anchor as the horizon extends.
        0.0 = no dampening (original behaviour).
        0.30 = 26% of terminal drift absorbed (default — mild, institutional).
        1.0 = very strong dampening (not recommended for short horizons).
    min_ci_spread_pct:
        Minimum 90% CI spread (upper − lower) at the terminal date, in %.
        Spread grows as √(t/H) so earlier steps have proportionally tighter
        but still visible bands.  Default 0.25 (25 bps).

    Returns
    -------
    ForecastResult
        Level-space forecast with calibrated CI bands.

    Raises
    ------
    ValueError
        If ``delta_result.points`` is empty.
    """
    if not delta_result.points:
        raise ValueError(
            "reconstruct_from_deltas: delta_result contains no forecast points. "
            "Cannot reconstruct levels from an empty series."
        )

    n = len(delta_result.points)

    # ── Step 1: extract delta arrays ────────────────────────────────────────
    delta_fc  = np.empty(n, dtype=np.float64)
    delta_l90 = np.empty(n, dtype=np.float64)
    delta_u90 = np.empty(n, dtype=np.float64)
    delta_l50 = np.empty(n, dtype=np.float64)
    delta_u50 = np.empty(n, dtype=np.float64)

    for i, pt in enumerate(delta_result.points):
        delta_fc[i]  = pt.forecast    if np.isfinite(pt.forecast)    else 0.0
        delta_l90[i] = pt.ci_lower_90 if np.isfinite(pt.ci_lower_90) else 0.0
        delta_u90[i] = pt.ci_upper_90 if np.isfinite(pt.ci_upper_90) else 0.0
        delta_l50[i] = pt.ci_lower_50 if np.isfinite(pt.ci_lower_50) else 0.0
        delta_u50[i] = pt.ci_upper_50 if np.isfinite(pt.ci_upper_50) else 0.0

    # ── Step 2: drift dampening via exponential decay ───────────────────────
    #
    # Without dampening, persistent small negative deltas (e.g. −0.005%/day)
    # compound over 252 business days → −1.26% cumulative, driving SOFR from
    # 4.3% to 3.04%.  With stronger drift this can collapse toward 0%.
    #
    # The decay factor exp(−κ·t/H) is applied to the *cumulative sum*:
    #   level[t] = anchor + cumsum[t] · decay[t]
    #
    # This is equivalent to a soft mean reversion: near-term steps are barely
    # dampened (decay ≈ 1), while later steps are progressively pulled toward
    # the anchor.  The short-term predictive signal is preserved.
    #
    # All five CI arrays receive the same decay so their relative widths are
    # preserved and no band inverts due to differential dampening.

    t_idx = np.arange(1, n + 1, dtype=np.float64)   # 1, 2, …, H

    if reversion_strength > 0.0 and n > 1:
        decay = np.exp(-reversion_strength * t_idx / n)
    else:
        decay = np.ones(n, dtype=np.float64)

    cumsum_fc  = np.cumsum(delta_fc)
    cumsum_l90 = np.cumsum(delta_l90)
    cumsum_u90 = np.cumsum(delta_u90)
    cumsum_l50 = np.cumsum(delta_l50)
    cumsum_u50 = np.cumsum(delta_u50)

    level_fc  = last_known_level + cumsum_fc  * decay
    level_l90 = last_known_level + cumsum_l90 * decay
    level_u90 = last_known_level + cumsum_u90 * decay
    level_l50 = last_known_level + cumsum_l50 * decay
    level_u50 = last_known_level + cumsum_u50 * decay

    # ── Step 3: hard institutional bounds ───────────────────────────────────
    def _clip(arr: np.ndarray) -> np.ndarray:
        arr = np.maximum(arr, floor)
        arr = np.minimum(arr, ceiling)
        return arr

    level_fc  = _clip(level_fc)
    level_l90 = _clip(level_l90)
    level_u90 = _clip(level_u90)
    level_l50 = _clip(level_l50)
    level_u50 = _clip(level_u50)

    # ── Step 4: restore CI ordering ─────────────────────────────────────────
    # Clipping can invert lower/upper when the forecast touches a boundary.
    level_l90 = np.minimum(level_l90, level_fc)
    level_u90 = np.maximum(level_u90, level_fc)
    level_l50 = np.minimum(level_l50, level_fc)
    level_u50 = np.maximum(level_u50, level_fc)

    # ── Step 5: volatility floor ────────────────────────────────────────────
    #
    # When CI bands collapse (e.g. SARIMAX very confident in near-zero deltas,
    # or bounds clamping squeezes the lower band), the fan chart degenerates.
    #
    # Enforce a minimum half-spread that grows with √(t/H), ensuring bands
    # are always visibly wider at longer horizons:
    #
    #   min_half_spread_90[t] = (min_ci_spread_pct / 2) · √(t / H)
    #
    # The 50% band is set to 45% of the 90% minimum (matching a normal-approx
    # ratio: z50/z90 ≈ 0.674/1.645 ≈ 0.41, using 0.45 for mild conservatism).

    if min_ci_spread_pct > 0.0:
        sqrt_t_norm    = np.sqrt(t_idx / n)
        min_half_90    = (min_ci_spread_pct / 2.0) * sqrt_t_norm
        min_half_50    = min_half_90 * 0.45

        # Widen bands symmetrically around the forecast if too narrow
        actual_half_90 = (level_u90 - level_l90) / 2.0
        deficit_90     = np.maximum(0.0, min_half_90 - actual_half_90)
        level_u90      = _clip(level_u90 + deficit_90)
        level_l90      = _clip(level_l90 - deficit_90)

        actual_half_50 = (level_u50 - level_l50) / 2.0
        deficit_50     = np.maximum(0.0, min_half_50 - actual_half_50)
        level_u50      = _clip(level_u50 + deficit_50)
        level_l50      = _clip(level_l50 - deficit_50)

        # Final CI ordering pass (widening can push bands back into violation)
        level_l90 = np.minimum(level_l90, level_fc)
        level_u90 = np.maximum(level_u90, level_fc)
        level_l50 = np.minimum(level_l50, level_fc)
        level_u50 = np.maximum(level_u50, level_fc)

    # ── Assemble level ForecastPoints ────────────────────────────────────────
    level_points = [
        ForecastPoint(
            date        = delta_result.points[i].date,
            forecast    = float(level_fc[i]),
            ci_lower_90 = float(level_l90[i]),
            ci_upper_90 = float(level_u90[i]),
            ci_lower_50 = float(level_l50[i]),
            ci_upper_50 = float(level_u50[i]),
        )
        for i in range(n)
    ]

    return ForecastResult(
        series_id      = series_id,
        model_name     = delta_result.model_name,
        order          = delta_result.order,
        train_start    = delta_result.train_start,
        train_end      = delta_result.train_end,
        n_train        = delta_result.n_train,
        forecast_start = delta_result.forecast_start,
        forecast_end   = delta_result.forecast_end,
        points         = level_points,
        fit_metrics    = delta_result.fit_metrics,
        accuracy       = delta_result.accuracy,
    )
