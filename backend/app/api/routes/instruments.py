"""Instruments routes — financial instrument catalog and market-data ingestion.

Covers equities, fixed income, FX, commodities, and derivatives.
Market-data ingestion endpoints are mutating; all read/query endpoints
use the read-only session.

The query endpoint uses `Annotated[MarketDataQuery, Depends()]` so FastAPI
correctly maps each Pydantic field to an individual query parameter.
Using `filters: MarketDataQuery = MarketDataQuery()` as a default would silently
accept a body instead of query params on a GET request.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies.db import DBSession, DBSessionReadOnly
from app.schemas.instrument import CommodityInstrument, InstrumentDetail, InstrumentSummary
from app.schemas.market_data import MarketDataPoint, MarketDataQuery, MarketDataResponse
from app.services.market_data_service import MarketDataService

router = APIRouter(prefix="/instruments", tags=["Instruments"])


# ── Instrument catalog ────────────────────────────────────────────────────────

@router.get(
    "/",
    response_model=list[InstrumentSummary],
    summary="List tracked instruments",
    responses={
        status.HTTP_200_OK: {"description": "Paginated instrument catalog"},
    },
)
async def list_instruments(
    db: DBSessionReadOnly,
    asset_class: str | None = Query(default=None, description="equity | fx | rates | commodity | derivative"),
    currency: str | None = Query(default=None, max_length=3),
    exchange: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[InstrumentSummary]:
    """Paginated catalog of all tracked financial instruments.

    Full implementation: queries the instrument master table (not yet created)
    with support for asset-class, currency, and exchange filters.
    """
    return []


@router.get(
    "/{ticker}",
    response_model=InstrumentDetail,
    summary="Get instrument by ticker",
    responses={
        status.HTTP_200_OK: {"description": "Full instrument record"},
        status.HTTP_404_NOT_FOUND: {"description": "Ticker not found"},
    },
)
async def get_instrument(ticker: str, db: DBSessionReadOnly) -> InstrumentDetail:
    """Retrieve full instrument detail including pricing metadata and identifiers.

    Full implementation: looks up the instrument master by primary ticker,
    ISIN, or SEDOL.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Instrument '{ticker}' not found",
    )


# ── Market data ───────────────────────────────────────────────────────────────

@router.post(
    "/market-data",
    response_model=MarketDataResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest a market data point",
    responses={
        status.HTTP_201_CREATED: {"description": "Market data point persisted"},
        status.HTTP_409_CONFLICT: {"description": "Duplicate (ticker, date, source) combination"},
    },
)
async def ingest_market_data(payload: MarketDataPoint, db: DBSession) -> MarketDataResponse:
    """Persist a single OHLCV market data point.

    Duplicate ingestion (same ticker + date + source) raises a 409 Conflict.
    Full implementation enforces the unique constraint and handles upsert logic.
    """
    return await MarketDataService(db).ingest(payload)


@router.get(
    "/market-data",
    response_model=list[MarketDataResponse],
    summary="Query historical market data",
    responses={
        status.HTTP_200_OK: {"description": "Filtered OHLCV records"},
    },
)
async def query_market_data(
    db: DBSessionReadOnly,
    filters: Annotated[MarketDataQuery, Depends()],
) -> list[MarketDataResponse]:
    """Query historical OHLCV data with optional filters.

    All query parameters are optional; omitting them returns the most recent
    `limit` records across all tickers and sources.
    """
    return await MarketDataService(db).query(filters)


# ── Commodities ───────────────────────────────────────────────────────────────

@router.get(
    "/commodities",
    response_model=list[CommodityInstrument],
    summary="List commodity instruments",
    responses={
        status.HTTP_200_OK: {"description": "Supported commodity instruments by class"},
    },
)
async def list_commodity_instruments(
    db: DBSessionReadOnly,
    commodity_class: str | None = Query(
        default=None,
        description="Filter: energy | metals | agriculture | softs",
    ),
) -> list[CommodityInstrument]:
    """Enumerate supported commodity instruments with contract metadata.

    Full implementation: queries the commodity instrument master and returns
    front-month contract details with latest settlement prices.
    """
    return []


@router.get(
    "/commodities/{symbol}",
    response_model=CommodityInstrument,
    summary="Get commodity instrument detail",
    responses={
        status.HTTP_200_OK: {"description": "Full commodity record with pricing"},
        status.HTTP_404_NOT_FOUND: {"description": "Symbol not tracked"},
    },
)
async def get_commodity_instrument(symbol: str, db: DBSessionReadOnly) -> CommodityInstrument:
    """Full commodity instrument record including contract specs and last price.

    Full implementation: returns contract size, tick size, front-month ticker,
    and most recent settlement price from the market_data table.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Commodity '{symbol}' is not tracked",
    )
