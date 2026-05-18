"""Dashboard routes — aggregate risk intelligence surface.

Endpoints here compose data from multiple services (scenarios, simulations,
market data, hedges) into views consumed by the platform's front-end dashboard.
All endpoints are read-only and use the read-only DB session to avoid
unnecessary transaction overhead.

Implementation status: placeholder — returns typed stubs pending service wiring.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query, status

from app.api.dependencies.db import DBSessionReadOnly
from app.schemas.common import NotImplementedResponse
from app.schemas.dashboard import (
    DashboardSummary,
    ExposureSummary,
    PerformanceAttribution,
    RiskAlert,
    RiskMetricSnapshot,
)

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

_NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get(
    "/summary",
    response_model=DashboardSummary,
    summary="Aggregate risk dashboard snapshot",
    responses={
        status.HTTP_200_OK: {"description": "Current risk summary"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "Market data feed unavailable"},
    },
)
async def get_dashboard_summary(db: DBSessionReadOnly) -> DashboardSummary:
    """Top-level snapshot: scenario count, simulation queue, exposure, alerts.

    Full implementation aggregates live data across the scenario, simulation,
    market-data, and hedge services. Returns empty collections until wired.
    """
    return DashboardSummary(
        total_scenarios=0,
        active_scenarios=0,
        pending_simulations=0,
        active_alerts=0,
        risk_metrics=[],
        exposure_summary=[],
        alerts=[],
        as_of=_NOW(),
    )


# ── Risk metrics ──────────────────────────────────────────────────────────────

@router.get(
    "/risk-metrics",
    response_model=list[RiskMetricSnapshot],
    summary="Portfolio-level risk metrics",
    responses={
        status.HTTP_200_OK: {"description": "VaR, CVaR, DV01, duration, Greeks"},
    },
)
async def get_risk_metrics(
    db: DBSessionReadOnly,
    currency: str = Query(default="USD", max_length=3, description="Base currency"),
    scenario_id: str | None = Query(default=None, description="Filter by scenario"),
) -> list[RiskMetricSnapshot]:
    """Portfolio-level risk metrics: VaR 95/99, CVaR, DV01, duration, Greeks.

    Full implementation: runs the risk calculation engine against the active
    scenario and live market data, returns metrics in the requested currency.
    """
    return []


# ── Exposure ──────────────────────────────────────────────────────────────────

@router.get(
    "/exposure",
    response_model=list[ExposureSummary],
    summary="Cross-asset exposure breakdown",
    responses={
        status.HTTP_200_OK: {"description": "Gross and net exposure by asset class"},
    },
)
async def get_exposure_breakdown(
    db: DBSessionReadOnly,
    currency: str = Query(default="USD", max_length=3),
) -> list[ExposureSummary]:
    """Gross and net exposure by asset class with hedge coverage ratios.

    Full implementation: joins active hedge configurations against live
    market data to produce a real-time exposure matrix.
    """
    return []


# ── Alerts ────────────────────────────────────────────────────────────────────

@router.get(
    "/alerts",
    response_model=list[RiskAlert],
    summary="Active risk limit alerts",
    responses={
        status.HTTP_200_OK: {"description": "Risk limit breaches and warnings"},
    },
)
async def get_risk_alerts(
    db: DBSessionReadOnly,
    severity: str | None = Query(
        default=None,
        description="Filter: critical | warning | info",
    ),
) -> list[RiskAlert]:
    """Active risk-limit breaches and warnings across all monitored metrics.

    Full implementation: evaluates configured limit rules against the
    current portfolio state and returns triggered alerts ordered by severity.
    """
    return []


# ── Performance ───────────────────────────────────────────────────────────────

@router.get(
    "/performance",
    response_model=list[PerformanceAttribution],
    summary="P&L performance attribution",
    responses={
        status.HTTP_200_OK: {"description": "P&L split by source (FX, rates, commodities, hedging cost)"},
    },
)
async def get_performance_attribution(
    db: DBSessionReadOnly,
    period: str = Query(
        default="daily",
        description="Attribution period: daily | mtd | qtd | ytd",
    ),
    currency: str = Query(default="USD", max_length=3),
) -> list[PerformanceAttribution]:
    """P&L attribution split by source: FX, rates, commodities, hedging cost.

    Full implementation: runs attribution analysis against historical
    positions and market data for the requested period.
    """
    return []
