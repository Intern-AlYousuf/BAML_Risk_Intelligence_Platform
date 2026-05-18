"""Financial time-series transformation utilities.

All functions are pure and return a new pd.Series; they never modify in-place.
NaN values in the input propagate naturally through arithmetic operations and
are not silently dropped.

Naming convention
-----------------
- `*_returns` functions operate on price/rate levels and return the derived
  series.
- `normalise_*` functions return a series with a specific scale/location.
- `difference` and `seasonal_difference` reduce non-stationarity for ARIMA
  and similar models.
- `add_lag_features` returns a DataFrame augmented with lag columns — it is
  the primary feature engineering entry point.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ── Return calculations ───────────────────────────────────────────────────────


def simple_returns(levels: pd.Series, periods: int = 1) -> pd.Series:
    """Compute period-over-period simple returns: (p_t - p_{t-1}) / p_{t-1}.

    Parameters
    ----------
    periods:
        Lag for comparison.  1 = 1-day returns; 5 = weekly returns from
        daily data.

    Notes
    -----
    The first ``periods`` values are NaN because there is no prior price to
    compare against.
    """
    r = levels.pct_change(periods=periods)
    r.name = f"{levels.name}_ret{periods}"
    return r


def log_returns(levels: pd.Series, periods: int = 1) -> pd.Series:
    """Compute log returns: log(p_t / p_{t-1}).

    Log returns are additive and approximately normally distributed for small
    moves, which makes them preferable to simple returns for statistical models.

    Parameters
    ----------
    periods:
        Lag for comparison.
    """
    shifted = levels.shift(periods)
    lr = np.log(levels / shifted)
    lr.name = f"{levels.name}_logret{periods}"
    return lr


def rate_changes(rate: pd.Series, periods: int = 1) -> pd.Series:
    """Compute absolute changes in a rate series: r_t - r_{t-1}.

    Preferred over percentage changes for interest rate series (SOFR, EFFR)
    where 0.25 percentage points is the standard unit of movement.
    """
    diff = rate.diff(periods=periods)
    diff.name = f"{rate.name}_chg{periods}"
    return diff


# ── Differencing ──────────────────────────────────────────────────────────────


def difference(series: pd.Series, order: int = 1) -> pd.Series:
    """Apply first- or higher-order differencing: Δ^d x_t.

    Used to achieve stationarity for ARIMA-class models.  order=1 is
    appropriate for most rate series; order=2 is occasionally needed for
    highly trending series.
    """
    result = series
    for _ in range(order):
        result = result.diff()
    result.name = f"{series.name}_diff{order}"
    return result


def seasonal_difference(
    series: pd.Series,
    period: int = 5,
) -> pd.Series:
    """Remove seasonality by differencing at lag *period*.

    Δ_s x_t = x_t - x_{t-s}

    For daily data, period=5 removes weekly seasonality; period=252 removes
    annual seasonality.
    """
    result = series - series.shift(period)
    result.name = f"{series.name}_sdiff{period}"
    return result


# ── Normalisation ─────────────────────────────────────────────────────────────


def normalise_zscore(
    series: pd.Series,
    *,
    window: int | None = None,
) -> pd.Series:
    """Standardise to zero mean and unit variance.

    Parameters
    ----------
    window:
        If provided, use rolling statistics (expanding-start if fewer than
        ``window`` obs are available).  If None, use the full-sample mean/std.

    Notes
    -----
    Full-sample normalisation leaks future information into historical values
    — do not use it for the training set when backtesting.  Use rolling
    normalisation or fit normalisation parameters on the training set only.
    """
    if window:
        mu    = series.rolling(window, min_periods=1).mean()
        sigma = series.rolling(window, min_periods=1).std()
    else:
        mu    = series.mean()
        sigma = series.std()

    result = (series - mu) / sigma.replace(0, np.nan)
    result.name = f"{series.name}_zscore"
    return result


def normalise_minmax(
    series: pd.Series,
    feature_range: tuple[float, float] = (0.0, 1.0),
) -> pd.Series:
    """Scale to [a, b] using min-max normalisation.

    Suitable for neural network inputs.  Susceptible to outliers; apply
    outlier capping before this transform.
    """
    lo, hi    = feature_range
    s_min     = series.min()
    s_max     = series.max()
    denom     = s_max - s_min
    if denom == 0:
        return pd.Series(lo, index=series.index, name=f"{series.name}_minmax")
    result = lo + (series - s_min) / denom * (hi - lo)
    result.name = f"{series.name}_minmax"
    return result


# ── Feature engineering ───────────────────────────────────────────────────────


def add_lag_features(
    df: pd.DataFrame,
    column: str,
    lags: list[int],
) -> pd.DataFrame:
    """Append lag columns for *column* to *df*.

    Each lag L produces a column named ``{column}_lag{L}`` holding the value
    L periods prior.  The resulting DataFrame has NaN in the first
    ``max(lags)`` rows of the lag columns.

    Parameters
    ----------
    column:
        The column in *df* to lag.
    lags:
        List of positive integer lag orders (e.g. [1, 2, 5, 21]).
    """
    out = df.copy()
    for lag in lags:
        out[f"{column}_lag{lag}"] = df[column].shift(lag)
    return out


def add_rolling_features(
    df: pd.DataFrame,
    column: str,
    windows: list[int],
    funcs: list[str] | None = None,
) -> pd.DataFrame:
    """Append rolling-window statistics for *column* to *df*.

    Parameters
    ----------
    windows:
        List of window sizes (in periods).
    funcs:
        Aggregation functions to compute.  Defaults to
        ``["mean", "std", "min", "max"]``.

    Column naming: ``{column}_roll{window}_{func}``
    """
    funcs = funcs or ["mean", "std", "min", "max"]
    out   = df.copy()

    for w in windows:
        roll = df[column].rolling(w, min_periods=max(1, w // 2))
        for fn in funcs:
            out[f"{column}_roll{w}_{fn}"] = getattr(roll, fn)()

    return out


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    """Append calendar-based features derived from the DatetimeIndex.

    Added columns
    -------------
    - ``day_of_week``  : 0=Monday … 4=Friday
    - ``month``        : 1–12
    - ``quarter``      : 1–4
    - ``is_month_end`` : bool — last business day of the month
    - ``fomc_week``    : bool — placeholder; requires FOMC calendar injection
    """
    out = df.copy()
    idx = df.index
    out["day_of_week"]  = idx.dayofweek.astype("int8")
    out["month"]        = idx.month.astype("int8")
    out["quarter"]      = idx.quarter.astype("int8")
    out["is_month_end"] = idx.is_month_end.astype("bool")
    # FOMC week flag: populated by FOMCCalendar utility (future implementation)
    out["fomc_week"]    = False
    return out
