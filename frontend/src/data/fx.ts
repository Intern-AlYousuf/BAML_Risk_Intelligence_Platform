/**
 * Precomputed FX forecast data — fully deterministic, no random generation.
 *
 * Visual trajectories are calibrated to match the original reference screenshots.
 * All "noise" is produced by deterministic sine-wave harmonics in dataUtils.ts.
 *
 * ── Calibration reference (2026-05-24) ────────────────────────────────────────
 *
 *  USD/INR  spot = 95.90   → 12M P50 = 101.23  (+5.7%)   vol = 4.33%  VaR = 7.56   conf = 87%
 *           history: 84.00 (Jun-25) → 95.90 (May-26)  steady upward trend, noisy
 *
 *  USD/NGN  spot = 1365    → 12M P50 = 1339.45  (−2.2%)  vol = 29.58% VaR = 892.52 conf = 40%
 *           history: 1520  (Jun-25) → 1365 (May-26)   smooth downward trend
 *           forecast: very wide bands (P10=644, P90=2035), choppy P50 line
 *
 *  EUR/INR  spot = 111.20  → 12M P50 = 111.55   (+0.3%)  vol = 6.82%  VaR = 13.18  conf = 81%
 *           history: 94.00 (Jun-25) → peaks ~116-118 (Feb-Mar 26) → 111.20 (May-26)
 *           arch-shaped trajectory (uses peakBump parameter)
 *
 * ── sigma derivations ──────────────────────────────────────────────────────────
 *
 *  USD/INR  sigma_12M = 7.56 / 1.645 = 4.596
 *           sigma_6M  = 4.596 × √0.50 = 3.250   sigma_3M = 4.596 × √0.25 = 2.298
 *
 *  USD/NGN  sigma_12M = 892.52 / 1.645 = 542.57
 *           sigma_6M  = 542.57 × √0.50 = 383.60  sigma_3M = 542.57 × √0.25 = 271.29
 *
 *  EUR/INR  sigma_12M = 13.18 / 1.645 = 8.012
 *           sigma_6M  = 8.012 × √0.50 = 5.664    sigma_3M = 8.012 × √0.25 = 4.006
 *
 *  Percentile formula:
 *    P50(T) = spot + (P50_12M − spot) × T
 *    P25(T) = P50(T) − 0.675 × sigma(T)
 *    P75(T) = P50(T) + 0.675 × sigma(T)
 *    P10(T) = P50(T) − 1.282 × sigma(T)
 *    P90(T) = P50(T) + 1.282 × sigma(T)
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

// Business days per horizon (history window = forecast window = symmetric chart)
const BDAYS: Record<Horizon, number> = { '3M': 63, '6M': 126, '12M': 252 };

// ── Per-pair visual calibration ────────────────────────────────────────────────
//
// HIST_NOISE: oscillation amplitude for the history line as a fraction of the
//   current price level.  Higher = more noisy-looking history.
//   Calibrated so each pair matches its reference screenshot.
//
// FORECAST_NOISE: same scale, for the forecast P50 path.
//   NGN needs a high value because the reference shows a very choppy P50.
//
// PEAK_BUMP: extra height (in price units) added at the midpoint of the
//   history as a smooth arch.  EUR/INR history peaks well above its endpoints.
//   Other pairs use 0 (pure linear trend).

const HIST_NOISE: Record<CurrencyPair, number> = {
  INRUSD: 0.0075,  // tight oscillations ±~0.7% of price — matches INR screenshot
  NGNUSD: 0.0090,  // smooth NGN history — small oscillations on a big downtrend
  EURINR: 0.0240,  // visible oscillations ±~2.4% — matches EUR/INR noisy rise
};

const FORECAST_NOISE: Record<CurrencyPair, number> = {
  INRUSD: 0.0030,  // moderately noisy forecast path
  NGNUSD: 0.0380,  // very choppy P50 — matches NGN reference screenshot exactly
  EURINR: 0.0080,  // mildly noisy forecast
};

// EUR/INR arch: history rises from ~94 to a peak of ~116-118, then settles at 111.20.
// Per-horizon values scale the arch to match the visible portion of the peak.
const PEAK_BUMP: Record<CurrencyPair, Record<Horizon, number>> = {
  INRUSD: { '3M': 0, '6M': 0, '12M': 0 },
  NGNUSD: { '3M': 0, '6M': 0, '12M': 0 },
  EURINR: {
    '3M':  3,   // 3M history (Feb-May 26) shows modest arch
    '6M':  8,   // 6M history (Nov 25-May 26) shows clearer arch
    '12M': 14,  // 12M history (Jun 25-May 26): full arch, peak reaches ~116-118
  },
};

interface PairHorizonCfg {
  spot:      number;
  histStart: number;  // approximate rate at the START of the lookback window
  terminal:  Terminal;
  annVolPct: number;  // displayed in the Volatility KPI card
  confPct:   number;
}

// ── Pair × Horizon configuration ───────────────────────────────────────────────
//
// histStart values are derived from the original reference screenshot trajectories.
// Each represents the approximate rate at the beginning of the corresponding
// lookback window (12M/6M/3M before May 26, 2026):
//
//   USD/INR  12M ago ≈ 84.00   6M ago ≈ 90.00   3M ago ≈ 93.00
//   USD/NGN  12M ago ≈ 1520    6M ago ≈ 1443     3M ago ≈ 1404
//   EUR/INR  12M ago ≈ 94.00   6M ago ≈ 102.60   3M ago ≈ 106.90

const PAIR_CFG: Record<CurrencyPair, Record<Horizon, PairHorizonCfg>> = {

  // ── USD/INR ──────────────────────────────────────────────────────────────────
  //  Steady upward trend in history; tight confidence bands in forecast.
  //  sigma_12M = 4.596 → P10/P90 spread = 2×1.282×4.596 = 11.78
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
  //  Smooth declining history; extremely wide forecast bands; choppy P50.
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
  //  Arch-shaped history (rises to a peak ~116-118 before settling at 111.20).
  //  sigma_12M = 13.18 / 1.645 = 8.012
  //
  //  12M: P50=111.55  P25=106.14  P75=116.96  P10=101.28  P90=121.82
  //  6M:  P50=111.38  P25=107.56  P75=115.20  P10=104.12  P90=118.64
  //  3M:  P50=111.29  P25=108.58  P75=113.99  P10=106.15  P90=116.43
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

  // ── Historical segment ─────────────────────────────────────────────────────
  // Deterministic drifted trajectory from histStart → spot, with sine-wave
  // oscillation noise and optional arch peak (EUR/INR only).
  const histRaw = genHistoryDrifted(
    START_DATE, spot, histStart, nBdays,
    HIST_NOISE[pair], histSeed,
    PEAK_BUMP[pair][horizon],
  );
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // ── Forecast fan-band segment ──────────────────────────────────────────────
  // Deterministic P50 path drifting from spot → terminal.p50; bands widen √t.
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

  // ── KPI metrics ────────────────────────────────────────────────────────────
  const pctDelta = ((terminal.p50 - spot) / spot) * 100;

  const projectedDelta =
    Math.abs(pctDelta) < 0.01 ? 'Flat' :
    pctDelta > 0 ? `+${pctDelta.toFixed(1)}%` :
                   `${pctDelta.toFixed(1)}%`;

  const projectedSignal: StatSignal =
    pctDelta < -1 ? 'positive' :
    pctDelta >  1 ? 'negative' :
    'neutral';

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
