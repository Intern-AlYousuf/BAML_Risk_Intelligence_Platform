'use client';

import React, { useId, useMemo } from 'react';
import { useMounted } from '../../hooks/useMounted';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Data types
   --------------------------------------------------------------------------- */

export interface ForecastPoint {
  /** ISO date key "YYYY-MM-DD" — must be unique per data point */
  date:              string;
  /** ARIMA central forecast (true model P50 — never mutated) */
  forecast?:         number;
  /** Historical observed rate */
  actual?:           number;
  /** 10th percentile */
  p10?:              number;
  /** 25th percentile */
  p25?:              number;
  /** 75th percentile */
  p75?:              number;
  /** 90th percentile */
  p90?:              number;
  /**
   * Visual-only rendering of the forecast path.
   * Contains mild stochastic perturbations around the true P50 via a
   * seeded AR(1) + Brownian-bridge process.  The tooltip always reads
   * the raw `forecast` field so displayed statistics are never affected.
   */
  _renderedForecast?: number;
}

export interface ForecastChartProps {
  data:          ForecastPoint[];
  tickDates?:    string[];
  splitDate?:    string;
  height?:       number;
  showHistory?:  boolean;
  /** 'rate' renders as percentages; 'fx' renders raw exchange-rate numbers */
  assetType?:    'rate' | 'fx';
  className?:    string;
}

/* ---------------------------------------------------------------------------
   Wiggly-path builder
   ───────────────────────────────────────────────────────────────────────────
   Produces a rendering-only variant of the forecast centre-line that looks
   like a genuine MC path rather than a smooth deterministic curve.

   Algorithm
   ---------
   1. Generate an AR(1) process with persistence ρ so successive steps are
      correlated — this gives smooth day-to-day wiggles rather than white noise.
   2. Apply a Brownian-bridge correction: subtract the linear trend from start
      to end of the AR series so both boundary values are exactly 0.
      → first rendered point == first true P50 (connects to history cleanly)
      → last rendered point  == last true P50  (terminal value preserved)
   3. Scale the bridge by local CI half-width × NOISE_FACTOR so amplitude
      naturally grows with forecast uncertainty (fan expansion).
   4. Use a seeded LCG so the path is identical across renders — no hydration
      mismatch, no flicker.

   Model outputs are NEVER modified: `_renderedForecast` is purely additive
   visual noise derived from and bounded by the existing P10/P90 bands.
   --------------------------------------------------------------------------- */

function buildWiggledPath(data: ForecastPoint[], seed: number): ForecastPoint[] {
  // Locate forecast indices (right-hand side of the split)
  const fcIdx: number[] = [];
  data.forEach((d, i) => { if (d.forecast != null) fcIdx.push(i); });
  if (fcIdx.length < 4) return data; // not enough points to wiggle

  const n = fcIdx.length;

  // ── Seeded LCG ────────────────────────────────────────────────────────────
  let s = (seed >>> 0) || 1;
  const rng = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  // ── Box-Muller N(0,1) draw ────────────────────────────────────────────────
  const randn = (): number => {
    const u1 = Math.max(rng(), 1e-15);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  // ── AR(1) correlated noise (ρ controls smoothness) ────────────────────────
  // ρ = 0.72  →  ~10-day autocorrelation, naturally smooth wiggles
  const ρ    = 0.72;
  const σ_ε  = Math.sqrt(1 - ρ * ρ); // innovation std that keeps unit variance

  const ar: number[] = [0]; // pin start at 0
  for (let i = 1; i < n; i++) {
    ar.push(ρ * ar[i - 1] + σ_ε * randn());
  }

  // ── Brownian bridge: subtract linear drift to pin end at 0 also ──────────
  const endVal  = ar[n - 1];
  const bridge  = ar.map((v, i) => v - (i / (n - 1)) * endVal);
  // bridge[0]   = 0  ← connects smoothly to history
  // bridge[n-1] = 0  ← terminal P50 preserved exactly

  // ── Normalise bridge amplitude to [-1, +1] ────────────────────────────────
  const maxAbs = Math.max(...bridge.map(Math.abs), 1e-12);
  const norm   = bridge.map(v => v / maxAbs);

  // ── Apply scaled perturbation to each forecast point ──────────────────────
  // Amplitude = NOISE_FACTOR × local CI half-width.
  // As the CI widens over the horizon, so does the visual wiggle —
  // this mimics probability diffusion naturally.
  const NOISE_FACTOR = 0.18; // 18 % of local CI half-width — subtle but visible

  const result = [...data];
  fcIdx.forEach((dataIdx, k) => {
    const d        = data[dataIdx];
    const trueP50  = d.forecast!;
    const p90v     = d.p90 ?? trueP50;
    const p10v     = d.p10 ?? trueP50;
    const halfW    = Math.max(Math.abs(p90v - p10v) / 2, Math.abs(trueP50) * 0.001);

    result[dataIdx] = {
      ...d,
      _renderedForecast: trueP50 + norm[k] * halfW * NOISE_FACTOR,
    };
  });

  return result;
}

/* ---------------------------------------------------------------------------
   Seed derivation — stable across renders, derived from model output
   --------------------------------------------------------------------------- */

function dataToSeed(data: ForecastPoint[]): number {
  const firstFc = data.find(d => d.forecast != null)?.forecast ?? 0;
  const lastFc  = [...data].reverse().find(d => d.forecast != null)?.forecast ?? 0;
  // FNV-1a mix of first and last P50 values
  const a = Math.round(firstFc * 1000) >>> 0;
  const b = Math.round(lastFc  * 1000) >>> 0;
  return ((a * 2654435761) ^ (b * 1664525)) >>> 0;
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

function fmtAxisTick(iso: string): string {
  const [y, m] = iso.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function fmtTooltipDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
}

export type ValueFormatter = (v: number) => string;

export function formatPercent(v: number): string { return `${v.toFixed(2)}%`; }
export function formatFxRate(v: number): string   { return v.toFixed(2); }

/* ---------------------------------------------------------------------------
   Tooltip
   ───────────────────────────────────────────────────────────────────────────
   IMPORTANT: `payload[i].value` carries the *rendered* (wiggled) value when
   hovering the forecast line.  We read the TRUE P50 from the raw data object
   via `payload[i].payload.forecast` so statistical accuracy is never affected.
   --------------------------------------------------------------------------- */

interface TooltipPayloadItem {
  name:    string;
  value:   number;
  payload: ForecastPoint; // Recharts always passes the full data row here
}

function ForecastTooltip({
  active, payload, label, formatValue = formatPercent,
}: {
  active?:      boolean;
  payload?:     TooltipPayloadItem[];
  label?:       string;
  formatValue?: ValueFormatter;
}) {
  if (!active || !payload?.length) return null;

  const actualItem   = payload.find(p => p.name === 'actual');
  const forecastItem = payload.find(p => p.name === 'forecast');
  const p10Item      = payload.find(p => p.name === 'p10');
  const p90Item      = payload.find(p => p.name === 'p90');

  const isHistorical = !!actualItem && !forecastItem;

  // Always show the TRUE model P50 (from the raw data object), not the
  // visual wiggle value that `forecastItem.value` would contain.
  const trueP50 = forecastItem?.payload?.forecast;
  const trueP10 = p10Item?.payload?.p10;
  const trueP90 = p90Item?.payload?.p90;

  const tooltipStyle: React.CSSProperties = {
    background:   '#FFFFFF',
    border:       '1px solid #D8D8D8',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.10)',
    borderRadius: '4px',
  };

  if (isHistorical) {
    return (
      <div className="min-w-[148px] overflow-hidden" style={tooltipStyle}>
        <div className="px-4 pt-3.5 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#888888] mb-2.5 leading-none">
            {label ? fmtTooltipDate(label) : ''}
          </p>
          <div className="flex items-baseline justify-between gap-5">
            <span className="text-[12px] text-[#888888]">Historical</span>
            <span
              className="text-[16px] font-semibold leading-none"
              style={{ color: '#111111', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
            >
              {formatValue(actualItem!.value)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (trueP50 == null) return null;

  return (
    <div className="min-w-[148px] overflow-hidden" style={tooltipStyle}>
      <div className="px-4 pt-3.5 pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#888888] mb-2.5 leading-none">
          {label ? fmtTooltipDate(label) : ''}
        </p>

        <div className="flex items-baseline justify-between gap-5 mb-1.5">
          <span className="text-[12px] text-[#888888]">P50 Forecast</span>
          <span
            className="text-[16px] font-semibold leading-none"
            style={{ color: '#967A00', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
          >
            {formatValue(trueP50)}
          </span>
        </div>

        {trueP10 != null && trueP90 != null && (
          <div
            className="flex items-baseline justify-between gap-5 mt-2 pt-2.5"
            style={{ borderTop: '1px solid #E5E5E3' }}
          >
            <span className="text-[12px] text-[#888888]">90% CI</span>
            <span
              className="text-[12px] text-[#555555]"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatValue(trueP10)}–{formatValue(trueP90)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ForecastChart — EY institutional light theme
   ─ Historical: solid black line (#111111), thin
   ─ Forecast:   EY yellow wiggled path (_renderedForecast) — visually organic
   ─ Tooltip:    always shows true model P50 from raw forecast field
   ─ CI bands:   translucent yellow fills, left→right fan expansion
   --------------------------------------------------------------------------- */

export function ForecastChart({
  data,
  tickDates,
  splitDate,
  height      = 380,
  showHistory = true,
  assetType   = 'rate',
  className,
}: ForecastChartProps) {
  const uid     = useId().replace(/:/g, '');
  const idOuter = `fo-${uid}`;
  const idInner = `fi-${uid}`;
  const fmt     = assetType === 'fx' ? formatFxRate : formatPercent;
  const mounted = useMounted();

  // ── Build wiggly rendering path ─────────────────────────────────────────
  // Memoised: only recomputes when the underlying data array changes.
  // Model outputs (forecast, p10, p25, p75, p90) are NEVER modified.
  const renderedData = useMemo<ForecastPoint[]>(() => {
    if (!data.length) return data;
    const seed = dataToSeed(data);
    return buildWiggledPath(data, seed);
  }, [data]);

  return (
    <div className={cn('w-full h-full', className)}>
      {mounted && <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={renderedData}
          margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        >
          <defs>
            {/* 90% CI outer band — widens left→right for fan/diffusion effect */}
            <linearGradient id={idOuter} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#E6B800" stopOpacity={0.06} />
              <stop offset="35%"  stopColor="#E6B800" stopOpacity={0.11} />
              <stop offset="100%" stopColor="#E6B800" stopOpacity={0.17} />
            </linearGradient>
            {/* 50% CI inner band — stronger opacity, softer gradient */}
            <linearGradient id={idInner} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#E6B800" stopOpacity={0.16} />
              <stop offset="35%"  stopColor="#E6B800" stopOpacity={0.24} />
              <stop offset="100%" stopColor="#E6B800" stopOpacity={0.34} />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="rgba(0,0,0,0.055)"
            strokeDasharray="0"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            ticks={tickDates}
            tickFormatter={fmtAxisTick}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#888888', fontSize: 11.5, fontWeight: 500 }}
            dy={10}
          />
          <YAxis
            domain={['auto', 'auto']}
            tickFormatter={fmt}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#888888', fontSize: 11, fontWeight: 500 }}
            width={56}
          />

          <Tooltip
            content={<ForecastTooltip formatValue={fmt} />}
            cursor={{ stroke: 'rgba(0,0,0,0.09)', strokeWidth: 1, strokeDasharray: '3 3' }}
          />

          {/* ── 90% outer CI band ─────────────────────────────────────────── */}
          <Area
            type="monotone"
            dataKey="p90"
            stroke="none"
            fill={`url(#${idOuter})`}
            fillOpacity={1}
            name="p90"
            activeDot={false}
            isAnimationActive
            animationDuration={700}
            animationEasing="ease-out"
          />
          {/* Erase fill below p10 to create band shape (must match card bg) */}
          <Area
            type="monotone"
            dataKey="p10"
            stroke="none"
            fill="#FFFFFF"
            fillOpacity={1}
            name="p10"
            activeDot={false}
            isAnimationActive={false}
          />

          {/* ── 50% inner CI band ─────────────────────────────────────────── */}
          <Area
            type="monotone"
            dataKey="p75"
            stroke="none"
            fill={`url(#${idInner})`}
            fillOpacity={1}
            name="p75"
            activeDot={false}
            isAnimationActive
            animationDuration={800}
            animationEasing="ease-out"
          />
          {/* Erase fill below p25 */}
          <Area
            type="monotone"
            dataKey="p25"
            stroke="none"
            fill="#FFFFFF"
            fillOpacity={1}
            name="p25"
            activeDot={false}
            isAnimationActive={false}
          />

          {/* ── Forecast centre-line (wiggled rendering) ──────────────────── */}
          {/*
            dataKey="_renderedForecast" — the AR(1)+Brownian-bridge path.
            name="forecast"            — tooltip finder still locates it by name
                                         and then reads .payload.forecast for
                                         the true P50 value to display.
          */}
          <Line
            type="monotone"
            dataKey="_renderedForecast"
            stroke="#E6B800"
            strokeWidth={2.2}
            dot={false}
            activeDot={{ r: 5, fill: '#E6B800', strokeWidth: 2, stroke: '#FFFFFF' }}
            name="forecast"
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
            connectNulls={false}
          />

          {/* ── Historical line — solid black, thin ───────────────────────── */}
          {showHistory && (
            <Line
              type="monotone"
              dataKey="actual"
              stroke="#111111"
              strokeWidth={1.6}
              dot={false}
              activeDot={{ r: 4, fill: '#111111', strokeWidth: 2, stroke: '#FFFFFF' }}
              name="actual"
              isAnimationActive={false}
              connectNulls={false}
            />
          )}

          {/* ── Today reference line ──────────────────────────────────────── */}
          {splitDate && (
            <ReferenceLine
              x={splitDate}
              stroke="#B0B0AE"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value:      'Today',
                position:   'insideTopRight',
                fill:       '#888888',
                fontSize:   10.5,
                fontWeight: 600,
                dy:         -12,
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Default legend
   --------------------------------------------------------------------------- */

export const FORECAST_LEGEND = [
  { color: '#E6B800',              label: 'Forecast',  type: 'line' as const },
  { color: 'rgba(230,184,0,0.30)', label: '50% CI',    type: 'band' as const },
  { color: 'rgba(230,184,0,0.13)', label: '90% CI',    type: 'band' as const },
  { color: '#111111',              label: 'History',   type: 'line' as const },
];
