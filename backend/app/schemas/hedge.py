import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class HedgeConfigCreate(BaseModel):
    scenario_id: uuid.UUID | None = None
    instrument_type: str = Field(..., min_length=1, max_length=100)
    notional: Decimal | None = Field(None, gt=Decimal("0"))
    strike: Decimal | None = Field(None, gt=Decimal("0"))
    maturity_days: int | None = Field(None, ge=1)
    hedge_ratio: Decimal | None = Field(None, ge=Decimal("0"), le=Decimal("1"))


class HedgeConfigUpdate(BaseModel):
    instrument_type: str | None = Field(None, min_length=1, max_length=100)
    notional: Decimal | None = Field(None, gt=Decimal("0"))
    strike: Decimal | None = Field(None, gt=Decimal("0"))
    maturity_days: int | None = Field(None, ge=1)
    hedge_ratio: Decimal | None = Field(None, ge=Decimal("0"), le=Decimal("1"))


class HedgeConfigResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    scenario_id: uuid.UUID | None
    instrument_type: str
    notional: Decimal | None
    strike: Decimal | None
    maturity_days: int | None
    hedge_ratio: Decimal | None
    created_at: datetime
    updated_at: datetime
