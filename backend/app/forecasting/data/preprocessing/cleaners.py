"""Time-series cleaning utilities.

Each function is a pure transformation: it takes a pd.Series, returns a
pd.Series, and records nothing.  All functions preserve the original index.

Design principles
-----------------
- Cleaning is non-destructive: NaN is preferred over row deletion so that
  downstream code retains a contiguous index and can make decisions about gaps.
- Functions are composable — the pipeline assembles them in order.
- Parameter defaults reflect sensible choices for daily financial rate series
  (SOFR, EFFR, FX spot).  Override as needed for other asset classes.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ── Gap handling ──────────────────────────────────────────────────────────────


def forward_fill_gaps(
    series: pd.Series,
    max_consecutive: int = 5,
) -> tuple[pd.Series, int]:
    """Forward-fill NaN values up to *max_consecutive* consecutive gaps.

    Gaps longer than *max_consecutive* are left as NaN so the pipeline can
    flag them as unreliable.  For daily financial series, a 5-day gap covers
    a full week (e.g. holiday clusters); longer gaps usually indicate a data
    vendor problem and should be surfaced rather than silently filled.

    Returns
    -------
    (filled_series, n_filled)
        n_filled is the number of NaN values that were replaced.
    """
    before  = series.isna().sum()
    filled  = series.ffill(limit=max_consecutive)
    n_filled = int(before - filled.isna().sum())
    return filled, n_filled


def reindex_to_business_days(
    series: pd.Series,
    start: pd.Timestamp | None = None,
    end:   pd.Timestamp | None = None,
) -> pd.Series:
    """Reindex *series* to a full Mon–Fri business day calendar.

    Any dates not present in the original series become NaN.  This is applied
    before forward-fill so that weekend / holiday structure is explicit.

    Parameters
    ----------
    start, end:
        Override the calendar bounds.  Default to the series' own min/max.
    """
    if series.empty:
        return series

    s = start or series.index.min()
    e = end   or series.index.max()

    bday_index = pd.bdate_range(start=s, end=e, name="date")
    return series.reindex(bday_index)


def drop_leading_trailing_nans(series: pd.Series) -> pd.Series:
    """Remove NaN values at the head and tail of the series.

    Interior NaN values are preserved; only the run at either boundary is
    stripped.  This avoids passing pre-observation padding into model fitting.
    """
    first_valid = series.first_valid_index()
    last_valid  = series.last_valid_index()
    if first_valid is None:
        return series
    return series.loc[first_valid:last_valid]


# ── Outlier handling ──────────────────────────────────────────────────────────


def remove_outliers_zscore(
    series: pd.Series,
    threshold: float = 4.5,
    window: int | None = None,
) -> tuple[pd.Series, int]:
    """Replace values more than *threshold* standard deviations from the mean.

    Parameters
    ----------
    threshold:
        Z-score cutoff.  4.5 is conservative (>1 in 100,000 under normality)
        and appropriate for interest rate series where genuine moves can be
        large.  Tighten for FX spot series.
    window:
        If provided, use a rolling z-score over this many periods (better for
        non-stationary series).  If None, use the global mean/std.

    Returns
    -------
    (cleaned_series, n_outliers)
    """
    clean = series.copy()

    if window:
        roll_mean = series.rolling(window, min_periods=max(10, window // 2)).mean()
        roll_std  = series.rolling(window, min_periods=max(10, window // 2)).std()
        z_scores  = (series - roll_mean) / roll_std.replace(0, np.nan)
    else:
        mu        = series.mean()
        sigma     = series.std()
        if sigma == 0 or np.isnan(sigma):
            return clean, 0
        z_scores = (series - mu) / sigma

    outlier_mask    = z_scores.abs() > threshold
    n_outliers      = int(outlier_mask.sum())
    clean[outlier_mask] = np.nan

    return clean, n_outliers


def clip_to_valid_range(
    series: pd.Series,
    floor:   float | None = None,
    ceiling: float | None = None,
) -> tuple[pd.Series, int]:
    """Clip values outside the domain-valid range to floor/ceiling.

    Different from outlier removal: clipping preserves the observation but
    constrains it.  Useful for rates (can't be negative in many regimes) or
    FX rates (can't reach zero in practice).

    Returns
    -------
    (clipped_series, n_clipped)
    """
    clipped = series.copy()
    n_clipped = 0

    if floor is not None:
        below = clipped < floor
        n_clipped += int(below.sum())
        clipped[below] = floor

    if ceiling is not None:
        above = clipped > ceiling
        n_clipped += int(above.sum())
        clipped[above] = ceiling

    return clipped, n_clipped


# ── Frequency and alignment ───────────────────────────────────────────────────


def align_to_series(
    series: pd.Series,
    reference: pd.Series,
) -> pd.Series:
    """Reindex *series* to match *reference*'s DatetimeIndex.

    Values on dates not in *series* become NaN.  Used to align a feature
    series (e.g. EFFR) to the target series (SOFR) before building a design
    matrix.
    """
    return series.reindex(reference.index)


def validate_minimum_length(
    series: pd.Series,
    min_points: int,
    series_id: str = "series",
) -> None:
    """Raise ValueError if *series* has fewer clean points than *min_points*.

    Centralises the check so the pipeline raises a consistent error rather
    than propagating a silent empty-dataframe into model training.
    """
    n_clean = int(series.notna().sum())
    if n_clean < min_points:
        raise ValueError(
            f"{series_id}: only {n_clean} non-NaN observations after cleaning "
            f"(minimum required: {min_points}). "
            "Extend the date range or review the data source."
        )
