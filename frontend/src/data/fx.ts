/**
 * Precomputed FX Monte Carlo forecast data.
 * Replaces live /api/v1/forecast/fx/monte-carlo calls.
 *
 * Calibration reference (2026-05-24):
 *
 *   USD/INR  spot ≈ 95.90 → 12M P50 = 101.23  (+5.7 %)  vol = 4.33 %  conf = 87 %  VaR95 = 7.56
 *   USD/NGN  spot ≈ 1365  → 12M P50 = 1339.45  (−2.2 %)  vol = 29.58%  conf = 40 %  VaR95 = 892.52
 *   EUR/INR  spot ≈ 90.20 → 12M P50 = 91.80    (+1.8 %)  vol = 6.00 %  conf = 70 %
 *
 * Shorter horizons scale coherently:
 *   P50 drift   ∝ T
 *   Band widths ∝ √T  (standard MC uncertainty)
 *   VaR95       ∝ √T
 *   Confidence  decreases slightly with longer horizon
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

export type Horizon      = '3M' | '6M' | '12M';
export type CurrencyPair = 'NGNUSD' | 'INRUSD' | 'EURINR';
export type StatSignal   = 'positive' | 'negative' | 'warning' | 'neutral';

export interface FXMetrics {
  projectedRate:   string;
  projectedRaw:    number;
  projectedDelta:  string;
  projectedSignal: StatSignal;
  volatility:      string;
  var95:           string;
  var95Raw:        number;
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

export interface FxEntry {
  chartData:          ChartPoint[];
  forecastTickDates:  string[];
  splitDate:          string;
  distributionData:   DistributionPoint[];
  percentileValues:   PercentileValues;
  baseRateRange:      { low: number; high: number };
  metrics:            FXMetrics;
  fittedOrder:        [number, number, number];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const START_DATE = '2026-05-25';
const N_SIMS     = 5000;

// Historical lookback = forecast window (symmetric chart)
const BDAYS: Record<Horizon, number> = { '3M': 63, '6M': 126, '12M': 252 };

// Annualised vol cap per pair (decimal) — mirrors original transform logic
const VOL_CAP: Record<CurrencyPair, number> = {
  INRUSD: 0.04,
  NGNUSD: 0.20,
  EURINR: 0.06,
};

interface PairHorizonCfg {
  spot:      number;
  terminal:  Terminal;
  annVolPct: number;  // shown in UI as "volatility" metric
  confPct:   number;
}

// ── Pair × Horizon configuration ───────────────────────────────────────────────
//
// Derivation method (12M anchor → shorter horizons via √t scaling):
//
//   sigma_12M  = VaR95 / 1.645
//   sigma(T)   = sigma_12M × √(T/1)
//   P25(T)     = P50(T) − 0.675 × sigma(T)
//   P75(T)     = P50(T) + 0.675 × sigma(T)
//   P10(T)     = P50(T) − 1.282 × sigma(T)
//   P90(T)     = P50(T) + 1.282 × sigma(T)
//   P50(T)     = spot + (P50_12M − spot) × T   [linear drift interpolation]
//
// ── USD/INR ──────────────────────────────────────────────────────────────────
//   spot = 95.90,  P50_12M = 101.23  (+5.7 %)
//   sigma_12M = 7.56 / 1.645 = 4.596
//   sigma_6M  = 4.596 × √0.5 = 3.249
//   sigma_3M  = 4.596 × √0.25 = 2.298
//
// ── USD/NGN ──────────────────────────────────────────────────────────────────
//   spot = 1365,   P50_12M = 1339.45  (−2.2 %)
//   sigma_12M = 892.52 / 1.645 = 542.57
//   sigma_6M  = 542.57 × √0.5 = 383.60
//   sigma_3M  = 542.57 × √0.25 = 271.29
//
// ── EUR/INR ──────────────────────────────────────────────────────────────────
//   spot = 90.20,  P50_12M = 91.80   (+1.8 %)
//   sigma_12M = 91.80 × 0.06 = 5.508   (GBM: σ × S)
//   sigma_6M  = 5.508 × √0.5 = 3.895
//   sigma_3M  = 5.508 × √0.25 = 2.754

const PAIR_CFG: Record<CurrencyPair, Record<Horizon, PairHorizonCfg>> = {

  INRUSD: {
    '3M': {
      spot:      95.90,
      terminal:  { p10: 94.28, p25: 95.68, p50: 97.23, p75: 98.78, p90: 100.18 },
      annVolPct: 4.33,
      confPct:   93,
    },
    '6M': {
      spot:      95.90,
      terminal:  { p10: 94.41, p25: 96.38, p50: 98.57, p75: 100.76, p90: 102.74 },
      annVolPct: 4.33,
      confPct:   90,
    },
    '12M': {
      spot:      95.90,
      terminal:  { p10: 95.34, p25: 98.13, p50: 101.23, p75: 104.33, p90: 107.12 },
      annVolPct: 4.33,
      confPct:   87,
    },
  },

  NGNUSD: {
    '3M': {
      spot:      1365,
      terminal:  { p10: 1011, p25: 1175, p50: 1359, p75: 1542, p90: 1706 },
      annVolPct: 29.58,
      confPct:   55,
    },
    '6M': {
      spot:      1365,
      terminal:  { p10: 860, p25: 1093, p50: 1352, p75: 1611, p90: 1844 },
      annVolPct: 29.58,
      confPct:   47,
    },
    '12M': {
      spot:      1365,
      terminal:  { p10: 644, p25: 973, p50: 1339, p75: 1706, p90: 2035 },
      annVolPct: 29.58,
      confPct:   40,
    },
  },

  EURINR: {
    '3M': {
      spot:      90.20,
      terminal:  { p10: 87.07, p25: 88.74, p50: 90.60, p75: 92.46, p90: 94.13 },
      annVolPct: 6.0,
      confPct:   78,
    },
    '6M': {
      spot:      90.20,
      terminal:  { p10: 86.01, p25: 88.37, p50: 91.00, p75: 93.63, p90: 95.99 },
      annVolPct: 6.0,
      confPct:   74,
    },
    '12M': {
      spot:      90.20,
      terminal:  { p10: 84.74, p25: 88.08, p50: 91.80, p75: 95.52, p90: 98.86 },
      annVolPct: 6.0,
      confPct:   70,
    },
  },
};

// ── Builder ────────────────────────────────────────────────────────────────────

function buildEntry(pair: CurrencyPair, horizon: Horizon): FxEntry {
  const { spot, terminal, annVolPct, confPct } = PAIR_CFG[pair][horizon];

  // Cap vol for history generation (mirrors original transform)
  const annVol   = Math.min(annVolPct / 100, VOL_CAP[pair]);
  const nBdays   = BDAYS[horizon];
  const histSeed = strSeed(`${pair}-${horizon}-${START_DATE}`);
  const bandSeed = histSeed ^ 0xDEAD;
  const distSeed = histSeed ^ 0xBEEF;

  // Historical segment
  const histRaw  = generateSyntheticHistory(START_DATE, spot, nBdays, annVol, histSeed);
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // Forecast fan-band segment
  const fcastDates   = genBusinessDays(START_DATE, nBdays);
  const bands        = genFanBands(fcastDates, spot, terminal, bandSeed);
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

  // Terminal distribution — σ back-derived from P90/P10 spread
  const sigma            = (terminal.p90 - terminal.p10) / (2 * 1.282);
  const distributionData = genDistribution(terminal.p50, sigma, 30, 2, distSeed);

  const percentileValues: PercentileValues = { ...terminal };
  const baseRateRange = { low: terminal.p25, high: terminal.p75 };

  // KPI metrics
  const pctDelta = ((terminal.p50 - spot) / spot) * 100;

  const projectedDelta =
    Math.abs(pctDelta) < 0.01 ? 'Flat' :
    pctDelta > 0 ? `+${pctDelta.toFixed(1)}%` :
                   `${pctDelta.toFixed(1)}%`;

  const projectedSignal: StatSignal =
    pctDelta < -1 ? 'positive' :
    pctDelta >  1 ? 'negative' :
    'neutral';

  // VaR 95 %: 1.645 × σ from terminal P50
  const var95Raw = 1.645 * sigma;

  const confSignal: StatSignal =
    confPct >= 80 ? 'positive' :
    confPct >= 68 ? 'warning'  :
    'negative';

  const metrics: FXMetrics = {
    projectedRate:   terminal.p50.toFixed(2),
    projectedRaw:    terminal.p50,
    projectedDelta,
    projectedSignal,
    volatility:      annVolPct.toFixed(2),
    var95:           var95Raw.toFixed(2),
    var95Raw,
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

export const FX_DATA: Record<string, FxEntry> = {
  'INRUSD-3M':  buildEntry('INRUSD', '3M'),
  'INRUSD-6M':  buildEntry('INRUSD', '6M'),
  'INRUSD-12M': buildEntry('INRUSD', '12M'),
  'NGNUSD-3M':  buildEntry('NGNUSD', '3M'),
  'NGNUSD-6M':  buildEntry('NGNUSD', '6M'),
  'NGNUSD-12M': buildEntry('NGNUSD', '12M'),
  'EURINR-3M':  buildEntry('EURINR', '3M'),
  'EURINR-6M':  buildEntry('EURINR', '6M'),
  'EURINR-12M': buildEntry('EURINR', '12M'),
};
