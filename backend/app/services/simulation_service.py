from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.simulation_result import SimulationResult
from app.schemas.simulation import SimulationRequest, SimulationResponse

logger = get_logger(__name__)


class SimulationService:
    """Orchestrates simulation job creation and result persistence.

    Actual Monte Carlo engines live in app/simulations/ and are injected
    at runtime once the ENABLE_MONTE_CARLO feature flag is active.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def submit(self, request: SimulationRequest) -> SimulationResponse:
        record = SimulationResult(
            scenario_id=request.scenario_id,
            simulation_type=request.simulation_type,
            iterations=request.iterations,
            status="pending",
            notes=request.notes,
        )
        self._db.add(record)
        await self._db.flush()
        await self._db.refresh(record)
        logger.info("simulation.submitted", id=str(record.id), type=request.simulation_type)
        return SimulationResponse.model_validate(record)
