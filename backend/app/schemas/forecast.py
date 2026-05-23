"""Pydantic response schemas for SOFR forecasting and Monte Carlo simulation.

Schema design principles
-------------------------
1. **Frontend-first shape**: field names and nesting match what the frontend
   chart components expect (recharts Area/Line data, KPI card props).
2. **Flat over nested where possible**: reduces destructuring boilerplate in the
   TypeScript layer.
3. **Decimal-free**: all rates and probabilities are plain floats — the frontend
   renders them directly without further coercion.
4. **Dates as ISO strings**: DatetimeIndex is serialised to "YYYY-MM-DD" so the
   frontend can pass them directly to Recharts or display them without parsing.
5. **Optional fields are None, not absent**: keeps the response shape stable and
   avoids conditional key-existence checks in the frontend.

Naming conventions
------------------
``*Response``   — top-level response type for a route
``*Schema``     — embedded sub-object
``*Params``     — request / query parameter objects
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  SHARED PRIMITIVES
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


class ForecastPointSchema(BaseModel):
    """Single-date forecast or historical output.

    Matches the chart data format expected by Recharts AreaChart / LineChart.
    Historical observations set only `actual`; forecast dates set `forecast` +
    CI fields.  Both field groups are nullable so that one schema serves both
    historical and forecast points without a schema split.
    """
    date:        str         = Field(...,  description="ISO date YYYY-MM-DD")
    forecast:    float | None = Field(None, description="ARIMA central forecast — None for historical points")
    ci_lower_90: float | None = Field(None, description="5th percentile — outer lower band")
    ci_upper_90: float | None = Field(None, description="95th percentile — outer upper band")
    ci_lower_50: float | None = Field(None, description="25th percentile — inner lower band")
    ci_upper_50: float | None = Field(None, description="75th percentile — inner upper band")
    actual:      float | None = Field(None, description="Historical observed rate (training window only)")


class ModelFitMetricsSchema(BaseModel):
    """ARIMA in-sample fit quality."""
    aic:            float
    bic:            float
    hqic:           float
    log_likelihood: float
    n_obs:          int
    order:          list[int]  = Field(..., description="[p, d, q]")
    residual_mean:  float
    residual_std:   float
    is_stationary:  bool       = Field(..., description="AR roots outside unit circle")
    is_invertible:  bool       = Field(..., description="MA roots outside unit circle")


class AccuracyMetricsSchema(BaseModel):
    """Out-of-sample forecast accuracy on a held-out test window."""
    mae:        float = Field(..., description="Mean Absolute Error (% p.a.)")
    rmse:       float = Field(..., description="Root Mean Squared Error (% p.a.)")
    mape:       float = Field(..., description="Mean Absolute Percentage Error (%)")
    n_test_obs: int
    test_start: str
    test_end:   str


class StationaritySchema(BaseModel):
    """ADF unit-root test results for SOFR levels and first differences."""
    levels_p_value:       float
    levels_statistic:     float
    levels_is_stationary: bool
    diff1_p_value:        float
    diff1_statistic:      float
    diff1_is_stationary:  bool
    recommended_d:        int
    interpretation:       str


class DiagnosticsSchema(BaseModel):
    """Residual diagnostics from the fitted ARIMA model."""
    n_residuals:        int
    residual_mean:      float
    residual_std:       float
    ljung_box_stat:     float
    ljung_box_pvalue:   float
    is_white_noise:     bool
    jarque_bera_stat:   float
    jarque_bera_pvalue: float
    is_normal:          bool
    adf_p_value:        float
    residuals_stationary: bool
    interpretation:     str


# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  SOFR FORECAST RESPONSE
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


class ForecastSummarySchema(BaseModel):
    """Derived KPI-card values for the SOFR Forecast page header row.

    Computed from the forecast array — no additional model calls required.
    """
    projected_rate:       float  = Field(..., description="Terminal forecast rate (% p.a.)")
    projected_rate_label: str    = Field(..., description="Formatted for display, e.g. '4.82'")
    change_from_spot:     float  = Field(..., description="Terminal forecast − last training rate")
    change_direction:     Literal["up", "down", "flat"]
    change_label:         str    = Field(..., description="Human label, e.g. '+0.32 pp vs today'")
    probability_range_low:  float = Field(..., description="P10 terminal rate (% p.a.)")
    probability_range_high: float = Field(..., description="P90 terminal rate (% p.a.)")
    probability_range_label: str  = Field(..., description="Formatted, e.g. '3.80 – 5.60'")
    horizon_label:        str    = Field(..., description="'3M' | '6M' | '12M' | '24M'")
    horizon_calendar_days: int


class SOFRForecastResponse(BaseModel):
    """Complete SOFR ARIMA forecast response.

    Top-level envelope returned by ``GET /api/v1/forecast/sofr``.
    """
    series_id:    str  = Field(default="SOFR")
    model_name:   str  = Field(..., description="e.g. 'ARIMA(2, 1, 2)'")
    fitted_order: list[int]
    order_was_auto: bool

    # Training window
    train_start: str
    train_end:   str
    n_train:     int

    # Forecast window
    forecast_start: str
    forecast_end:   str

    # Chart data — all business-day steps in the forecast horizon
    points: list[ForecastPointSchema]

    # Derived KPI values
    summary: ForecastSummarySchema

    # Model quality
    fit_metrics: ModelFitMetricsSchema
    accuracy:    AccuracyMetricsSchema | None = None
    stationarity: StationaritySchema
    diagnostics:  DiagnosticsSchema | None = None

    # Engine metadata
    fit_wall_time_s: float


# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  MONTE CARLO RESPONSE
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


class PercentileBandsSchema(BaseModel):
    """Fan-chart data: all percentile curves at every forecast date.

    Designed for direct consumption by a Recharts AreaChart or D3 fan chart.
    Each field is a list of the same length as ``dates``.
    """
    dates: list[str]    = Field(..., description="ISO date strings (x-axis)")
    p05:   list[float]  = Field(..., description="5th percentile path")
    p10:   list[float]  = Field(..., description="10th percentile path")
    p25:   list[float]  = Field(..., description="25th percentile path")
    p50:   list[float]  = Field(..., description="Median path")
    p75:   list[float]  = Field(..., description="75th percentile path")
    p90:   list[float]  = Field(..., description="90th percentile path")
    p95:   list[float]  = Field(..., description="95th percentile path")
    mean:  list[float]  = Field(..., description="Mean across all paths")
    std:   list[float]  = Field(..., description="Std deviation across paths")


class DistributionBinSchema(BaseModel):
    """Single bar in the probability distribution histogram."""
    rate:        float = Field(..., description="Rate value at bin centre (% p.a.)")
    probability: float = Field(..., description="Probability mass in this bin (0–1)")


class TerminalDistributionSchema(BaseModel):
    """Terminal rate distribution at a single snapshot horizon.

    The ``bins`` list is pre-zipped (rate + probability) so the frontend can
    pass it directly as data to a Recharts BarChart.
    """
    snapshot_date: str
    snapshot_bday: int   = Field(..., description="Business-day index from forecast start")

    bins: list[DistributionBinSchema]

    # Named percentile values for tooltip overlay
    percentiles: dict[str, float]   = Field(
        ...,
        description="String keys '5', '10', '25', '50', '75', '90', '95'",
    )
    mean:      float
    std:       float
    skewness:  float
    kurtosis:  float   = Field(..., description="Excess kurtosis (normal → 0)")


class ConvergenceSchema(BaseModel):
    """Stability check: is the simulation sufficiently converged?"""
    n_simulations:      int
    p50_std_error_bps:  float = Field(..., description="Bootstrap std-error of P50 estimate, in bps")
    threshold_bps:      float = Field(default=1.0, description="Convergence threshold, bps")
    is_converged:       bool
    message:            str


class MonteCarloSummarySchema(BaseModel):
    """KPI-card values derived from the Monte Carlo ensemble.

    Provides the four metrics displayed in the ``Prediction Metrics Row``
    on the SOFR Forecast page.
    """
    projected_rate:       float  = Field(..., description="P50 terminal rate (% p.a.)")
    projected_rate_label: str    = Field(..., description="Formatted for display")
    volatility_ann:       float  = Field(..., description="Annualised vol (% p.a.)")
    volatility_label:     str    = Field(..., description="e.g. 'Low regime', 'Moderate', 'Elevated'")
    prob_range_low:       float  = Field(..., description="P10 terminal rate")
    prob_range_high:      float  = Field(..., description="P90 terminal rate")
    prob_range_label:     str    = Field(..., description="e.g. '4.40 – 5.60'")
    confidence_pct:       float  = Field(..., description="Ensemble model confidence (0–100)")
    confidence_label:     str    = Field(..., description="e.g. '84.2'")
    horizon_label:        str
    horizon_calendar_days: int


class SOFRMonteCarloResponse(BaseModel):
    """Complete SOFR Monte Carlo simulation response.

    Top-level envelope returned by ``GET /api/v1/forecast/sofr/monte-carlo``.
    Includes both the MC bands and the ARIMA point-forecast overlay so the
    frontend only needs to call one endpoint to render the full chart.
    """
    series_id:       str = Field(default="SOFR")
    model_name:      str
    fitted_order:    list[int]
    n_simulations:   int
    simulation_mode: Literal["bootstrap", "parametric"]
    seed:            int | None = None

    # Training / forecast window
    train_start:     str
    train_end:       str
    forecast_start:  str
    forecast_end:    str

    # Fan chart data
    bands: PercentileBandsSchema

    # Terminal distribution (for histogram chart — default: last forecast date)
    terminal_distribution: TerminalDistributionSchema

    # Intermediate distributions (for multi-horizon slider, e.g. 3M/6M/9M snapshots)
    snapshot_distributions: list[TerminalDistributionSchema] = Field(default_factory=list)

    # ARIMA point forecast overlay (central line rendered on top of MC fan)
    arima_points: list[ForecastPointSchema]

    # Derived KPI values for metric cards
    summary: MonteCarloSummarySchema

    # Model quality
    fit_metrics: ModelFitMetricsSchema
    accuracy:    AccuracyMetricsSchema | None = None

    # Simulation diagnostics
    convergence: ConvergenceSchema | None = None
    stationarity: StationaritySchema

    wall_time_s: float


# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  REQUEST PARAMETER SCHEMAS (used by POST variants or as documentation types)
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


class SOFRForecastParams(BaseModel):
    """Query parameters for ``GET /forecast/sofr``."""
    horizon:         int  = Field(365, ge=30, le=730, description="Forecast horizon in calendar days")
    lookback_years:  int  = Field(5,   ge=1,  le=10,  description="Years of SOFR history")
    arima_p:         int | None = Field(None, ge=0, le=8,  description="Force AR order p (omit for auto)")
    arima_d:         int | None = Field(None, ge=0, le=2,  description="Force differencing d")
    arima_q:         int | None = Field(None, ge=0, le=8,  description="Force MA order q")
    enable_backtest: bool = Field(False, description="Walk-forward backtest — adds latency")
    run_diagnostics: bool = Field(True,  description="Residual diagnostics — negligible overhead")


class SOFRMonteCarloParams(BaseModel):
    """Query parameters for ``GET /forecast/sofr/monte-carlo``."""
    horizon:         int  = Field(365, ge=30,  le=730,    description="Forecast horizon in calendar days")
    lookback_years:  int  = Field(5,   ge=1,   le=10)
    n_simulations:   int  = Field(10_000, ge=100, le=50_000, description="Number of paths")
    mode:            Literal["bootstrap", "parametric"] = Field(
        "bootstrap",
        description="bootstrap: resamples residuals; parametric: draws from N(0, σ²)",
    )
    seed:            int | None = Field(None, description="RNG seed for reproducibility")
    arima_p:         int | None = Field(None, ge=0, le=8)
    arima_d:         int | None = Field(None, ge=0, le=2)
    arima_q:         int | None = Field(None, ge=0, le=8)
    run_diagnostics: bool = Field(False, description="Include residual diagnostics in response")


# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
#  FX MONTE CARLO RESPONSE
#  Mirrors SOFRMonteCarloResponse field-for-field so the frontend can reuse
#  useSofrForecast-style transform logic with minimal adaptation.
# ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──


class FXMonteCarloSummarySchema(BaseModel):
    """KPI-card values derived from the FX Monte Carlo ensemble.

    Field names intentionally mirror ``MonteCarloSummarySchema`` so the same
    frontend transform() function works for both SOFR and FX responses.
    """
    projected_rate:        float = Field(..., description="P50 terminal rate")
    projected_rate_label:  str   = Field(..., description="Formatted for display, e.g. '84.32'")
    volatility_ann:        float = Field(..., description="Annualised vol (%, log-return basis)")
    volatility_label:      str   = Field(..., description="e.g. 'Low regime', 'Moderate'")
    prob_range_low:        float = Field(..., description="P10 terminal rate")
    prob_range_high:       float = Field(..., description="P90 terminal rate")
    prob_range_label:      str   = Field(..., description="e.g. '82.10 – 88.50'")
    confidence_pct:        float = Field(..., description="Ensemble confidence (0–100)")
    confidence_label:      str
    horizon_label:         str
    horizon_calendar_days: int


class FXMonteCarloResponse(BaseModel):
    """Complete FX Monte Carlo simulation response.

    Top-level envelope returned by ``GET /api/v1/forecast/fx/monte-carlo``.

    Field layout is identical to ``SOFRMonteCarloResponse`` except:
    - ``pair_id`` replaces ``series_id``
    - ``stationarity`` is omitted (log-return stationarity is an ARIMA assumption)
    - ``accuracy`` and ``fit_metrics`` are omitted (no held-out test window)
    """
    pair_id:         str = Field(..., description="Pair ID, e.g. 'INRUSD'")
    display_name:    str = Field(..., description="Human label, e.g. 'USD/INR'")
    model_name:      str
    fitted_order:    list[int]
    n_simulations:   int
    simulation_mode: Literal["bootstrap", "parametric"]
    seed:            int | None = None

    # Training / forecast window
    train_end:       str
    forecast_start:  str
    forecast_end:    str

    # Fan chart data — all percentile paths at every forecast date
    bands: PercentileBandsSchema

    # Terminal rate distribution at the last forecast date
    terminal_distribution: TerminalDistributionSchema

    # Intermediate distributions at 3M / 6M / 9M checkpoints
    snapshot_distributions: list[TerminalDistributionSchema] = Field(default_factory=list)

    # ARIMA point-forecast overlay (central line rendered on top of MC fan)
    arima_points: list[ForecastPointSchema]

    # Derived KPI values — same field names as SOFR for frontend reuse
    summary: FXMonteCarloSummarySchema

    # Simulation diagnostics
    convergence: ConvergenceSchema | None = None

    wall_time_s: float
