/**
 * Centralised number-formatting utilities.
 *
 * Rules:
 *  - Maximum 2 decimal places everywhere
 *  - No trailing zeros beyond what the format requires
 *  - All values clamped to finite numbers before formatting
 */

/** Ensure a value is a finite number before formatting. */
function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

/** General numeric value — up to 2 dp, no trailing noise. */
export function fmt2(v: number): string {
  return safe(v).toFixed(2);
}

/** Exchange-rate / absolute level (e.g. FX spot): "96.21" */
export function fmtFx(v: number): string {
  return safe(v).toFixed(2);
}

/** Interest rate displayed as a percentage string: "4.38%" */
export function fmtRate(v: number): string {
  return `${safe(v).toFixed(2)}%`;
}

/** Pure percentage value already in 0–100 scale: "29.12%" */
export function fmtPct(v: number): string {
  return `${safe(v).toFixed(2)}%`;
}

/** Percentage expressed as a decimal (0–1): "11.60%" */
export function fmtPctDecimal(v: number): string {
  return `${(safe(v) * 100).toFixed(2)}%`;
}

/** Integer — no decimal places: "2146" */
export function fmtInt(v: number): string {
  return String(Math.round(safe(v)));
}

/**
 * Compact crore display for P&L (mirrors scenarioEngine.formatCr).
 * Returns "₹ 2,146.00 Cr"
 */
export function fmtCr(v: number): string {
  const abs = Math.abs(safe(v)).toFixed(2);
  const [int, dec] = abs.split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₹ ${intFormatted}.${dec} Cr`;
}

/**
 * Seed-stable simple random walk for synthetic historical chart data.
 * Returns business-day observations ending exactly at `currentSpot` on `splitDate`.
 *
 * @param splitDate    ISO "YYYY-MM-DD" — first forecast date (chart split point)
 * @param currentSpot  Spot value at splitDate (first P50 from forecast)
 * @param numBusDays   How many business days of history to generate
 * @param annualizedVol Annualised % volatility (e.g. 0.03 = 3 %). Drives noise.
 * @param seed         Deterministic seed so the path is stable across renders
 */
export interface HistoricalPoint { date: string; actual: number }

export function generateSyntheticHistory(
  splitDate:     string,
  currentSpot:   number,
  numBusDays:    number,
  annualizedVol: number,
  seed:          number = 42,
): HistoricalPoint[] {
  if (!splitDate || !Number.isFinite(currentSpot) || currentSpot <= 0 || numBusDays <= 0) {
    return [];
  }

  // ── Seeded LCG random number generator (deterministic, no hydration drift) ──
  let s = (seed >>> 0) || 1;
  function rng(): number {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;
  }

  // ── Generate N business days backwards from splitDate ──────────────────────
  const dates: string[] = [];
  const from = new Date(splitDate + 'T12:00:00Z');
  let cursor = new Date(from);

  while (dates.length < numBusDays) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {                // skip weekends
      dates.push(cursor.toISOString().slice(0, 10));
    }
  }
  dates.reverse(); // oldest → newest

  // ── Simulate log-return path backwards from current spot ───────────────────
  // Daily vol from annualised (σ_daily = σ_annual / √252)
  // Capped to a sensible range to avoid extreme synthetic paths
  const vol = Math.min(Math.max(annualizedVol, 0.005), 0.6);
  const dailyVol = vol / Math.sqrt(252);

  const logLevels: number[] = new Array(numBusDays);
  logLevels[numBusDays - 1] = Math.log(currentSpot); // last point = current spot

  for (let i = numBusDays - 2; i >= 0; i--) {
    // Centred normal via Box-Muller
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    logLevels[i] = logLevels[i + 1] - dailyVol * z;
  }

  return dates.map((date, i) => ({
    date,
    actual: Math.max(parseFloat(Math.exp(logLevels[i]).toFixed(4)), 0.0001),
  }));
}

/**
 * Build a numeric seed from a string (pair + horizon + date) for synthetic history.
 * Stable across renders — same inputs always produce the same seed.
 */
export function strSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
