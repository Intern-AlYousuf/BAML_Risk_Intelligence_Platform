"""Forecasting API routes.

Exposes:
- Series catalogue (no auth required — public metadata)
- SOFR historical data endpoint (requires FRED API key in config)
- FX rate historical data endpoint
- Generic load-and-preprocess endpoint

ML forecast job endpoints (run / status) remain stubs gated behind
ENABLE_ML_FORECASTING — they will be implemented when models are added.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.exceptions import ExternalServiceError, NotFoundError
from app.forecasting import AssetClass, ForecastHorizon, list_series
from app.services.forecasting_data_service import (
    ForecastingDataService,
    get_forecasting_data_service,
)

router = APIRouter(prefix="/forecasting", tags=["Forecasting"])

_FEATURE_DISABLED = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="ML forecasting is not enabled on this instance (set ENABLE_ML_FORECASTING=true)",
)

_NO_FRED_KEY = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail=(
        "FRED_API_KEY is not configured. "
        "Register at https://fred.stlouisfed.org/docs/api/api_key.html "
        "and set FRED_API_KEY in your environment."
    ),
)


# ── Response models ───────────────────────────────────────────────────────────


class SeriesInfo(BaseModel):
    series_id:   str
    name:        str
    asset_class: str
    frequency:   str
    source:      str
    units:       str
    description: str
    loader:      str


class PreprocSummary(BaseModel):
    series_id:     str
    start:         str
    end:           str
    n_raw:         int
    n_clean:       int
    n_gaps_filled: int
    n_outliers:    int
    flags:         list[str]
    sufficient:    bool


class ForecastJobResult(BaseModel):
    forecast_id: str
    ticker:      str
    horizon_days: int
    model_name:  str
    status:      str


class ForecastRequest(BaseModel):
    ticker:       str        = Field(..., description="Instrument ticker to forecast")
    horizon_days: int        = Field(..., ge=1, le=730, description="Forecast horizon in calendar days")
    model_name:   str        = Field(default="naive", description="Model identifier")
    scenario_id:  str | None = None


# ── Series catalogue ──────────────────────────────────────────────────────────


@router.get(
    "/series",
    response_model=list[SeriesInfo],
    summary="List all registered forecast series",
)
async def list_forecast_series(
    asset_class: str | None = Query(default=None, description="Filter by asset class"),
) -> list[SeriesInfo]:
    """Return the platform's catalogue of registered time series.

    This is a static list from the series registry.  No network calls are made.
    """
    ac: AssetClass | None = None
    if asset_class:
        try:
            ac = AssetClass(asset_class)
        except ValueError:
            valid = [a.value for a in AssetClass]
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid asset_class '{asset_class}'. Valid values: {valid}",
            )

    configs = list_series(asset_class=ac)
    return [
        SeriesInfo(
            series_id=c.series_id,
            name=c.metadata.name,
            asset_class=c.metadata.asset_class.value,
            frequency=c.metadata.frequency.value,
            source=c.metadata.source.value,
            units=c.metadata.units,
            description=c.metadata.description,
            loader=c.loader,
        )
        for c in configs
    ]


# ── Data history endpoints ────────────────────────────────────────────────────


@router.get(
    "/sofr/history",
    response_model=PreprocSummary,
    summary="Load and preprocess SOFR history",
    responses={
        status.HTTP_200_OK:                  {"description": "Preprocessing summary"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "FRED API key not configured"},
        status.HTTP_502_BAD_GATEWAY:         {"description": "FRED API unreachable"},
    },
)
async def get_sofr_history(
    lookback_years: Annotated[int, Query(ge=1, le=10)] = 5,
    start:          date | None = Query(default=None),
    end:            date | None = Query(default=None),
    service: ForecastingDataService = Depends(get_forecasting_data_service),
) -> PreprocSummary:
    """Load SOFR overnight rate from FRED and run the preprocessing pipeline.

    Returns a summary of the preprocessing result.  The full cleaned series
    and derived features are available to downstream forecasting jobs but are
    not returned here (use the model endpoints for that).

    Requires FRED_API_KEY to be set in the environment.
    """
    if not settings.FRED_API_KEY:
        raise _NO_FRED_KEY

    try:
        result = await service.load_sofr(
            lookback_years=lookback_years,
            start=start,
            end=end,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ExternalServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )

    return PreprocSummary(**result.summary)


@router.get(
    "/fx/{series_id}/history",
    response_model=PreprocSummary,
    summary="Load and preprocess an FX rate series",
    responses={
        status.HTTP_200_OK:                  {"description": "Preprocessing summary"},
        status.HTTP_404_NOT_FOUND:           {"description": "Series not in registry"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "FRED API key not configured (FRED-sourced series)"},
        status.HTTP_502_BAD_GATEWAY:         {"description": "Data source unreachable"},
    },
)
async def get_fx_history(
    series_id:      str,
    lookback_years: Annotated[int, Query(ge=1, le=10)] = 5,
    start:          date | None = Query(default=None),
    end:            date | None = Query(default=None),
    service: ForecastingDataService = Depends(get_forecasting_data_service),
) -> PreprocSummary:
    """Load an FX spot rate series and run the preprocessing pipeline.

    Supported series_id values: ``USD_INR`` (FRED), ``USD_NGN`` (platform DB).

    ``USD_INR`` requires FRED_API_KEY.  ``USD_NGN`` requires data to have been
    ingested into the platform's market_data table via MarketDataService.
    """
    from app.forecasting.data.registry import get_series_config
    try:
        cfg = get_series_config(series_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    if cfg.loader == "fred" and not settings.FRED_API_KEY:
        raise _NO_FRED_KEY

    try:
        result = await service.load_fx_rate(
            series_id,
            lookback_years=lookback_years,
            start=start,
            end=end,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ExternalServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )

    return PreprocSummary(**result.summary)


@router.get(
    "/series/{series_id}/history",
    response_model=PreprocSummary,
    summary="Load and preprocess any registered series",
)
async def get_series_history(
    series_id:      str,
    lookback_years: Annotated[int, Query(ge=1, le=10)] = 5,
    start:          date | None = Query(default=None),
    end:            date | None = Query(default=None),
    service: ForecastingDataService = Depends(get_forecasting_data_service),
) -> PreprocSummary:
    """Generic endpoint to load any series in the registry.

    Delegates to the appropriate loader based on the registry configuration.
    """
    from app.forecasting.data.registry import get_series_config
    try:
        cfg = get_series_config(series_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    if cfg.loader == "fred" and not settings.FRED_API_KEY:
        raise _NO_FRED_KEY

    resolved_end   = end   or date.today()
    from datetime import timedelta
    resolved_start = start or (resolved_end - timedelta(days=lookback_years * 365))

    try:
        result = await service.load_and_preprocess(
            series_id,
            start=resolved_start,
            end=resolved_end,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ExternalServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )

    return PreprocSummary(**result.summary)


# ── ML forecast job stubs ─────────────────────────────────────────────────────
# These remain stubs; they will be implemented when models are added.


@router.post(
    "/run",
    response_model=ForecastJobResult,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a forecast job",
)
async def run_forecast(payload: ForecastRequest) -> ForecastJobResult:
    """Submit an ML forecast job.  Requires ENABLE_ML_FORECASTING=true."""
    if not settings.ENABLE_ML_FORECASTING:
        raise _FEATURE_DISABLED
    return ForecastJobResult(
        forecast_id="pending",
        ticker=payload.ticker,
        horizon_days=payload.horizon_days,
        model_name=payload.model_name,
        status="pending",
    )


@router.get(
    "/jobs/{forecast_id}",
    response_model=ForecastJobResult,
    summary="Get forecast job status",
)
async def get_forecast_job(forecast_id: str) -> ForecastJobResult:
    """Retrieve the status and results of a submitted forecast job."""
    if not settings.ENABLE_ML_FORECASTING:
        raise _FEATURE_DISABLED
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Forecast job '{forecast_id}' not found",
    )
