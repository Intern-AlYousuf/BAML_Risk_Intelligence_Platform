'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ForecastPoint } from '@/components/charts/ForecastChart';
import type { DistributionPoint } from '@/components/charts/DistributionCharrt';
import type { StatSignal } from '@/components/cards/StatCard';

/* ---------------------------------------------------------------------------
   Public types
   --------------------------------------------------------------------------- */

export type Horizon = '3M' | '6M' | '12M';

export interface SOFRMetrics {
  /** Terminal P50 rate, formatted e.g. "4.38" */
  projected:        string;
  projectedRaw:     number;
  /** Change vs spot, e.g. "−75 bps" */
  projectedDelta:   string;
  projectedSignal:  StatSignal;
  /** Annualised vol (% p.a.) rounded to integer */
  volatility:       string;
  /** P10–P90 terminal spread in bps */
  probRange:        string;
  probRangeRaw:     number;
  /** Ensemble convergence confidence 0–100 */
  confidence:       string;
  confidenceRaw:    number;
  confSignal:       StatSignal;
  /** Number of simulated paths */
  nSimulations:     number;
}

export interface PercentileValues {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/* ---------------------------------------------------------------------------
   Internal API response types
   Mirrors GET /api/v1/forecast/sofr/monte-carlo → SOFRMonteCarloResponse
   See backend: app/schemas/forecast.py
   --------------------------------------------------------------------------- */

/** PercentileBandsSchema — fan-chart curves at every forecast date */
interface ApiBands {
  dates: string[];
  p05:   number[];
  p10:   number[];
  p25:   number[];
  p50:   number[];
  p75:   number[];
  p90:   number[];
  p95:   number[];
  mean:  number[];
  std:   number[];
}

/** DistributionBinSchema — single histogram bar */
interface ApiDistBin {
  rate:        number;   /* bin centre (% p.a.) */
  probability: number;   /* probability MASS in this bin, range 0–1 */
}

/** TerminalDistributionSchema */
interface ApiDistribution {
  snapshot_date: string;
  snapshot_bday: number;
  bins:          ApiDistBin[];
  percentiles:   Record<string, number>;  /* keys "5","10","25","50","75","90","95" */
  mean:          number;
  std:           number;
  skewness:      number;
  kurtosis:      number;
}

/** ForecastPointSchema — ARIMA overlay point */
interface ApiArimaPoint {
  date:        string;
  forecast:    number;
  ci_lower_90: number;
  ci_upper_90: number;
  ci_lower_50: number;
  ci_upper_50: number;
  actual:      number | null;
}

/** MonteCarloSummarySchema — pre-computed KPI values */
interface ApiSummary {
  projected_rate:        number;
  projected_rate_label:  string;
  volatility_ann:        number;
  volatility_label:      string;
  prob_range_low:        number;
  prob_range_high:       number;
  prob_range_label:      string;
  confidence_pct:        number;
  confidence_label:      string;
  horizon_label:         string;
  horizon_calendar_days: number;
}

/** ConvergenceSchema */
interface ApiConvergence {
  n_simulations:     number;
  p50_std_error_bps: number;
  threshold_bps:     number;
  is_converged:      boolean;
  message:           string;
}

/** SOFRMonteCarloResponse — full top-level response */
interface MonteCarloResponse {
  series_id:       string;
  model_name:      string;
  fitted_order:    number[];
  n_simulations:   number;
  simulation_mode: string;
  seed:            number | null;
  train_start:     string;
  train_end:       string;
  forecast_start:  string;
  forecast_end:    string;
  bands:                    ApiBands;
  terminal_distribution:    ApiDistribution;
  snapshot_distributions:   ApiDistribution[];
  arima_points:             ApiArimaPoint[];
  summary:                  ApiSummary;
  convergence:              ApiConvergence | null;
  wall_time_s:              number;
}

/* ---------------------------------------------------------------------------
   Constants
   --------------------------------------------------------------------------- */

/** Maps UI horizon label → query param `horizon` (calendar days) */
const HORIZON_DAYS: Record<Horizon, number> = {
  '3M':  90,
  '6M':  180,
  '12M': 365,
};

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

/** Pick ~maxTicks evenly-spaced dates including the first and last. */
function pickTicks(dates: string[], maxTicks = 6): string[] {
  if (dates.length <= maxTicks) return dates;
  const step  = Math.floor(dates.length / (maxTicks - 1));
  const ticks: string[] = [];
  for (let i = 0; i < dates.length; i += step) {
    ticks.push(dates[i]);
  }
  const last = dates[dates.length - 1];
  if (ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}

/* ---------------------------------------------------------------------------
   Data transformation
   Maps SOFRMonteCarloResponse → hook return shape consumed by the UI
   --------------------------------------------------------------------------- */

function transform(raw: MonteCarloResponse) {
  const { bands, terminal_distribution, arima_points, summary, n_simulations } = raw;

  /* ── Fan chart data ────────────────────────────────────────────────────
     bands.dates is the canonical date array (business days in forecast window).
     arima_points[i].forecast is the ARIMA central forecast at that date.
     Both arrays are aligned by index (same model run, same date range).
  ─────────────────────────────────────────────────────────────────────── */

  const chartData: ForecastPoint[] = bands.dates.map((date, i) => ({
    date,
    forecast: arima_points[i]?.forecast ?? bands.p50[i],
    p10:      bands.p10[i],
    p25:      bands.p25[i],
    p75:      bands.p75[i],
    p90:      bands.p90[i],
  }));

  const forecastTickDates = pickTicks(bands.dates);

  /* ── Terminal probability distribution ────────────────────────────────
     bins[].probability is 0–1 (schema note: "probability mass in this bin").
     Multiply × 100 so chart y-axis reads "5.0%" not "0.05%".
  ─────────────────────────────────────────────────────────────────────── */

  const distributionData: DistributionPoint[] = terminal_distribution.bins.map(bin => ({
    rate: bin.rate.toFixed(2),
    prob: +(bin.probability * 100).toFixed(3),
  }));

  /* ── Percentile values ─────────────────────────────────────────────────
     terminal_distribution.percentiles has string keys: "10", "25", "50", etc.
  ─────────────────────────────────────────────────────────────────────── */

  const pct = terminal_distribution.percentiles;
  const percentileValues: PercentileValues = {
    p10: pct['10'] ?? 0,
    p25: pct['25'] ?? 0,
    p50: pct['50'] ?? summary.projected_rate,
    p75: pct['75'] ?? 0,
    p90: pct['90'] ?? 0,
  };

  /* ── Base rate range — highlights the P25–P75 "base case" zone on the
     distribution histogram.
  ─────────────────────────────────────────────────────────────────────── */

  const baseRateRange = {
    low:  percentileValues.p25,
    high: percentileValues.p75,
  };

  /* ── KPI metrics ────────────────────────────────────────────────────────
     Use backend pre-computed summary values where available.
     Compute projectedDelta ourselves (not in MonteCarloSummarySchema).
  ─────────────────────────────────────────────────────────────────────── */

  const spotRate     = arima_points[0]?.forecast ?? bands.p50[0];
  const terminalRate = summary.projected_rate;
  const delta_bps    = Math.round((terminalRate - spotRate) * 100);

  const projectedDelta =
    delta_bps === 0   ? 'Flat'
    : delta_bps > 0   ? `+${delta_bps} bps`
    : `${delta_bps} bps`;

  /* Rate cuts (negative delta) are labelled "positive" — lower rates are
     the directionally favoured outcome on a risk hedging platform.       */
  const projectedSignal: StatSignal =
    delta_bps < -5  ? 'positive' :
    delta_bps > 5   ? 'negative' :
    'neutral';

  const probRangeRaw  = summary.prob_range_high - summary.prob_range_low;
  const confidenceRaw = summary.confidence_pct;

  const confSignal: StatSignal =
    confidenceRaw >= 80 ? 'positive' :
    confidenceRaw >= 68 ? 'warning'  :
    'negative';

  const metrics: SOFRMetrics = {
    projected:       summary.projected_rate_label,  /* formatted by backend */
    projectedRaw:    summary.projected_rate,
    projectedDelta,
    projectedSignal,
    volatility:      String(Math.round(summary.volatility_ann)),
    probRange:       String(Math.round(probRangeRaw * 100)),
    probRangeRaw,
    confidence:      String(Math.round(confidenceRaw)),
    confidenceRaw,
    confSignal,
    nSimulations:    n_simulations,
  };

  return {
    chartData,
    forecastTickDates,
    distributionData,
    percentileValues,
    baseRateRange,
    metrics,
    fittedOrder: raw.fitted_order as [number, number, number],
  };
}

/* ---------------------------------------------------------------------------
   Hook state
   --------------------------------------------------------------------------- */

interface HookState {
  chartData:          ForecastPoint[];
  forecastTickDates:  string[];
  distributionData:   DistributionPoint[];
  percentileValues:   PercentileValues | null;
  baseRateRange:      { low: number; high: number };
  metrics:            SOFRMetrics | null;
  fittedOrder:        [number, number, number] | null;
  loading:            boolean;
  error:              Error | null;
}

const INITIAL_STATE: HookState = {
  chartData:         [],
  forecastTickDates: [],
  distributionData:  [],
  percentileValues:  null,
  baseRateRange:     { low: 0, high: 0 },
  metrics:           null,
  fittedOrder:       null,
  loading:           true,
  error:             null,
};

/* ---------------------------------------------------------------------------
   useSofrForecast
   --------------------------------------------------------------------------- */

export function useSofrForecast(horizon: Horizon) {
  const [state, setState] = useState<HookState>(INITIAL_STATE);

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const days = HORIZON_DAYS[horizon];

      /* ── Live endpoint ────────────────────────────────────────────────
         GET /api/v1/forecast/sofr/monte-carlo
         Proxied by Next.js to http://localhost:8000/api/v1/...
         See next.config.ts rewrites: /api/:path* → BACKEND_URL/api/:path*
      ─────────────────────────────────────────────────────────────────── */
      const url = `/api/v1/forecast/sofr/monte-carlo?horizon=${days}&n_simulations=10000`;
      const res = await fetch(url);

      if (!res.ok) {
        const body   = await res.json().catch(() => null);
        const detail = body?.detail;
        throw new Error(
          typeof detail === 'string'
            ? detail
            : `API error ${res.status} — ${res.statusText}`,
        );
      }

      const raw  = (await res.json()) as MonteCarloResponse;
      const data = transform(raw);

      setState({ ...data, loading: false, error: null });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err : new Error(String(err)),
      }));
    }
  }, [horizon]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}
