from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.market_data import MarketData
from app.schemas.market_data import MarketDataPoint, MarketDataQuery, MarketDataResponse

logger = get_logger(__name__)


class MarketDataService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def ingest(self, payload: MarketDataPoint) -> MarketDataResponse:
        record = MarketData(**payload.model_dump())
        self._db.add(record)
        await self._db.flush()
        await self._db.refresh(record)
        logger.info("market_data.ingested", ticker=payload.ticker, date=str(payload.data_date))
        return MarketDataResponse.model_validate(record)

    async def query(self, filters: MarketDataQuery) -> list[MarketDataResponse]:
        stmt = select(MarketData)

        if filters.ticker:
            stmt = stmt.where(MarketData.ticker == filters.ticker)
        if filters.asset_class:
            stmt = stmt.where(MarketData.asset_class == filters.asset_class)
        if filters.source:
            stmt = stmt.where(MarketData.source == filters.source)
        if filters.date_from:
            stmt = stmt.where(MarketData.data_date >= filters.date_from)
        if filters.date_to:
            stmt = stmt.where(MarketData.data_date <= filters.date_to)

        stmt = stmt.offset(filters.offset).limit(filters.limit)
        result = await self._db.execute(stmt)
        return [MarketDataResponse.model_validate(r) for r in result.scalars().all()]
