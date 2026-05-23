'use client';

import { motion } from 'framer-motion';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Legend
   --------------------------------------------------------------------------- */

export interface LegendItem {
  color: string;
  label: string;
  type?: 'line' | 'band' | 'dot';
}

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex items-center flex-wrap gap-x-5 gap-y-2">
      {items.map(({ color, label, type = 'line' }) => (
        <div key={label} className="flex items-center gap-2">
          {type === 'line' && (
            <span className="h-[2px] w-5 shrink-0" style={{ background: color }} />
          )}
          {type === 'band' && (
            <span className="h-3 w-4 rounded-[2px] shrink-0" style={{ background: color }} />
          )}
          {type === 'dot' && (
            <span className="h-[8px] w-[8px] rounded-full shrink-0" style={{ background: color }} />
          )}
          <span className="text-[11.5px] text-[#888888] leading-none whitespace-nowrap font-medium">
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
      className="absolute inset-0 flex items-center justify-center z-10"
      style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(2px)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-4 w-4 rounded-full border-2 animate-spin"
          style={{ borderColor: '#D8D8D8', borderTopColor: '#E6B800' }}
        />
        <span className="text-[13px] font-medium text-[#888888]">Loading…</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface ChartCardProps {
  title:      string;
  subtitle?:  string;
  actions?:   React.ReactNode;
  legend?:    LegendItem[];
  children:   React.ReactNode;
  loading?:   boolean;
  height?:    number;
  flush?:     boolean;
  className?: string;
}

/* ---------------------------------------------------------------------------
   ChartCard — EY light institutional style
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
      className={cn('overflow-hidden rounded-[8px]', className)}
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between gap-4 px-8 pt-7 pb-6"
        style={{ borderBottom: '1px solid #E5E5E3' }}
      >
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-[#111111] leading-none tracking-tight">
            {title}
          </p>
          {subtitle && (
            <p className="mt-1.5 text-[12.5px] text-[#888888] leading-none">{subtitle}</p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0 -mt-0.5">{actions}</div>
        )}
      </div>

      {/* Legend */}
      {legend && legend.length > 0 && (
        <div className="px-8 pt-4 pb-0">
          <Legend items={legend} />
        </div>
      )}

      {/* Chart area */}
      <div
        className={cn('relative', flush ? '' : 'px-4 pt-4 pb-6')}
        style={{ height }}
      >
        {children}
        {loading && <LoadingOverlay />}
      </div>
    </motion.div>
  );
}
