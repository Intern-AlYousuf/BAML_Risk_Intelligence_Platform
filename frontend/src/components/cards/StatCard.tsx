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
  label:          string;
  value:          string | number;
  unit?:          string;
  unitPosition?:  'prefix' | 'suffix';
  delta?:         string;
  annotation?:    string;
  signal?:        StatSignal;
  accent?:        StatAccent;
  featured?:      boolean;
  loading?:       boolean;
  size?:          StatSize;
  className?:     string;
  onClick?:       () => void;
}

/* ---------------------------------------------------------------------------
   Design maps — light theme
   --------------------------------------------------------------------------- */

const ACCENT_BAR: Record<StatAccent, string> = {
  yellow: '#FFE600',
  green:  '#16A34A',
  red:    '#DC2626',
  amber:  '#D97706',
  blue:   '#2563EB',
  none:   'transparent',
};

const SIGNAL_CONFIG: Record<StatSignal, {
  text:   string;
  bg:     string;
  border: string;
  Icon:   React.ElementType;
}> = {
  positive: { text: '#16A34A', bg: 'rgba(22,163,74,0.08)',   border: 'rgba(22,163,74,0.20)',   Icon: TrendingUp   },
  negative: { text: '#DC2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.20)',   Icon: TrendingDown },
  warning:  { text: '#D97706', bg: 'rgba(217,119,6,0.08)',   border: 'rgba(217,119,6,0.20)',   Icon: TrendingUp   },
  neutral:  { text: '#888888', bg: 'rgba(0,0,0,0.04)',       border: '#D8D8D8',                Icon: Minus        },
};

const SIZE_CONFIG: Record<StatSize, {
  pad:        string;
  label:      string;
  valueSize:  string;
  unitSize:   string;
  deltaSize:  string;
  minHeight:  string;
}> = {
  sm: { pad: 'px-6 pt-6 pb-5',   label: 'text-[11px]',   valueSize: 'text-[2.5rem]',  unitSize: 'text-[1.1rem]',  deltaSize: 'text-[12px]',   minHeight: 'min-h-[160px]' },
  md: { pad: 'px-7 pt-7 pb-6',   label: 'text-[11.5px]', valueSize: 'text-[3rem]',    unitSize: 'text-[1.4rem]',  deltaSize: 'text-[13px]',   minHeight: 'min-h-[200px]' },
  lg: { pad: 'px-8 pt-8 pb-7',   label: 'text-[12px]',   valueSize: 'text-[3.75rem]', unitSize: 'text-[1.7rem]',  deltaSize: 'text-[13.5px]', minHeight: 'min-h-[230px]' },
};

/* ---------------------------------------------------------------------------
   StatCard — EY light institutional style
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
  const sz          = SIZE_CONFIG[size];
  const sig         = SIGNAL_CONFIG[signal];
  const accentBg    = ACCENT_BAR[accent];
  const isClickable = !!onClick;

  const cardStyle: React.CSSProperties = featured
    ? { background: 'rgba(255,230,0,0.06)', border: '1px solid rgba(255,230,0,0.30)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }
    : { background: '#FFFFFF', border: '1px solid #D8D8D8', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' };

  return (
    <motion.div
      whileHover={isClickable ? { y: -2 } : undefined}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      onClick={onClick}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-[8px]',
        'transition-all duration-150',
        sz.minHeight,
        isClickable && 'cursor-pointer',
        className,
      )}
      style={cardStyle}
    >
      {/* Top accent bar — 3px, full width */}
      {accent !== 'none' && (
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
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
              'font-bold uppercase leading-none tracking-[0.14em]',
              sz.label,
              featured ? 'text-[#967A00]' : 'text-[#888888]',
            )}>
              {label}
            </p>

            {/* Value row */}
            <div className="mt-auto flex items-baseline gap-1.5 pt-5">
              {unit && unitPosition === 'prefix' && (
                <span className={cn('font-medium leading-none text-[#888888]', sz.unitSize)}>
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
                  className={cn('font-bold leading-none', sz.valueSize)}
                  style={{
                    color:               featured ? '#967A00' : '#111111',
                    fontVariantNumeric:  'tabular-nums',
                    fontFeatureSettings: '"tnum" 1',
                    letterSpacing:       '-0.03em',
                  }}
                >
                  {value}
                </motion.span>
              </AnimatePresence>

              {unit && unitPosition === 'suffix' && (
                <span className={cn('font-medium leading-none text-[#888888]', sz.unitSize)}>
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
                      'inline-flex items-center gap-1 rounded-[4px] border px-2.5 py-1.5 leading-none font-semibold',
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
                  <span className={cn('leading-none text-[#888888]', sz.deltaSize)}>
                    {annotation}
                  </span>
                )}
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {isClickable && (
        <span
          className="pointer-events-none absolute inset-0 rounded-[8px] opacity-0 ring-2 ring-[#FFE600] transition-opacity focus-visible:opacity-100"
          aria-hidden
        />
      )}
    </motion.div>
  );
}
