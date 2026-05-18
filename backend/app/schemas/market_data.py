import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class MarketDataPoint(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=50)
    asset_class: str = Field(..., min_length=1, max_length=50)
    data_date: date
    source: str = Field(..., min_length=1, max_length=100)
    open_price: Decimal | None = None
    high_price: Decimal | None = None
    low_price: Decimal | None = None
    close_price: Decimal | None = None
    volume: Decimal | None = None


class MarketDataResponse(MarketDataPoint):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class MarketDataQuery(BaseModel):
    ticker: str | None = None
    asset_class: str | None = None
    source: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
