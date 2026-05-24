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
 *   with tiny noise (gives it a natural look without large swings).
 * - Uncertainty bands widen as √(t/T), reaching the terminal percentiles
 *   at the last date.  This matches the qualitative behaviour of MC output.
 */
export function genFanBands(
  dates:    string[],
  spot:     number,
  terminal: Terminal,
  seed:     number,
): FanPoint[] {
  const rng = mkRng(seed);
  const n   = dates.length;
  if (n === 0) return [];

  // Drift so that E[logVal at n] = log(terminal.p50)
  const logDrift  = (Math.log(terminal.p50) - Math.log(spot)) / n;
  const noiseSig  = 0.0008; // tiny daily noise — keeps curve smooth
  let   logVal    = Math.log(spot);

  return dates.map((date, i) => {
    logVal += logDrift + stdNormal(rng) * noiseSig;
    const mid = Math.exp(logVal);
    const t   = Math.sqrt((i + 1) / n); // 0 → 1 as √(t/T)

    // Band offsets relative to terminal.p50, scaled by √(t)
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
