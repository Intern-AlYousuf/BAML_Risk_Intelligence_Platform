/**
 * Precomputed SOFR forecast data — fully deterministic, no random generation.
 *
 * Visual trajectories are calibrated to match the original reference screenshot.
 * All "noise" is produced by deterministic sine-wave harmonics in dataUtils.ts.
 *
 * ── Calibration reference (2026-05-24) ────────────────────────────────────────
 *
 *   Spot rate     : 3.51 %   (SOFR after Fed easing cycle, as of May 26 2026)
 *   12M terminal  : 4.15 %   (+64 bps — mean reversion upward)
 *   History shape : ~4.40 % (Jun-25) → declining with noise → 3.51 % (May-26)
 *                   Stepped, noisy decline (consistent with rate-cut environment)
 *   Forecast shape: 3.51 % → rising choppy path → 4.15 % at 12M
 *   Implied Vol   : 20 bps   (ARIMA 1-step residual label, shown in UI)
 *   Prob Range    : 205 bps  (12M IQR = P75 − P25)
 *   Confidence    : 53 %     (12M)
 *
 * ── sigma derivation ──────────────────────────────────────────────────────────
 *
 *   IQR = P75 − P25 = 205 bps = 2.05 %
 *   2.05 = 2 × 0.675 × sigma_12M  →  sigma_12M = 1.519 %
 *
 *   sigma(T) = sigma_12M × √T:
 *     3M  (T=0.25): sigma = 1.519 × 0.500 = 0.760
 *     6M  (T=0.50): sigma = 1.519 × 0.707 = 1.074
 *     12M (T=1.00): sigma = 1.519
 *
 *   P50(T) = spot + (4.15 − 3.51) × T:
 *     3M P50 = 3.51 + 0.64 × 0.25 = 3.67
 *     6M P50 = 3.51 + 0.64 × 0.50 = 3.83
 *    12M P50 = 4.15
 *
 *   12M: P10 = 4.15 − 1.282×1.519 = 2.20   P90 = 4.15 + 1.282×1.519 = 6.10
 *        P25 = 4.15 − 0.675×1.519 = 3.13   P75 = 4.15 + 0.675×1.519 = 5.18
 *
 *    6M: P10 = 3.83 − 1.282×1.074 = 2.45   P90 = 3.83 + 1.282×1.074 = 5.21
 *        P25 = 3.83 − 0.675×1.074 = 3.11   P75 = 3.83 + 0.675×1.074 = 4.56
 *
 *    3M: P10 = 3.67 − 1.282×0.760 = 2.70   P90 = 3.67 + 1.282×0.760 = 4.64
 *        P25 = 3.67 − 0.675×0.760 = 3.16   P75 = 3.67 + 0.675×0.760 = 4.18
 *
 * ── Historical start values ────────────────────────────────────────────────────
 *   Interpolated from the Jun-25 → May-26 declining trajectory:
 *     12M ago (Jun-25) : 4.40 %
 *      6M ago (Nov-25) : 3.96 %   (= 4.40 − 0.89 × 0.5)
 *      3M ago (Feb-26) : 3.73 %   (= 4.40 − 0.89 × 0.75)
 */

import { strSeed } from '@/lib/format';
import {
  genBusinessDays,
  genFanBands,
  genDistribution,
  genMonthlyTicks,
  genHistoryDrifted,
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

/** Current SOFR rate — chart split point and history endpoint. */
const SPOT       = 3.51;
const START_DATE = '2026-05-25';
const N_SIMS     = 5000;

// Historical window = forecast window (symmetric chart layout)
const BDAYS: Record<Horizon, number> = { '3M': 63, '6M': 126, '12M': 252 };

// ── Visual calibration ─────────────────────────────────────────────────────────
//
// HIST_NOISE: oscillation amplitude for history as fraction of rate level.
//   The reference screenshot shows a noisy, stepped decline.
//   At 4.0 %, noiseAmp 0.025 gives oscillations of ±0.10 % points.
//
// FORECAST_NOISE: same scale for the forecast P50 path.
//   The reference screenshot shows a distinctly noisy/choppy rising mean.

const HIST_NOISE     = 0.025;  // ±~0.10 % at SOFR ~4 %  — stepped noisy decline
const FORECAST_NOISE = 0.020;  // ±~0.07 % at SOFR ~3.7 % — choppy rising forecast

interface HorizonCfg {
  histStart: number;  // SOFR rate at the start of the lookback window
  terminal:  Terminal;
  annVolPct: number;  // displayed in the UI "Implied Volatility" card
  confPct:   number;
}

const CFG: Record<Horizon, HorizonCfg> = {
  '3M': {
    histStart: 3.73,
    terminal:  { p10: 2.70, p25: 3.16, p50: 3.67, p75: 4.18, p90: 4.64 },
    annVolPct: 20,
    confPct:   68,
  },
  '6M': {
    histStart: 3.96,
    terminal:  { p10: 2.45, p25: 3.11, p50: 3.83, p75: 4.56, p90: 5.21 },
    annVolPct: 20,
    confPct:   60,
  },
  '12M': {
    histStart: 4.40,
    terminal:  { p10: 2.20, p25: 3.13, p50: 4.15, p75: 5.18, p90: 6.10 },
    annVolPct: 20,
    confPct:   53,
  },
};

// ── Builder ────────────────────────────────────────────────────────────────────

function buildEntry(horizon: Horizon): SofrEntry {
  const { histStart, terminal, annVolPct, confPct } = CFG[horizon];

  const nBdays   = BDAYS[horizon];
  const histSeed = strSeed(`SOFR-${horizon}-${START_DATE}`);
  const bandSeed = histSeed ^ 0xDEAD;
  const distSeed = histSeed ^ 0xBEEF;

  // ── Historical segment ─────────────────────────────────────────────────────
  // Deterministic declining trajectory from histStart → SPOT with sine-wave
  // oscillation (no peakBump — SOFR declines monotonically in the reference).
  const histRaw = genHistoryDrifted(
    START_DATE, SPOT, histStart, nBdays,
    HIST_NOISE, histSeed,
    0, // no arch peak for SOFR
  );
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // ── Forecast fan-band segment ──────────────────────────────────────────────
  // SOFR rises from SPOT (3.51 %) toward terminal P50 (4.15 %) with a
  // choppy deterministic path; bands widen as √t.
  const fcastDates   = genBusinessDays(START_DATE, nBdays);
  const bands        = genFanBands(fcastDates, SPOT, terminal, bandSeed, FORECAST_NOISE);
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

  // ── KPI metrics ────────────────────────────────────────────────────────────
  const delta_bps = Math.round((terminal.p50 - SPOT) * 100);

  const projectedDelta =
    delta_bps === 0 ? 'Flat' :
    delta_bps  > 0  ? `+${delta_bps} bps` :
                      `${delta_bps} bps`;

  // Rising SOFR = tighter conditions → negative signal for borrowers
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
    probRange:       String(Math.round(probRangeRaw * 100)),  // "205"
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
