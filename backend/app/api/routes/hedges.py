"""Hedges routes — CRUD for hedge configuration management.

Hedge configurations belong to scenarios and define the instrument-level
parameters for hedging strategies (notional, strike, maturity, hedge ratio).

GET endpoints use the read-only session; all mutating endpoints use
read-write sessions with automatic commit/rollback.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.api.dependencies.db import DBSession, DBSessionReadOnly
from app.schemas.hedge import HedgeConfigCreate, HedgeConfigResponse, HedgeConfigUpdate
from app.services.hedge_service import HedgeService

router = APIRouter(prefix="/hedges", tags=["Hedges"])


# ── Collection ────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=HedgeConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a hedge configuration",
    responses={
        status.HTTP_201_CREATED: {"description": "Hedge configuration created"},
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Validation error"},
    },
)
async def create_hedge(payload: HedgeConfigCreate, db: DBSession) -> HedgeConfigResponse:
    return await HedgeService(db).create(payload)


@router.get(
    "/",
    response_model=list[HedgeConfigResponse],
    summary="List all hedge configurations",
    responses={
        status.HTTP_200_OK: {"description": "Hedge configurations optionally filtered by scenario"},
    },
)
async def list_hedges(
    db: DBSessionReadOnly,
    scenario_id: uuid.UUID | None = Query(default=None, description="Filter by parent scenario"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[HedgeConfigResponse]:
    return await HedgeService(db).list(
        offset=offset, limit=limit, scenario_id=scenario_id
    )


# ── Resource ──────────────────────────────────────────────────────────────────

@router.get(
    "/{hedge_id}",
    response_model=HedgeConfigResponse,
    summary="Get a hedge configuration by ID",
    responses={
        status.HTTP_200_OK: {"description": "Hedge configuration record"},
        status.HTTP_404_NOT_FOUND: {"description": "Hedge not found"},
    },
)
async def get_hedge(hedge_id: uuid.UUID, db: DBSessionReadOnly) -> HedgeConfigResponse:
    result = await HedgeService(db).get_by_id(hedge_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hedge not found")
    return result


@router.patch(
    "/{hedge_id}",
    response_model=HedgeConfigResponse,
    summary="Partially update a hedge configuration",
    responses={
        status.HTTP_200_OK: {"description": "Updated hedge configuration"},
        status.HTTP_404_NOT_FOUND: {"description": "Hedge not found"},
    },
)
async def update_hedge(
    hedge_id: uuid.UUID, payload: HedgeConfigUpdate, db: DBSession
) -> HedgeConfigResponse:
    result = await HedgeService(db).update(hedge_id, payload)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hedge not found")
    return result


@router.delete(
    "/{hedge_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete a hedge configuration",
    responses={
        status.HTTP_200_OK: {"description": "Hedge deleted"},
        status.HTTP_404_NOT_FOUND: {"description": "Hedge not found"},
    },
)
async def delete_hedge(hedge_id: uuid.UUID, db: DBSession) -> None:
    deleted = await HedgeService(db).delete(hedge_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hedge not found")


# ── Scenario sub-resource ─────────────────────────────────────────────────────

@router.get(
    "/scenario/{scenario_id}",
    response_model=list[HedgeConfigResponse],
    summary="List hedges for a scenario",
    responses={
        status.HTTP_200_OK: {"description": "All hedge configurations linked to this scenario"},
    },
)
async def list_hedges_for_scenario(
    scenario_id: uuid.UUID,
    db: DBSessionReadOnly,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[HedgeConfigResponse]:
    return await HedgeService(db).list_by_scenario(
        scenario_id=scenario_id, offset=offset, limit=limit
    )
