'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export type StatSignal   = 'positive' | 'negative' | 'warning' | 'neutral';
export type StatAccent   = 'yellow' | 'green' | 'red' | 'amber' | 'blue' | 'none';
export type StatSize     = 'sm' | 'md' | 'lg';

export interface StatCardProps {
  /** Compact upper label — e.g. "Projected SOFR · 12M" */
  label:          string;
  /** Primary KPI value — e.g. "4.38" */
  value:          string | number;
  /** Unit appended/prepended to value */
  unit?:          string;
  unitPosition?:  'prefix' | 'suffix';
  /** Delta row — e.g. "+0.12 bps" or "P10 – P90 spread" */
  delta?:         string;
  /** Secondary annotation below delta */
  annotation?:    string;
  /** Colours the delta pill and top accent bar */
  signal?:        StatSignal;
  /** Top-of-card colour bar */
  accent?:        StatAccent;
  /** Yellow featured variant — larger KPI, yellow tint surface */
  featured?:      boolean;
  /** Skeleton loading state */
  loading?:       boolean;
  size?:          StatSize;
  className?:     string;
  onClick?:       () => void;
}

/* ---------------------------------------------------------------------------
   Design maps
   --------------------------------------------------------------------------- */

const ACCENT_BAR: Record<StatAccent, string> = {
  yellow: '#F5D90A',
  green:  '#22C55E',
  red:    '#EF4444',
  amber:  '#F59E0B',
  blue:   '#3B82F6',
  none:   'transparent',
};

const SIGNAL_CONFIG: Record<StatSignal, {
  text:   string;
  bg:     string;
  border: string;
  Icon:   React.ElementType;
}> = {
  positive: { text: '#22C55E', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.22)',  Icon: TrendingUp   },
  negative: { text: '#EF4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.22)',  Icon: TrendingDown },
  warning:  { text: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.22)', Icon: TrendingUp   },
  neutral:  { text: '#6B7280', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.09)', Icon: Minus      },
};

const SIZE_CONFIG: Record<StatSize, {
  pad:        string;
  label:      string;
  valueSize:  string;
  unitSize:   string;
  deltaSize:  string;
  minHeight:  string;
}> = {
  sm: { pad: 'px-7 pt-7 pb-6',   label: 'text-[12px]',   valueSize: 'text-[2.75rem]', unitSize: 'text-[1.2rem]',  deltaSize: 'text-[13px]',   minHeight: 'min-h-[170px]' },
  md: { pad: 'px-8 pt-8 pb-7',   label: 'text-[12.5px]', valueSize: 'text-[3.25rem]', unitSize: 'text-[1.5rem]',  deltaSize: 'text-[14px]',   minHeight: 'min-h-[210px]' },
  lg: { pad: 'px-9 pt-9 pb-8',   label: 'text-[13px]',   valueSize: 'text-[4rem]',    unitSize: 'text-[1.8rem]',  deltaSize: 'text-[14.5px]', minHeight: 'min-h-[240px]' },
};

/* ---------------------------------------------------------------------------
   StatCard
   --------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  unit,
  unitPosition = 'suffix',
  delta,
  annotation,
  signal        = 'neutral',
  accent        = 'none',
  featured      = false,
  loading       = false,
  size          = 'md',
  className,
  onClick,
}: StatCardProps) {
  const sz       = SIZE_CONFIG[size];
  const sig      = SIGNAL_CONFIG[signal];
  const accentBg = ACCENT_BAR[accent];
  const isClickable = !!onClick;

  const cardStyle: React.CSSProperties = {
    background: featured ? 'rgba(245,217,10,0.05)' : '#15171C',
    border:     featured ? '1px solid rgba(245,217,10,0.14)' : '1px solid rgba(255,255,255,0.06)',
  };

  return (
    <motion.div
      whileHover={isClickable ? { y: -2 } : undefined}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      onClick={onClick}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-[20px]',
        'transition-all duration-150',
        sz.minHeight,
        isClickable && 'cursor-pointer',
        className,
      )}
      style={cardStyle}
    >
      {/* Top accent bar — 2px, full width */}
      {accent !== 'none' && (
        <div
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-[20px]"
          style={{ background: accentBg }}
        />
      )}

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn('flex flex-col gap-3', sz.pad)}
          >
            <div className="skeleton h-2.5 w-1/3 rounded" />
            <div className="skeleton h-12 w-2/3 rounded" style={{ marginTop: '1rem' }} />
            <div className="skeleton h-2.5 w-1/2 rounded" style={{ marginTop: '0.5rem' }} />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn('flex h-full flex-col', sz.pad)}
          >

            {/* Label */}
            <p className={cn(
              'font-semibold uppercase leading-none tracking-[0.13em]',
              sz.label,
              featured ? 'text-[#A89208]' : 'text-[#6B7280]',
            )}>
              {label}
            </p>

            {/* Value row */}
            <div className="mt-auto flex items-baseline gap-1.5 pt-5">
              {unit && unitPosition === 'prefix' && (
                <span className={cn('font-medium leading-none', sz.unitSize, 'text-[#6B7280]')}>
                  {unit}
                </span>
              )}

              <AnimatePresence mode="wait">
                <motion.span
                  key={String(value)}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className={cn('font-semibold leading-none', sz.valueSize)}
                  style={{
                    color:              featured ? '#F5D90A' : '#F5F7FA',
                    fontVariantNumeric: 'tabular-nums',
                    fontFeatureSettings: '"tnum" 1',
                    letterSpacing:      '-0.025em',
                  }}
                >
                  {value}
                </motion.span>
              </AnimatePresence>

              {unit && unitPosition === 'suffix' && (
                <span className={cn('font-medium leading-none', sz.unitSize, 'text-[#6B7280]')}>
                  {unit}
                </span>
              )}
            </div>

            {/* Delta row */}
            {(delta || annotation) && (
              <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                {delta && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 leading-none font-semibold',
                      sz.deltaSize,
                    )}
                    style={{
                      color:      sig.text,
                      background: sig.bg,
                      border:     `1px solid ${sig.border}`,
                    }}
                  >
                    <sig.Icon className="h-[10px] w-[10px] shrink-0" strokeWidth={2.5} />
                    {delta}
                  </span>
                )}
                {annotation && (
                  <span className={cn('leading-none', sz.deltaSize, 'text-[#6B7280]')}>
                    {annotation}
                  </span>
                )}
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* Focus ring for accessible interactive cards */}
      {isClickable && (
        <span
          className="pointer-events-none absolute inset-0 rounded-[20px] opacity-0 ring-2 ring-[#F5D90A] transition-opacity focus-visible:opacity-100"
          aria-hidden
        />
      )}
    </motion.div>
  );
}
