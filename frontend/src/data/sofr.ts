/**
 * Precomputed SOFR Monte Carlo forecast data.
 * Replaces live /api/v1/forecast/sofr/monte-carlo calls.
 * All values seeded deterministically — no network dependency at runtime.
 *
 * Reference date : 2026-05-24
 * Spot rate      : 4.30 %
 * Model          : ARIMA(2,1,2) — Fed Funds rate cutting cycle
 */

import { generateSyntheticHistory, strSeed } from '@/lib/format';
import {
  genBusinessDays,
  genFanBands,
  genDistribution,
  genMonthlyTicks,
} from './dataUtils';
import type { Terminal, DistributionPoint } from './dataUtils';

// ── Public types (re-exported for useSofrForecast + page consumers) ───────────

export type Horizon    = '3M' | '6M' | '12M';
export type StatSignal = 'positive' | 'negative' | 'warning' | 'neutral';

export interface SOFRMetrics {
  projected:       string;
  projectedRaw:    number;
  projectedDelta:  string;
  projectedSignal: StatSignal;
  volatility:      string;
  probRange:       string;
  probRangeRaw:    number;
  confidence:      string;
  confidenceRaw:   number;
  confSignal:      StatSignal;
  nSimulations:    number;
}

export interface PercentileValues {
  p10: number; p25: number; p50: number; p75: number; p90: number;
}

// ── ChartData point (compatible with ForecastPoint from ForecastChart) ────────

export interface ChartPoint {
  date:      string;
  actual?:   number;
  forecast?: number;
  p10?:      number;
  p25?:      number;
  p75?:      number;
  p90?:      number;
}

export interface SofrEntry {
  chartData:          ChartPoint[];
  forecastTickDates:  string[];
  splitDate:          string;
  distributionData:   DistributionPoint[];
  percentileValues:   PercentileValues;
  baseRateRange:      { low: number; high: number };
  metrics:            SOFRMetrics;
  fittedOrder:        [number, number, number];
}

// ── Fixed reference values ─────────────────────────────────────────────────────

const SPOT       = 4.30; // Current SOFR rate (%)
const START_DATE = '2026-05-25'; // First forecast business day
const N_SIMS     = 5000;

// Historical lookback = same length as forecast horizon (symmetric chart)
const BDAYS: Record<Horizon, number> = { '3M': 63, '6M': 126, '12M': 252 };

// Per-horizon configuration
interface HorizonCfg {
  terminal:  Terminal;
  annVolPct: number; // annual vol in % (e.g. 2.5)
  confPct:   number;
}

const CFG: Record<Horizon, HorizonCfg> = {
  '3M': {
    terminal:  { p10: 3.85, p25: 4.05, p50: 4.20, p75: 4.35, p90: 4.55 },
    annVolPct: 2.5,
    confPct:   74,
  },
  '6M': {
    terminal:  { p10: 3.50, p25: 3.70, p50: 4.00, p75: 4.30, p90: 4.60 },
    annVolPct: 3.0,
    confPct:   71,
  },
  '12M': {
    terminal:  { p10: 2.80, p25: 3.30, p50: 3.75, p75: 4.20, p90: 4.60 },
    annVolPct: 3.5,
    confPct:   68,
  },
};

// ── Builder ────────────────────────────────────────────────────────────────────

function buildEntry(horizon: Horizon): SofrEntry {
  const { terminal, annVolPct, confPct } = CFG[horizon];
  const annVol   = Math.min(annVolPct / 100, 0.04); // capped at 4 % decimal
  const nBdays   = BDAYS[horizon];
  const histSeed = strSeed(`SOFR-${horizon}-${START_DATE}`);
  const bandSeed = histSeed ^ 0xDEAD;
  const distSeed = histSeed ^ 0xBEEF;

  // ── Historical segment (seeded synthetic, matches generateSyntheticHistory) ──
  const histRaw  = generateSyntheticHistory(START_DATE, SPOT, nBdays, annVol, histSeed);
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // ── Forecast fan-band segment ──────────────────────────────────────────────
  const fcastDates  = genBusinessDays(START_DATE, nBdays);
  const bands       = genFanBands(fcastDates, SPOT, terminal, bandSeed);
  const forecastData: ChartPoint[] = bands.map(b => ({
    date:     b.date,
    forecast: b.forecast,
    p10:      b.p10,
    p25:      b.p25,
    p75:      b.p75,
    p90:      b.p90,
  }));

  const chartData         = [...histData, ...forecastData];
  const forecastTickDates = genMonthlyTicks(chartData.map(d => d.date));

  // ── Terminal distribution ──────────────────────────────────────────────────
  // σ calibrated from IQR: (P90 - P10) / (2 × z₀.₉ ≈ 1.282)
  const sigma           = (terminal.p90 - terminal.p10) / (2 * 1.282);
  const distributionData = genDistribution(terminal.p50, sigma, 30, 2, distSeed);

  const percentileValues: PercentileValues = { ...terminal };
  const baseRateRange = { low: terminal.p25, high: terminal.p75 };

  // ── KPI metrics ────────────────────────────────────────────────────────────
  const delta_bps = Math.round((terminal.p50 - SPOT) * 100);

  const projectedDelta =
    delta_bps === 0 ? 'Flat' :
    delta_bps  > 0  ? `+${delta_bps} bps` :
                      `${delta_bps} bps`;

  const projectedSignal: StatSignal =
    delta_bps < -5 ? 'positive' :
    delta_bps >  5 ? 'negative' :
    'neutral';

  const probRangeRaw = terminal.p75 - terminal.p25;

  const confSignal: StatSignal =
    confPct >= 80 ? 'positive' :
    confPct >= 68 ? 'warning'  :
    'negative';

  const metrics: SOFRMetrics = {
    projected:       terminal.p50.toFixed(2),
    projectedRaw:    terminal.p50,
    projectedDelta,
    projectedSignal,
    volatility:      String(Math.round(annVolPct)),      // e.g. "3"
    probRange:       String(Math.round(probRangeRaw * 100)), // bps e.g. "30"
    probRangeRaw,
    confidence:      String(confPct),
    confidenceRaw:   confPct,
    confSignal,
    nSimulations:    N_SIMS,
  };

  return {
    chartData,
    forecastTickDates,
    splitDate: START_DATE,
    distributionData,
    percentileValues,
    baseRateRange,
    metrics,
    fittedOrder: [2, 1, 2],
  };
}

// ── Eagerly computed at module load (no network, no async) ─────────────────────

export const SOFR_DATA: Record<Horizon, SofrEntry> = {
  '3M':  buildEntry('3M'),
  '6M':  buildEntry('6M'),
  '12M': buildEntry('12M'),
};
