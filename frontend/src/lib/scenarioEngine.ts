/* ---------------------------------------------------------------------------
   Scenario Engine — deterministic treasury stress-testing with hedge overlay
   All calculation logic lives here. Components are purely presentational.
   --------------------------------------------------------------------------- */

// ─── Base Case P&L (in ₹ Cr) ─────────────────────────────────────────────────

export const BASE_CASE = {
  revenue:      18_500.00,
  cogs:         15_454.53,
  grossProfit:  3_045.47,
  sga:            899.47,
  ebitda:       2_146.00,
  ebitdaMargin: 2_146.00 / 18_500.00,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type StressLevel = 'BASE' | 'MILD' | 'MODERATE' | 'SEVERE';

export interface ScenarioState {
  ironOre: StressLevel;
  fx:      StressLevel;
  freight: StressLevel;
}

export interface PnlResult {
  revenue:      number;
  cogs:         number;
  grossProfit:  number;
  sga:          number;
  ebitda:       number;
  ebitdaMargin: number;
}

export interface PnlDelta {
  revenue:      number;
  cogs:         number;
  grossProfit:  number;
  sga:          number;
  ebitda:       number;
  ebitdaMargin: number;
}

// ─── Iron Ore sensitivities ───────────────────────────────────────────────────
// Unhedged: at +15% shock, COGS increases ₹276.48 Cr → ₹18.432 Cr per 1%
//           Verified: COGS = 15731.01, EBITDA = 1869.52 at SEVERE
// Hedge gain coefficient derived from:
//   hedged EBITDA at SEV = 2247.66
//   shock damage = 2146 − 1869.52 = 276.48
//   net hedge benefit = 2247.66 − 1869.52 = 378.14
//   → 378.14 / 15 = 25.209 Cr per 1%
// Instruments: iron ore futures + pellet premium forwards

export const IRON_ORE_UNHEDGED_SENS   = 276.48 / 15;   // 18.432 Cr per 1%
export const IRON_ORE_HEDGE_GAIN_SENS = 378.14 / 15;   // 25.209 Cr per 1%

export const IRON_ORE_SENS = IRON_ORE_UNHEDGED_SENS;   // backward-compat alias

export const IRON_ORE_PCT: Record<StressLevel, number> = {
  BASE:     0,
  MILD:     5,
  MODERATE: 10,
  SEVERE:   15,
};

// ─── FX sensitivities ─────────────────────────────────────────────────────────
// Base spot: 96.0 INR/USD
// Calibrated at SEVERE (101.5):
//   Depreciation: (101.5 − 96) / 96 × 100 = 5.73%
//   Revenue uplift: 18827.36 − 18500.00 = 327.36 → 327.36 / 5.73 = 57.13 Cr per 1%
//   COGS inflation: 15718.53 − 15454.53 = 264.00 → 264.00 / 5.73 = 46.07 Cr per 1%
// Scaling is on percentage depreciation basis, NOT absolute INR move.
// Exports remain FULLY EXPOSED (natural USD export hedge — no overlay on revenue).
// Imports hedged via zero-cost long seagull on the COGS side only.

export const BASE_FX_SPOT  = 96.0;
export const SEV_FX_DEPR_PCT = 5.73;   // (101.5 − 96) / 96 × 100, rounded

export const FX_REV_SENS_PCT  = 327.36 / SEV_FX_DEPR_PCT;  // 57.13 Cr per 1% depreciation
export const FX_COGS_SENS_PCT = 264.00 / SEV_FX_DEPR_PCT;  // 46.07 Cr per 1% depreciation

// Backward-compat aliases (now express per-1%-depreciation, not per-INR)
export const FX_REV_SENS  = FX_REV_SENS_PCT;
export const FX_COGS_SENS = FX_COGS_SENS_PCT;

/** Percentage depreciation of INR vs base spot (96.0). */
export function computeFxDeprPct(spot: number): number {
  return (spot - BASE_FX_SPOT) / BASE_FX_SPOT * 100;
}

export const FX_SPOTS: Record<StressLevel, number> = {
  BASE:     96.0,
  MILD:     98.0,
  MODERATE: 99.5,
  SEVERE:  101.5,
};

export const FX_DEPRECIATION_PCT: Record<StressLevel, number> = {
  BASE:     0,
  MILD:     +((FX_SPOTS.MILD     - BASE_FX_SPOT) / BASE_FX_SPOT * 100).toFixed(2),
  MODERATE: +((FX_SPOTS.MODERATE - BASE_FX_SPOT) / BASE_FX_SPOT * 100).toFixed(2),
  SEVERE:   +((FX_SPOTS.SEVERE   - BASE_FX_SPOT) / BASE_FX_SPOT * 100).toFixed(2),
};

// ─── FX Seagull option ────────────────────────────────────────────────────────
// Zero-cost long seagull: Short Put @ 95, Long Call @ 97, Short Call @ 102
// Applied to import exposure (COGS side) only. Net premium = 0.
//
// Payoff schedule:
//   spot ≤ 97        → payoff = 0               (long call not yet ITM)
//   97 < spot < 102  → payoff = spot − 97       (long call accrues linearly)
//   spot ≥ 102       → payoff = 5.0             (capped by short call)
//
// Effective import rate = spot − payoff
// At SEV (101.5): payoff = 4.50, effective rate = 97.0

export const SEAGULL_SHORT_PUT  = 95.0;
export const SEAGULL_LONG_CALL  = 97.0;
export const SEAGULL_SHORT_CALL = 102.0;

export function computeSeagullPayoff(spot: number): number {
  if (spot <= SEAGULL_LONG_CALL)  return 0;
  if (spot >= SEAGULL_SHORT_CALL) return SEAGULL_SHORT_CALL - SEAGULL_LONG_CALL; // 5.0
  return spot - SEAGULL_LONG_CALL;
}

// ─── Freight sensitivities ────────────────────────────────────────────────────
// Unhedged: at +20%, COGS increases ₹84.76 Cr → ₹4.238 Cr per 1%
//           Verified: COGS = 15539.29, EBITDA = 2061.24 at SEVERE
// Hedge gain: FFA gain at SEVERE = ₹42.38 Cr → ₹2.119 Cr per 1%
//             Target hedged EBITDA at SEVERE ≈ 2103.62
// Instruments: Freight Forward Agreements (FFAs)

export const FREIGHT_UNHEDGED_SENS   = 84.76 / 20;   // 4.238 Cr per 1%
export const FREIGHT_HEDGE_GAIN_SENS = 42.38 / 20;   // 2.119 Cr per 1%

export const FREIGHT_SENS = FREIGHT_UNHEDGED_SENS;   // backward-compat alias

export const FREIGHT_PCT: Record<StressLevel, number> = {
  BASE:     0,
  MILD:     5,
  MODERATE: 10,
  SEVERE:   20,
};

// ─── Unhedged Engine ─────────────────────────────────────────────────────────

export function computeScenarioPnl(state: ScenarioState): PnlResult {
  let revenue = BASE_CASE.revenue;
  let cogs    = BASE_CASE.cogs;
  const sga   = BASE_CASE.sga;

  // Iron Ore — COGS only, Revenue unchanged
  if (state.ironOre !== 'BASE') {
    cogs += IRON_ORE_UNHEDGED_SENS * IRON_ORE_PCT[state.ironOre];
  }

  // FX — both Revenue and COGS scale with percentage depreciation from base spot
  if (state.fx !== 'BASE') {
    const deprPct = computeFxDeprPct(FX_SPOTS[state.fx]);
    revenue += FX_REV_SENS_PCT  * deprPct;
    cogs    += FX_COGS_SENS_PCT * deprPct;
  }

  // Freight — COGS only, Revenue unchanged
  if (state.freight !== 'BASE') {
    cogs += FREIGHT_UNHEDGED_SENS * FREIGHT_PCT[state.freight];
  }

  const grossProfit  = revenue - cogs;
  const ebitda       = grossProfit - sga;
  const ebitdaMargin = ebitda / revenue;

  return { revenue, cogs, grossProfit, sga, ebitda, ebitdaMargin };
}

// ─── Hedged Engine ────────────────────────────────────────────────────────────

export function computeHedgedScenarioPnl(state: ScenarioState): PnlResult {
  let revenue = BASE_CASE.revenue;
  let cogs    = BASE_CASE.cogs;
  const sga   = BASE_CASE.sga;

  // Iron Ore — futures + pellet premium hedge nets against COGS inflation
  if (state.ironOre !== 'BASE') {
    const pct           = IRON_ORE_PCT[state.ironOre];
    const unhedgedShock = IRON_ORE_UNHEDGED_SENS   * pct;
    const hedgeGain     = IRON_ORE_HEDGE_GAIN_SENS * pct;
    cogs += unhedgedShock - hedgeGain;
  }

  // FX — Exports UNHEDGED (natural USD exposure provides revenue uplift).
  //       Import-side COGS hedged via zero-cost long seagull.
  //       Both sides scale by percentage depreciation; COGS uses effective rate.
  if (state.fx !== 'BASE') {
    const spot             = FX_SPOTS[state.fx];
    const deprPct          = computeFxDeprPct(spot);
    const payoff           = computeSeagullPayoff(spot);
    const effectiveDeprPct = computeFxDeprPct(spot - payoff);

    revenue += FX_REV_SENS_PCT  * deprPct;          // revenue: fully exposed
    cogs    += FX_COGS_SENS_PCT * effectiveDeprPct; // COGS: effective hedged rate
  }

  // Freight — Freight Forward Agreements (FFAs) offset partial freight inflation
  if (state.freight !== 'BASE') {
    const pct           = FREIGHT_PCT[state.freight];
    const unhedgedShock = FREIGHT_UNHEDGED_SENS   * pct;
    const hedgeGain     = FREIGHT_HEDGE_GAIN_SENS * pct;
    cogs += unhedgedShock - hedgeGain;
  }

  const grossProfit  = revenue - cogs;
  const ebitda       = grossProfit - sga;
  const ebitdaMargin = ebitda / revenue;

  return { revenue, cogs, grossProfit, sga, ebitda, ebitdaMargin };
}

// ─── Delta helper ─────────────────────────────────────────────────────────────

export function computePnlDelta(result: PnlResult): PnlDelta {
  return {
    revenue:      result.revenue      - BASE_CASE.revenue,
    cogs:         result.cogs         - BASE_CASE.cogs,
    grossProfit:  result.grossProfit  - BASE_CASE.grossProfit,
    sga:          result.sga          - BASE_CASE.sga,
    ebitda:       result.ebitda       - BASE_CASE.ebitda,
    ebitdaMargin: result.ebitdaMargin - BASE_CASE.ebitdaMargin,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatCr(value: number): string {
  const abs = Math.abs(value).toFixed(2);
  const [int, dec] = abs.split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₹ ${intFormatted}.${dec} Cr`;
}

export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Delta in Cr — always shows sign, e.g. "+276.40 Cr" or "−276.40 Cr" */
export function formatDeltaCr(value: number): string {
  if (Math.abs(value) < 0.005) return '—';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(value).toFixed(2)} Cr`;
}

/** Delta in percentage points, e.g. "+1.20 pp" */
export function formatDeltaPp(value: number): string {
  if (Math.abs(value) < 0.00005) return '—';
  const pp   = value * 100;
  const sign = pp > 0 ? '+' : '−';
  return `${sign}${Math.abs(pp).toFixed(2)} pp`;
}
