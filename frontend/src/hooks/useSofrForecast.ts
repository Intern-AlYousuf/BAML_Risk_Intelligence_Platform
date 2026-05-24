'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ForecastPoint } from '@/components/charts/ForecastChart';
import type { DistributionPoint } from '@/components/charts/DistributionCharrt';
import type { StatSignal } from '@/components/cards/StatCard';
import { generateSyntheticHistory, strSeed } from '@/lib/format';

/* ---------------------------------------------------------------------------
   Public types
   --------------------------------------------------------------------------- */

export type Horizon = '3M' | '6M' | '12M';

export interface SOFRMetrics {
  projected:        string;
  projectedRaw:     number;
  projectedDelta:   string;
  projectedSignal:  StatSignal;
  volatility:       string;
  probRange:        string;
  probRangeRaw:     number;
  confidence:       string;
  confidenceRaw:    number;
  confSignal:       StatSignal;
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
   All fields are optional — a partial response degrades gracefully.
   --------------------------------------------------------------------------- */

interface ApiBands {
  dates?: string[];
  p05?:   number[];
  p10?:   number[];
  p25?:   number[];
  p50?:   number[];
  p75?:   number[];
  p90?:   number[];
  p95?:   number[];
  mean?:  number[];
  std?:   number[];
}

interface ApiDistBin {
  rate?:        number | string;
  probability?: number | string;
}

interface ApiDistribution {
  snapshot_date?: string;
  snapshot_bday?: number;
  bins?:          ApiDistBin[];
  percentiles?:   Record<string, number>;
  mean?:          number;
  std?:           number;
  skewness?:      number;
  kurtosis?:      number;
}

interface ApiArimaPoint {
  date?:        string;
  forecast?:    number;
  ci_lower_90?: number;
  ci_upper_90?: number;
  ci_lower_50?: number;
  ci_upper_50?: number;
  actual?:      number | null;
}

interface ApiSummary {
  projected_rate?:        number;
  projected_rate_label?:  string;
  volatility_ann?:        number;
  volatility_label?:      string;
  prob_range_low?:        number;
  prob_range_high?:       number;
  prob_range_label?:      string;
  confidence_pct?:        number;
  confidence_label?:      string;
  horizon_label?:         string;
  horizon_calendar_days?: number;
}

interface ApiConvergence {
  n_simulations?:     number;
  p50_std_error_bps?: number;
  threshold_bps?:     number;
  is_converged?:      boolean;
  message?:           string;
}

interface MonteCarloResponse {
  series_id?:       string;
  model_name?:      string;
  fitted_order?:    number[];
  n_simulations?:   number;
  simulation_mode?: string;
  seed?:            number | null;
  train_start?:     string;
  train_end?:       string;
  forecast_start?:  string;
  forecast_end?:    string;
  bands?:                   ApiBands;
  terminal_distribution?:   ApiDistribution;
  snapshot_distributions?:  ApiDistribution[];
  arima_points?:            ApiArimaPoint[];
  summary?:                 ApiSummary;
  convergence?:             ApiConvergence | null;
  wall_time_s?:             number;
}

/* ---------------------------------------------------------------------------
   Constants
   --------------------------------------------------------------------------- */

const HORIZON_DAYS: Record<Horizon, number> = {
  '3M':  90,
  '6M':  180,
  '12M': 365,
};

const HORIZON_HIST_BDAYS: Record<Horizon, number> = {
  '3M':  63,
  '6M':  126,
  '12M': 252,
};

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

/**
 * Returns one tick per calendar month (the first business day in each month
 * that exists in the data array).  This produces clean monthly labels for
 * 3M / 6M / 12M horizons without compressing the visible chart range.
 */
function monthlyTicks(dates: string[]): string[] {
  if (dates.length === 0) return [];
  const seen = new Set<string>();
  const ticks: string[] = [];
  for (const d of dates) {
    const ym = d.slice(0, 7); // "YYYY-MM"
    if (!seen.has(ym)) {
      seen.add(ym);
      ticks.push(d);
    }
  }
  const last = dates[dates.length - 1];
  if (ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ---------------------------------------------------------------------------
   Safe JSON parse
   Reads body as text first so a non-JSON error page doesn't throw.
   --------------------------------------------------------------------------- */

async function safeReadJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
   Data transformation
   Every field access uses optional chaining + nullish coalescing so a
   partially-populated response degrades gracefully instead of throwing.
   --------------------------------------------------------------------------- */

function transform(raw: MonteCarloResponse, horizon: Horizon) {
  const bands    = raw.bands                 ?? {};
  const arimaRaw = raw.arima_points          ?? [];
  const distRaw  = raw.terminal_distribution ?? {};
  const summary  = raw.summary               ?? {};
  const nSims    = safeNum(raw.n_simulations, 10_000);

  const dates  = bands.dates ?? [];
  const p10arr = bands.p10   ?? [];
  const p25arr = bands.p25   ?? [];
  const p50arr = bands.p50   ?? [];
  const p75arr = bands.p75   ?? [];
  const p90arr = bands.p90   ?? [];

  /* ── Historical series ──────────────────────────────────────────────── */

  const splitDate   = raw.forecast_start ?? (dates[0] ?? null);
  const numHistDays = HORIZON_HIST_BDAYS[horizon];
  const currentSpot = safeNum(p50arr[0]);                  // first MC P50 ≈ current rate
  // volatility_ann from backend is in PERCENTAGE form (e.g. 2.50 = 2.5%).
  // generateSyntheticHistory expects a DECIMAL (0.025).  Divide by 100.
  // SOFR realistic annual vol ≈ 2–4%; cap at 4% to prevent extreme paths.
  const annVol = Math.min(safeNum(raw.summary?.volatility_ann, 2) / 100, 0.04);

  const apiHistPoints = arimaRaw
    .filter(p => p.date && p.actual !== null && p.actual !== undefined)
    .slice(-numHistDays);

  let histData: ForecastPoint[];

  if (apiHistPoints.length >= 5) {
    histData = apiHistPoints.map(p => ({
      date:   p.date as string,
      actual: safeNum(p.actual as number),
    }));
  } else if (splitDate && currentSpot > 0) {
    const seed = strSeed(`SOFR-${horizon}-${splitDate}`);
    const synth = generateSyntheticHistory(splitDate, currentSpot, numHistDays, annVol, seed);
    histData = synth.map(pt => ({ date: pt.date, actual: pt.actual }));
  } else {
    histData = [];
  }

  /* ── Fan chart ─────────────────────────────────────────────────────── */

  const forecastData: ForecastPoint[] = dates.map((date, i) => ({
    date,
    forecast: safeNum(p50arr[i]),  // MC median path — terminal value == P50 == KPI
    p10:      safeNum(p10arr[i]),
    p25:      safeNum(p25arr[i]),
    p75:      safeNum(p75arr[i]),
    p90:      safeNum(p90arr[i]),
  }));

  const chartData = [...histData, ...forecastData];

  const forecastTickDates = monthlyTicks(chartData.map(d => d.date));

  /* ── Distribution ──────────────────────────────────────────────────── */

  const bins = distRaw.bins ?? [];
  const distributionData: DistributionPoint[] = bins.map(bin => ({
    rate: safeNum(bin.rate).toFixed(2),
    prob: +(safeNum(bin.probability) * 100).toFixed(3),
  }));

  /* ── Percentiles ───────────────────────────────────────────────────── */

  const pct           = distRaw.percentiles ?? {};
  const projectedRate = safeNum(summary.projected_rate);

  const percentileValues: PercentileValues = {
    p10: safeNum(pct['10']),
    p25: safeNum(pct['25']),
    p50: safeNum(pct['50'], projectedRate),
    p75: safeNum(pct['75']),
    p90: safeNum(pct['90']),
  };

  const baseRateRange = { low: percentileValues.p25, high: percentileValues.p75 };

  /* ── KPI metrics ───────────────────────────────────────────────────── */

  const spotRate     = safeNum(p50arr[0]);                  // MC p50 at first forecast date
  const terminalRate = percentileValues.p50;                // SSOT: terminal_distribution.percentiles["50"]
  const delta_bps    = Math.round((terminalRate - spotRate) * 100);

  const projectedDelta =
    delta_bps === 0 ? 'Flat'
    : delta_bps > 0 ? `+${delta_bps} bps`
    : `${delta_bps} bps`;

  const projectedSignal: StatSignal =
    delta_bps < -5 ? 'positive' :
    delta_bps > 5  ? 'negative' :
    'neutral';

  const probRangeRaw  = safeNum(summary.prob_range_high) - safeNum(summary.prob_range_low);
  const confidenceRaw = safeNum(summary.confidence_pct, 70);

  const confSignal: StatSignal =
    confidenceRaw >= 80 ? 'positive' :
    confidenceRaw >= 68 ? 'warning'  :
    'negative';

  const metrics: SOFRMetrics = {
    projected:       terminalRate.toFixed(2),  // P50-anchored rate; StatCard appends "%" via unit prop
    projectedRaw:    terminalRate,
    projectedDelta,
    projectedSignal,
    volatility:      String(Math.round(safeNum(summary.volatility_ann))),
    probRange:       String(Math.round(probRangeRaw * 100)),
    probRangeRaw,
    confidence:      String(Math.round(confidenceRaw)),
    confidenceRaw,
    confSignal,
    nSimulations:    nSims,
  };

  return {
    chartData,
    forecastTickDates,
    splitDate,
    distributionData,
    percentileValues,
    baseRateRange,
    metrics,
    fittedOrder: (raw.fitted_order ?? [2, 1, 2]) as [number, number, number],
  };
}

/* ---------------------------------------------------------------------------
   Hook state
   --------------------------------------------------------------------------- */

interface HookState {
  chartData:          ForecastPoint[];
  forecastTickDates:  string[];
  splitDate:          string | null;
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
  splitDate:         null,
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

      const url = `${BACKEND}/api/v1/forecast/sofr/monte-carlo?horizon=${days}&n_simulations=5000`;

      const res = await fetch(url);

      const bodyJson = await safeReadJson(res);

      // ── HTTP error ───────────────────────────────────────────────────────
      if (!res.ok) {
        const body   = bodyJson as Record<string, unknown> | null;
        const detail = body?.detail;
        const msg =
          typeof detail === 'string'
            ? detail
            : `API error ${res.status} — ${res.statusText}`;

        throw new Error(msg);
      }

      // ── Transform ────────────────────────────────────────────────────────
      let data: ReturnType<typeof transform>;
      try {
        data = transform(bodyJson as MonteCarloResponse, horizon);
      } catch (transformErr) {
        throw new Error(
          `Failed to parse forecast response: ${
            transformErr instanceof Error ? transformErr.message : String(transformErr)
          }`
        );
      }

      setState({ ...data, loading: false, error: null });

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState(prev => ({ ...prev, loading: false, error }));
    }
  }, [horizon]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}
