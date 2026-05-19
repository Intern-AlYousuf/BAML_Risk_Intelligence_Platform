"""Typed forecast endpoints.

Provides:
  GET /forecast/sofr              ARIMA forecast with CI bands
  GET /forecast/sofr/monte-carlo  Monte Carlo fan chart + terminal distribution
  GET /forecast/fx/monte-carlo    FX Monte Carlo fan chart + terminal distribution

These routes are the authoritative typed API for the SOFR and FX Forecast pages.
Every field in every response is declared in ``app/schemas/forecast.py`` and
validated by Pydantic before the response is serialised.

Architecture
------------
Route handlers are thin: they validate inputs, call the service, then pass the
output to a builder function that maps domain objects → Pydantic schemas.
No business logic lives in this file.

Builder functions (_build_*) live here rather than in the schema module so that
the schema module stays free of domain-layer imports (prevents circular deps).
"""
from __future__ import annotations

import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import settings
from app.core.exceptions import ExternalServiceError, NotFoundError
from app.forecasting.sofr.diagnostics import ResidualDiagnostics, SOFRStationarityCheck
from app.forecasting.sofr.engine import SOFRForecastOutput
from app.forecasting.fx.engine import FXForecastOutput
from app.forecasting.fx.registry import FX_PAIR_REGISTRY, get_pair_config
from app.forecasting.fx.service import FXForecastService
from app.forecasting.simulations.engine import MonteCarloResult
from app.forecasting.simulations.statistics import PercentileBands, TerminalDistribution
from app.forecasting.models.results import (
    AccuracyMetrics,
    ForecastPoint,
    ForecastResult,
    ModelFitMetrics,
)
from app.schemas.forecast import (
    AccuracyMetricsSchema,
    ConvergenceSchema,
    DiagnosticsSchema,
    DistributionBinSchema,
    ForecastPointSchema,
    ForecastSummarySchema,
    FXMonteCarloResponse,
    FXMonteCarloSummarySchema,
    ModelFitMetricsSchema,
    MonteCarloSummarySchema,
    PercentileBandsSchema,
    SOFRForecastResponse,
    SOFRMonteCarloResponse,
    StationaritySchema,
    TerminalDistributionSchema,
)
from app.services.sofr_forecast_service import (
    SOFRForecastService,
    get_sofr_forecast_service,
)

router = APIRouter(prefix="/forecast", tags=["Forecast"])

# ── Constants ─────────────────────────────────────────────────────────────────

_HORIZON_LABELS: dict[int, str] = {90: "3M", 180: "6M", 365: "12M", 730: "24M"}

_NO_FRED_KEY = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail=(
        "FRED_API_KEY is not configured. "
        "Register at https://fred.stlouisfed.org/docs/api/api_key.html "
        "and set FRED_API_KEY in your environment."
    ),
)

# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  ENDPOINTS
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


@router.get(
    "/sofr",
    response_model=SOFRForecastResponse,
    summary="SOFR ARIMA forecast with confidence intervals",
    description="""
Loads SOFR overnight rate history from FRED, fits an ARIMA(p,1,q) model,
and returns the full forecast path with 50% and 90% confidence intervals.

**Horizon shortcuts**
| Calendar days | Label |
|---|---|
| 90  | 3M  |
| 180 | 6M  |
| 365 | 12M |
| 730 | 24M |

**ARIMA order selection**
Omit `arima_p` / `arima_q` for automatic AIC-based selection (recommended).
Set all three (`arima_p`, `arima_d`, `arima_q`) to force a specific order.

**Response shape**
- `points[]` — one `ForecastPointSchema` per business day; drives the chart
- `summary` — pre-computed KPI card values (projected rate, probability range, …)
- `fit_metrics` — AIC / BIC / residual statistics
- `accuracy` — MAE / RMSE / MAPE on the held-out test window (if available)
- `stationarity` — ADF test on SOFR levels and first differences
- `diagnostics` — Ljung-Box / Jarque-Bera residual checks (if `run_diagnostics=true`)
""",
    responses={
        status.HTTP_200_OK:                   {"description": "Typed SOFR forecast"},
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Validation or model error"},
        status.HTTP_502_BAD_GATEWAY:          {"description": "FRED API unreachable"},
        status.HTTP_503_SERVICE_UNAVAILABLE:  {"description": "FRED API key not configured"},
    },
)
async def get_sofr_forecast(
    horizon:         Annotated[int,  Query(ge=30, le=730,  description="Forecast horizon in calendar days")] = 365,
    lookback_years:  Annotated[int,  Query(ge=1,  le=10,   description="Years of SOFR history to load")]     = 5,
    arima_p:         Annotated[int | None, Query(ge=0, le=8,  description="Force AR order p")] = None,
    arima_d:         Annotated[int | None, Query(ge=0, le=2,  description="Force differencing d")] = None,
    arima_q:         Annotated[int | None, Query(ge=0, le=8,  description="Force MA order q")] = None,
    enable_backtest: Annotated[bool, Query(description="Walk-forward backtest — adds ~1–3 s")] = False,
    run_diagnostics: Annotated[bool, Query(description="Residual diagnostics — negligible latency")] = True,
    service: SOFRForecastService = Depends(get_sofr_forecast_service),
) -> SOFRForecastResponse:
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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Model error: {exc}",
        )

    return _build_forecast_response(output, horizon)


@router.get(
    "/sofr/monte-carlo",
    response_model=SOFRMonteCarloResponse,
    summary="SOFR Monte Carlo simulation — fan chart and terminal distribution",
    description="""
Fits ARIMA(p,1,q) on SOFR history, then generates `n_simulations` independent
future rate paths using the fitted residual structure.

Returns:
- **Fan chart bands** (`bands`) — P5/P10/P25/P50/P75/P90/P95 at every business day
- **Terminal distribution** — probability histogram at the final forecast date
- **Snapshot distributions** — intermediate histograms at 3M / 6M / 9M checkpoints
- **ARIMA overlay** (`arima_points`) — central forecast line for chart overlay
- **KPI summary** — projected rate, annualised volatility, probability range, confidence

**Simulation modes**
- `bootstrap` *(default)*: resamples historical model residuals — preserves the
  fat-tail and asymmetric structure of SOFR shocks around FOMC meetings
- `parametric`: draws from N(0, σ²) — faster, assumes shock normality

**Performance**
| n_simulations | Approx. latency |
|---|---|
| 1,000  | ~50 ms   |
| 10,000 | ~300 ms  |
| 50,000 | ~1.5 s   |
""",
    responses={
        status.HTTP_200_OK:                   {"description": "Monte Carlo simulation output"},
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Validation or simulation error"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Simulation did not complete"},
        status.HTTP_502_BAD_GATEWAY:           {"description": "FRED API unreachable"},
        status.HTTP_503_SERVICE_UNAVAILABLE:   {"description": "FRED API key not configured"},
    },
)
async def get_sofr_monte_carlo(
    horizon:         Annotated[int,  Query(ge=30,  le=730,    description="Forecast horizon in calendar days")] = 365,
    lookback_years:  Annotated[int,  Query(ge=1,   le=10)]    = 5,
    n_simulations:   Annotated[int,  Query(ge=100, le=50_000, description="Number of simulated paths")] = 10_000,
    mode:            Annotated[str,  Query(description="'bootstrap' or 'parametric'")] = "bootstrap",
    seed:            Annotated[int | None, Query(description="RNG seed for reproducibility")] = None,
    arima_p:         Annotated[int | None, Query(ge=0, le=8)] = None,
    arima_d:         Annotated[int | None, Query(ge=0, le=2)] = None,
    arima_q:         Annotated[int | None, Query(ge=0, le=8)] = None,
    run_diagnostics: Annotated[bool, Query()] = False,
    service: SOFRForecastService = Depends(get_sofr_forecast_service),
) -> SOFRMonteCarloResponse:
    _require_fred_key()

    if mode not in ("bootstrap", "parametric"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="mode must be 'bootstrap' or 'parametric'",
        )

    arima_order = _parse_arima_order(arima_p, arima_d, arima_q)

    try:
        output = await service.run_forecast(
            horizon_calendar_days=horizon,
            lookback_years=lookback_years,
            arima_order=arima_order,
            enable_backtest=False,
            run_diagnostics=run_diagnostics,
            enable_simulation=True,
            n_simulations=n_simulations,
            simulation_mode=mode,
            simulation_seed=seed,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ExternalServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Simulation error: {exc}",
        )

    if output.simulation is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Simulation did not produce output — check server logs.",
        )

    return _build_monte_carlo_response(output, horizon, mode, seed)


# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  SCHEMA BUILDERS  (domain objects → Pydantic schemas)
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


def _build_forecast_response(
    output: SOFRForecastOutput,
    horizon_calendar_days: int,
) -> SOFRForecastResponse:
    fc = output.forecast

    points = [_build_forecast_point(p) for p in fc.points]
    summary = _build_forecast_summary(fc, horizon_calendar_days)

    return SOFRForecastResponse(
        series_id       = "SOFR",
        model_name      = fc.model_name,
        fitted_order    = list(output.fitted_order),
        order_was_auto  = output.order_was_auto,
        train_start     = str(fc.train_start),
        train_end       = str(fc.train_end),
        n_train         = fc.n_train,
        forecast_start  = str(fc.forecast_start),
        forecast_end    = str(fc.forecast_end),
        points          = points,
        summary         = summary,
        fit_metrics     = _build_fit_metrics(fc.fit_metrics),
        accuracy        = _build_accuracy(fc.accuracy),
        stationarity    = _build_stationarity(output.stationarity),
        diagnostics     = _build_diagnostics(output.diagnostics),
        fit_wall_time_s = round(output.fit_wall_time_s, 3),
    )


def _build_monte_carlo_response(
    output: SOFRForecastOutput,
    horizon_calendar_days: int,
    mode: str,
    seed: int | None,
) -> SOFRMonteCarloResponse:
    sim = output.simulation
    fc  = output.forecast

    return SOFRMonteCarloResponse(
        series_id       = "SOFR",
        model_name      = fc.model_name,
        fitted_order    = list(output.fitted_order),
        n_simulations   = sim.n_simulations,
        simulation_mode = mode,
        seed            = seed,
        train_start     = str(fc.train_start),
        train_end       = str(fc.train_end),
        forecast_start  = str(sim.forecast_start),
        forecast_end    = str(sim.forecast_end),
        bands           = _build_bands(sim.bands),
        terminal_distribution = _build_distribution(sim.terminal_distribution),
        snapshot_distributions= [_build_distribution(d) for d in sim.snapshot_distributions],
        arima_points    = [_build_forecast_point(p) for p in fc.points],
        summary         = _build_mc_summary(sim, horizon_calendar_days),
        fit_metrics     = _build_fit_metrics(fc.fit_metrics),
        accuracy        = _build_accuracy(fc.accuracy),
        convergence     = _build_convergence(sim.convergence),
        stationarity    = _build_stationarity(output.stationarity),
        wall_time_s     = round(sim.wall_time_s, 3),
    )


# ── Primitive builders ────────────────────────────────────────────────────────


def _build_forecast_point(p: ForecastPoint) -> ForecastPointSchema:
    return ForecastPointSchema(
        date        = str(p.date),
        forecast    = round(p.forecast, 4),
        ci_lower_90 = round(p.ci_lower_90, 4),
        ci_upper_90 = round(p.ci_upper_90, 4),
        ci_lower_50 = round(p.ci_lower_50, 4),
        ci_upper_50 = round(p.ci_upper_50, 4),
        actual      = None,
    )


def _build_fit_metrics(m: ModelFitMetrics) -> ModelFitMetricsSchema:
    return ModelFitMetricsSchema(
        aic            = round(m.aic, 4),
        bic            = round(m.bic, 4),
        hqic           = round(m.hqic, 4),
        log_likelihood = round(m.log_likelihood, 4),
        n_obs          = m.n_obs,
        order          = list(m.order),
        residual_mean  = round(m.residual_mean, 6),
        residual_std   = round(m.residual_std, 6),
        is_stationary  = m.is_stationary,
        is_invertible  = m.is_invertible,
    )


def _build_accuracy(a: AccuracyMetrics | None) -> AccuracyMetricsSchema | None:
    if a is None:
        return None
    return AccuracyMetricsSchema(
        mae        = round(a.mae, 6),
        rmse       = round(a.rmse, 6),
        mape       = round(a.mape, 4),
        n_test_obs = a.n_test_obs,
        test_start = str(a.test_start),
        test_end   = str(a.test_end),
    )


def _build_stationarity(s: SOFRStationarityCheck) -> StationaritySchema:
    return StationaritySchema(
        levels_p_value       = round(s.levels_result.p_value, 4),
        levels_statistic     = round(s.levels_result.test_statistic, 4),
        levels_is_stationary = s.levels_result.is_stationary,
        diff1_p_value        = round(s.diff1_result.p_value, 4),
        diff1_statistic      = round(s.diff1_result.test_statistic, 4),
        diff1_is_stationary  = s.diff1_result.is_stationary,
        recommended_d        = s.recommended_d,
        interpretation       = s.interpretation,
    )


def _build_diagnostics(d: ResidualDiagnostics | None) -> DiagnosticsSchema | None:
    if d is None:
        return None
    return DiagnosticsSchema(
        n_residuals          = d.n_residuals,
        residual_mean        = round(d.mean, 6),
        residual_std         = round(d.std, 6),
        ljung_box_stat       = round(d.ljung_box_stat, 4),
        ljung_box_pvalue     = round(d.ljung_box_pvalue, 4),
        is_white_noise       = d.is_white_noise,
        jarque_bera_stat     = round(d.jarque_bera_stat, 4),
        jarque_bera_pvalue   = round(d.jarque_bera_pvalue, 4),
        is_normal            = d.is_normal,
        adf_p_value          = round(d.adf_stationarity.p_value, 4),
        residuals_stationary = d.adf_stationarity.is_stationary,
        interpretation       = d.interpretation,
    )


def _build_bands(b: PercentileBands) -> PercentileBandsSchema:
    def _band(p: int) -> list[float]:
        return [round(v, 4) for v in b.bands.get(p, [])]

    return PercentileBandsSchema(
        dates = b.dates,
        p05   = _band(5),
        p10   = _band(10),
        p25   = _band(25),
        p50   = _band(50),
        p75   = _band(75),
        p90   = _band(90),
        p95   = _band(95),
        mean  = [round(v, 4) for v in b.mean],
        std   = [round(v, 4) for v in b.std],
    )


def _build_distribution(d: TerminalDistribution) -> TerminalDistributionSchema:
    bins = [
        DistributionBinSchema(
            rate        = round(centre, 4),
            probability = round(prob, 6),
        )
        for centre, prob in zip(d.bin_centers, d.bin_probabilities)
    ]
    return TerminalDistributionSchema(
        snapshot_date = d.snapshot_date,
        snapshot_bday = d.snapshot_bday,
        bins          = bins,
        percentiles   = {str(k): round(v, 4) for k, v in d.percentiles.items()},
        mean          = round(d.mean, 4),
        std           = round(d.std, 4),
        skewness      = round(d.skewness, 4),
        kurtosis      = round(d.kurtosis, 4),
    )


def _build_convergence(c) -> ConvergenceSchema | None:
    if c is None:
        return None
    return ConvergenceSchema(
        n_simulations     = c.n_simulations,
        p50_std_error_bps = round(c.p50_std_error_bps, 3),
        threshold_bps     = round(c.threshold_bps, 3),
        is_converged      = c.is_converged,
        message           = c.message,
    )


# ── Summary / KPI builders ────────────────────────────────────────────────────


def _build_forecast_summary(
    fc: ForecastResult,
    horizon_calendar_days: int,
) -> ForecastSummarySchema:
    """Derive KPI card values from the ARIMA forecast result."""
    if not fc.points:
        return _empty_forecast_summary(horizon_calendar_days)

    first = fc.points[0].forecast
    last  = fc.points[-1].forecast

    change  = round(last - first, 4)
    p10_t   = round(fc.points[-1].ci_lower_90, 4)   # 90% CI lower ≈ P5
    p90_t   = round(fc.points[-1].ci_upper_90, 4)   # 90% CI upper ≈ P95

    direction: str
    if change > 0.005:
        direction = "up"
    elif change < -0.005:
        direction = "down"
    else:
        direction = "flat"

    sign        = "+" if change >= 0 else ""
    change_pp   = round(change * 100, 1)    # convert to bps (percentage points × 100)
    change_lbl  = f"{sign}{change_pp:+.0f} bps vs today" if abs(change_pp) >= 1 \
                  else "Flat vs today"

    return ForecastSummarySchema(
        projected_rate         = round(last, 4),
        projected_rate_label   = f"{last:.2f}",
        change_from_spot       = change,
        change_direction       = direction,
        change_label           = change_lbl,
        probability_range_low  = p10_t,
        probability_range_high = p90_t,
        probability_range_label = f"{p10_t:.2f} – {p90_t:.2f}",
        horizon_label          = _horizon_label(horizon_calendar_days),
        horizon_calendar_days  = horizon_calendar_days,
    )


def _build_mc_summary(
    sim: MonteCarloResult,
    horizon_calendar_days: int,
) -> MonteCarloSummarySchema:
    """Derive KPI card values from the Monte Carlo result."""
    dist = sim.terminal_distribution
    pct  = dist.percentiles

    p50   = round(float(pct.get("50", pct.get(50, dist.mean))), 4)
    p10   = round(float(pct.get("10", pct.get(10, dist.mean - dist.std))), 4)
    p90   = round(float(pct.get("90", pct.get(90, dist.mean + dist.std))), 4)

    # Annualised volatility: annualise the terminal std assuming a random walk.
    # vol_ann = std_terminal * sqrt(252 / horizon_bdays) expressed as % of rate.
    # This is the lognormal annual vol approximation used in rate markets.
    horizon_bdays = sim.horizon_bdays or 1
    if p50 > 0:
        vol_ann = round(
            (dist.std / p50) * math.sqrt(max(1, 252 / horizon_bdays)) * 100, 2
        )
    else:
        vol_ann = 0.0

    # Model confidence: inverse of the relative CI width.
    ci_width = p90 - p10
    confidence = round(max(40.0, min(97.0, 97.0 - (ci_width / max(p50, 0.01)) * 100 * 0.9)), 1)

    return MonteCarloSummarySchema(
        projected_rate         = p50,
        projected_rate_label   = f"{p50:.2f}",
        volatility_ann         = vol_ann,
        volatility_label       = _vol_label(vol_ann),
        prob_range_low         = p10,
        prob_range_high        = p90,
        prob_range_label       = f"{p10:.2f} – {p90:.2f}",
        confidence_pct         = confidence,
        confidence_label       = f"{confidence:.1f}",
        horizon_label          = _horizon_label(horizon_calendar_days),
        horizon_calendar_days  = horizon_calendar_days,
    )


def _empty_forecast_summary(horizon_calendar_days: int) -> ForecastSummarySchema:
    return ForecastSummarySchema(
        projected_rate=0.0, projected_rate_label="—",
        change_from_spot=0.0, change_direction="flat", change_label="—",
        probability_range_low=0.0, probability_range_high=0.0,
        probability_range_label="—",
        horizon_label=_horizon_label(horizon_calendar_days),
        horizon_calendar_days=horizon_calendar_days,
    )


# ── Label helpers ─────────────────────────────────────────────────────────────


def _horizon_label(calendar_days: int) -> str:
    """Return the nearest named horizon label (3M, 6M, 12M, 24M)."""
    closest_key = min(_HORIZON_LABELS, key=lambda d: abs(d - calendar_days))
    return _HORIZON_LABELS[closest_key]


def _vol_label(vol_pct: float) -> str:
    """Classify annualised volatility into a human-readable regime label."""
    if vol_pct < 10:
        return "Low regime"
    if vol_pct < 20:
        return "Moderate"
    if vol_pct < 35:
        return "Elevated"
    return "High regime"


# ── Validation helpers ────────────────────────────────────────────────────────


def _require_fred_key() -> None:
    if not settings.FRED_API_KEY:
        raise _NO_FRED_KEY


def _parse_arima_order(
    p: int | None,
    d: int | None,
    q: int | None,
) -> tuple[int, int, int] | None:
    """Return an explicit (p, d, q) order, or None to trigger auto-selection."""
    if p is None and d is None and q is None:
        return None
    if None in (p, d, q):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "arima_p, arima_d, and arima_q must all be provided together "
                "to specify a fixed order. Omit all three for auto-selection."
            ),
        )
    return (p, d, q)  # type: ignore[return-value]


# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  FX FORECAST ENDPOINT
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


@router.get(
    "/fx/monte-carlo",
    response_model=FXMonteCarloResponse,
    summary="FX Monte Carlo simulation — fan chart and terminal distribution",
    description="""
Fits ARIMA(p, 0, q) on daily log returns of the requested FX pair, then
generates `n_simulations` independent future rate paths.

**Supported pairs**

| pair    | Description        | Yahoo Finance symbol |
|---------|--------------------|----------------------|
| INRUSD  | USD/INR spot rate  | USDINR=X             |
| NGNUSD  | USD/NGN spot rate  | USDNGN=X             |
| EURINR  | EUR/INR spot rate  | EURINR=X             |

**Modelling approach**

Log returns `r_t = log(P_t / P_{t-1})` are stationary for FX, so ARIMA is fit
with `d=0`.  Future levels are reconstructed:
`P_{t+k} = P_last × exp(Σ r_{t+1..t+k})`.

**Response structure**

Identical to the SOFR Monte Carlo response:
- **bands** — P5/P10/P25/P50/P75/P90/P95 at every business day
- **arima_points** — deterministic level forecast (ARIMA central path)
- **terminal_distribution** — probability histogram at the final date
- **summary** — projected rate, annualised vol, probability range, confidence
- **convergence** — path-ensemble stability check
""",
    responses={
        status.HTTP_200_OK:                   {"description": "FX Monte Carlo output"},
        status.HTTP_404_NOT_FOUND:            {"description": "Unsupported FX pair"},
        status.HTTP_422_UNPROCESSABLE_ENTITY: {"description": "Validation or simulation error"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Simulation did not complete"},
    },
)
async def get_fx_monte_carlo(
    pair:          Annotated[str, Query(description="FX pair ID: INRUSD | NGNUSD | EURINR")] = "INRUSD",
    horizon:       Annotated[int, Query(ge=30, le=730, description="Forecast horizon in calendar days")] = 365,
    lookback_years: Annotated[int, Query(ge=1, le=10)] = 5,
    n_simulations: Annotated[int, Query(ge=100, le=50_000, description="Number of simulated paths")] = 10_000,
    mode:          Annotated[str, Query(description="'bootstrap' or 'parametric'")] = "bootstrap",
    seed:          Annotated[int | None, Query(description="RNG seed for reproducibility")] = None,
    arima_p:       Annotated[int | None, Query(ge=0, le=8)] = None,
    arima_q:       Annotated[int | None, Query(ge=0, le=8)] = None,
) -> FXMonteCarloResponse:
    # ── Validate pair ──────────────────────────────────────────────────────
    pair_upper = pair.upper()
    if pair_upper not in FX_PAIR_REGISTRY:
        valid = ", ".join(sorted(FX_PAIR_REGISTRY))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"FX pair '{pair}' is not supported.  Valid pairs: {valid}",
        )

    if mode not in ("bootstrap", "parametric"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="mode must be 'bootstrap' or 'parametric'",
        )

    # ARIMA order for FX is (p, 0, q) — d is always 0 for log returns
    arima_order: tuple[int, int, int] | None = None
    if arima_p is not None and arima_q is not None:
        arima_order = (arima_p, 0, arima_q)

    # ── Run FX forecast service ────────────────────────────────────────────
    service = FXForecastService()

    try:
        output = await service.run_forecast(
            pair                  = pair_upper,
            horizon_calendar_days = horizon,
            lookback_years        = lookback_years,
            arima_order           = arima_order,
            enable_simulation     = True,
            n_simulations         = n_simulations,
            simulation_mode       = mode,
            simulation_seed       = seed,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"FX simulation error: {exc}",
        )

    if output.simulation is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Simulation did not produce output — check server logs.",
        )

    return _build_fx_monte_carlo_response(output, horizon, mode, seed)


# ── FX response builder ───────────────────────────────────────────────────────


def _build_fx_monte_carlo_response(
    output:                FXForecastOutput,
    horizon_calendar_days: int,
    mode:                  str,
    seed:                  int | None,
) -> FXMonteCarloResponse:
    """Map FXForecastOutput → FXMonteCarloResponse (Pydantic schema).

    Reuses all existing SOFR builder helpers (_build_bands, _build_distribution,
    _build_convergence, _build_forecast_point) — they operate on domain objects
    and have no SOFR-specific dependencies.
    """
    sim    = output.simulation
    fc     = output.forecast
    pair   = output.pair_id

    try:
        pair_cfg = get_pair_config(pair)
        display_name = pair_cfg.display_name
    except KeyError:
        display_name = pair

    return FXMonteCarloResponse(
        pair_id          = pair,
        display_name     = display_name,
        model_name       = fc.model_name,
        fitted_order     = list(output.fitted_order),
        n_simulations    = sim.n_simulations,
        simulation_mode  = mode,
        seed             = seed,
        train_end        = str(fc.train_end),
        forecast_start   = str(sim.forecast_start),
        forecast_end     = str(sim.forecast_end),
        bands            = _build_bands(sim.bands),
        terminal_distribution  = _build_distribution(sim.terminal_distribution),
        snapshot_distributions = [_build_distribution(d) for d in sim.snapshot_distributions],
        arima_points     = [_build_forecast_point(p) for p in fc.points],
        summary          = _build_fx_summary(sim, horizon_calendar_days),
        convergence      = _build_convergence(sim.convergence),
        wall_time_s      = round(sim.wall_time_s, 3),
    )


def _build_fx_summary(
    sim:                   MonteCarloResult,
    horizon_calendar_days: int,
) -> FXMonteCarloSummarySchema:
    """Derive KPI values from the FX Monte Carlo ensemble.

    Mirrors _build_mc_summary for SOFR; annualised vol is computed on the
    same log-return basis appropriate for FX rates.
    """
    dist = sim.terminal_distribution
    pct  = dist.percentiles

    p50 = round(float(pct.get("50", pct.get(50, dist.mean))), 4)
    p10 = round(float(pct.get("10", pct.get(10, dist.mean - dist.std))), 4)
    p90 = round(float(pct.get("90", pct.get(90, dist.mean + dist.std))), 4)

    # Annualised vol: σ_terminal * sqrt(252 / horizon_bdays) as a % of spot rate
    horizon_bdays = sim.horizon_bdays or 1
    if p50 > 0:
        vol_ann = round(
            (dist.std / p50) * math.sqrt(max(1, 252 / horizon_bdays)) * 100, 2
        )
    else:
        vol_ann = 0.0

    ci_width   = p90 - p10
    confidence = round(
        max(40.0, min(97.0, 97.0 - (ci_width / max(p50, 0.01)) * 100 * 0.9)), 1
    )

    return FXMonteCarloSummarySchema(
        projected_rate        = p50,
        projected_rate_label  = f"{p50:.2f}",
        volatility_ann        = vol_ann,
        volatility_label      = _vol_label(vol_ann),
        prob_range_low        = p10,
        prob_range_high       = p90,
        prob_range_label      = f"{p10:.2f} – {p90:.2f}",
        confidence_pct        = confidence,
        confidence_label      = f"{confidence:.1f}",
        horizon_label         = _horizon_label(horizon_calendar_days),
        horizon_calendar_days = horizon_calendar_days,
    )
