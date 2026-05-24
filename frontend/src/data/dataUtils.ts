/**
 * Pure data-generation utilities for precomputed forecast data.
 *
 * ALL functions are fully deterministic — there are NO random number generators.
 * Visual variation (oscillations that look like real market data) is produced by
 * summing four sine-wave harmonics with different periods and phases.
 * The `seed` parameter maps to a phase offset in [0, 2π], making every
 * pair/horizon unique without any randomness.
 *
 * This guarantees:
 *  - Zero hydration mismatch between SSR and client
 *  - Identical output on every render / build / browser
 *  - Visually natural trajectories that match the calibration screenshots
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
    const ym = d.slice(0, 7);
    if (!seen.has(ym)) { seen.add(ym); ticks.push(d); }
  }
  const last = dates[dates.length - 1];
  if (ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}

// ── Deterministic oscillation engine ─────────────────────────────────────────
//
// Four sine harmonics combine to produce a waveform that looks like realistic
// financial-market noise without any randomness.
//
//  Primary    period × 1.00  (long cycle  ~6-7 weeks for business-day data)
//  Secondary  period × 0.52  (medium      ~3.3 weeks)
//  Tertiary   period × 0.27  (short       ~1.7 weeks)
//  Quaternary period × 0.12  (micro       ~4 trading days — subtle texture)
//
// Amplitude weights sum to 1.00 so the output sits in roughly [−0.90, +0.90].

function osc(i: number, period: number, phase: number): number {
  const τ = 2 * Math.PI;
  return (
    0.40 * Math.sin(τ * i / (period)          + phase        ) +
    0.30 * Math.sin(τ * i / (period * 0.52)   + phase * 1.73 ) +
    0.20 * Math.sin(τ * i / (period * 0.27)   + phase * 2.61 ) +
    0.10 * Math.sin(τ * i / (period * 0.12)   + phase * 0.89 )
  );
}

/**
 * Convert an integer seed → unique phase in [0, 2π].
 * Different pair/horizon seeds produce visually distinct waveforms.
 * Pure arithmetic — no randomness.
 */
function seedPhase(seed: number): number {
  return ((seed >>> 0) % 997) / 997 * 2 * Math.PI;
}

// ── Drifted history generator ─────────────────────────────────────────────────

export interface ChartHistoryPoint { date: string; actual: number }

/**
 * Generate a deterministic synthetic history that trends from `histStart`
 * to `spot` over `nBdays` business days, with a natural-looking oscillation
 * overlay calibrated per pair.
 *
 * @param splitDate  ISO "YYYY-MM-DD" — chart split point (history ends here)
 * @param spot       Rate at splitDate (endpoint, pinned exactly)
 * @param histStart  Approximate rate at the start of the history window
 * @param nBdays     Number of business days to generate
 * @param noiseAmp   Oscillation amplitude as a fraction of the current price
 *                   (e.g. 0.008 = peaks at ±0.8 % of price). Controls how
 *                   "noisy" the historical line looks.
 * @param seed       Maps to a sine-wave phase offset — different pairs/horizons
 *                   get different waveform shapes (deterministic, not random)
 * @param peakBump   Optional extra height added at the midpoint as a smooth
 *                   arch (sin π·t).  Use for EUR/INR whose history peaks well
 *                   above both endpoints before settling at spot.
 */
export function genHistoryDrifted(
  splitDate: string,
  spot:      number,
  histStart: number,
  nBdays:    number,
  noiseAmp:  number,
  seed:      number,
  peakBump:  number = 0,
): ChartHistoryPoint[] {
  if (!splitDate || spot <= 0 || histStart <= 0 || nBdays <= 0) return [];

  // Build list of N business days ending one day before splitDate
  const dates: string[] = [];
  const cursor = new Date(splitDate + 'T12:00:00Z');
  while (dates.length < nBdays) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cursor.toISOString().slice(0, 10));
  }
  dates.reverse(); // oldest → newest

  const phase  = seedPhase(seed);
  const period = 32; // primary oscillation period (≈ 6.5 weeks of trading days)

  return dates.map((date, i) => {
    const t = i / Math.max(nBdays - 1, 1);

    // Trend: linear interpolation from histStart → spot, plus optional arch
    const linear  = histStart + (spot - histStart) * t;
    const arch    = peakBump * Math.sin(Math.PI * t);
    const trend   = linear + arch;

    // Deterministic oscillation noise — amplitude proportional to current price
    const noise = noiseAmp * Math.abs(trend) * osc(i, period, phase);

    // Pin the final point exactly to spot (seamless join with forecast)
    const val = i === nBdays - 1
      ? spot
      : Math.max(trend + noise, 0.0001);

    return { date, actual: parseFloat(val.toFixed(4)) };
  });
}

// ── Fan-band forecast generator ───────────────────────────────────────────────

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
 * Generate a deterministic forecast fan-band series.
 *
 * The P50 forecast path drifts from `spot` toward `terminal.p50` with a
 * calibrated deterministic oscillation overlay (noiseSig).  The uncertainty
 * bands widen as √(t/T), reaching the full terminal percentile spread at
 * the last date — exactly matching standard Monte-Carlo output behaviour.
 *
 * @param noiseSig  Oscillation amplitude for the forecast median path as a
 *                  fraction of the current price.  Higher values give a
 *                  choppier mean line (e.g. NGN needs ~0.038, INR ~0.003).
 */
export function genFanBands(
  dates:    string[],
  spot:     number,
  terminal: Terminal,
  seed:     number,
  noiseSig: number = 0.004,
): FanPoint[] {
  const n = dates.length;
  if (n === 0) return [];

  // Use a phase offset shifted from the history so forecast looks distinct
  const phase  = seedPhase(seed) + 1.57; // +π/2 → orthogonal waveform
  const period = 24; // slightly shorter primary period for forecast section

  return dates.map((date, i) => {
    const t_lin  = i / Math.max(n - 1, 1);    // linear progress 0 → 1
    const t_sqrt = Math.sqrt((i + 1) / n);     // √t progress 0 → 1 (band widening)

    // P50 path: linear drift + deterministic noise
    const drift  = spot + (terminal.p50 - spot) * t_lin;
    const noise  = noiseSig * Math.abs(drift) * osc(i, period, phase);
    const mid    = Math.max(drift + noise, 0.0001);

    // Percentile bands: offset from mid, widening as √t
    return {
      date,
      forecast: +mid.toFixed(4),
      p25:      +(mid + (terminal.p25 - terminal.p50) * t_sqrt).toFixed(4),
      p75:      +(mid + (terminal.p75 - terminal.p50) * t_sqrt).toFixed(4),
      p10:      +(mid + (terminal.p10 - terminal.p50) * t_sqrt).toFixed(4),
      p90:      +(mid + (terminal.p90 - terminal.p50) * t_sqrt).toFixed(4),
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
 * Tiny deterministic visual texture is added via sine wave (no randomness).
 *
 * @param center  Terminal P50 (bin centre)
 * @param sigma   Standard deviation in rate units
 * @param nBins   Number of histogram bins
 * @param dp      Decimal places for bin label strings
 * @param seed    Phase seed for visual texture (deterministic)
 */
export function genDistribution(
  center: number,
  sigma:  number,
  nBins:  number,
  dp:     number,
  seed:   number,
): DistributionPoint[] {
  const phase = seedPhase(seed);
  const lo    = center - 3.6 * sigma;
  const hi    = center + 3.6 * sigma;
  const bw    = (hi - lo) / nBins;

  let total = 0;
  const raw: { rate: string; w: number }[] = [];

  for (let i = 0; i < nBins; i++) {
    const x = lo + (i + 0.5) * bw;
    const z = (x - center) / sigma;
    // Normal PDF with deterministic texture (replaces RNG noise)
    const texture = 1 + Math.sin(i * 2.31 + phase) * 0.02;
    const w = Math.exp(-0.5 * z * z) * texture;
    raw.push({ rate: x.toFixed(dp), w });
    total += w;
  }

  return raw.map(b => ({ rate: b.rate, prob: +(b.w / total * 100).toFixed(3) }));
}
