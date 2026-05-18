"""Response schemas for the Dashboard domain.

All monetary values use Decimal — see app/db/types.py for rationale.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class RiskMetricSnapshot(BaseModel):
    """A single named risk metric at a point in time."""

    metric_name: str
    value: Decimal | None = None
    currency: str = Field(default="USD", max_length=3)
    unit: str | None = Field(default=None, description="e.g. 'bps', '%', 'USD'")
    as_of: datetime


class ExposureSummary(BaseModel):
    """Gross and net exposure broken down by asset class."""

    asset_class: str
    gross_exposure: Decimal
    net_exposure: Decimal
    currency: str = Field(default="USD", max_length=3)
    hedge_coverage: Decimal | None = Field(
        default=None,
        description="Proportion of gross exposure covered by active hedges (0–1)",
    )


class RiskAlert(BaseModel):
    """An active risk limit breach or warning."""

    alert_id: str
    severity: str = Field(..., description="critical | warning | info")
    metric: str
    threshold: Decimal
    current_value: Decimal
    currency: str = Field(default="USD", max_length=3)
    triggered_at: datetime
    message: str


class PerformanceAttribution(BaseModel):
    """P&L attribution split by source."""

    period: str = Field(..., description="e.g. 'daily', 'mtd', 'ytd'")
    total_pnl: Decimal
    fx_pnl: Decimal
    rates_pnl: Decimal
    commodity_pnl: Decimal
    hedging_cost: Decimal
    currency: str = Field(default="USD", max_length=3)
    as_of: datetime


class DashboardSummary(BaseModel):
    """Top-level risk dashboard snapshot.

    Aggregates scenario count, simulation status, live risk metrics,
    exposure breakdown, and active alerts into a single response.
    Full implementation connects the scenario, simulation, and market-data
    services with live market data feeds.
    """

    total_scenarios: int = Field(default=0)
    active_scenarios: int = Field(default=0)
    pending_simulations: int = Field(default=0)
    active_alerts: int = Field(default=0)
    risk_metrics: list[RiskMetricSnapshot] = Field(default_factory=list)
    exposure_summary: list[ExposureSummary] = Field(default_factory=list)
    alerts: list[RiskAlert] = Field(default_factory=list)
    as_of: datetime
