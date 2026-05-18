"""Response schemas for the FX domain.

Currency pairs follow the ISO 4217 convention: base/quote (e.g. EUR/USD).
All rates use Decimal — see app/db/types.py for rationale.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class CurrencyPair(BaseModel):
    """Canonical representation of an FX currency pair."""

    pair: str = Field(..., min_length=6, max_length=7, description="e.g. 'EURUSD'")
    base_currency: str = Field(..., min_length=3, max_length=3)
    quote_currency: str = Field(..., min_length=3, max_length=3)


class FXRate(CurrencyPair):
    """Live or historical FX rate with bid/ask spread."""

    mid: Decimal | None = None
    bid: Decimal | None = None
    ask: Decimal | None = None
    spread_bps: Decimal | None = Field(
        default=None,
        description="Bid-ask spread in basis points",
    )
    source: str
    as_of: datetime


class FXForwardPoint(BaseModel):
    """A single point on a forward curve."""

    tenor: str = Field(..., description="e.g. '1W', '1M', '3M', '1Y'")
    tenor_days: int
    forward_rate: Decimal
    swap_points: Decimal


class FXForwardCurve(CurrencyPair):
    """Forward rate curve for a currency pair."""

    spot_rate: Decimal
    points: list[FXForwardPoint] = Field(default_factory=list)
    as_of: datetime


class FXExposure(BaseModel):
    """FX exposure for a single currency vs. the base currency."""

    currency: str = Field(..., min_length=3, max_length=3)
    base_currency: str = Field(default="USD", min_length=3, max_length=3)
    gross_notional: Decimal
    net_notional: Decimal
    hedge_notional: Decimal
    hedge_ratio: Decimal = Field(description="0.0 = unhedged, 1.0 = fully hedged")
    unrealised_pnl: Decimal | None = None
    as_of: datetime


class FXExposureSummary(BaseModel):
    """Aggregate FX exposure across all currencies."""

    base_currency: str = Field(default="USD", min_length=3, max_length=3)
    exposures: list[FXExposure] = Field(default_factory=list)
    total_gross: Decimal
    total_net: Decimal
    overall_hedge_ratio: Decimal
    as_of: datetime


class FXStressTestRequest(BaseModel):
    """Request schema for an FX stress-test scenario."""

    currency_pairs: list[str] = Field(..., min_length=1)
    shock_bps: Decimal = Field(..., description="Rate shock in basis points")
    scenario_id: str | None = None
