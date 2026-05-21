/* ---------------------------------------------------------------------------
   Scenario Engine — deterministic treasury stress-testing
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

// ─── Iron Ore sensitivity ─────────────────────────────────────────────────────
// At +20%: COGS increases ₹ 276.40 Cr → ₹ 13.82 Cr per 1%

export const IRON_ORE_SENS = 13.82;   // ₹ Cr per 1% shock

export const IRON_ORE_PCT: Record<StressLevel, number> = {
  BASE:     0,
  MILD:     5,
  MODERATE: 10,
  SEVERE:   20,
};

// ─── FX sensitivity ───────────────────────────────────────────────────────────
// Base spot: 96.0 INR/USD
// Known case at 101.5 INR/USD (+5.5 units): Revenue +427.00 Cr, COGS +253.44 Cr
// Rev sensitivity:  427.00 / 5.5 = 77.636 Cr per 1 INR/USD unit
// COGS sensitivity: 253.44 / 5.5 = 46.080 Cr per 1 INR/USD unit

export const BASE_FX_SPOT  = 96.0;
export const FX_REV_SENS   = (18_927 - 18_500) / (101.5 - 96.0);       // 77.6364 Cr / INR
export const FX_COGS_SENS  = (15_707.97 - 15_454.53) / (101.5 - 96.0); // 46.08   Cr / INR

export const FX_SPOTS: Record<StressLevel, number> = {
  BASE:      96.0,
  MILD:      98.0,
  MODERATE:  99.5,
  SEVERE:   101.5,
};

// Depreciation % derived from spot rates — display only, not used in calculation
export const FX_DEPRECIATION_PCT: Record<StressLevel, number> = {
  BASE:     0,
  MILD:     +((FX_SPOTS.MILD     - BASE_FX_SPOT) / BASE_FX_SPOT * 100).toFixed(2),
  MODERATE: +((FX_SPOTS.MODERATE - BASE_FX_SPOT) / BASE_FX_SPOT * 100).toFixed(2),
  SEVERE:   +((FX_SPOTS.SEVERE   - BASE_FX_SPOT) / BASE_FX_SPOT * 100).toFixed(2),
};

// ─── Freight sensitivity ──────────────────────────────────────────────────────
// At +20%: COGS increases ₹ 83.73 Cr → ₹ 4.1865 Cr per 1%

export const FREIGHT_SENS = 83.73 / 20;   // 4.1865 Cr per 1% shock

export const FREIGHT_PCT: Record<StressLevel, number> = {
  BASE:     0,
  MILD:     5,
  MODERATE: 10,
  SEVERE:   20,
};

// ─── Engine ───────────────────────────────────────────────────────────────────

export function computeScenarioPnl(state: ScenarioState): PnlResult {
  let revenue = BASE_CASE.revenue;
  let cogs    = BASE_CASE.cogs;
  const sga   = BASE_CASE.sga;

  // Iron Ore — COGS only, Revenue unchanged
  if (state.ironOre !== 'BASE') {
    cogs += IRON_ORE_SENS * IRON_ORE_PCT[state.ironOre];
  }

  // FX — both Revenue and COGS shift based on INR/USD spot delta from base (96.0)
  if (state.fx !== 'BASE') {
    const spotDelta = FX_SPOTS[state.fx] - BASE_FX_SPOT;
    revenue += FX_REV_SENS  * spotDelta;
    cogs    += FX_COGS_SENS * spotDelta;
  }

  // Freight — COGS only, Revenue unchanged
  if (state.freight !== 'BASE') {
    cogs += FREIGHT_SENS * FREIGHT_PCT[state.freight];
  }

  const grossProfit  = revenue - cogs;
  const ebitda       = grossProfit - sga;
  const ebitdaMargin = ebitda / revenue;

  return { revenue, cogs, grossProfit, sga, ebitda, ebitdaMargin };
}

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
