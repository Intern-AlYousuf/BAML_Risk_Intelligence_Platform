'use client';

/**
 * useSofrForecast — demo mode.
 *
 * Returns precomputed SOFR forecast data from @/data/sofr.
 * No network calls are made; loading is always false.
 *
 * To restore live API mode:
 *   1. Uncomment the full original implementation (git history: "GARCH Model Added")
 *   2. Delete the SOFR_DATA import below
 *   3. Ensure NEXT_PUBLIC_API_URL is set in .env.local / Vercel env vars
 */

import type { ForecastPoint } from '@/components/charts/ForecastChart';
import type { DistributionPoint } from '@/components/charts/DistributionCharrt';
import type { StatSignal } from '@/components/cards/StatCard';
import { SOFR_DATA } from '@/data/sofr';

/* ---------------------------------------------------------------------------
   Public types — kept here so existing consumers (sofr.tsx, page.tsx) need
   no import-path changes.
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
   useSofrForecast
   --------------------------------------------------------------------------- */

export function useSofrForecast(horizon: Horizon) {
  const d = SOFR_DATA[horizon];

  return {
    chartData:         d.chartData          as ForecastPoint[],
    forecastTickDates: d.forecastTickDates,
    splitDate:         d.splitDate          as string | null,
    distributionData:  d.distributionData   as DistributionPoint[],
    percentileValues:  d.percentileValues   as PercentileValues,
    baseRateRange:     d.baseRateRange,
    metrics:           d.metrics            as SOFRMetrics,
    fittedOrder:       d.fittedOrder        as [number, number, number],
    loading:           false                as const,
    error:             null                 as (Error | null),
    refetch:           () => {},
  };
}
