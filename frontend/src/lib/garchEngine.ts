/**
 * garchEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight frontend GARCH(1,1) engine + Monte Carlo price simulator.
 *
 * Historical model:  σ²_t = ω + α·ε²_(t-1) + β·σ²_(t-1)
 * Forward forecast:  σ²_(t+1) uses actual last ε²; h≥2 uses E[ε²]=σ² (mean-reverting)
 * Price simulation:  S(t+1) = S(t)·exp((μ−0.5σ²)Δt + σ√Δt·Z)  [GBM]
 *
 * All computation is pure TypeScript — no dependencies, no backend calls.
 * Results are permanently memoised to ensure instant re-renders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ReturnPoint } from './commodityData';

/* ═══════════════════════════════════════════════════════════════════════════
   GARCH PARAMETER PRESETS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GarchParams {
  omega: number;   // ω — long-run variance intercept
  alpha: number;   // α — ARCH (shock) coefficient
  beta:  number;   // β — GARCH (persistence) coefficient
}

export const GARCH_PARAMS: Record<'iron_ore' | 'coking_coal', GarchParams> = {
  iron_ore:    { omega: 0.000002, alpha: 0.12, beta: 0.84 },
  coking_coal: { omega: 0.000004, alpha: 0.16, beta: 0.78 },
};

/* ═══════════════════════════════════════════════════════════════════════════
   VOLATILITY REGIME CLASSIFICATION
   ═══════════════════════════════════════════════════════════════════════════ */

export type VolRegime = 'LOW' | 'NORMAL' | 'ELEVATED' | 'CRISIS';

export interface RegimeInfo {
  label:    VolRegime;
  color:    string;
  bgColor:  string;
  severity: number;       // 1–4
}

export function classifyRegime(annualizedVolPct: number): RegimeInfo {
  if (annualizedVolPct < 18)
    return { label: 'LOW',      color: '#16A34A', bgColor: 'rgba(22,163,74,0.08)',  severity: 1 };
  if (annualizedVolPct < 28)
    return { label: 'NORMAL',   color: '#2563EB', bgColor: 'rgba(37,99,235,0.07)',  severity: 2 };
  if (annualizedVolPct < 40)
    return { label: 'ELEVATED', color: '#D97706', bgColor: 'rgba(217,119,6,0.09)',  severity: 3 };
  return   { label: 'CRISIS',   color: '#DC2626', bgColor: 'rgba(220,38,38,0.09)',  severity: 4 };
}

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORICAL GARCH TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GarchPoint {
  date:          Date;
  dateLabel:     string;
  condVariance:  number;
  condVolPct:    number;
  regime:        RegimeInfo;
}

export interface GarchResult {
  series:         GarchPoint[];
  currentVol:     number;     // most recent conditional annualised vol (%)
  persistence:    number;     // α + β
  longRunVol:     number;     // unconditional long-run vol (%)
  forwardVol:     number;     // one-step-ahead vol (%)
  currentRegime:  RegimeInfo;
  realisedVol30m: number;     // 30-month realised vol (%)
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORWARD FORECAST TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GarchForecastStep {
  stepAhead:    number;
  dateLabel:    string;
  condVariance: number;
  condVolPct:   number;
  regime:       RegimeInfo;
}

export interface GarchForecast {
  steps:          GarchForecastStep[];
  avgFwdVol:      number;    // average annualised vol across forecast horizon
  volChangePct:   number;    // avgFwdVol − currentVol (signed, in pct points)
  terminalRegime: RegimeInfo;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONTE CARLO TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface McStep {
  dateLabel: string;
  median:    number;
  p25:       number;
  p75:       number;
  p05:       number;
  p95:       number;
}

export interface McResult {
  steps: McStep[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATE HELPER
   ═══════════════════════════════════════════════════════════════════════════ */

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun',
                     'Jul','Aug','Sep','Oct','Nov','Dec'];

function addMonths(base: Date, n: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + n, 1);
}

function toMonthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEEDED PRNG + BOX-MULLER
   Linear Congruential Generator — deterministic, fast.
   ═══════════════════════════════════════════════════════════════════════════ */

function createLcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function normalSample(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORICAL GARCH(1,1) ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

const _garchCache = new Map<string, GarchResult>();

export function runGarch(
  returns:  ReturnPoint[],
  params:   GarchParams,
  cacheKey: string,
): GarchResult {
  const key = `${cacheKey}:${returns.length}`;
  if (_garchCache.has(key)) return _garchCache.get(key)!;

  const { omega, alpha, beta } = params;

  // Seed σ²_0 from sample variance of first 12 obs
  const init    = returns.slice(0, Math.min(12, returns.length)).map(r => r.logReturn);
  const initMu  = init.reduce((s, v) => s + v, 0) / init.length;
  let sigma2    = init.reduce((s, v) => s + (v - initMu) ** 2, 0) / init.length;
  if (sigma2 === 0) sigma2 = omega / Math.max(1 - alpha - beta, 1e-6);

  const series: GarchPoint[] = [];

  for (let t = 0; t < returns.length; t++) {
    const eps2 = returns[t].logReturn ** 2;
    sigma2     = omega + alpha * eps2 + beta * sigma2;
    const vol  = Math.sqrt(Math.max(sigma2, 0) * 12) * 100;
    series.push({
      date:         returns[t].date,
      dateLabel:    returns[t].dateLabel,
      condVariance: sigma2,
      condVolPct:   parseFloat(vol.toFixed(3)),
      regime:       classifyRegime(vol),
    });
  }

  const last        = series[series.length - 1];
  const persistence = alpha + beta;
  const lrVariance  = omega / Math.max(1 - persistence, 1e-6);
  const longRunVol  = Math.sqrt(lrVariance * 12) * 100;

  const lastEps2    = returns[returns.length - 1].logReturn ** 2;
  const fwdVar      = omega + alpha * lastEps2 + beta * last.condVariance;
  const forwardVol  = Math.sqrt(Math.max(fwdVar, 0) * 12) * 100;

  const s30    = returns.slice(-30).map(r => r.logReturn);
  const mu30   = s30.reduce((a, v) => a + v, 0) / s30.length;
  const var30  = s30.reduce((a, v) => a + (v - mu30) ** 2, 0) / (s30.length - 1);
  const rv30m  = Math.sqrt(var30 * 12) * 100;

  const result: GarchResult = {
    series, currentVol: last.condVolPct, persistence,
    longRunVol, forwardVol, currentRegime: last.regime, realisedVol30m: rv30m,
  };
  _garchCache.set(key, result);
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GARCH(1,1) MULTI-STEP FORWARD FORECAST
   ─────────────────────────────────────────────────────────────────────────
   h = 1:  σ²_(t+1) = ω + α·ε²_t + β·σ²_t        (actual last shock)
   h ≥ 2:  σ²_(t+h) = ω + (α+β)·σ²_(t+h-1)        (E[ε²] = σ²)
   → converges to long-run variance as h → ∞
   ═══════════════════════════════════════════════════════════════════════════ */

const _forecastCache = new Map<string, GarchForecast>();

export function forecastGarch(
  lastVariance: number,
  lastReturn:   number,
  params:       GarchParams,
  steps:        number,
  lastDate:     Date,
  currentVol:   number,
  cacheKey:     string,
): GarchForecast {
  const key = `${cacheKey}:fcast:${steps}:${lastVariance.toFixed(8)}`;
  if (_forecastCache.has(key)) return _forecastCache.get(key)!;

  const { omega, alpha, beta } = params;

  // h = 1: use actual last squared return
  let sigma2 = omega + alpha * lastReturn ** 2 + beta * lastVariance;

  const fSteps: GarchForecastStep[] = [];

  for (let h = 1; h <= steps; h++) {
    if (h > 1) {
      // h ≥ 2: E[ε²] = σ²_(t+h-1)
      sigma2 = omega + (alpha + beta) * sigma2;
    }
    const vol    = Math.sqrt(Math.max(sigma2, 0) * 12) * 100;
    const regime = classifyRegime(vol);
    fSteps.push({
      stepAhead:    h,
      dateLabel:    toMonthLabel(addMonths(lastDate, h)),
      condVariance: sigma2,
      condVolPct:   parseFloat(vol.toFixed(3)),
      regime,
    });
  }

  const avgFwdVol = fSteps.reduce((s, f) => s + f.condVolPct, 0) / fSteps.length;

  const result: GarchForecast = {
    steps:          fSteps,
    avgFwdVol,
    volChangePct:   parseFloat((avgFwdVol - currentVol).toFixed(2)),
    terminalRegime: fSteps[fSteps.length - 1].regime,
  };
  _forecastCache.set(key, result);
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONTE CARLO PRICE SIMULATION (GBM + GARCH variance)
   ─────────────────────────────────────────────────────────────────────────
   S(t+1) = S(t)·exp((μ − 0.5σ²)Δt + σ√Δt·Z)
   σ² from GARCH forward forecast steps.
   300 paths, seeded PRNG — results are deterministic and cached.
   ═══════════════════════════════════════════════════════════════════════════ */

const _mcCache = new Map<string, McResult>();

export function runMonteCarlo(
  lastPrice:    number,
  forecast:     GarchForecast,
  monthlyDrift: number,   // μ per month (log)
  numPaths:     number,
  seed:         number,
  cacheKey:     string,
): McResult {
  const key = `${cacheKey}:mc:${lastPrice.toFixed(4)}:${numPaths}`;
  if (_mcCache.has(key)) return _mcCache.get(key)!;

  const rng    = createLcg(seed);
  const nSteps = forecast.steps.length;

  // Simulate `numPaths` GBM paths
  const pathMatrix: number[][] = Array.from({ length: numPaths }, () => {
    let S = lastPrice;
    const path: number[] = [];
    for (let t = 0; t < nSteps; t++) {
      const s2  = forecast.steps[t].condVariance;
      const sig = Math.sqrt(Math.max(s2, 0));
      const Z   = normalSample(rng);
      S = S * Math.exp((monthlyDrift - 0.5 * s2) + sig * Z);
      path.push(S);
    }
    return path;
  });

  // Percentile helper
  function pct(arr: number[], q: number): number {
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx    = Math.min(Math.floor(q * sorted.length), sorted.length - 1);
    return parseFloat(sorted[idx].toFixed(2));
  }

  const steps: McStep[] = forecast.steps.map((fStep, t) => {
    const col = pathMatrix.map(p => p[t]);
    return {
      dateLabel: fStep.dateLabel,
      median:    pct(col, 0.50),
      p25:       pct(col, 0.25),
      p75:       pct(col, 0.75),
      p05:       pct(col, 0.05),
      p95:       pct(col, 0.95),
    };
  });

  const result: McResult = { steps };
  _mcCache.set(key, result);
  return result;
}
