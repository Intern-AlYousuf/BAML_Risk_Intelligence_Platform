'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Data types
   --------------------------------------------------------------------------- */

export interface DistributionPoint {
  rate:  string;
  prob:  number;
}

export interface DistributionChartProps {
  data:          DistributionPoint[];
  baseRange?:    { low: number; high: number };
  assetLabel?:   string;
  height?:       number;
  className?:    string;
}

/* ---------------------------------------------------------------------------
   Tooltip — white card, dark text
   --------------------------------------------------------------------------- */

function DistributionTooltip({
  active, payload, label, assetLabel = 'SOFR',
}: {
  active?:     boolean;
  payload?:    Array<{ value: number }>;
  label?:      string;
  assetLabel?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="overflow-hidden"
      style={{
        background:   '#FFFFFF',
        border:       '1px solid #D8D8D8',
        boxShadow:    '0 4px 16px rgba(0,0,0,0.10)',
        borderRadius: '4px',
      }}
    >
      <div className="px-4 pt-3.5 pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#888888] mb-2.5 leading-none">
          {assetLabel} {label}
        </p>
        <p
          className="text-[18px] font-semibold leading-none"
          style={{ color: '#111111', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
        >
          {payload[0].value.toFixed(1)}%
        </p>
        <p className="text-[12px] text-[#888888] mt-1.5">probability mass</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DistributionChart — EY light theme
   --------------------------------------------------------------------------- */

export function DistributionChart({
  data,
  baseRange,
  assetLabel,
  height    = 300,
  className,
}: DistributionChartProps) {
  if (!data.length) return null;

  const maxProb = Math.max(...data.map(d => d.prob));

  function cellColor(entry: DistributionPoint): string {
    const rate   = parseFloat(entry.rate);
    const isMode = entry.prob === maxProb;
    const isBase = baseRange
      ? rate >= baseRange.low && rate <= baseRange.high
      : false;

    if (isMode)  return '#E6B800';              /* mode: full EY yellow      */
    if (isBase)  return 'rgba(230,184,0,0.55)'; /* base range: mid yellow    */
    return        'rgba(230,184,0,0.20)';        /* tail: light yellow        */
  }

  return (
    <div className={cn('w-full h-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          barCategoryGap="14%"
          margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            stroke="rgba(0,0,0,0.06)"
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="rate"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#888888', fontSize: 11, fontWeight: 500 }}
            tickFormatter={(v: string) => `${v}%`}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#888888', fontSize: 11, fontWeight: 500 }}
            tickFormatter={(v: number) => `${v}%`}
            width={38}
          />
          <Tooltip
            content={<DistributionTooltip assetLabel={assetLabel} />}
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
          />
          <Bar
            dataKey="prob"
            radius={[3, 3, 0, 0]}
            isAnimationActive
            animationDuration={600}
            animationEasing="ease-out"
          >
            {data.map((entry) => (
              <Cell key={entry.rate} fill={cellColor(entry)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
