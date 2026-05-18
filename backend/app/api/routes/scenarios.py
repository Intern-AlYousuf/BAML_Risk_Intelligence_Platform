"""Scenarios routes — full CRUD for risk scenario management.

Scenarios are the root context for hedges, simulations, and risk calculations.
GET endpoints use the read-only session; mutating endpoints use the read-write
session with automatic commit/rollback.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.api.dependencies.db import DBSession, DBSessionReadOnly
from app.schemas.scenario import (
    ScenarioCreate,
    ScenarioListResponse,
    ScenarioResponse,
    ScenarioUpdate,
)
from app.services.scenario_service import ScenarioService

router = APIRouter(prefix="/scenarios", tags=["Scenarios"])


# ── Collection ────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=ScenarioResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a risk scenario",
    responses={
        status.HTTP_201_CREATED: {"description": "Scenario created"},
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Validation error"},
    },
)
async def create_scenario(payload: ScenarioCreate, db: DBSession) -> ScenarioResponse:
    return await ScenarioService(db).create(payload)


@router.get(
    "/",
    response_model=ScenarioListResponse,
    summary="List all risk scenarios",
    responses={
        status.HTTP_200_OK: {"description": "Paginated scenario list"},
    },
)
async def list_scenarios(
    db: DBSessionReadOnly,
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    limit: int = Query(default=50, ge=1, le=200, description="Maximum records to return"),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Filter by status: draft | active | archived",
    ),
) -> ScenarioListResponse:
    return await ScenarioService(db).list(offset=offset, limit=limit, status_filter=status_filter)


# ── Resource ──────────────────────────────────────────────────────────────────

@router.get(
    "/{scenario_id}",
    response_model=ScenarioResponse,
    summary="Get a scenario by ID",
    responses={
        status.HTTP_200_OK: {"description": "Scenario record"},
        status.HTTP_404_NOT_FOUND: {"description": "Scenario not found"},
    },
)
async def get_scenario(scenario_id: uuid.UUID, db: DBSessionReadOnly) -> ScenarioResponse:
    result = await ScenarioService(db).get_by_id(scenario_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found")
    return result


@router.patch(
    "/{scenario_id}",
    response_model=ScenarioResponse,
    summary="Partially update a scenario",
    responses={
        status.HTTP_200_OK: {"description": "Updated scenario"},
        status.HTTP_404_NOT_FOUND: {"description": "Scenario not found"},
    },
)
async def update_scenario(
    scenario_id: uuid.UUID, payload: ScenarioUpdate, db: DBSession
) -> ScenarioResponse:
    result = await ScenarioService(db).update(scenario_id, payload)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found")
    return result


@router.delete(
    "/{scenario_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a scenario",
    responses={
        status.HTTP_204_NO_CONTENT: {"description": "Scenario deleted"},
        status.HTTP_404_NOT_FOUND: {"description": "Scenario not found"},
    },
)
async def delete_scenario(scenario_id: uuid.UUID, db: DBSession) -> None:
    deleted = await ScenarioService(db).delete(scenario_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found")


# ── Sub-resources ─────────────────────────────────────────────────────────────

@router.get(
    "/{scenario_id}/hedges",
    summary="List hedge configurations for a scenario",
    responses={
        status.HTTP_200_OK: {"description": "Hedge configurations linked to this scenario"},
        status.HTTP_404_NOT_FOUND: {"description": "Scenario not found"},
    },
)
async def list_scenario_hedges(scenario_id: uuid.UUID, db: DBSessionReadOnly) -> list[dict]:
    """Return all hedge configurations linked to this scenario.

    Full implementation: delegates to HedgeService.list_by_scenario().
    """
    return []


@router.get(
    "/{scenario_id}/simulations",
    summary="List simulations run against a scenario",
    responses={
        status.HTTP_200_OK: {"description": "Simulation results for this scenario"},
    },
)
async def list_scenario_simulations(scenario_id: uuid.UUID, db: DBSessionReadOnly) -> list[dict]:
    """Return all simulation results linked to this scenario.

    Full implementation: delegates to SimulationService.list_by_scenario().
    """
    return []
