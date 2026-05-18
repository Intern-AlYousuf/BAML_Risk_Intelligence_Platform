import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    scenario_id: uuid.UUID | None = None
    simulation_type: str = Field(..., min_length=1, max_length=100)
    iterations: int = Field(default=10_000, ge=100, le=1_000_000)
    notes: str | None = None


class SimulationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    scenario_id: uuid.UUID | None
    simulation_type: str
    iterations: int | None
    status: str
    mean_value: Decimal | None
    std_dev: Decimal | None
    var_95: Decimal | None
    var_99: Decimal | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class SimulationSummary(BaseModel):
    mean_value: Decimal
    std_dev: Decimal
    var_95: Decimal
    var_99: Decimal
    min_value: Decimal
    max_value: Decimal
    percentiles: dict[str, Decimal] = Field(default_factory=dict)
