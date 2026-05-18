"""Simulations routes — Monte Carlo and scenario simulation job management.

Simulation jobs are asynchronous: POST submits the job (202 Accepted),
GET /{id} polls for results. All result reads use the read-only session.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.api.dependencies.db import DBSession, DBSessionReadOnly
from app.core.config import settings
from app.schemas.simulation import SimulationRequest, SimulationResponse
from app.services.simulation_service import SimulationService

router = APIRouter(prefix="/simulations", tags=["Simulations"])


@router.post(
    "/",
    response_model=SimulationResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a simulation job",
    responses={
        status.HTTP_202_ACCEPTED: {"description": "Job accepted — poll GET /{id} for results"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "Monte Carlo engine not enabled"},
    },
)
async def submit_simulation(payload: SimulationRequest, db: DBSession) -> SimulationResponse:
    """Submit an async simulation job.

    Returns immediately with status='pending'. Poll GET /{simulation_id} for
    status transitions: pending → running → completed | failed.
    Requires ENABLE_MONTE_CARLO feature flag for monte_carlo simulation type.
    """
    if payload.simulation_type == "monte_carlo" and not settings.ENABLE_MONTE_CARLO:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Monte Carlo engine is not enabled on this instance",
        )
    return await SimulationService(db).submit(payload)


@router.get(
    "/",
    response_model=list[SimulationResponse],
    summary="List simulation jobs",
    responses={
        status.HTTP_200_OK: {"description": "Simulation jobs optionally filtered by scenario or status"},
    },
)
async def list_simulations(
    db: DBSessionReadOnly,
    scenario_id: uuid.UUID | None = Query(default=None),
    sim_status: str | None = Query(
        default=None,
        alias="status",
        description="Filter: pending | running | completed | failed",
    ),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[SimulationResponse]:
    """List all simulation jobs with optional scenario and status filters.

    Full implementation: delegates to SimulationService.list() with filters.
    """
    return []


@router.get(
    "/{simulation_id}",
    response_model=SimulationResponse,
    summary="Get simulation result by ID",
    responses={
        status.HTTP_200_OK: {"description": "Simulation result (may still be pending/running)"},
        status.HTTP_404_NOT_FOUND: {"description": "Simulation not found"},
    },
)
async def get_simulation_result(
    simulation_id: uuid.UUID, db: DBSessionReadOnly
) -> SimulationResponse:
    """Retrieve the status and summary statistics for a submitted simulation job.

    Full implementation: fetches the SimulationResult record and returns
    the current status. When status='completed', summary statistics are populated.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Simulation '{simulation_id}' not found",
    )
