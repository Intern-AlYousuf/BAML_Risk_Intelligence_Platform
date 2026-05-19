"""FX historical data loader via Yahoo Finance Chart API v8.

Calls the Yahoo Finance v8 chart endpoint directly using the ``httpx`` client
that is already present in the project.  This avoids the ``yfinance`` package
dependency and works around the consent-page SSL redirect that affects some
environments.

API reference (unofficial)
--------------------------
GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
    ?interval=1d
    &period1={unix_start}
    &period2={unix_end}

The response contains OHLCV data as parallel arrays keyed under:
    result[0].timestamp          — Unix timestamps
    result[0].indicators.quote[0].close — adjusted close prices

Design notes
------------
- The function signature is async; the underlying httpx call is awaited so
  FastAPI's event loop is never blocked.
- The resulting index is normalised to a tz-naive pd.DatetimeIndex compatible
  with PreprocessingPipeline.
- Missing values (``null`` in JSON) are converted to NaN; gaps are handled
  downstream by the pipeline.
"""
from __future__ import annotations

from datetime import date, timedelta, timezone, datetime

import httpx
import pandas as pd

from app.core.logging import get_logger

logger = get_logger(__name__)

_YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_REQUEST_TIMEOUT = 20          # seconds
_USER_AGENT      = "Mozilla/5.0 (compatible; BAML-RiskPlatform/1.0)"


async def load_fx_levels(
    yahoo_symbol:   str,
    lookback_years: int = 5,
    end_date:       date | None = None,
) -> pd.Series:
    """Download FX rate history from the Yahoo Finance Chart API.

    Parameters
    ----------
    yahoo_symbol:
        Yahoo Finance ticker, e.g. ``"USDINR=X"``, ``"USDNGN=X"``.
    lookback_years:
        Calendar years of history to load (counted back from *end_date*).
    end_date:
        Last date to include.  Defaults to today.

    Returns
    -------
    pd.Series
        Float64 series with a tz-naive ``DatetimeIndex`` named ``"date"``,
        sorted ascending.  Missing values are NaN; forward-filling is left
        to the preprocessing pipeline.

    Raises
    ------
    RuntimeError
        If Yahoo Finance returns an empty or malformed response.
    """
    resolved_end   = end_date or date.today()
    resolved_start = resolved_end - timedelta(days=lookback_years * 365 + 60)

    # Convert to Unix timestamps (Yahoo Finance expects seconds since epoch)
    dt_start = datetime(resolved_start.year, resolved_start.month, resolved_start.day,
                        tzinfo=timezone.utc)
    dt_end   = datetime(resolved_end.year,   resolved_end.month,   resolved_end.day,
                        tzinfo=timezone.utc)
    period1  = int(dt_start.timestamp())
    period2  = int(dt_end.timestamp())

    logger.info(
        "fx_loader.download.start",
        symbol=yahoo_symbol,
        start=str(resolved_start),
        end=str(resolved_end),
    )

    url = _YAHOO_CHART_URL.format(symbol=yahoo_symbol)
    params = {
        "interval": "1d",
        "period1":  period1,
        "period2":  period2,
    }
    headers = {"User-Agent": _USER_AGENT}

    async with httpx.AsyncClient(
        timeout=_REQUEST_TIMEOUT,
        follow_redirects=True,
        headers=headers,
    ) as client:
        try:
            response = await client.get(url, params=params)
        except httpx.RequestError as exc:
            raise RuntimeError(
                f"Network error fetching Yahoo Finance data for '{yahoo_symbol}': {exc}"
            ) from exc

    if response.status_code != 200:
        raise RuntimeError(
            f"Yahoo Finance returned HTTP {response.status_code} for '{yahoo_symbol}'.  "
            f"Verify the symbol is correct."
        )

    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(
            f"Yahoo Finance returned non-JSON response for '{yahoo_symbol}': {exc}"
        ) from exc

    series = _parse_chart_response(payload, yahoo_symbol)

    if series.empty:
        raise RuntimeError(
            f"Yahoo Finance returned no data for '{yahoo_symbol}' "
            f"between {resolved_start} and {resolved_end}.  "
            "Verify the symbol is correct and the date range is valid."
        )

    logger.info(
        "fx_loader.download.done",
        symbol=yahoo_symbol,
        n_obs=len(series),
        start=str(series.index.min().date()),
        end=str(series.index.max().date()),
        n_missing=int(series.isna().sum()),
    )

    return series


# ── Response parser ───────────────────────────────────────────────────────────


def _parse_chart_response(payload: dict, symbol: str) -> pd.Series:
    """Extract a daily close series from a Yahoo Finance v8 chart JSON payload."""
    try:
        result    = payload["chart"]["result"]
        if not result:
            return pd.Series(dtype="float64", name=symbol)

        timestamps: list[int]         = result[0]["timestamp"]
        closes:     list[float | None] = result[0]["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(
            f"Unexpected Yahoo Finance response structure for '{symbol}': {exc}"
        ) from exc

    dates  = [
        pd.Timestamp(datetime.fromtimestamp(ts, tz=timezone.utc).date())
        for ts in timestamps
    ]
    values = [float(c) if c is not None else float("nan") for c in closes]

    index  = pd.DatetimeIndex(dates, name="date")
    series = pd.Series(values, index=index, dtype="float64", name=symbol)

    # Drop duplicates (rare around DST or corporate actions)
    series = series[~series.index.duplicated(keep="last")]

    return series.sort_index()
