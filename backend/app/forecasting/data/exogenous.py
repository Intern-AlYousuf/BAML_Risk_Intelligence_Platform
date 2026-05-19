"""Exogenous macroeconomic feature builder for SARIMAX SOFR forecasting.

Loads, aligns, and prepares six macro variables from FRED:

1. EFFR (DFF)     — Effective Federal Funds Rate
2. CPI YoY        — CPI year-over-year % change (derived from CPIAUCSL)
3. UNRATE         — Civilian Unemployment Rate
4. Spread 10Y–2Y  — T10Y2Y yield curve spread
5. DGS2           — 2-Year Treasury Constant Maturity Rate
6. DGS10          — 10-Year Treasury Constant Maturity Rate

Design principles
-----------------
- **No lookahead leakage**: all alignment uses forward-fill only (values
  propagate forward in time, never backward).
- **Graceful degradation**: individual feature failures are logged and the
  feature is replaced with its historical median so the pipeline continues.
- **Business-day alignment**: every feature is reindexed to the SOFR
  business-day calendar before being passed to the model.
- **Monthly → daily conversion**: UNRATE and CPI are released monthly.
  The latest reading is carried forward until the next release.

Future-exog assumption
----------------------
For the forecast horizon, all features are held constant at their last
observed value ("freeze macro").  This is conservative and avoids speculative
projections of macro variables that would themselves require a model.
"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.core.logging import get_logger
from app.forecasting.base import DateRange

logger = get_logger(__name__)


# ── Feature catalogue ─────────────────────────────────────────────────────────

#: Ordered feature names — must stay stable; used as DataFrame column names.
EXOG_FEATURES: list[str] = [
    "effr",          # Effective Federal Funds Rate (% p.a.)
    "cpi_yoy",       # CPI year-over-year change (%)
    "unrate",        # Unemployment Rate (%)
    "spread_10y2y",  # 10Y–2Y Treasury spread (% — positive = normal, negative = inverted)
    "dgs2",          # 2-Year Treasury yield (% p.a.)
    "dgs10",         # 10-Year Treasury yield (% p.a.)
]

#: FRED series ID for each feature name.
_FRED_IDS: dict[str, str] = {
    "effr":         "DFF",
    "cpi_yoy":      "CPIAUCSL",
    "unrate":       "UNRATE",
    "spread_10y2y": "T10Y2Y",
    "dgs2":         "DGS2",
    "dgs10":        "DGS10",
}

# Maximum consecutive business-day forward-fill gap.
# Beyond this, NaN is propagated (and later filled with column median).
_MAX_FILL_GAP: int = 5


# ── Public API ────────────────────────────────────────────────────────────────


async def build_exogenous_dataframe(
    fred_loader,           # FREDLoader — avoid circular import by duck-typing
    sofr_index: pd.DatetimeIndex,
    lookback_years: int = 7,
) -> pd.DataFrame:
    """Load and align all macro features to the SOFR business-day index.

    Parameters
    ----------
    fred_loader:
        Authenticated ``FREDLoader`` instance.  Must support ``await load()``.
    sofr_index:
        DatetimeIndex of SOFR training observations to align all features to.
    lookback_years:
        How many years of history to fetch for each macro series.  A larger
        window improves CPI YoY computation stability.

    Returns
    -------
    pd.DataFrame
        Shape ``(len(sofr_index), len(EXOG_FEATURES))``.
        Index matches ``sofr_index``.  All NaNs resolved.
    """
    start_date = sofr_index.min().date() - timedelta(days=lookback_years * 365 + 60)
    end_date   = sofr_index.max().date()
    date_range = DateRange(start=start_date, end=end_date)

    # Load all features concurrently
    raw = await _load_all_features(fred_loader, date_range)

    # CPI → YoY % change before alignment
    if "cpi_yoy" in raw and not raw["cpi_yoy"].empty:
        raw["cpi_yoy"] = _cpi_yoy(raw["cpi_yoy"])

    return align_exogenous_features(raw, sofr_index)


def align_exogenous_features(
    raw_series: dict[str, pd.Series],
    target_index: pd.DatetimeIndex,
) -> pd.DataFrame:
    """Align multiple raw FRED series to a target DatetimeIndex.

    Alignment steps for each feature:
    1. Reindex to a full business-day calendar spanning ``target_index``.
    2. Forward-fill gaps up to ``_MAX_FILL_GAP`` days.
       (Monthly series like UNRATE become daily this way.)
    3. Reindex to the exact ``target_index``.
    4. Remaining NaNs (early dates before a series starts) → column median.

    No lookahead: forward-fill only propagates past values into future rows,
    never the reverse.

    Parameters
    ----------
    raw_series:
        ``{feature_name: pd.Series}`` — raw FRED data, any frequency.
    target_index:
        Business-day DatetimeIndex to align all features to.

    Returns
    -------
    pd.DataFrame
        All features as columns, ``target_index`` as the row index.
        NaN-free.
    """
    full_bday = pd.bdate_range(
        start=target_index.min(),
        end=target_index.max(),
        freq="B",
    )

    aligned: dict[str, pd.Series] = {}

    for feat, series in raw_series.items():
        if series is None or series.empty:
            aligned[feat] = pd.Series(np.nan, index=target_index, name=feat)
            logger.warning("exog.align.missing_feature", feature=feat)
            continue

        # Normalise index to DatetimeIndex
        idx = series.index
        if not isinstance(idx, pd.DatetimeIndex):
            try:
                series = series.copy()
                series.index = pd.to_datetime(idx)
            except Exception:
                aligned[feat] = pd.Series(np.nan, index=target_index, name=feat)
                continue

        # Reindex → full business-day calendar → forward-fill → target
        s = (
            series
            .reindex(full_bday, method=None)
            .ffill(limit=_MAX_FILL_GAP)
            .reindex(target_index)
        )
        s.name = feat
        aligned[feat] = s

    df = pd.DataFrame(aligned, index=target_index)

    # Resolve remaining NaNs with column median (early-history fallback)
    for col in df.columns:
        n_nan = int(df[col].isna().sum())
        if n_nan > 0:
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val if not np.isnan(median_val) else 0.0)
            logger.debug(
                "exog.align.nan_filled",
                feature=col,
                n_filled=n_nan,
                fill_value=round(float(median_val), 4) if not np.isnan(median_val) else 0.0,
            )

    logger.info(
        "exog.align.done",
        n_rows=len(df),
        n_features=len(df.columns),
        features=list(df.columns),
        n_nan_remaining=int(df.isna().sum().sum()),
    )

    return df


def prepare_future_exog(
    historical_exog: pd.DataFrame,
    last_sofr_date: pd.Timestamp,
    horizon_bdays: int,
) -> pd.DataFrame:
    """Build the future exogenous feature matrix for the forecast horizon.

    Strategy: carry forward the last observed values for all features.

    This "freeze macro" assumption is appropriate for horizons up to 12 months
    and avoids the need for projections of macro variables (which would require
    their own models and introduce additional uncertainty).

    Parameters
    ----------
    historical_exog:
        Aligned historical feature matrix (training period).  The last row
        provides the carry-forward values.
    last_sofr_date:
        Last date in the training window.  Future dates are generated from
        the next business day onwards.
    horizon_bdays:
        Number of business days to generate.

    Returns
    -------
    pd.DataFrame
        Shape ``(horizon_bdays, n_features)`` with future dates as index.
        All feature values are equal to the last historical observation.
    """
    from app.utils.timeseries import business_days_ahead

    future_dates = business_days_ahead(last_sofr_date, horizon_bdays)

    if historical_exog.empty:
        logger.warning(
            "exog.future.empty_historical",
            detail="historical_exog is empty — returning zeros for future exog",
        )
        return pd.DataFrame(
            0.0,
            index=future_dates,
            columns=EXOG_FEATURES,
        )

    # Carry forward last row of historical features
    last_values = historical_exog.iloc[-1].values
    future_exog = pd.DataFrame(
        np.tile(last_values, (len(future_dates), 1)),
        index=future_dates,
        columns=historical_exog.columns,
    )

    logger.info(
        "exog.future.prepared",
        horizon_bdays=horizon_bdays,
        n_features=len(future_exog.columns),
        carry_forward_from=str(historical_exog.index[-1].date()),
    )

    return future_exog


# ── Internal helpers ──────────────────────────────────────────────────────────


async def _load_all_features(
    fred_loader,
    date_range: DateRange,
) -> dict[str, pd.Series]:
    """Fetch all EXOG_FEATURES from FRED concurrently.

    Features that fail to load return an empty Series so the pipeline
    continues in degraded mode (missing feature → column median).
    """
    tasks = {
        feat: fred_loader.load(fred_id, date_range)
        for feat, fred_id in _FRED_IDS.items()
    }

    results: dict[str, pd.Series] = {}

    # Gather with per-task exception handling
    for feat, coro in tasks.items():
        try:
            series = await coro
            results[feat] = series
            logger.debug("exog.load.ok", feature=feat, n_obs=len(series))
        except Exception as exc:
            logger.warning(
                "exog.load.failed",
                feature=feat,
                fred_id=_FRED_IDS[feat],
                error=str(exc),
            )
            results[feat] = pd.Series(dtype="float64", name=feat)

    return results


def _cpi_yoy(cpi_monthly: pd.Series) -> pd.Series:
    """Compute year-over-year CPI inflation from a monthly index level series.

    Formula: (CPI_t − CPI_{t−12}) / CPI_{t−12} × 100

    The 12-lag naturally provides a ~1-year publication delay buffer on top
    of FRED's own release lag, preventing lookahead for monthly CPI data.

    Parameters
    ----------
    cpi_monthly:
        Raw monthly CPI-U level series (CPIAUCSL) with DatetimeIndex.

    Returns
    -------
    pd.Series
        Year-over-year % change.  First 12 observations are NaN (no prior
        year available).  Forward-fill in ``align_exogenous_features`` handles
        propagation to business-day frequency.
    """
    yoy = cpi_monthly.pct_change(periods=12) * 100.0
    yoy.name = "cpi_yoy"
    return yoy
