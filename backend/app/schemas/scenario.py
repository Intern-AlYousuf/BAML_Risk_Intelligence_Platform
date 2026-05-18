import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class ScenarioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    base_rate: Decimal | None = Field(None, ge=Decimal("-1"), le=Decimal("1"))
    stress_factor: Decimal | None = Field(None, ge=Decimal("0"), le=Decimal("100"))
    horizon_days: int | None = Field(None, ge=1, le=3650)


class ScenarioUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    status: Literal["draft", "active", "archived"] | None = None
    base_rate: Decimal | None = Field(None, ge=Decimal("-1"), le=Decimal("1"))
    stress_factor: Decimal | None = Field(None, ge=Decimal("0"), le=Decimal("100"))
    horizon_days: int | None = Field(None, ge=1, le=3650)


class ScenarioResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    description: str | None
    status: str
    base_rate: Decimal | None
    stress_factor: Decimal | None
    horizon_days: int | None
    created_at: datetime
    updated_at: datetime


class ScenarioListResponse(BaseModel):
    total: int
    items: list[ScenarioResponse]
