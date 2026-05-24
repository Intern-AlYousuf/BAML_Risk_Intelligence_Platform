/**
 * Precomputed SOFR Monte Carlo forecast data.
 * Replaces live /api/v1/forecast/sofr/monte-carlo calls.
 *
 * Calibration reference (2026-05-24):
 *   Spot rate     : 4.35 %
 *   12M terminal  : 4.15 %  (−20 bps from spot)
 *   Vol display   : 20      (annualised vol in bps-label form)
 *   Prob range    : 205 bps (12M IQR)
 *   Confidence    : 53 %    (12M)
 *
 * Shorter horizons are scaled coherently:
 *   P50 drift     ∝ T
 *   Band widths   ∝ √T   (standard MC uncertainty)
 *   VaR           ∝ √T
 *   Confidence    decreases with longer horizon
 */

import { generateSyntheticHistory, strSeed } from '@/lib/format';
import {
  genBusinessDays,
  genFanBands,
  genDistribution,
  genMonthlyTicks,
} from './dataUtils';
import type { Terminal, DistributionPoint } from './dataUtils';

// ── Public types ───────────────────────────────────────────────────────────────

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

// ── Model parameters ───────────────────────────────────────────────────────────

/** Last observed SOFR rate — chart split point / history anchor */
const SPOT       = 4.35;
const START_DATE = '2026-05-25';
const N_SIMS     = 5000;

// Historical window matches forecast window (symmetric chart)
const BDAYS: Record<Horizon, number> = { '3M': 63, '6M': 126, '12M': 252 };

// ── 12M anchor calibration ─────────────────────────────────────────────────────
//
// sigma_12M derived from prob-range target: 205 bps IQR
//   IQR  = P75 - P25 = 2 × 0.675 × sigma  →  sigma = 1.025 / 0.675 = 1.519
//
// Shorter horizons: sigma(T) = sigma_12M × √(T/1)
//   3M  (T=0.25):  sigma = 1.519 × 0.500 = 0.760
//   6M  (T=0.50):  sigma = 1.519 × 0.707 = 1.074
//   12M (T=1.00):  sigma = 1.519 × 1.000 = 1.519
//
// P50(T) linearly interpolated from spot → 12M terminal:
//   3M  P50 = 4.35 + (4.15 − 4.35) × 0.25 = 4.30
//   6M  P50 = 4.35 + (4.15 − 4.35) × 0.50 = 4.25
//   12M P50 = 4.15

interface HorizonCfg {
  terminal:  Terminal;
  annVolPct: number; // shown in UI as "volatility" metric label
  confPct:   number;
}

const CFG: Record<Horizon, HorizonCfg> = {
  '3M': {
    terminal: { p10: 3.33, p25: 3.79, p50: 4.30, p75: 4.81, p90: 5.28 },
    annVolPct: 20,
    confPct:   68,
  },
  '6M': {
    terminal: { p10: 2.87, p25: 3.53, p50: 4.25, p75: 4.98, p90: 5.63 },
    annVolPct: 20,
    confPct:   60,
  },
  '12M': {
    terminal: { p10: 2.20, p25: 3.13, p50: 4.15, p75: 5.18, p90: 6.10 },
    annVolPct: 20,
    confPct:   53,
  },
};

// ── Builder ────────────────────────────────────────────────────────────────────

function buildEntry(horizon: Horizon): SofrEntry {
  const { terminal, annVolPct, confPct } = CFG[horizon];

  // History generation: cap at 4 % (original transform: Math.min(vol/100, 0.04))
  const annVol   = Math.min(annVolPct / 100, 0.04);
  const nBdays   = BDAYS[horizon];
  const histSeed = strSeed(`SOFR-${horizon}-${START_DATE}`);
  const bandSeed = histSeed ^ 0xDEAD;
  const distSeed = histSeed ^ 0xBEEF;

  // Historical segment
  const histRaw  = generateSyntheticHistory(START_DATE, SPOT, nBdays, annVol, histSeed);
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // Forecast fan-band segment
  const fcastDates   = genBusinessDays(START_DATE, nBdays);
  const bands        = genFanBands(fcastDates, SPOT, terminal, bandSeed);
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

  // Terminal distribution — σ back-derived from IQR
  const sigma            = (terminal.p90 - terminal.p10) / (2 * 1.282);
  const distributionData = genDistribution(terminal.p50, sigma, 30, 2, distSeed);

  const percentileValues: PercentileValues = { ...terminal };
  const baseRateRange = { low: terminal.p25, high: terminal.p75 };

  // KPI metrics
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
    volatility:      String(Math.round(annVolPct)),           // "20"
    probRange:       String(Math.round(probRangeRaw * 100)),  // e.g. "205"
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

// ── Eagerly computed at module load ────────────────────────────────────────────

export const SOFR_DATA: Record<Horizon, SofrEntry> = {
  '3M':  buildEntry('3M'),
  '6M':  buildEntry('6M'),
  '12M': buildEntry('12M'),
};
