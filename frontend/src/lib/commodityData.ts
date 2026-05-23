/**
 * commodityData.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CSV loader, parser, return calculator and window trimmer for
 * commodity price series (Iron Ore · Coking Coal).
 *
 * ALL processing is frontend-side — no API calls, no backend.
 * Results are memoised so recalculations never happen on re-render.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PricePoint {
  date:      Date;
  dateLabel: string;   // "Jan 2022" display label
  price:     number;
}

export interface ReturnPoint {
  date:      Date;
  dateLabel: string;
  logReturn: number;
}

export interface CommoditySeries {
  raw:     PricePoint[];
  returns: ReturnPoint[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONTH MAP — for "Dec 1975" format
   ═══════════════════════════════════════════════════════════════════════════ */

const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3,  May: 4,  Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9,  Nov: 10, Dec: 11,
};

/* ═══════════════════════════════════════════════════════════════════════════
   PARSE HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Parse "Dec 1975" or "Jan 2022" → Date */
function parseMonthYear(s: string): Date | null {
  const parts = s.trim().split(' ');
  if (parts.length !== 2) return null;
  const month = MONTH_MAP[parts[0]];
  const year  = parseInt(parts[1], 10);
  if (month === undefined || isNaN(year)) return null;
  return new Date(year, month, 1);
}

/** Parse "01/01/2021" (DD/MM/YYYY) → Date */
function parseDDMMYYYY(s: string): Date | null {
  const parts = s.trim().split('/');
  if (parts.length !== 3) return null;
  const day   = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year  = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, day);
}

function toLabel(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CSV FETCH + PARSE
   ═══════════════════════════════════════════════════════════════════════════ */

async function fetchCSV(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

/**
 * Parse Iron Ore CSV: columns [Date, Price], date format "Dec 1975"
 */
function parseIronOreCSV(text: string): PricePoint[] {
  const lines = text.trim().split('\n');
  const result: PricePoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const rawDate  = line.slice(0, comma).trim();
    const rawPrice = line.slice(comma + 1).trim();
    const date  = parseMonthYear(rawDate);
    const price = parseFloat(rawPrice);
    if (!date || isNaN(price)) continue;
    result.push({ date, dateLabel: toLabel(date), price });
  }
  return result.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Parse Coking Coal CSV: columns [date, price], date format "01/01/2021"
 */
function parseCokingCoalCSV(text: string): PricePoint[] {
  const lines = text.trim().split('\n');
  const result: PricePoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const rawDate  = line.slice(0, comma).trim();
    const rawPrice = line.slice(comma + 1).trim();
    const date  = parseDDMMYYYY(rawDate);
    const price = parseFloat(rawPrice);
    if (!date || isNaN(price)) continue;
    result.push({ date, dateLabel: toLabel(date), price });
  }
  return result.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/* ═══════════════════════════════════════════════════════════════════════════
   RETURN CALCULATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute monthly log returns from price series.
 * Returns series is length (n-1).
 */
export function computeLogReturns(prices: PricePoint[]): ReturnPoint[] {
  const result: ReturnPoint[] = [];
  for (let i = 1; i < prices.length; i++) {
    const logReturn = Math.log(prices[i].price / prices[i - 1].price);
    result.push({
      date:      prices[i].date,
      dateLabel: prices[i].dateLabel,
      logReturn,
    });
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROLLING VOLATILITY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute rolling realised volatility (annualised) over a given window.
 * @param returns   Log return series
 * @param window    Rolling window in months (default 12)
 * @returns         Array of { date, dateLabel, rollingVol } aligned to returns
 */
export function rollingVolatility(
  returns: ReturnPoint[],
  window: number = 12,
): Array<{ date: Date; dateLabel: string; rollingVol: number | null }> {
  return returns.map((r, i) => {
    if (i < window - 1) {
      return { date: r.date, dateLabel: r.dateLabel, rollingVol: null };
    }
    const slice = returns.slice(i - window + 1, i + 1).map(x => x.logReturn);
    const mean  = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
    const annualized = Math.sqrt(variance * 12) * 100;
    return { date: r.date, dateLabel: r.dateLabel, rollingVol: annualized };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   WINDOW TRIMMER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Return the most recent N years of data from any time-sorted series.
 */
export function getRecentWindow<T extends { date: Date }>(
  series: T[],
  years: number = 5,
): T[] {
  if (series.length === 0) return [];
  const latest = series[series.length - 1].date;
  const cutoff = new Date(latest);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return series.filter(p => p.date >= cutoff);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MEMO CACHE
   ═══════════════════════════════════════════════════════════════════════════ */

const _cache: Record<string, CommoditySeries> = {};

/**
 * Load and process a commodity price series.
 * Results are permanently cached — subsequent calls are instant.
 *
 * @param commodity  'iron_ore' | 'coking_coal'
 */
export async function loadCommoditySeries(
  commodity: 'iron_ore' | 'coking_coal',
): Promise<CommoditySeries> {
  if (_cache[commodity]) return _cache[commodity];

  const url = `/data/${commodity}.csv`;
  const text = await fetchCSV(url);

  const raw = commodity === 'iron_ore'
    ? parseIronOreCSV(text)
    : parseCokingCoalCSV(text);

  const returns = computeLogReturns(raw);

  const series: CommoditySeries = { raw, returns };
  _cache[commodity] = series;
  return series;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REALISED VOLATILITY OVER WINDOW
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute annualised realised volatility over the last N months of returns.
 */
export function realisedVol(returns: ReturnPoint[], months: number = 30): number {
  if (returns.length < 2) return 0;
  const slice = returns.slice(-months).map(r => r.logReturn);
  const mean  = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(variance * 12) * 100;
}
