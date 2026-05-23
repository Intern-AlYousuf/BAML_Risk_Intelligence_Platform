'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ForecastPoint } from '@/components/charts/ForecastChart';
import type { DistributionPoint } from '@/components/charts/DistributionCharrt';
import type { StatSignal } from '@/components/cards/StatCard';
import { generateSyntheticHistory, strSeed } from '@/lib/format';

/* ---------------------------------------------------------------------------
   Public types
   --------------------------------------------------------------------------- */

export type Horizon   = '3M' | '6M' | '12M';
export type CurrencyPair = 'NGNUSD' | 'INRUSD' | 'EURINR';

export interface FXMetrics {
  projectedRate:    string;
  projectedRaw:     number;
  projectedDelta:   string;
  projectedSignal:  StatSignal;
  volatility:       string;
  var95:            string;
  var95Raw:         number;
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
   Internal API response types — mirrors FX Monte Carlo response schema
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
  n_simulations?:    number;
  p50_std_error?:    number;
  threshold?:        number;
  is_converged?:     boolean;
  message?:          string;
}

interface FXMonteCarloResponse {
  pair?:            string;
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

// Business days of trailing history shown per horizon (mirrors forecast length)
const HORIZON_HIST_BDAYS: Record<Horizon, number> = {
  '3M':  63,
  '6M':  126,
  '12M': 252,
};

const BACKEND = 'http://127.0.0.1:8000';

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

function monthlyTicks(dates: string[]): string[] {
  if (dates.length === 0) return [];
  const seen = new Set<string>();
  const ticks: string[] = [];
  for (const d of dates) {
    const ym = d.slice(0, 7);
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

async function safeReadJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.warn('[useFxForecast] response body is not valid JSON — first 300 chars:', text.slice(0, 300));
    return null;
  }
}

/* ---------------------------------------------------------------------------
   Data transformation
   --------------------------------------------------------------------------- */

function transform(raw: FXMonteCarloResponse, pair: CurrencyPair, horizon: Horizon) {
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
  const currentSpot = safeNum(p50arr[0]);                  // first MC P50 ≈ spot
  // volatility_ann from backend is in PERCENTAGE form (e.g. 3.50 = 3.5%).
  // generateSyntheticHistory expects a DECIMAL (0.035).  Divide by 100.
  // Per-pair realistic caps prevent extreme values if backend reports outliers.
  const RAW_VOL_PCT: Record<CurrencyPair, number> = { INRUSD: 4, NGNUSD: 20, EURINR: 6 };
  const annVol = Math.min(
    safeNum(raw.summary?.volatility_ann, RAW_VOL_PCT[pair]) / 100,
    RAW_VOL_PCT[pair] / 100,         // hard cap at pair-specific realistic max
  );

  const apiHistPoints = arimaRaw
    .filter(p => p.date && p.actual !== null && p.actual !== undefined)
    .slice(-numHistDays);

  let histData: ForecastPoint[];

  if (apiHistPoints.length >= 5) {
    // Use real historical data from the API
    histData = apiHistPoints.map(p => ({
      date:   p.date as string,
      actual: safeNum(p.actual as number),
    }));
  } else if (splitDate && currentSpot > 0) {
    // API returned no history — generate smooth synthetic trailing data
    const seed = strSeed(`${pair}-${horizon}-${splitDate}`);
    const synth = generateSyntheticHistory(splitDate, currentSpot, numHistDays, annVol, seed);
    histData = synth.map(pt => ({ date: pt.date, actual: pt.actual }));
  } else {
    histData = [];
  }

  /* ── Fan chart ──────────────────────────────────────────────────────── */

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

  /* ── Distribution ───────────────────────────────────────────────────── */

  const bins = distRaw.bins ?? [];
  const distributionData: DistributionPoint[] = bins.map(bin => ({
    rate: safeNum(bin.rate).toFixed(2),
    prob: +(safeNum(bin.probability) * 100).toFixed(3),
  }));

  /* ── Percentiles ────────────────────────────────────────────────────── */

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

  /* ── KPI metrics ────────────────────────────────────────────────────── */

  const spotRate     = safeNum(p50arr[0]);                  // MC p50 at first forecast date
  const terminalRate = percentileValues.p50;                // SSOT: terminal_distribution.percentiles["50"]

  const pctDelta = spotRate !== 0
    ? ((terminalRate - spotRate) / spotRate) * 100
    : 0;

  const projectedDelta =
    Math.abs(pctDelta) < 0.01 ? 'Flat'
    : pctDelta > 0 ? `+${pctDelta.toFixed(1)}%`
    : `${pctDelta.toFixed(1)}%`;

  const projectedSignal: StatSignal =
    pctDelta < -1 ? 'positive' :
    pctDelta > 1  ? 'negative' :
    'neutral';

  // VaR 95%: distance from P50 to P95 (worst 5% depreciation move)
  const p95 = safeNum(pct['95'], percentileValues.p90);
  const var95Raw = Math.abs(p95 - percentileValues.p50);
  const var95    = var95Raw.toFixed(4);

  const confidenceRaw = safeNum(summary.confidence_pct, 70);
  const confSignal: StatSignal =
    confidenceRaw >= 80 ? 'positive' :
    confidenceRaw >= 68 ? 'warning'  :
    'negative';

  const volatilityAnn = safeNum(summary.volatility_ann);

  const metrics: FXMetrics = {
    projectedRate:   terminalRate.toFixed(2),  // max 2 dp — e.g. "96.21"
    projectedRaw:    terminalRate,
    projectedDelta,
    projectedSignal,
    volatility:      volatilityAnn.toFixed(2),
    var95:           var95Raw.toFixed(2),       // max 2 dp
    var95Raw,
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
  metrics:            FXMetrics | null;
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
   useFxForecast
   --------------------------------------------------------------------------- */

export function useFxForecast(pair: CurrencyPair, horizon: Horizon) {
  const [state, setState] = useState<HookState>(INITIAL_STATE);

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const days = HORIZON_DAYS[horizon];
      const url  = `${BACKEND}/api/v1/forecast/fx/monte-carlo?pair=${pair}&horizon=${days}&n_simulations=5000`;

      console.log('[FX fetch URL]', url);

      const res = await fetch(url);

      const bodyJson = await safeReadJson(res);

      console.log('[useFxForecast] raw response:', {
        status: res.status,
        ok:     res.ok,
        pair,
        horizon,
        body:   bodyJson,
      });

      if (!res.ok) {
        const body   = bodyJson as Record<string, unknown> | null;
        const detail = body?.detail;
        const msg =
          typeof detail === 'string'
            ? detail
            : `API error ${res.status} — ${res.statusText}`;

        console.error('[useFxForecast] HTTP error:', res.status, detail ?? res.statusText);
        throw new Error(msg);
      }

      let data: ReturnType<typeof transform>;
      try {
        data = transform(bodyJson as FXMonteCarloResponse, pair, horizon);
      } catch (transformErr) {
        console.error(
          '[useFxForecast] transform() failed:',
          transformErr,
          '\nRaw body:', bodyJson,
        );
        throw new Error(
          `Failed to parse FX forecast response: ${
            transformErr instanceof Error ? transformErr.message : String(transformErr)
          }`
        );
      }

      setState({ ...data, loading: false, error: null });

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[useFxForecast] fetch failed:', error.message);
      setState(prev => ({ ...prev, loading: false, error }));
    }
  }, [pair, horizon]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}
