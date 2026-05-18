"""Reusable time-series utilities.

These helpers are asset-class agnostic and operate purely on pd.Series /
pd.DataFrame objects.  They are consumed by the preprocessing pipeline, the
forecasting service, and the model layer (when implemented).

Statsmodels is imported lazily where used so that callers that do not need
statistical diagnostics (e.g. simple API handlers) do not pay the import cost.
"""
from __future__ import annotations

from datetime import date
from typing import NamedTuple

import numpy as np
import pandas as pd


# ── Business-day calendar ─────────────────────────────────────────────────────


def business_day_range(
    start: date | pd.Timestamp,
    end:   date | pd.Timestamp,
) -> pd.DatetimeIndex:
    """Return a Mon–Fri business-day DatetimeIndex between *start* and *end*.

    Uses pandas ``bdate_range``, which handles the Mon–Fri convention without
    requiring a separate calendar library.
    """
    return pd.bdate_range(start=start, end=end, name="date")


def business_days_ahead(
    anchor: date | pd.Timestamp,
    n:      int,
) -> pd.DatetimeIndex:
    """Return a business-day DatetimeIndex for the *n* days after *anchor*.

    Useful for constructing a forecast horizon grid.
    """
    return pd.bdate_range(start=anchor, periods=n + 1, name="date")[1:]


def calendar_to_business_days(calendar_days: int, avg_days_per_year: float = 252.0) -> int:
    """Convert a calendar-day horizon to an approximate business-day count.

    ``calendar_days / 365 * 252`` rounded to the nearest integer.
    """
    return round(calendar_days / 365.0 * avg_days_per_year)


# ── Series alignment ──────────────────────────────────────────────────────────


def align_series(
    *series: pd.Series,
    fill: str | None = None,
) -> list[pd.Series]:
    """Align multiple series to their common DatetimeIndex (intersection).

    Parameters
    ----------
    *series:
        Two or more pd.Series with DatetimeIndex.
    fill:
        If ``"ffill"``, forward-fill after aligning to the union index.
        If ``None``, use intersection (no NaN introduction).

    Returns
    -------
    list[pd.Series]
        One series per input, all sharing the same index and length.
    """
    if not series:
        return []

    if fill == "ffill":
        df = pd.concat(series, axis=1).ffill()
    else:
        # Inner join — only dates present in all series.
        df = pd.concat(series, axis=1).dropna(how="any")

    return [df.iloc[:, i].rename(s.name) for i, s in enumerate(series)]


# ── Rolling / expanding statistics ───────────────────────────────────────────


def rolling_statistics(
    series:    pd.Series,
    window:    int,
    min_obs:   int | None = None,
) -> pd.DataFrame:
    """Compute rolling mean, std, min, and max.

    Parameters
    ----------
    window:
        Rolling window size in periods.
    min_obs:
        Minimum non-NaN observations to compute a result.  Defaults to
        ``max(1, window // 2)``.

    Returns
    -------
    pd.DataFrame
        Columns: ``mean``, ``std``, ``min``, ``max``.
    """
    min_p = min_obs or max(1, window // 2)
    roll  = series.rolling(window, min_periods=min_p)
    return pd.DataFrame({
        "mean": roll.mean(),
        "std":  roll.std(),
        "min":  roll.min(),
        "max":  roll.max(),
    })


def expanding_statistics(series: pd.Series, min_obs: int = 2) -> pd.DataFrame:
    """Compute expanding (cumulative) mean, std, min, and max.

    Returns
    -------
    pd.DataFrame
        Columns: ``mean``, ``std``, ``min``, ``max``.
    """
    exp = series.expanding(min_periods=min_obs)
    return pd.DataFrame({
        "mean": exp.mean(),
        "std":  exp.std(),
        "min":  exp.min(),
        "max":  exp.max(),
    })


def realised_volatility(
    log_returns: pd.Series,
    window:      int = 21,
    annualise:   bool = True,
    trading_days: int = 252,
) -> pd.Series:
    """Compute rolling realised volatility from log returns.

    Parameters
    ----------
    log_returns:
        Daily log-return series.
    window:
        Rolling window in trading days.  21 ≈ 1 month; 63 ≈ 1 quarter.
    annualise:
        If True, multiply by sqrt(trading_days) for annualised percentage vol.
    trading_days:
        Convention for annualisation (252 for equities/rates; 260 for FX).

    Returns
    -------
    pd.Series
        Annualised volatility as a decimal (e.g. 0.15 = 15%).
    """
    rv = log_returns.rolling(window).std()
    if annualise:
        rv = rv * np.sqrt(trading_days)
    rv.name = f"rv_{window}d"
    return rv


# ── Train / test splitting ────────────────────────────────────────────────────


class TrainTestSplit(NamedTuple):
    train: pd.Series
    test:  pd.Series
    cutoff: pd.Timestamp


def train_test_split(
    series:    pd.Series,
    test_size: float = 0.20,
) -> TrainTestSplit:
    """Split a time series into train and test sets by date.

    The split is purely positional (no shuffling) to respect temporal order.

    Parameters
    ----------
    test_size:
        Fraction of observations reserved for the test set.  0.20 = last 20%.
    """
    n       = len(series)
    split   = int(n * (1.0 - test_size))
    train   = series.iloc[:split]
    test    = series.iloc[split:]
    cutoff  = series.index[split]
    return TrainTestSplit(train=train, test=test, cutoff=cutoff)


def walk_forward_splits(
    series:       pd.Series,
    n_splits:     int = 5,
    min_train:    int = 252,
    horizon:      int = 63,
) -> list[TrainTestSplit]:
    """Generate walk-forward (expanding-window) train/test splits.

    Used for backtesting: each split uses all data up to a cutoff date as
    training and the following *horizon* periods as the test window.

    Parameters
    ----------
    n_splits:
        Number of splits to generate.
    min_train:
        Minimum training set size (periods) before the first split.
    horizon:
        Test window length in periods.
    """
    splits: list[TrainTestSplit] = []
    n      = len(series)
    step   = max(1, (n - min_train - horizon) // n_splits)

    for i in range(n_splits):
        cutoff_idx = min_train + i * step
        end_idx    = cutoff_idx + horizon
        if end_idx > n:
            break
        train   = series.iloc[:cutoff_idx]
        test    = series.iloc[cutoff_idx:end_idx]
        cutoff  = series.index[cutoff_idx]
        splits.append(TrainTestSplit(train=train, test=test, cutoff=cutoff))

    return splits


# ── Statistical diagnostics ───────────────────────────────────────────────────


class StationarityResult(NamedTuple):
    test_statistic:  float
    p_value:         float
    n_lags:          int
    is_stationary:   bool   # True if p_value < significance_level
    critical_values: dict[str, float]


def adf_test(
    series:              pd.Series,
    significance_level:  float = 0.05,
    max_lags:            int | None = None,
) -> StationarityResult:
    """Augmented Dickey-Fuller test for unit root (non-stationarity).

    Null hypothesis: the series has a unit root (is non-stationary).
    Reject H0 when p-value < significance_level → series is stationary.

    Parameters
    ----------
    max_lags:
        Maximum lags to include.  If None, statsmodels auto-selects via AIC.

    Returns
    -------
    StationarityResult
    """
    try:
        from statsmodels.tsa.stattools import adfuller
    except ImportError as exc:
        raise ImportError(
            "statsmodels is required for ADF testing. "
            "Install it with: pip install statsmodels"
        ) from exc

    clean = series.dropna()
    stat, p_val, n_lags, _, crit_vals, _ = adfuller(
        clean.values,
        maxlag=max_lags,
        autolag="AIC",
    )

    return StationarityResult(
        test_statistic=float(stat),
        p_value=float(p_val),
        n_lags=int(n_lags),
        is_stationary=p_val < significance_level,
        critical_values={k: float(v) for k, v in crit_vals.items()},
    )


class ACFPACFResult(NamedTuple):
    acf:    np.ndarray
    pacf:   np.ndarray
    lags:   np.ndarray   # integer lag indices
    conf_interval: float


def compute_acf_pacf(
    series:         pd.Series,
    n_lags:         int = 40,
    alpha:          float = 0.05,
) -> ACFPACFResult:
    """Compute ACF and PACF for a time series.

    Used for manual ARIMA order identification (p, q selection) and for
    diagnostic plots in the forecasting service layer.

    Parameters
    ----------
    n_lags:
        Number of lags to compute.
    alpha:
        Significance level for confidence intervals (stored but not applied;
        callers draw their own bands).
    """
    try:
        from statsmodels.tsa.stattools import acf, pacf
    except ImportError as exc:
        raise ImportError("statsmodels is required for ACF/PACF") from exc

    clean = series.dropna().values
    acf_vals  = acf(clean,  nlags=n_lags, fft=True)
    pacf_vals = pacf(clean, nlags=n_lags)

    return ACFPACFResult(
        acf=acf_vals,
        pacf=pacf_vals,
        lags=np.arange(len(acf_vals)),
        conf_interval=alpha,
    )


# ── Error metrics ─────────────────────────────────────────────────────────────


def mean_absolute_error(actual: pd.Series, forecast: pd.Series) -> float:
    """MAE between actual and forecast on their common index."""
    aligned = pd.concat([actual, forecast], axis=1).dropna()
    return float(np.abs(aligned.iloc[:, 0] - aligned.iloc[:, 1]).mean())


def root_mean_squared_error(actual: pd.Series, forecast: pd.Series) -> float:
    """RMSE between actual and forecast on their common index."""
    aligned = pd.concat([actual, forecast], axis=1).dropna()
    return float(np.sqrt(((aligned.iloc[:, 0] - aligned.iloc[:, 1]) ** 2).mean()))


def mean_absolute_percentage_error(
    actual:   pd.Series,
    forecast: pd.Series,
) -> float:
    """MAPE — Mean Absolute Percentage Error.

    Excludes rows where actual == 0 to avoid division by zero.
    """
    aligned = pd.concat([actual, forecast], axis=1).dropna()
    a, f    = aligned.iloc[:, 0], aligned.iloc[:, 1]
    nonzero = a != 0
    return float((np.abs((a[nonzero] - f[nonzero]) / a[nonzero])).mean() * 100)
