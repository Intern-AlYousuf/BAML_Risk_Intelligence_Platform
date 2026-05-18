import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.scenario import Scenario
from app.schemas.scenario import ScenarioCreate, ScenarioListResponse, ScenarioResponse, ScenarioUpdate

logger = get_logger(__name__)


class ScenarioService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(self, payload: ScenarioCreate) -> ScenarioResponse:
        scenario = Scenario(**payload.model_dump())
        self._db.add(scenario)
        await self._db.flush()
        await self._db.refresh(scenario)
        logger.info("scenario.created", id=str(scenario.id))
        return ScenarioResponse.model_validate(scenario)

    async def get_by_id(self, scenario_id: uuid.UUID) -> ScenarioResponse | None:
        result = await self._db.execute(select(Scenario).where(Scenario.id == scenario_id))
        row = result.scalar_one_or_none()
        return ScenarioResponse.model_validate(row) if row else None

    async def list(
        self,
        offset: int = 0,
        limit: int = 50,
        status_filter: str | None = None,
    ) -> ScenarioListResponse:
        base_stmt = select(Scenario).where(Scenario.deleted_filter())
        if status_filter:
            base_stmt = base_stmt.where(Scenario.status == status_filter)

        count_result = await self._db.execute(
            select(func.count()).select_from(base_stmt.subquery())
        )
        total = count_result.scalar_one()

        result = await self._db.execute(base_stmt.offset(offset).limit(limit))
        items = [ScenarioResponse.model_validate(r) for r in result.scalars().all()]
        return ScenarioListResponse(total=total, items=items)

    async def update(self, scenario_id: uuid.UUID, payload: ScenarioUpdate) -> ScenarioResponse | None:
        result = await self._db.execute(select(Scenario).where(Scenario.id == scenario_id))
        scenario = result.scalar_one_or_none()
        if not scenario:
            return None

        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(scenario, field, value)

        await self._db.flush()
        await self._db.refresh(scenario)
        logger.info("scenario.updated", id=str(scenario_id))
        return ScenarioResponse.model_validate(scenario)

    async def delete(self, scenario_id: uuid.UUID) -> bool:
        result = await self._db.execute(select(Scenario).where(Scenario.id == scenario_id))
        scenario = result.scalar_one_or_none()
        if not scenario:
            return False
        await self._db.delete(scenario)
        logger.info("scenario.deleted", id=str(scenario_id))
        return True
