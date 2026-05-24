/**
 * Precomputed FX Monte Carlo forecast data.
 * Replaces live /api/v1/forecast/fx/monte-carlo calls.
 * All values seeded deterministically — no network dependency at runtime.
 *
 * Reference date : 2026-05-24
 * Pairs          : INRUSD · NGNUSD · EURINR
 * Model          : ARIMA(2,1,2) + GBM simulation
 */

import { generateSyntheticHistory, strSeed } from '@/lib/format';
import {
  genBusinessDays,
  genFanBands,
  genDistribution,
  genMonthlyTicks,
} from './dataUtils';
import type { Terminal, DistributionPoint } from './dataUtils';

// ── Public types (re-exported for useFxForecast + page consumers) ─────────────

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

// ── Fixed reference values ─────────────────────────────────────────────────────

const START_DATE = '2026-05-25';
const N_SIMS     = 5000;

// Historical lookback = forecast length (symmetric chart)
const BDAYS: Record<Horizon, number> = { '3M': 63, '6M': 126, '12M': 252 };

// Pair-specific annual vol cap (decimal)
const VOL_CAP: Record<CurrencyPair, number> = {
  INRUSD: 0.04,
  NGNUSD: 0.20,
  EURINR: 0.06,
};

interface PairHorizonCfg {
  spot:      number;
  terminal:  Terminal;
  annVolPct: number; // annual vol in % (for history + volatility metric)
  confPct:   number;
}

// ── Pair × Horizon configuration ───────────────────────────────────────────────
//
// Terminal percentiles are calibrated to realistic analyst ranges for
// each currency pair given the 2026 macro environment.
//
// INRUSD — moderate depreciation trend, RBI maintaining managed float
// NGNUSD — higher vol, NGN structural depreciation pressures
// EURINR — modest appreciation of EUR vs INR, low vol

const PAIR_CFG: Record<CurrencyPair, Record<Horizon, PairHorizonCfg>> = {
  INRUSD: {
    '3M':  { spot: 83.50, terminal: { p10: 82.80, p25: 83.60, p50: 84.15, p75: 84.75, p90: 85.50 }, annVolPct: 3.0, confPct: 75 },
    '6M':  { spot: 83.50, terminal: { p10: 82.20, p25: 83.70, p50: 84.90, p75: 86.15, p90: 87.50 }, annVolPct: 4.0, confPct: 72 },
    '12M': { spot: 83.50, terminal: { p10: 80.50, p25: 83.00, p50: 86.20, p75: 89.50, p90: 92.00 }, annVolPct: 5.0, confPct: 69 },
  },
  NGNUSD: {
    '3M':  { spot: 1580, terminal: { p10: 1510, p25: 1572, p50: 1618, p75: 1668, p90: 1730 }, annVolPct: 12.0, confPct: 73 },
    '6M':  { spot: 1580, terminal: { p10: 1440, p25: 1565, p50: 1660, p75: 1765, p90: 1880 }, annVolPct: 15.0, confPct: 70 },
    '12M': { spot: 1580, terminal: { p10: 1300, p25: 1550, p50: 1742, p75: 1950, p90: 2150 }, annVolPct: 18.0, confPct: 67 },
  },
  EURINR: {
    '3M':  { spot: 90.20, terminal: { p10: 89.10, p25: 90.00, p50: 90.55, p75: 91.10, p90: 91.95 }, annVolPct: 4.0, confPct: 76 },
    '6M':  { spot: 90.20, terminal: { p10: 88.50, p25: 89.80, p50: 90.95, p75: 92.15, p90: 93.40 }, annVolPct: 5.0, confPct: 73 },
    '12M': { spot: 90.20, terminal: { p10: 86.80, p25: 89.30, p50: 91.80, p75: 94.35, p90: 96.80 }, annVolPct: 6.0, confPct: 70 },
  },
};

// ── Builder ────────────────────────────────────────────────────────────────────

function buildEntry(pair: CurrencyPair, horizon: Horizon): FxEntry {
  const { spot, terminal, annVolPct, confPct } = PAIR_CFG[pair][horizon];
  const annVol   = Math.min(annVolPct / 100, VOL_CAP[pair]);
  const nBdays   = BDAYS[horizon];
  const histSeed = strSeed(`${pair}-${horizon}-${START_DATE}`);
  const bandSeed = histSeed ^ 0xDEAD;
  const distSeed = histSeed ^ 0xBEEF;

  // ── Historical segment ────────────────────────────────────────────────────
  const histRaw  = generateSyntheticHistory(START_DATE, spot, nBdays, annVol, histSeed);
  const histData: ChartPoint[] = histRaw.map(pt => ({ date: pt.date, actual: pt.actual }));

  // ── Forecast fan-band segment ─────────────────────────────────────────────
  const fcastDates  = genBusinessDays(START_DATE, nBdays);
  const bands       = genFanBands(fcastDates, spot, terminal, bandSeed);
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

  // ── Terminal distribution ─────────────────────────────────────────────────
  const sigma           = (terminal.p90 - terminal.p10) / (2 * 1.282);
  const distributionData = genDistribution(terminal.p50, sigma, 30, 2, distSeed);

  const percentileValues: PercentileValues = { ...terminal };
  const baseRateRange = { low: terminal.p25, high: terminal.p75 };

  // ── KPI metrics ───────────────────────────────────────────────────────────
  const pctDelta = ((terminal.p50 - spot) / spot) * 100;

  const projectedDelta =
    Math.abs(pctDelta) < 0.01 ? 'Flat' :
    pctDelta > 0 ? `+${pctDelta.toFixed(1)}%` :
                   `${pctDelta.toFixed(1)}%`;

  const projectedSignal: StatSignal =
    pctDelta < -1 ? 'positive' :
    pctDelta >  1 ? 'negative' :
    'neutral';

  // VaR 95 %: 1.645σ from terminal P50
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
    volatility:      annVolPct.toFixed(2),    // e.g. "3.00"
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

// ── Eagerly computed at module load (no network, no async) ─────────────────────

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
