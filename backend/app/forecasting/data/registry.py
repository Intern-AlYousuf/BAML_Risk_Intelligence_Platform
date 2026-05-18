"""Series registry — the platform's catalogue of known time series.

The registry maps a platform-internal ``series_id`` to a ``SeriesConfig``
that describes where to load it, what it represents, and how to preprocess it.

Adding a new series
-------------------
1. Add a ``SeriesConfig`` entry to ``SERIES_REGISTRY`` below.
2. If the series is on FRED, add its FRED series code to the FRED loader's
   ``_FRED_CATALOGUE`` in ``app/forecasting/data/loaders/fred.py``.
3. If the series lives in the platform DB, set ``loader="db"`` and ensure
   the ticker is ingested via ``MarketDataService.ingest``.

Design rationale
----------------
The registry is intentionally a plain dict (not a DB table) because the
catalogue of *supported* series changes on code deploys, not at runtime.
Dynamic user-defined series should be stored in the DB and looked up via
``MarketDataService``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.forecasting.base import (
    AssetClass,
    DataSource,
    SeriesFrequency,
    SeriesMetadata,
)


# ── Series configuration ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class SeriesConfig:
    """Complete specification for a platform-known time series.

    Attributes
    ----------
    series_id:
        Platform-internal identifier.  Used as keys in SERIES_REGISTRY.
    loader:
        ``"fred"`` to use FREDLoader; ``"db"`` to use DBLoader.
    metadata:
        Static descriptor forwarded to the preprocessing pipeline.
    fred_series_id:
        FRED series code.  Required when ``loader == "fred"``.
    db_ticker:
        Ticker in the ``market_data`` table.  Required when ``loader == "db"``.
    """
    series_id:      str
    loader:         Literal["fred", "db"]
    metadata:       SeriesMetadata
    fred_series_id: str | None = None
    db_ticker:      str | None = None

    def __post_init__(self) -> None:
        if self.loader == "fred" and not self.fred_series_id:
            raise ValueError(
                f"SeriesConfig '{self.series_id}': fred_series_id is required "
                "when loader='fred'"
            )
        if self.loader == "db" and not self.db_ticker:
            raise ValueError(
                f"SeriesConfig '{self.series_id}': db_ticker is required "
                "when loader='db'"
            )


# ── Registry ──────────────────────────────────────────────────────────────────


def _cfg(
    sid:        str,
    loader:     Literal["fred", "db"],
    name:       str,
    asset:      AssetClass,
    freq:       SeriesFrequency,
    source:     DataSource,
    units:      str,
    desc:       str,
    *,
    fred_id:    str | None = None,
    db_ticker:  str | None = None,
) -> SeriesConfig:
    return SeriesConfig(
        series_id=sid,
        loader=loader,
        metadata=SeriesMetadata(
            series_id=sid,
            name=name,
            asset_class=asset,
            frequency=freq,
            source=source,
            units=units,
            description=desc,
            source_id=fred_id or db_ticker or sid,
        ),
        fred_series_id=fred_id,
        db_ticker=db_ticker,
    )


SERIES_REGISTRY: dict[str, SeriesConfig] = {

    # ── SOFR ──────────────────────────────────────────────────────────────────

    "SOFR": _cfg(
        sid="SOFR",
        loader="fred",
        name="Secured Overnight Financing Rate",
        asset=AssetClass.INTEREST_RATE,
        freq=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        desc=(
            "Daily SOFR published by FRBNY. Primary rate for the SOFR "
            "Forecast page.  Available from 2018-04-02."
        ),
        fred_id="SOFR",
    ),

    "SOFR_30D": _cfg(
        sid="SOFR_30D",
        loader="fred",
        name="30-Day Average SOFR",
        asset=AssetClass.INTEREST_RATE,
        freq=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        desc="Compounded 30-day average SOFR rate.",
        fred_id="SOFR30DAYAVG",
    ),

    "SOFR_90D": _cfg(
        sid="SOFR_90D",
        loader="fred",
        name="90-Day Average SOFR",
        asset=AssetClass.INTEREST_RATE,
        freq=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        desc="Compounded 90-day average SOFR rate.",
        fred_id="SOFR90DAYAVG",
    ),

    "SOFR_180D": _cfg(
        sid="SOFR_180D",
        loader="fred",
        name="180-Day Average SOFR",
        asset=AssetClass.INTEREST_RATE,
        freq=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        desc="Compounded 180-day average SOFR rate.",
        fred_id="SOFR180DAYAVG",
    ),

    # ── Fed funds / policy rate ────────────────────────────────────────────────

    "EFFR": _cfg(
        sid="EFFR",
        loader="fred",
        name="Effective Federal Funds Rate",
        asset=AssetClass.INTEREST_RATE,
        freq=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent_annualized",
        desc=(
            "Daily EFFR published by FRBNY. Anchor rate for rate forecasting; "
            "SOFR typically trades 2–5 bps below EFFR."
        ),
        fred_id="DFF",
    ),

    "YIELD_SPREAD_10Y2Y": _cfg(
        sid="YIELD_SPREAD_10Y2Y",
        loader="fred",
        name="10Y–2Y Treasury Yield Spread",
        asset=AssetClass.INTEREST_RATE,
        freq=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="percent",
        desc=(
            "Yield spread between 10-year and 2-year Treasuries. "
            "Inverted yield curve is a leading recession indicator and "
            "influences Fed easing timing."
        ),
        fred_id="T10Y2Y",
    ),

    # ── FX series ─────────────────────────────────────────────────────────────

    "USD_INR": _cfg(
        sid="USD_INR",
        loader="fred",
        name="USD / INR Spot Rate",
        asset=AssetClass.FX,
        freq=SeriesFrequency.DAILY,
        source=DataSource.FRED,
        units="inr_per_usd",
        desc=(
            "Indian rupees per U.S. dollar. Noon buying rates in New York. "
            "Used for FX Forecast page — USD/INR pair."
        ),
        fred_id="DEXINUS",
    ),

    # USD/NGN is not available on FRED; sourced from platform DB after manual
    # ingestion from Bloomberg or a commercial data vendor.
    "USD_NGN": _cfg(
        sid="USD_NGN",
        loader="db",
        name="USD / NGN Spot Rate",
        asset=AssetClass.FX,
        freq=SeriesFrequency.DAILY,
        source=DataSource.PLATFORM,
        units="ngn_per_usd",
        desc=(
            "Nigerian naira per U.S. dollar. CBN official rate. "
            "Must be ingested via MarketDataService before use."
        ),
        db_ticker="USD_NGN",
    ),
}


# ── Registry accessor ─────────────────────────────────────────────────────────


def get_series_config(series_id: str) -> SeriesConfig:
    """Return the ``SeriesConfig`` for *series_id*.

    Raises
    ------
    KeyError
        If *series_id* is not registered.  The error message names the
        available series to make debugging easier.
    """
    try:
        return SERIES_REGISTRY[series_id]
    except KeyError:
        available = ", ".join(sorted(SERIES_REGISTRY))
        raise KeyError(
            f"Series '{series_id}' is not in the registry. "
            f"Available: {available}"
        )


def list_series(
    asset_class: AssetClass | None = None,
    loader: Literal["fred", "db"] | None = None,
) -> list[SeriesConfig]:
    """Return all registered series, optionally filtered."""
    configs = list(SERIES_REGISTRY.values())
    if asset_class is not None:
        configs = [c for c in configs if c.metadata.asset_class == asset_class]
    if loader is not None:
        configs = [c for c in configs if c.loader == loader]
    return configs
