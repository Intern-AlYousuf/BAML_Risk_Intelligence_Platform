'use client';

import { motion } from 'framer-motion';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Legend
   --------------------------------------------------------------------------- */

export interface LegendItem {
  color: string;
  label: string;
  /** 'line' → horizontal bar, 'band' → filled rect, 'dot' → circle */
  type?: 'line' | 'band' | 'dot';
}

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex items-center flex-wrap gap-x-5 gap-y-2">
      {items.map(({ color, label, type = 'line' }) => (
        <div key={label} className="flex items-center gap-2">
          {type === 'line' && (
            <span className="h-[2px] w-5 rounded-full shrink-0" style={{ background: color }} />
          )}
          {type === 'band' && (
            <span className="h-3 w-4 rounded-[3px] shrink-0" style={{ background: color }} />
          )}
          {type === 'dot' && (
            <span className="h-[9px] w-[9px] rounded-full shrink-0" style={{ background: color }} />
          )}
          <span className="text-[12px] text-[#6B7280] leading-none whitespace-nowrap">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Loading overlay
   --------------------------------------------------------------------------- */

function LoadingOverlay() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-10 rounded-[inherit]"
      style={{ background: 'rgba(21,23,28,0.75)', backdropFilter: 'blur(4px)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-4 w-4 rounded-full border-2 animate-spin"
          style={{ borderColor: 'rgba(255,255,255,0.12)', borderTopColor: '#F5D90A' }}
        />
        <span className="text-[13px] font-medium text-[#6B7280]">Loading…</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface ChartCardProps {
  /** Primary panel title */
  title:      string;
  /** One-line subtitle */
  subtitle?:  string;
  /** Right-side action slot in the header */
  actions?:   React.ReactNode;
  /** Legend row between header and chart */
  legend?:    LegendItem[];
  /** The chart — fills the chart container */
  children:   React.ReactNode;
  /** Shows a blurred overlay while fetching */
  loading?:   boolean;
  /** Explicit chart container height in px. Default: 360 */
  height?:    number;
  /** Remove default chart padding — for edge-to-edge charts */
  flush?:     boolean;
  className?: string;
}

/* ---------------------------------------------------------------------------
   ChartCard
   --------------------------------------------------------------------------- */

export function ChartCard({
  title,
  subtitle,
  actions,
  legend,
  children,
  loading   = false,
  height    = 360,
  flush     = false,
  className,
}: ChartCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
      className={cn('overflow-hidden rounded-[20px]', className)}
      style={{ background: '#15171C', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Header ────────────────────────────────────────────────────── */}
      <div
        className="flex items-start justify-between gap-4 px-8 pt-7 pb-6"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-[#F5F7FA] leading-none tracking-tight">
            {title}
          </p>
          {subtitle && (
            <p className="mt-1.5 text-[13px] text-[#6B7280] leading-none">{subtitle}</p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0 -mt-0.5">{actions}</div>
        )}
      </div>

      {/* Legend ─────────────────────────────────────────────────────── */}
      {legend && legend.length > 0 && (
        <div className="px-8 pt-4">
          <Legend items={legend} />
        </div>
      )}

      {/* Chart area ─────────────────────────────────────────────────── */}
      <div
        className={cn('relative', flush ? '' : 'px-4 pt-3 pb-6')}
        style={{ height }}
      >
        {children}
        {loading && <LoadingOverlay />}
      </div>
    </motion.div>
  );
}
