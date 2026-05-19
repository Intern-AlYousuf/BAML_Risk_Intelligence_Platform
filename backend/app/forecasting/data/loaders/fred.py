"""FRED (St. Louis Fed) time-series loader.

Uses httpx for async HTTP.  No third-party ``fredapi`` package is required —
the FRED REST API is simple enough to call directly, and using httpx keeps the
dependency footprint minimal and the async model consistent with the rest of
the backend.

FRED API reference
------------------
https://fred.stlouisfed.org/docs/api/fred/series_observations.html

Rate limits (free tier)
-----------------------
- 120 requests per minute per API key
- Results are paginated; this loader requests up to 100,000 observations per
  call, which covers all SOFR history (~1,700 business days) in one round trip.

Missing values
--------------
FRED encodes missing observations as the string ``"."``; these are converted
to ``float("nan")`` during parsing so callers receive a uniform float series.
"""
from __future__ import annotations

import logging
from datetime import date

import httpx
import pandas as pd

from app.core.config import settings
from app.core.logging import get_logger
from app.forecasting.base import (
    AssetClass,
    DataSource,
    DateRange,
    SeriesFrequency,
    SeriesMetadata,
)
from app.forecasting.data.loaders.base import (
    LoaderError,
    SeriesNotFoundError,
    TimeSeriesLoader,
)

logger = get_logger(__name__)

# FRED API constant — never change observation units for raw ingest.
_OBSERVATION_UNITS = "lin"  # level (linear), not log or percentage-change

# Hard limit on observations per request. 100k covers >250 years of daily data.
_MAX_OBS = 100_000

# Sentinel used by FRED for missing / not-yet-released values.
_FRED_MISSING = "."


# ── Static catalogue ──────────────────────────────────────────────────────────
# Series supported by this loader with their static metadata.
# Extend this dict as new FRED series are needed by the platform.

_FRED_CATALOGUE: dict[str, SeriesMetadata] = {
    "SOFR": SeriesMetadata(
        series_id="SOFR",
        name="Secured Overnight Financing Rate",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description=(
            "Overnight interest rate on Treasury-collateralised repo transactions. "
            "Published by FRBNY. Available from 2018-04-02."
        ),
        source_id="SOFR",
    ),
    "SOFR30DAYAVG": SeriesMetadata(
        series_id="SOFR30DAYAVG",
        name="30-Day Average SOFR",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description="Compounded average SOFR over a rolling 30-day window.",
        source_id="SOFR30DAYAVG",
    ),
    "SOFR90DAYAVG": SeriesMetadata(
        series_id="SOFR90DAYAVG",
        name="90-Day Average SOFR",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description="Compounded average SOFR over a rolling 90-day window.",
        source_id="SOFR90DAYAVG",
    ),
    "SOFR180DAYAVG": SeriesMetadata(
        series_id="SOFR180DAYAVG",
        name="180-Day Average SOFR",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description="Compounded average SOFR over a rolling 180-day window.",
        source_id="SOFR180DAYAVG",
    ),
    "DEXINUS": SeriesMetadata(
        series_id="DEXINUS",
        name="India / U.S. Foreign Exchange Rate (USD/INR)",
        asset_class=AssetClass.FX,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="inr_per_usd",
        description=(
            "Indian rupees per U.S. dollar. "
            "Noon buying rates in New York City for cable transfers payable in foreign currencies."
        ),
        source_id="DEXINUS",
    ),
    "DFF": SeriesMetadata(
        series_id="DFF",
        name="Effective Federal Funds Rate",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description="Daily effective federal funds rate (EFFR). Used as the policy rate anchor.",
        source_id="DFF",
    ),
    "T10Y2Y": SeriesMetadata(
        series_id="T10Y2Y",
        name="10-Year / 2-Year Treasury Yield Spread",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent",
        description="Yield spread between the 10-year and 2-year Treasury. Recession indicator.",
        source_id="T10Y2Y",
    ),
    # ── Macro exogenous variables for SARIMAX SOFR forecasting ───────────────
    "FEDFUNDS": SeriesMetadata(
        series_id="FEDFUNDS",
        name="Federal Funds Effective Rate",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description=(
            "Effective federal funds rate published by the Federal Reserve Board. "
            "Alias for DFF (daily). Policy rate anchor for short-end rates."
        ),
        source_id="DFF",   # FRED series ID is DFF; FEDFUNDS is the platform alias
    ),
    "CPIAUCSL": SeriesMetadata(
        series_id="CPIAUCSL",
        name="Consumer Price Index for All Urban Consumers",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.MONTHLY,
        source=DataSource.FRED,
        units="index_1982_84_equals_100",
        description=(
            "Monthly CPI-U level. Transformed to year-over-year % change in the "
            "exogenous feature pipeline. Released with ~2-week lag; use with "
            "forward-fill to avoid lookahead."
        ),
        source_id="CPIAUCSL",
    ),
    "UNRATE": SeriesMetadata(
        series_id="UNRATE",
        name="Civilian Unemployment Rate",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.MONTHLY,
        source=DataSource.FRED,
        units="percent",
        description=(
            "Monthly U-3 unemployment rate. Forward-filled to business-day "
            "frequency in the exogenous feature pipeline."
        ),
        source_id="UNRATE",
    ),
    "DGS2": SeriesMetadata(
        series_id="DGS2",
        name="2-Year Treasury Constant Maturity Rate",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description=(
            "Daily 2-year on-the-run Treasury yield. Highly sensitive to "
            "near-term Fed policy expectations; strong short-term SOFR predictor."
        ),
        source_id="DGS2",
    ),
    "DGS10": SeriesMetadata(
        series_id="DGS10",
        name="10-Year Treasury Constant Maturity Rate",
        asset_class=AssetClass.INTEREST_RATE,
        frequency=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        description=(
            "Daily 10-year on-the-run Treasury yield. Captures term premium "
            "and long-run inflation expectations."
        ),
        source_id="DGS10",
    ),
}


# ── Loader ────────────────────────────────────────────────────────────────────


class FREDLoader(TimeSeriesLoader):
    """Fetches time-series data from the FRED REST API.

    Parameters
    ----------
    client:
        An httpx.AsyncClient shared with other loaders / services.
        Must remain open for the lifetime of this loader instance.
    api_key:
        FRED API key.  Defaults to ``settings.FRED_API_KEY``.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: str | None = None,
    ) -> None:
        self._client  = client
        self._api_key = api_key or settings.FRED_API_KEY

        if not self._api_key:
            logger.warning(
                "fred.loader.no_key",
                detail=(
                    "FREDLoader instantiated without an API key. "
                    "All load() calls will fail with a 400 from FRED. "
                    "Set FRED_API_KEY in backend/.env"
                ),
            )

    # ── Public interface ──────────────────────────────────────────────────────

    def supports(self, series_id: str) -> bool:
        return series_id in _FRED_CATALOGUE

    def get_metadata(self, series_id: str) -> SeriesMetadata:
        try:
            return _FRED_CATALOGUE[series_id]
        except KeyError:
            raise SeriesNotFoundError(
                series_id,
                f"'{series_id}' is not in the FRED loader catalogue. "
                "Add it to _FRED_CATALOGUE in app/forecasting/data/loaders/fred.py",
            )

    async def load(
        self,
        series_id: str,
        date_range: DateRange,
    ) -> pd.Series:
        """Fetch observations for *series_id* from FRED.

        Returns a pd.Series with:
        - Float64 dtype
        - DatetimeIndex in ascending order (tz-naive)
        - Missing values as NaN (FRED "." sentinel converted)
        - Name equal to *series_id*
        """
        if not self.supports(series_id):
            raise SeriesNotFoundError(
                series_id,
                f"'{series_id}' is not registered in the FRED loader catalogue.",
            )

        meta = _FRED_CATALOGUE[series_id]
        fred_id = meta.source_id or series_id

        logger.info(
            "fred.load.start",
            series_id=series_id,
            fred_id=fred_id,
            start=str(date_range.start),
            end=str(date_range.end),
        )

        params = {
            "series_id":           fred_id,
            "observation_start":   date_range.start.isoformat(),
            "observation_end":     date_range.end.isoformat(),
            "units":               _OBSERVATION_UNITS,
            "limit":               _MAX_OBS,
            "sort_order":          "asc",
            "file_type":           "json",
            "api_key":             self._api_key,
        }

        try:
            response = await self._client.get(
                f"{settings.FRED_BASE_URL}/series/observations",
                params=params,
                timeout=settings.FRED_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as exc:
            raise LoaderError(
                series_id,
                "FRED API request timed out",
                upstream=exc,
            ) from exc
        except httpx.RequestError as exc:
            raise LoaderError(
                series_id,
                f"FRED API network error: {exc}",
                upstream=exc,
            ) from exc

        if response.status_code == 401:
            logger.error(
                "fred.load.auth_error",
                series_id=series_id,
                detail="FRED rejected the API key — verify FRED_API_KEY in backend/.env",
            )
            raise LoaderError(
                series_id,
                "FRED API key is invalid or has been revoked. "
                "Verify FRED_API_KEY in backend/.env — "
                "register at https://fred.stlouisfed.org/docs/api/api_key.html",
            )

        if response.status_code == 400:
            logger.error(
                "fred.load.bad_request",
                series_id=series_id,
                response_preview=response.text[:200],
                detail="FRED returned 400 — likely a missing or malformed API key",
            )
            raise LoaderError(
                series_id,
                "FRED returned 400 (bad request). "
                "Check that FRED_API_KEY is set in backend/.env and is not empty. "
                f"FRED response: {response.text[:200]}",
            )

        if response.status_code == 404:
            raise SeriesNotFoundError(
                series_id,
                f"FRED returned 404 for series '{fred_id}'. "
                "Verify the series ID at https://fred.stlouisfed.org/",
            )

        if response.status_code != 200:
            logger.error(
                "fred.load.unexpected_status",
                series_id=series_id,
                status_code=response.status_code,
                response_preview=response.text[:200],
            )
            raise LoaderError(
                series_id,
                f"FRED returned unexpected status {response.status_code}: {response.text[:200]}",
            )

        try:
            payload = response.json()
        except Exception as exc:
            raise LoaderError(
                series_id,
                "FRED returned non-JSON response",
                upstream=exc,
            ) from exc

        observations = payload.get("observations", [])
        if not observations:
            logger.warning(
                "fred.load.empty",
                series_id=series_id,
                start=str(date_range.start),
                end=str(date_range.end),
            )
            return pd.Series(dtype="float64", name=series_id)

        series = _parse_observations(observations, series_id)

        logger.info(
            "fred.load.complete",
            series_id=series_id,
            n_obs=len(series),
            n_missing=int(series.isna().sum()),
            start=str(series.index.min().date()) if len(series) else "n/a",
            end=str(series.index.max().date()) if len(series) else "n/a",
        )

        return series


# ── Parsing helpers ───────────────────────────────────────────────────────────


def _parse_observations(
    observations: list[dict],
    series_id: str,
) -> pd.Series:
    """Convert FRED JSON observations to a typed pd.Series.

    FRED encodes missing values as the literal string ``"."``; these are
    replaced with NaN.  All other values are coerced to float64; any that
    cannot be coerced (should never happen for FRED financial series) are
    also set to NaN.
    """
    dates:  list[pd.Timestamp] = []
    values: list[float | None] = []

    for obs in observations:
        raw_date  = obs.get("date", "")
        raw_value = obs.get("value", _FRED_MISSING)

        if not raw_date:
            continue

        try:
            ts = pd.Timestamp(raw_date)
        except Exception:
            logger.warning("fred.parse.bad_date", raw=raw_date, series_id=series_id)
            continue

        if raw_value == _FRED_MISSING:
            value: float | None = None
        else:
            try:
                value = float(raw_value)
            except (ValueError, TypeError):
                logger.warning(
                    "fred.parse.bad_value",
                    raw=raw_value,
                    date=raw_date,
                    series_id=series_id,
                )
                value = None

        dates.append(ts)
        values.append(value)

    index  = pd.DatetimeIndex(dates, name="date")
    series = pd.Series(values, index=index, dtype="float64", name=series_id)
    return series.sort_index()
