'use client';

/**
 * useFxForecast — demo mode.
 *
 * Returns precomputed FX forecast data from @/data/fx.
 * No network calls are made; loading is always false.
 *
 * To restore live API mode:
 *   1. Uncomment the full original implementation (git history: "GARCH Model Added")
 *   2. Delete the FX_DATA import below
 *   3. Ensure NEXT_PUBLIC_API_URL is set in .env.local / Vercel env vars
 */

import type { ForecastPoint } from '@/components/charts/ForecastChart';
import type { DistributionPoint } from '@/components/charts/DistributionCharrt';
import type { StatSignal } from '@/components/cards/StatCard';
import { FX_DATA } from '@/data/fx';

/* ---------------------------------------------------------------------------
   Public types — kept here so existing consumers (fx.tsx, page.tsx) need
   no import-path changes.
   --------------------------------------------------------------------------- */

export type Horizon      = '3M' | '6M' | '12M';
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
   useFxForecast
   --------------------------------------------------------------------------- */

export function useFxForecast(pair: CurrencyPair, horizon: Horizon) {
  const d = FX_DATA[`${pair}-${horizon}`];

  return {
    chartData:         d.chartData          as ForecastPoint[],
    forecastTickDates: d.forecastTickDates,
    splitDate:         d.splitDate          as string | null,
    distributionData:  d.distributionData   as DistributionPoint[],
    percentileValues:  d.percentileValues   as PercentileValues,
    baseRateRange:     d.baseRateRange,
    metrics:           d.metrics            as FXMetrics,
    fittedOrder:       d.fittedOrder        as [number, number, number],
    loading:           false                as const,
    error:             null                 as (Error | null),
    refetch:           () => {},
  };
}
