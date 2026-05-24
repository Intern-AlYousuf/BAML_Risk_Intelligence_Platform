/**
 * Precomputed SOFR Monte Carlo forecast data.
 * Replaces live /api/v1/forecast/sofr/monte-carlo calls.
 *
 * Calibration reference (2026-05-24) — visually matched to original screenshot:
 *
 *   Spot rate     : 3.51 %   (SOFR as of May 26, 2026 — after Fed cuts)
 *   12M terminal  : 4.15 %   (+64 bps from spot — mean reversion upward)
 *   History       : ~4.40 % (Jun 25) → 3.51 % (May 26)   [declining trend]
 *   Implied Vol   : 20 bps   (ARIMA residual dispersion label)
 *   Prob Range    : 205 bps  (12M IQR = P75 − P25)
 *   Confidence    : 53 %     (12M)
 *
 * sigma derivation from IQR:
 *   IQR  = P75 − P25 = 2 × 0.675 × sigma   →  205 bps = 1.35 × sigma
 *   sigma_12M = 2.05 / 1.35 = 1.519 %
 *
 * Shorter horizons — sigma(T) = sigma_12M × √T, P50(T) linear interpolation:
 *   3M  (T=0.25): sigma = 1.519 × 0.500 = 0.760   P50 = 3.51 + 0.64 × 0.25 = 3.67
 *   6M  (T=0.50): sigma = 1.519 × 0.707 = 1.074   P50 = 3.51 + 0.64 × 0.50 = 3.83
 *   12M (T=1.00): sigma = 1.519               P50 = 4.15
 *
 * Historical start values (interpolated along the Jun 25 → May 26 decline):
 *   12M ago (Jun 25): 4.40 %
 *    6M ago (Nov 25): 3.96 %
 *    3M ago (Feb 26): 3.73 %
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

/**
 * Last observed SOFR rate — chart split point / history anchor.
 * As of May 26 2026 SOFR is 3.51 % after Fed easing cycle.
 * The 12M forecast (4.15 %) represents +64 bps mean reversion.
 */
const SPOT       = 3.51;
const START_DATE = '2026-05-25';
const N_SIMS     = 5000;

// Historical window matches forecast window (symmetric chart)
const BDAYS: Record<Horizon, number> = { '3M': 63, '6M': 126, '12M': 252 };

/**
 * Annualised vol used for history generation.
 * Using ~8 % gives a visually smooth declining history path
 * (the ARIMA residual label "20 bps" is a 1-step forecast error, not the
 * rolling historical vol driving the path generator).
 */
const HIST_VOL   = 0.08;

/**
 * Forecast P50 path noise amplitude in log-space.
 * Higher value → choppier MC mean path (matches SOFR original screenshot).
 */
const FORECAST_NOISE = 0.0028;

interface HorizonCfg {
  histStart: number;  // approximate SOFR at the start of the lookback window
  terminal:  Terminal;
  annVolPct: number;  // shown in UI as "volatility" metric label
  confPct:   number;
}

// ── Horizon configurations ─────────────────────────────────────────────────────
//
// 12M terminals (sigma_12M = 1.519):
//   P10 = 4.15 − 1.282 × 1.519 = 2.203   P90 = 4.15 + 1.282 × 1.519 = 6.097
//   P25 = 4.15 − 0.675 × 1.519 = 3.125   P75 = 4.15 + 0.675 × 1.519 = 5.175
//
// 6M terminals (sigma_6M = 1.074):
//   P10 = 3.83 − 1.282 × 1.074 = 2.454   P90 = 3.83 + 1.282 × 1.074 = 5.207
//   P25 = 3.83 − 0.675 × 1.074 = 3.105   P75 = 3.83 + 0.675 × 1.074 = 4.555
//
// 3M terminals (sigma_3M = 0.760):
//   P10 = 3.67 − 1.282 × 0.760 = 2.695   P90 = 3.67 + 1.282 × 0.760 = 4.644
//   P25 = 3.67 − 0.675 × 0.760 = 3.157   P75 = 3.67 + 0.675 × 0.760 = 4.183

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

  // Historical segment — drifted GBM from histStart → SPOT
  const histRaw  = genHistoryDrifted(
    START_DATE, SPOT, histStart, nBdays,
    HIST_VOL, histSeed,
  );
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // Forecast fan-band segment — SOFR mean-reverts upward from SPOT → terminal.p50
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

  // KPI metrics
  const delta_bps = Math.round((terminal.p50 - SPOT) * 100);

  const projectedDelta =
    delta_bps === 0 ? 'Flat' :
    delta_bps  > 0  ? `+${delta_bps} bps` :
                      `${delta_bps} bps`;

  // Rising SOFR means tighter monetary conditions → 'negative' signal
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
