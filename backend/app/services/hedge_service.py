from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.hedge_configuration import HedgeConfiguration
from app.schemas.hedge import HedgeConfigCreate, HedgeConfigResponse, HedgeConfigUpdate

logger = get_logger(__name__)


class HedgeService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(self, payload: HedgeConfigCreate) -> HedgeConfigResponse:
        hedge = HedgeConfiguration(**payload.model_dump())
        self._db.add(hedge)
        await self._db.flush()
        await self._db.refresh(hedge)
        logger.info("hedge.created", id=str(hedge.id))
        return HedgeConfigResponse.model_validate(hedge)

    async def get_by_id(self, hedge_id: uuid.UUID) -> HedgeConfigResponse | None:
        result = await self._db.execute(
            select(HedgeConfiguration).where(HedgeConfiguration.id == hedge_id)
        )
        row = result.scalar_one_or_none()
        return HedgeConfigResponse.model_validate(row) if row else None

    async def list(
        self,
        offset: int = 0,
        limit: int = 50,
        scenario_id: uuid.UUID | None = None,
    ) -> list[HedgeConfigResponse]:
        stmt = select(HedgeConfiguration)
        if scenario_id is not None:
            stmt = stmt.where(HedgeConfiguration.scenario_id == scenario_id)
        result = await self._db.execute(stmt.offset(offset).limit(limit))
        return [HedgeConfigResponse.model_validate(r) for r in result.scalars().all()]

    async def update(
        self, hedge_id: uuid.UUID, payload: HedgeConfigUpdate
    ) -> HedgeConfigResponse | None:
        result = await self._db.execute(
            select(HedgeConfiguration).where(HedgeConfiguration.id == hedge_id)
        )
        hedge = result.scalar_one_or_none()
        if not hedge:
            return None

        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(hedge, field, value)

        await self._db.flush()
        await self._db.refresh(hedge)
        logger.info("hedge.updated", id=str(hedge_id))
        return HedgeConfigResponse.model_validate(hedge)

    async def delete(self, hedge_id: uuid.UUID) -> bool:
        result = await self._db.execute(
            select(HedgeConfiguration).where(HedgeConfiguration.id == hedge_id)
        )
        hedge = result.scalar_one_or_none()
        if not hedge:
            return False
        await self._db.delete(hedge)
        logger.info("hedge.deleted", id=str(hedge_id))
        return True

    async def list_by_scenario(
        self, scenario_id: uuid.UUID, offset: int = 0, limit: int = 100
    ) -> list[HedgeConfigResponse]:
        return await self.list(offset=offset, limit=limit, scenario_id=scenario_id)
