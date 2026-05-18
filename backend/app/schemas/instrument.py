"""Response schemas for the Instruments domain."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class InstrumentSummary(BaseModel):
    """Minimal instrument descriptor returned in list responses."""

    ticker: str
    name: str | None = None
    asset_class: str
    currency: str = Field(default="USD", max_length=3)
    exchange: str | None = None
    is_active: bool = True


class InstrumentDetail(InstrumentSummary):
    """Full instrument record including pricing metadata."""

    isin: str | None = None
    sedol: str | None = None
    contract_size: Decimal | None = None
    tick_size: Decimal | None = None
    last_price: Decimal | None = None
    price_date: datetime | None = None


class CommodityInstrument(BaseModel):
    """Commodity-specific instrument metadata."""

    symbol: str
    name: str
    commodity_class: str = Field(
        ..., description="energy | metals | agriculture | softs"
    )
    unit: str = Field(..., description="e.g. 'barrel', 'troy_oz', 'bushel'")
    currency: str = Field(default="USD", max_length=3)
    exchange: str | None = None
    front_month_ticker: str | None = None
    last_price: Decimal | None = None
    price_date: datetime | None = None
