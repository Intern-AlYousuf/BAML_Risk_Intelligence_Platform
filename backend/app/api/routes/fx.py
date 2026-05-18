"""FX routes — foreign exchange rates, exposure, forward curves, and stress tests.

All GET endpoints are read-only. POST endpoints (stress tests, hedges) are
mutating and use the read-write session.

Implementation status: typed placeholders — returns empty structures pending
market-data feed integration and FX calculation engine wiring.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.api.dependencies.db import DBSession, DBSessionReadOnly
from app.core.config import settings
from app.schemas.fx import (
    FXExposure,
    FXExposureSummary,
    FXForwardCurve,
    FXRate,
    FXStressTestRequest,
)

router = APIRouter(prefix="/fx", tags=["FX"])


# ── Rates ─────────────────────────────────────────────────────────────────────

@router.get(
    "/rates",
    response_model=list[FXRate],
    summary="List live FX rates",
    responses={
        status.HTTP_200_OK: {"description": "Current bid/mid/ask for requested pairs"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "Market data feed unavailable"},
    },
)
async def list_fx_rates(
    db: DBSessionReadOnly,
    base: str | None = Query(default=None, max_length=3, description="Filter by base currency (e.g. EUR)"),
    quote: str | None = Query(default=None, max_length=3, description="Filter by quote currency (e.g. USD)"),
    source: str | None = Query(default=None, description="Data source filter"),
) -> list[FXRate]:
    """Live mid/bid/ask for all tracked currency pairs.

    Full implementation: queries the market-data feed (ENABLE_LIVE_FEEDS)
    or returns the latest cached rates from the market_data table.
    """
    return []


@router.get(
    "/rates/{pair}",
    response_model=FXRate,
    summary="Get rate for a specific currency pair",
    responses={
        status.HTTP_200_OK: {"description": "Current rate for the pair"},
        status.HTTP_404_NOT_FOUND: {"description": "Pair not found or not tracked"},
    },
)
async def get_fx_rate(
    pair: str,
    db: DBSessionReadOnly,
    source: str | None = Query(default=None),
) -> FXRate:
    """Single-pair rate lookup. `pair` format: EURUSD, GBPUSD, USDJPY.

    Full implementation: returns the most recent record from market_data
    for this ticker, or fetches from the live feed if ENABLE_LIVE_FEEDS is on.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"FX pair '{pair}' is not yet tracked",
    )


# ── Forward curves ────────────────────────────────────────────────────────────

@router.get(
    "/forward-curve/{pair}",
    response_model=FXForwardCurve,
    summary="Forward rate curve for a currency pair",
    responses={
        status.HTTP_200_OK: {"description": "Forward curve with tenor points"},
        status.HTTP_404_NOT_FOUND: {"description": "Pair not supported"},
    },
)
async def get_forward_curve(
    pair: str,
    db: DBSessionReadOnly,
    tenors: str | None = Query(
        default=None,
        description="Comma-separated tenors to include: 1W,1M,3M,6M,1Y",
    ),
) -> FXForwardCurve:
    """Bootstrapped forward rate curve for pricing FX forwards and options.

    Full implementation: reads swap-point data from market_data table
    and bootstraps the full forward curve for the requested tenors.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Forward curve for '{pair}' is not yet available",
    )


# ── Exposure ──────────────────────────────────────────────────────────────────

@router.get(
    "/exposure",
    response_model=FXExposureSummary,
    summary="Aggregate FX exposure across all currencies",
    responses={
        status.HTTP_200_OK: {"description": "Net and gross exposure with hedge coverage"},
    },
)
async def get_fx_exposure_summary(
    db: DBSessionReadOnly,
    base_currency: str = Query(default="USD", max_length=3),
    scenario_id: str | None = Query(default=None),
) -> FXExposureSummary:
    """Aggregate FX exposure: gross, net, hedge notional, and hedge ratio.

    Full implementation: joins active hedge configurations with live FX rates
    to produce a real-time exposure matrix in the base currency.
    """
    from decimal import Decimal
    from datetime import datetime, timezone
    return FXExposureSummary(
        base_currency=base_currency,
        exposures=[],
        total_gross=Decimal("0"),
        total_net=Decimal("0"),
        overall_hedge_ratio=Decimal("0"),
        as_of=datetime.now(timezone.utc),
    )


@router.get(
    "/exposure/{currency}",
    response_model=FXExposure,
    summary="FX exposure for a single currency",
    responses={
        status.HTTP_200_OK: {"description": "Per-currency exposure detail"},
        status.HTTP_404_NOT_FOUND: {"description": "No exposure for this currency"},
    },
)
async def get_fx_exposure_by_currency(
    currency: str,
    db: DBSessionReadOnly,
    base_currency: str = Query(default="USD", max_length=3),
) -> FXExposure:
    """Gross, net, and hedged exposure for a single foreign currency.

    Full implementation: aggregates all instrument positions denominated
    in the requested currency across all active scenarios.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"No tracked exposure for currency '{currency}'",
    )


# ── Stress test ───────────────────────────────────────────────────────────────

@router.post(
    "/stress-test",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit an FX stress-test job",
    responses={
        status.HTTP_202_ACCEPTED: {"description": "Stress-test job accepted and queued"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "Monte Carlo engine not enabled"},
    },
)
async def submit_fx_stress_test(
    payload: FXStressTestRequest,
    db: DBSession,
) -> dict:
    """Submit a parallel-shock FX stress test across the requested currency pairs.

    Full implementation: creates a SimulationResult record, enqueues the job,
    and returns the simulation_id for polling via GET /simulations/{id}.
    Requires ENABLE_MONTE_CARLO feature flag.
    """
    if not settings.ENABLE_MONTE_CARLO:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Monte Carlo engine is not enabled on this instance",
        )
    return {"status": "accepted", "message": "FX stress-test submission — implementation pending"}
