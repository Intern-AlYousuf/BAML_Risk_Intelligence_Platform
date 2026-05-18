'use client';

import { useId } from 'react';
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
  date:      string;
  /** ARIMA central forecast rate */
  forecast?: number;
  /** Historical observed rate */
  actual?:   number;
  /** 10th percentile */
  p10?:      number;
  /** 25th percentile */
  p25?:      number;
  /** 75th percentile */
  p75?:      number;
  /** 90th percentile */
  p90?:      number;
}

export interface ForecastChartProps {
  data:          ForecastPoint[];
  /** Sparse subset of ISO dates to render as x-axis tick labels */
  tickDates?:    string[];
  /** ISO date of the history/forecast split — draws a "Today" reference line */
  splitDate?:    string;
  /** Chart area height in px. ChartCard controls the outer container height. */
  height?:       number;
  /** Whether to render the historical actual line */
  showHistory?:  boolean;
  className?:    string;
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

/* ---------------------------------------------------------------------------
   Tooltip
   --------------------------------------------------------------------------- */

function ForecastTooltip({
  active, payload, label,
}: {
  active?:   boolean;
  payload?:  Array<{ name: string; value: number }>;
  label?:    string;
}) {
  if (!active || !payload?.length) return null;
  const forecast = payload.find(p => p.name === 'forecast');
  const p10      = payload.find(p => p.name === 'p10');
  const p90      = payload.find(p => p.name === 'p90');

  return (
    <div
      className="rounded-[14px] min-w-[156px] overflow-hidden"
      style={{
        background:          'rgba(15,17,20,0.96)',
        border:              '1px solid rgba(255,255,255,0.08)',
        backdropFilter:      'blur(16px)',
        WebkitBackdropFilter:'blur(16px)',
        boxShadow:           '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div className="px-4 pt-3.5 pb-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-[#6B7280] mb-3 leading-none">
          {label ? fmtTooltipDate(label) : ''}
        </p>

        {forecast && (
          <div className="flex items-baseline justify-between gap-5 mb-1.5">
            <span className="text-[12px] text-[#6B7280]">Forecast</span>
            <span
              className="text-[17px] font-semibold leading-none"
              style={{ color: '#F5D90A', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
            >
              {forecast.value.toFixed(2)}%
            </span>
          </div>
        )}

        {p10 && p90 && (
          <div
            className="flex items-baseline justify-between gap-5 mt-2 pt-2.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="text-[12px] text-[#6B7280]">90% CI</span>
            <span
              className="text-[13px] text-[#A1A8B3]"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {p10.value.toFixed(2)}–{p90.value.toFixed(2)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ForecastChart
   --------------------------------------------------------------------------- */

export function ForecastChart({
  data,
  tickDates,
  splitDate,
  height       = 380,
  showHistory  = true,
  className,
}: ForecastChartProps) {
  const uid = useId().replace(/:/g, '');
  const idOuter = `fo-${uid}`;
  const idInner = `fi-${uid}`;

  return (
    <div className={cn('w-full h-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 20, left: 0, bottom: 0 }}
        >
          <defs>
            {/* 90% CI — wide, airy outer fan */}
            <linearGradient id={idOuter} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#F5D90A" stopOpacity={0.18} />
              <stop offset="55%"  stopColor="#F5D90A" stopOpacity={0.07} />
              <stop offset="100%" stopColor="#F5D90A" stopOpacity={0.01} />
            </linearGradient>
            {/* 50% CI — confident inner band */}
            <linearGradient id={idInner} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#F5D90A" stopOpacity={0.46} />
              <stop offset="45%"  stopColor="#F5D90A" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#F5D90A" stopOpacity={0.08} />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="rgba(255,255,255,0.035)"
            strokeDasharray="0"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            ticks={tickDates}
            tickFormatter={fmtAxisTick}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,0.28)', fontSize: 12 }}
            dy={10}
          />
          <YAxis
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `${v.toFixed(2)}%`}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,0.28)', fontSize: 11.5 }}
            width={54}
          />

          <Tooltip
            content={<ForecastTooltip />}
            cursor={{ stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 }}
          />

          {/* 90% outer band — rendered first so it sits behind */}
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
          {/* Erase below p10 to create band effect */}
          <Area
            type="monotone"
            dataKey="p10"
            stroke="none"
            fill="#15171C"
            fillOpacity={1}
            name="p10"
            activeDot={false}
            isAnimationActive={false}
          />

          {/* 50% inner band */}
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
          <Area
            type="monotone"
            dataKey="p25"
            stroke="none"
            fill="#15171C"
            fillOpacity={1}
            name="p25"
            activeDot={false}
            isAnimationActive={false}
          />

          {/* Central forecast line */}
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="#F5D90A"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: '#F5D90A', strokeWidth: 0 }}
            name="forecast"
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          />

          {/* History line — muted, behind forecast */}
          {showHistory && (
            <Line
              type="monotone"
              dataKey="actual"
              stroke="rgba(255,255,255,0.32)"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              name="actual"
              isAnimationActive={false}
            />
          )}

          {/* Today divider */}
          {splitDate && (
            <ReferenceLine
              x={splitDate}
              stroke="rgba(255,255,255,0.12)"
              strokeDasharray="3 5"
              strokeWidth={1}
              label={{
                value:    'Today',
                position: 'insideTopRight',
                fill:     'rgba(255,255,255,0.22)',
                fontSize: 11,
                dy:       -12,
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Default legend helper — import alongside ForecastChart for convenience
   --------------------------------------------------------------------------- */

export const FORECAST_LEGEND = [
  { color: '#F5D90A',               label: 'Forecast',  type: 'line' as const },
  { color: 'rgba(245,217,10,0.45)', label: '50% CI',    type: 'band' as const },
  { color: 'rgba(245,217,10,0.17)', label: '90% CI',    type: 'band' as const },
  { color: 'rgba(255,255,255,0.32)', label: 'History',  type: 'line' as const },
];
