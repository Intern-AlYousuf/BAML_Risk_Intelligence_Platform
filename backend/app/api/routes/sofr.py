"""SOFR Forecast API endpoints.

Provides:
- ``GET /sofr/forecast``       Primary forecast for a given horizon
- ``GET /sofr/forecast/multi`` Run all four horizons (3M/6M/12M/24M)
- ``GET /sofr/diagnostics``    Residual + stationarity diagnostics only
- ``GET /sofr/history``        Preprocessed history summary (no forecast)

All endpoints require FRED_API_KEY to be configured.  A missing key returns
HTTP 503 so the error is immediately actionable (not a cryptic 502).

Response design
---------------
Forecast responses return the complete ``SOFRForecastOutput.to_dict()`` payload
rather than a reduced schema.  This keeps the route thin and lets the frontend
consume the full model output as the product evolves.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.exceptions import ExternalServiceError, NotFoundError
from app.services.sofr_forecast_service import (
    SOFRForecastService,
    get_sofr_forecast_service,
)

router = APIRouter(prefix="/sofr", tags=["SOFR Forecast"])

_NO_FRED_KEY = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail=(
        "FRED_API_KEY is not configured. "
        "Register at https://fred.stlouisfed.org/docs/api/api_key.html "
        "and set FRED_API_KEY in your environment."
    ),
)

# Valid calendar-day horizons map to the labelled UI values.
_VALID_HORIZONS: dict[int, str] = {
    90:  "3M",
    180: "6M",
    365: "12M",
    730: "24M",
}


# ── Inline request / response models ─────────────────────────────────────────
# Full Pydantic schemas will move to app/schemas/sofr.py when the FX forecaster
# is integrated under the same schema envelope.


class ForecastRequest(BaseModel):
    horizon_days:    int   = Field(365, ge=30, le=730, description="Forecast horizon in calendar days")
    lookback_years:  int   = Field(5,   ge=1,  le=10,  description="Years of SOFR history to load")
    arima_order_p:   int | None = Field(None, ge=0, le=8)
    arima_order_d:   int | None = Field(None, ge=0, le=2)
    arima_order_q:   int | None = Field(None, ge=0, le=8)
    enable_backtest: bool  = Field(False, description="Run walk-forward backtest (slower)")
    run_diagnostics: bool  = Field(True,  description="Run residual diagnostics")


class MultiForecastRequest(BaseModel):
    lookback_years:  int = Field(5, ge=1, le=10)
    enable_backtest: bool = False
    run_diagnostics: bool = True


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get(
    "/forecast",
    summary="Run SOFR ARIMA forecast",
    response_model=None,
    responses={
        status.HTTP_200_OK:                  {"description": "Forecast output"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "FRED API key not configured"},
        status.HTTP_502_BAD_GATEWAY:         {"description": "FRED API unreachable"},
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Insufficient data or model error"},
    },
)
async def get_sofr_forecast(
    horizon:         Annotated[int,  Query(ge=30, le=730, description="Forecast horizon in calendar days")] = 365,
    lookback_years:  Annotated[int,  Query(ge=1,  le=10)]  = 5,
    arima_p:         int | None = Query(default=None, ge=0, le=8, description="Force AR order p"),
    arima_d:         int | None = Query(default=None, ge=0, le=2, description="Force differencing d"),
    arima_q:         int | None = Query(default=None, ge=0, le=8, description="Force MA order q"),
    enable_backtest: bool = Query(default=False, description="Run walk-forward backtest"),
    run_diagnostics: bool = Query(default=True),
    service: SOFRForecastService = Depends(get_sofr_forecast_service),
) -> dict[str, Any]:
    """Run ARIMA forecast on SOFR overnight rate.

    Loads SOFR history from FRED, fits ARIMA(p,1,q) with optional auto-order
    selection, and returns the full forecast with confidence intervals.

    **Horizon shortcuts:**
    - 90 days  → 3M
    - 180 days → 6M
    - 365 days → 12M
    - 730 days → 24M

    **Order selection:**
    - Leave ``arima_p`` / ``arima_q`` unset → AIC-based auto-selection.
    - Set both to force a specific order.

    **Response structure:**
    ```json
    {
      "series_id": "SOFR",
      "fitted_order": [2, 1, 2],
      "order_was_auto": true,
      "fit_wall_time_s": 0.84,
      "stationarity": { ... },
      "forecast": {
        "train_start": "2019-05-17",
        "train_end": "2025-05-15",
        "n_train": 1490,
        "forecast_start": "2025-05-16",
        "forecast_end": "2026-05-15",
        "fit_metrics": { "aic": -1234.5, "bic": -1200.3, ... },
        "accuracy": { "mae": 0.12, "rmse": 0.18, ... },
        "points": [
          { "date": "2025-05-16", "forecast": 4.82, "ci_lower_90": 4.38, "ci_upper_90": 5.26, ... },
          ...
        ]
      },
      "diagnostics": { ... }
    }
    ```
    """
    _require_fred_key()

    arima_order = _parse_arima_order(arima_p, arima_d, arima_q)

    try:
        output = await service.run_forecast(
            horizon_calendar_days=horizon,
            lookback_years=lookback_years,
            arima_order=arima_order,
            enable_backtest=enable_backtest,
            run_diagnostics=run_diagnostics,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ExternalServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Model fitting failed: {exc}",
        )

    return output.to_dict()


@router.get(
    "/forecast/multi",
    summary="Run all four SOFR forecast horizons",
    response_model=None,
)
async def get_sofr_forecast_multi(
    lookback_years:  Annotated[int, Query(ge=1, le=10)] = 5,
    enable_backtest: bool = Query(default=False),
    run_diagnostics: bool = Query(default=True),
    service: SOFRForecastService = Depends(get_sofr_forecast_service),
) -> dict[str, Any]:
    """Run SOFR forecasts for 3M, 6M, 12M, and 24M horizons sequentially.

    Returns a dict keyed by horizon label (``"3M"``, ``"6M"``, ``"12M"``,
    ``"24M"``).  Horizons that fail (e.g., 24M if data is very short) are
    omitted with a warning in the response.

    Note: This endpoint is sequential, not parallel.  Each horizon re-fits the
    model on the same data but re-uses the same FRED data fetch.  For
    latency-sensitive use cases, call ``/sofr/forecast`` per horizon.
    """
    _require_fred_key()

    results: dict[str, Any] = {}
    warnings_out: list[str] = []

    for horizon_days, label in _VALID_HORIZONS.items():
        try:
            output = await service.run_forecast(
                horizon_calendar_days=horizon_days,
                lookback_years=lookback_years,
                enable_backtest=enable_backtest,
                run_diagnostics=run_diagnostics,
            )
            results[label] = output.to_dict()
        except Exception as exc:
            warnings_out.append(f"{label}: {exc}")

    return {"horizons": results, "warnings": warnings_out}


@router.get(
    "/diagnostics",
    summary="SOFR stationarity and model diagnostics",
    response_model=None,
)
async def get_sofr_diagnostics(
    lookback_years: Annotated[int, Query(ge=1, le=10)] = 5,
    service: SOFRForecastService = Depends(get_sofr_forecast_service),
) -> dict[str, Any]:
    """Return stationarity checks and residual diagnostics for the 12M forecast.

    Useful for monitoring data quality and model health without requesting a
    full forecast payload.
    """
    _require_fred_key()

    try:
        output = await service.run_forecast(
            horizon_calendar_days=365,
            lookback_years=lookback_years,
            enable_backtest=False,
            run_diagnostics=True,
        )
    except (NotFoundError, ExternalServiceError, ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        )

    return {
        "series_id":   "SOFR",
        "stationarity": output.stationarity.to_dict(),
        "diagnostics":  output.diagnostics.to_dict() if output.diagnostics else None,
        "fit_metrics":  output.forecast.fit_metrics.to_dict(),
        "fitted_order": list(output.fitted_order),
    }


@router.get(
    "/simulate",
    summary="Run SOFR Monte Carlo simulation",
    response_model=None,
    responses={
        status.HTTP_200_OK:                  {"description": "Monte Carlo simulation output"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "FRED API key not configured"},
        status.HTTP_502_BAD_GATEWAY:         {"description": "FRED API unreachable or model error"},
    },
)
async def get_sofr_simulation(
    horizon:          Annotated[int,  Query(ge=30, le=730)] = 365,
    lookback_years:   Annotated[int,  Query(ge=1,  le=10)]  = 5,
    n_simulations:    Annotated[int,  Query(ge=100, le=50_000)] = 10_000,
    mode:             str   = Query(default="bootstrap", description="'bootstrap' or 'parametric'"),
    seed:             int | None = Query(default=None, description="RNG seed for reproducibility"),
    arima_p:          int | None = Query(default=None, ge=0, le=8),
    arima_d:          int | None = Query(default=None, ge=0, le=2),
    arima_q:          int | None = Query(default=None, ge=0, le=8),
    run_diagnostics:  bool = Query(default=False),
    service: SOFRForecastService = Depends(get_sofr_forecast_service),
) -> dict[str, Any]:
    """Run a Monte Carlo simulation of future SOFR paths.

    Fits an ARIMA(p,1,q) model on historical SOFR data, then generates
    *n_simulations* independent future rate paths.  Returns:

    - **bands**: percentile fan-chart curves (P5, P10, P25, P50, P75, P90, P95)
      at every business day in the forecast horizon
    - **terminal_distribution**: probability histogram of the terminal rate
    - **convergence**: stability check on the P50 estimate

    This endpoint is designed to power fan charts and probability distribution
    visualizations in the SOFR Forecast page.

    **Simulation modes:**
    - ``bootstrap`` (default): resamples historical model residuals, preserving
      the fat-tail and asymmetric structure of SOFR shock distribution
    - ``parametric``: draws from N(0, σ²) — faster, assumes normality

    **Performance:** 10,000 paths × 252 steps runs in ~100–300ms on the server.
    Reduce n_simulations to 1,000 for sub-50ms latency.
    """
    _require_fred_key()

    if mode not in ("bootstrap", "parametric"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="mode must be 'bootstrap' or 'parametric'",
        )

    arima_order = _parse_arima_order(arima_p, arima_d, arima_q)

    try:
        output = await service.run_forecast(
            horizon_calendar_days = horizon,
            lookback_years        = lookback_years,
            arima_order           = arima_order,
            enable_backtest       = False,
            run_diagnostics       = run_diagnostics,
            enable_simulation     = True,
            n_simulations         = n_simulations,
            simulation_mode       = mode,
            simulation_seed       = seed,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ExternalServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Simulation failed: {exc}",
        )

    if output.simulation is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Simulation did not complete (check server logs).",
        )

    return {
        "series_id":    "SOFR",
        "fitted_order": list(output.fitted_order),
        "simulation":   output.simulation.to_dict(),
        # Include ARIMA point forecast alongside MC bands for chart overlay
        "arima_forecast": {
            "dates":    [str(p.date) for p in output.forecast.points],
            "values":   [round(p.forecast, 4) for p in output.forecast.points],
        },
    }


# ── Helpers ───────────────────────────────────────────────────────────────────


def _require_fred_key() -> None:
    if not settings.FRED_API_KEY:
        raise _NO_FRED_KEY


def _parse_arima_order(
    p: int | None,
    d: int | None,
    q: int | None,
) -> tuple[int, int, int] | None:
    """Return an explicit ARIMA order if all three components are provided."""
    if p is None and d is None and q is None:
        return None
    if p is None or d is None or q is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "arima_p, arima_d, and arima_q must all be provided together "
                "to specify an explicit order.  Omit all three for auto-selection."
            ),
        )
    return (p, d, q)
