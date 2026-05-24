/**
 * Pure data-generation utilities for precomputed forecast data.
 * No React, no async — safe to run at module load time.
 */

// ── Date helpers ───────────────────────────────────────────────────────────────

/** Generate n business days (Mon–Fri) starting from startDate (inclusive). */
export function genBusinessDays(startDate: string, n: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(startDate + 'T12:00:00Z');
  while (dates.length < n) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Return the first date in each calendar month that appears in `dates`,
 * plus the final date — used for clean x-axis tick marks.
 */
export function genMonthlyTicks(dates: string[]): string[] {
  if (!dates.length) return [];
  const seen = new Set<string>();
  const ticks: string[] = [];
  for (const d of dates) {
    const ym = d.slice(0, 7); // "YYYY-MM"
    if (!seen.has(ym)) { seen.add(ym); ticks.push(d); }
  }
  const last = dates[dates.length - 1];
  if (ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}

// ── Seeded random ─────────────────────────────────────────────────────────────

/** Linear Congruential Generator — deterministic, no hydration drift. */
function mkRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Box-Muller transform — standard normal sample from two uniform samples. */
function stdNormal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Drifted history generator ─────────────────────────────────────────────────

export interface ChartHistoryPoint { date: string; actual: number }

/**
 * Generate synthetic historical data with a deterministic log-GBM drift.
 *
 * Produces N business days of history ending at `spot` on `splitDate`, with
 * the path starting near `histStart`.  A log-GBM forward walk with the
 * implied daily drift is used so the chart shows a trending trajectory that
 * matches the original calibration screenshots (e.g. INR rising from 84 to
 * 95.90, EUR/INR rising from 94 to 111.20, NGN declining from 1520 to 1365,
 * SOFR declining from 4.40 % to 3.51 %).
 *
 * @param splitDate  ISO "YYYY-MM-DD" — chart split point (history ends here)
 * @param spot       Rate at splitDate (history endpoint, pinned exactly)
 * @param histStart  Approximate rate at the start of the history window
 * @param nBdays     Number of business days of history to generate
 * @param annVol     Annualised volatility in decimal (e.g. 0.06 = 6 %)
 * @param seed       Deterministic LCG seed for reproducibility
 */
export function genHistoryDrifted(
  splitDate: string,
  spot:      number,
  histStart: number,
  nBdays:    number,
  annVol:    number,
  seed:      number,
): ChartHistoryPoint[] {
  if (!splitDate || spot <= 0 || histStart <= 0 || nBdays <= 0) return [];

  const rng = mkRng(seed);

  // Build list of N business days ending one day before splitDate
  const dates: string[] = [];
  const cursor = new Date(splitDate + 'T12:00:00Z');
  while (dates.length < nBdays) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cursor.toISOString().slice(0, 10));
  }
  dates.reverse(); // oldest → newest

  const vol      = Math.min(Math.max(annVol, 0.005), 0.6);
  const dailyVol = vol / Math.sqrt(252);
  // Log-space drift per day so that the path goes from histStart → spot
  const logDrift = (Math.log(spot) - Math.log(histStart)) / nBdays;

  const logLevels: number[] = new Array(nBdays);
  logLevels[0] = Math.log(histStart);
  for (let i = 1; i < nBdays - 1; i++) {
    logLevels[i] = logLevels[i - 1] + logDrift + dailyVol * stdNormal(rng);
  }
  // Pin the last history point exactly to spot for a seamless chart join
  logLevels[nBdays - 1] = Math.log(spot);

  return dates.map((date, i) => ({
    date,
    actual: Math.max(parseFloat(Math.exp(logLevels[i]).toFixed(4)), 0.0001),
  }));
}

// ── Fan-band generator ────────────────────────────────────────────────────────

export interface Terminal {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface FanPoint {
  date:     string;
  forecast: number;
  p10:      number;
  p25:      number;
  p75:      number;
  p90:      number;
}

/**
 * Generate a fan-band forecast series over `dates`.
 *
 * - The P50 path follows a log-GBM drift from `spot` → `terminal.p50`
 *   with per-pair calibrated noise (`noiseSig`).
 * - Uncertainty bands widen as √(t/T), reaching the terminal percentiles
 *   at the last date.  This matches qualitative MC output behaviour.
 *
 * @param noiseSig  Daily log-return noise amplitude (default 0.0008).
 *                  Increase for volatile pairs (NGN, SOFR) to reproduce
 *                  the choppier MC forecast paths visible in the originals.
 */
export function genFanBands(
  dates:    string[],
  spot:     number,
  terminal: Terminal,
  seed:     number,
  noiseSig: number = 0.0008,
): FanPoint[] {
  const rng = mkRng(seed);
  const n   = dates.length;
  if (n === 0) return [];

  // Drift so that E[logVal at n] = log(terminal.p50)
  const logDrift = (Math.log(terminal.p50) - Math.log(spot)) / n;
  let   logVal   = Math.log(spot);

  return dates.map((date, i) => {
    logVal += logDrift + stdNormal(rng) * noiseSig;
    const mid = Math.exp(logVal);
    const t   = Math.sqrt((i + 1) / n); // √(t/T): 0 → 1

    // Band offsets relative to terminal.p50, scaled by √t
    return {
      date,
      forecast: +mid.toFixed(4),
      p25:      +(mid + (terminal.p25 - terminal.p50) * t).toFixed(4),
      p75:      +(mid + (terminal.p75 - terminal.p50) * t).toFixed(4),
      p10:      +(mid + (terminal.p10 - terminal.p50) * t).toFixed(4),
      p90:      +(mid + (terminal.p90 - terminal.p50) * t).toFixed(4),
    };
  });
}

// ── Distribution generator ────────────────────────────────────────────────────

export interface DistributionPoint {
  rate: string;
  prob: number;
}

/**
 * Build a histogram approximating a normal distribution.
 *
 * @param center  Terminal P50 (bin centre)
 * @param sigma   Standard deviation in rate units
 * @param nBins   Number of histogram bins
 * @param dp      Decimal places for bin label strings
 * @param seed    Reproducible seed for tiny visual noise
 */
export function genDistribution(
  center: number,
  sigma:  number,
  nBins:  number,
  dp:     number,
  seed:   number,
): DistributionPoint[] {
  const rng = mkRng(seed);
  const lo  = center - 3.6 * sigma;
  const hi  = center + 3.6 * sigma;
  const bw  = (hi - lo) / nBins;

  let total = 0;
  const raw: { rate: string; w: number }[] = [];

  for (let i = 0; i < nBins; i++) {
    const x = lo + (i + 0.5) * bw;
    const z = (x - center) / sigma;
    // Normal PDF × tiny LCG noise for visual texture
    const w = Math.exp(-0.5 * z * z) * (1 + (rng() - 0.5) * 0.04);
    raw.push({ rate: x.toFixed(dp), w });
    total += w;
  }

  // Normalise to sum ≈ 100 (matches the `prob * 100` convention in transform())
  return raw.map(b => ({ rate: b.rate, prob: +(b.w / total * 100).toFixed(3) }));
}
