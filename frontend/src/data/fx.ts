/**
 * Precomputed FX Monte Carlo forecast data.
 * Replaces live /api/v1/forecast/fx/monte-carlo calls.
 *
 * Calibration reference (2026-05-24) — visually matched to original screenshots:
 *
 *   USD/INR  spot ≈ 95.90 → 12M P50 = 101.23  (+5.7%)   vol = 4.33%   VaR95 = 7.56    conf = 87%
 *            history: ~84.00 (Jun 25) → 95.90 (May 26)  [rising trend]
 *
 *   USD/NGN  spot ≈ 1365  → 12M P50 = 1339.45  (−2.2%)  vol = 29.58%  VaR95 = 892.52  conf = 40%
 *            history: ~1520 (Jun 25) → 1365 (May 26)    [declining trend]
 *
 *   EUR/INR  spot ≈ 111.20 → 12M P50 = 111.55  (+0.3%)  vol = 6.82%   VaR95 = 13.18   conf = 81%
 *            history: ~94.00 (Jun 25) → 111.20 (May 26) [rising trend]
 *
 * Derivation (12M anchor → shorter horizons via √T scaling):
 *   sigma_12M  = VaR95 / 1.645
 *   sigma(T)   = sigma_12M × √T   (T in years: 0.25, 0.50, 1.00)
 *   P25(T)     = P50(T) − 0.675 × sigma(T)
 *   P75(T)     = P50(T) + 0.675 × sigma(T)
 *   P10(T)     = P50(T) − 1.282 × sigma(T)
 *   P90(T)     = P50(T) + 1.282 × sigma(T)
 *   P50(T)     = spot + (P50_12M − spot) × T  [linear drift interpolation]
 *
 * EUR/INR sigma derivation:
 *   sigma_12M = 13.18 / 1.645 = 8.012
 *   sigma_6M  = 8.012 × √0.50 = 5.664
 *   sigma_3M  = 8.012 × √0.25 = 4.006
 *
 * USD/INR sigma derivation:
 *   sigma_12M = 7.56 / 1.645 = 4.596
 *   sigma_6M  = 4.596 × √0.50 = 3.250
 *   sigma_3M  = 4.596 × √0.25 = 2.298
 *
 * USD/NGN sigma derivation:
 *   sigma_12M = 892.52 / 1.645 = 542.57
 *   sigma_6M  = 542.57 × √0.50 = 383.60
 *   sigma_3M  = 542.57 × √0.25 = 271.29
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

// Annualised vol used for history generation (smoothed to avoid overly jagged lines)
// Independent of the displayed "Annualised Volatility" KPI.
const HIST_VOL: Record<CurrencyPair, number> = {
  INRUSD: 0.0433,  // matches INR display vol — gentle upward drift dominates
  NGNUSD: 0.09,    // reduced from 29.58 % so history trend is legible (not too noisy)
  EURINR: 0.0682,  // matches EUR/INR display vol — rising trend dominant
};

// Noise amplitude in log-space for forecast P50 path generation.
// Larger values produce a choppier Monte-Carlo forecast line (matching originals).
const FORECAST_NOISE: Record<CurrencyPair, number> = {
  INRUSD: 0.0010,  // smooth, slightly noisy — matches INR original
  NGNUSD: 0.0035,  // choppy — matches NGN original (high-vol pair)
  EURINR: 0.0008,  // smooth — matches EUR/INR original
};

interface PairHorizonCfg {
  spot:      number;
  histStart: number;  // approximate rate at the START of the history window
  terminal:  Terminal;
  annVolPct: number;  // shown in UI as "volatility" KPI
  confPct:   number;
}

// ── Pair × Horizon configuration ───────────────────────────────────────────────
//
// histStart values are the approximate spot at the beginning of each lookback
// window (derived from the original screenshot trajectories):
//
//   USD/INR  12M ago ≈ 84.00   6M ago ≈ 90.00   3M ago ≈ 93.00
//   USD/NGN  12M ago ≈ 1520    6M ago ≈ 1443     3M ago ≈ 1404
//   EUR/INR  12M ago ≈ 94.00   6M ago ≈ 102.60   3M ago ≈ 106.90

const PAIR_CFG: Record<CurrencyPair, Record<Horizon, PairHorizonCfg>> = {

  // ── USD/INR ──────────────────────────────────────────────────────────────────
  //  spot = 95.90,  12M P50 = 101.23  (+5.7 %)
  //  sigma_12M = 7.56 / 1.645 = 4.596
  INRUSD: {
    '3M': {
      spot:      95.90,
      histStart: 93.00,
      terminal:  { p10: 94.50, p25: 95.98, p50: 97.23, p75: 98.48, p90: 99.96 },
      annVolPct: 4.33,
      confPct:   93,
    },
    '6M': {
      spot:      95.90,
      histStart: 90.00,
      terminal:  { p10: 94.23, p25: 96.31, p50: 98.57, p75: 100.83, p90: 102.91 },
      annVolPct: 4.33,
      confPct:   90,
    },
    '12M': {
      spot:      95.90,
      histStart: 84.00,
      terminal:  { p10: 95.31, p25: 98.12, p50: 101.23, p75: 104.34, p90: 107.15 },
      annVolPct: 4.33,
      confPct:   87,
    },
  },

  // ── USD/NGN ──────────────────────────────────────────────────────────────────
  //  spot = 1365,   12M P50 = 1339.45  (−2.2 %)
  //  sigma_12M = 892.52 / 1.645 = 542.57
  NGNUSD: {
    '3M': {
      spot:      1365,
      histStart: 1404,
      terminal:  { p10: 1012, p25: 1182, p50: 1359, p75: 1536, p90: 1706 },
      annVolPct: 29.58,
      confPct:   55,
    },
    '6M': {
      spot:      1365,
      histStart: 1443,
      terminal:  { p10: 854,  p25: 1087, p50: 1352, p75: 1617, p90: 1850 },
      annVolPct: 29.58,
      confPct:   47,
    },
    '12M': {
      spot:      1365,
      histStart: 1520,
      terminal:  { p10: 644,  p25: 973,  p50: 1339, p75: 1706, p90: 2035 },
      annVolPct: 29.58,
      confPct:   40,
    },
  },

  // ── EUR/INR ──────────────────────────────────────────────────────────────────
  //  spot = 111.20,  12M P50 = 111.55  (+0.3 %)
  //  sigma_12M = 13.18 / 1.645 = 8.012
  //  sigma_6M  = 8.012 × √0.50 = 5.664
  //  sigma_3M  = 8.012 × √0.25 = 4.006
  //
  //  12M terminals:
  //    P25 = 111.55 − 0.675 × 8.012 = 106.14
  //    P75 = 111.55 + 0.675 × 8.012 = 116.96
  //    P10 = 111.55 − 1.282 × 8.012 = 101.28
  //    P90 = 111.55 + 1.282 × 8.012 = 121.82
  //
  //  6M P50 = 111.20 + (111.55 − 111.20) × 0.50 = 111.38
  //    P25 = 111.38 − 0.675 × 5.664 = 107.56
  //    P75 = 111.38 + 0.675 × 5.664 = 115.20
  //    P10 = 111.38 − 1.282 × 5.664 = 104.12
  //    P90 = 111.38 + 1.282 × 5.664 = 118.64
  //
  //  3M P50 = 111.20 + (111.55 − 111.20) × 0.25 = 111.29
  //    P25 = 111.29 − 0.675 × 4.006 = 108.58
  //    P75 = 111.29 + 0.675 × 4.006 = 113.99
  //    P10 = 111.29 − 1.282 × 4.006 = 106.15
  //    P90 = 111.29 + 1.282 × 4.006 = 116.43
  EURINR: {
    '3M': {
      spot:      111.20,
      histStart: 106.90,
      terminal:  { p10: 106.15, p25: 108.58, p50: 111.29, p75: 113.99, p90: 116.43 },
      annVolPct: 6.82,
      confPct:   78,
    },
    '6M': {
      spot:      111.20,
      histStart: 102.60,
      terminal:  { p10: 104.12, p25: 107.56, p50: 111.38, p75: 115.20, p90: 118.64 },
      annVolPct: 6.82,
      confPct:   74,
    },
    '12M': {
      spot:      111.20,
      histStart: 94.00,
      terminal:  { p10: 101.28, p25: 106.14, p50: 111.55, p75: 116.96, p90: 121.82 },
      annVolPct: 6.82,
      confPct:   81,
    },
  },
};

// ── Builder ────────────────────────────────────────────────────────────────────

function buildEntry(pair: CurrencyPair, horizon: Horizon): FxEntry {
  const { spot, histStart, terminal, annVolPct, confPct } = PAIR_CFG[pair][horizon];

  const nBdays   = BDAYS[horizon];
  const histSeed = strSeed(`${pair}-${horizon}-${START_DATE}`);
  const bandSeed = histSeed ^ 0xDEAD;
  const distSeed = histSeed ^ 0xBEEF;

  // Historical segment — drifted GBM from histStart → spot
  const histRaw  = genHistoryDrifted(
    START_DATE, spot, histStart, nBdays,
    HIST_VOL[pair], histSeed,
  );
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // Forecast fan-band segment — pair-calibrated MC noise
  const fcastDates   = genBusinessDays(START_DATE, nBdays);
  const bands        = genFanBands(fcastDates, spot, terminal, bandSeed, FORECAST_NOISE[pair]);
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
