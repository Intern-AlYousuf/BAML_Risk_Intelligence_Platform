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
  /** Rate label — e.g. "4.25" */
  rate:  string;
  /** Probability mass (0–100) */
  prob:  number;
}

export interface DistributionChartProps {
  data:          DistributionPoint[];
  /** Inclusive range for the "base case" highlighted zone */
  baseRange?:    { low: number; high: number };
  /** Chart area height in px */
  height?:       number;
  className?:    string;
}

/* ---------------------------------------------------------------------------
   Tooltip
   --------------------------------------------------------------------------- */

function DistributionTooltip({
  active, payload, label,
}: {
  active?:  boolean;
  payload?: Array<{ value: number }>;
  label?:   string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{
        background:          'rgba(15,17,20,0.96)',
        border:              '1px solid rgba(255,255,255,0.08)',
        backdropFilter:      'blur(16px)',
        WebkitBackdropFilter:'blur(16px)',
        boxShadow:           '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div className="px-4 pt-3.5 pb-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-[#6B7280] mb-2.5 leading-none">
          SOFR {label}%
        </p>
        <p
          className="text-[18px] font-semibold leading-none"
          style={{ color: '#F5F7FA', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
        >
          {payload[0].value.toFixed(1)}%
        </p>
        <p className="text-[12px] text-[#6B7280] mt-1.5">probability mass</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DistributionChart
   --------------------------------------------------------------------------- */

export function DistributionChart({
  data,
  baseRange,
  height    = 300,
  className,
}: DistributionChartProps) {
  if (!data.length) return null;

  const maxProb = Math.max(...data.map(d => d.prob));

  function cellColor(entry: DistributionPoint): string {
    const rate = parseFloat(entry.rate);
    const isMode = entry.prob === maxProb;
    const isBase = baseRange
      ? rate >= baseRange.low && rate <= baseRange.high
      : false;

    if (isMode)  return '#F5D90A';
    if (isBase)  return 'rgba(245,217,10,0.44)';
    return       'rgba(245,217,10,0.14)';
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
            stroke="rgba(255,255,255,0.035)"
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="rate"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,0.28)', fontSize: 11.5 }}
            tickFormatter={(v: string) => `${v}%`}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(255,255,255,0.28)', fontSize: 11 }}
            tickFormatter={(v: number) => `${v}%`}
            width={38}
          />
          <Tooltip
            content={<DistributionTooltip />}
            cursor={{ fill: 'rgba(255,255,255,0.02)' }}
          />
          <Bar
            dataKey="prob"
            radius={[5, 5, 0, 0]}
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
