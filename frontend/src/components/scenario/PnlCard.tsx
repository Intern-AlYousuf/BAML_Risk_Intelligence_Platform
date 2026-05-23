'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../lib/theme';
import {
  type PnlResult,
  type PnlDelta,
  formatCr,
  formatPct,
  formatDeltaCr,
  formatDeltaPp,
} from '../../lib/scenarioEngine';

interface PnlCardProps {
  title:    string;
  subtitle?: string;
  result:   PnlResult;
  delta:    PnlDelta;
  isBase:   boolean;
  variant?: 'unhedged' | 'hedged';
}

const VARIANT_TOKENS = {
  unhedged: {
    accentBar:    '#FFE600',
    ebitdaBg:     'rgba(255,230,0,0.07)',
    ebitdaBorder: 'rgba(255,230,0,0.30)',
    ebitdaLabel:  '#967A00',
    ebitdaValue:  '#7A6000',
    eyebrowText:  'Unhedged Outcome',
  },
  hedged: {
    accentBar:    '#2563EB',
    ebitdaBg:     'rgba(37,99,235,0.05)',
    ebitdaBorder: 'rgba(37,99,235,0.18)',
    ebitdaLabel:  '#1D4ED8',
    ebitdaValue:  '#1E3A8A',
    eyebrowText:  'Hedged Outcome',
  },
} as const;

type DeltaDirection = 'positive' | 'negative' | 'neutral';

function getDeltaDirection(value: number, isExpense: boolean): DeltaDirection {
  if (Math.abs(value) < 0.005) return 'neutral';
  if (isExpense) return value > 0 ? 'negative' : 'positive';
  return value > 0 ? 'positive' : 'negative';
}

const DELTA_STYLES: Record<DeltaDirection, { text: string; bg: string; border: string; Icon: React.ElementType }> = {
  positive: { text: '#16A34A', bg: 'rgba(22,163,74,0.08)',   border: 'rgba(22,163,74,0.22)',   Icon: TrendingUp   },
  negative: { text: '#DC2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.22)',   Icon: TrendingDown },
  neutral:  { text: '#888888', bg: 'rgba(0,0,0,0.04)',       border: '#D8D8D8',                Icon: Minus        },
};

function DeltaBadge({ formatted, direction, size = 'sm' }: {
  value: number; formatted: string; direction: DeltaDirection; size?: 'sm' | 'md';
}) {
  const s    = DELTA_STYLES[direction];
  const isMd = size === 'md';
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={formatted}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3 }}
        transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
        className={cn(
          'inline-flex items-center gap-1 rounded-[4px] border font-semibold leading-none',
          isMd ? 'px-2.5 py-1.5 text-[12px]' : 'px-2 py-1 text-[10.5px]',
        )}
        style={{ color: s.text, background: s.bg, border: `1px solid ${s.border}` }}
      >
        <s.Icon
          className={cn('shrink-0', isMd ? 'w-[10px] h-[10px]' : 'w-[9px] h-[9px]')}
          strokeWidth={2.5}
        />
        {formatted}
      </motion.span>
    </AnimatePresence>
  );
}

function PnlRow({ label, value, deltaValue, isExpense = false, isSubtotal = false, indent = false }: {
  label: string; value: number; deltaValue: number; isExpense?: boolean; isSubtotal?: boolean; indent?: boolean;
}) {
  const direction = getDeltaDirection(deltaValue, isExpense);
  const formatted = formatDeltaCr(deltaValue);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-2.5',
        indent && 'pl-4',
        isSubtotal && 'rounded-[4px] px-2',
      )}
      style={isSubtotal ? { background: '#F7F7F5' } : undefined}
    >
      <span
        className={cn(
          'text-[13px] leading-none',
          isSubtotal ? 'font-semibold text-[#111111]' : 'font-medium text-[#555555]',
          indent && 'text-[12.5px]',
        )}
      >
        {label}
      </span>
      <div className="flex items-center gap-2.5 shrink-0">
        <DeltaBadge value={deltaValue} formatted={formatted} direction={direction} />
        <AnimatePresence mode="wait">
          <motion.span
            key={formatCr(value)}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            className={cn(
              'text-right leading-none tabular-nums',
              isSubtotal ? 'text-[13.5px] font-semibold text-[#111111]' : 'text-[13px] font-medium text-[#111111]',
            )}
            style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}
          >
            {formatCr(value)}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px my-1" style={{ background: '#E5E5E3' }} />;
}

export function PnlCard({ title, subtitle, result, delta, isBase, variant = 'unhedged' }: PnlCardProps) {
  const tokens = VARIANT_TOKENS[variant];

  return (
    <div
      className="relative flex flex-col rounded-[8px] overflow-hidden"
      style={{
        background:  '#FFFFFF',
        border:      '1px solid #D8D8D8',
        boxShadow:   '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      {/* Top accent bar */}
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: tokens.accentBar }} />

      {/* Header */}
      <div className="px-6 pt-6 pb-5" style={{ borderBottom: '1px solid #E5E5E3' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#888888]">
              {tokens.eyebrowText}
            </p>
            <h3 className="text-[16px] font-semibold text-[#111111] leading-tight">
              {title}
            </h3>
            {subtitle && <p className="text-[12px] text-[#888888]">{subtitle}</p>}
          </div>
        </div>

        <div className="mt-3.5">
          <AnimatePresence mode="wait">
            {isBase ? (
              <motion.div key="base" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#16A34A' }} />
                <span className="text-[11.5px] text-[#888888]">Showing base case values</span>
              </motion.div>
            ) : (
              <motion.div key="stressed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#D97706' }} />
                <span className="text-[11.5px] font-medium" style={{ color: '#D97706' }}>
                  {variant === 'hedged' ? 'Hedge overlay applied — delta vs base shown' : 'Stress scenario applied — delta vs base shown'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* P&L table */}
      <div className="flex-1 px-6 py-4 space-y-0.5">
        <PnlRow label="Revenue" value={result.revenue} deltaValue={delta.revenue} />
        <Divider />
        <PnlRow label="Cost of Goods Sold" value={result.cogs} deltaValue={delta.cogs} isExpense indent />
        <Divider />
        <PnlRow label="Gross Profit" value={result.grossProfit} deltaValue={delta.grossProfit} isSubtotal />
        <div className="py-1" />
        <PnlRow label="SG&A" value={result.sga} deltaValue={delta.sga} isExpense indent />
        <Divider />
      </div>

      {/* EBITDA featured section */}
      <div
        className="mx-5 mb-5 rounded-[6px] px-5 py-4"
        style={{ background: tokens.ebitdaBg, border: `1px solid ${tokens.ebitdaBorder}` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.16em]" style={{ color: tokens.ebitdaLabel }}>
              EBITDA
            </p>
            <AnimatePresence mode="wait">
              <motion.p
                key={formatCr(result.ebitda)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                className="text-[24px] font-bold leading-none tabular-nums"
                style={{ color: tokens.ebitdaValue, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums' }}
              >
                {formatCr(result.ebitda)}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
            <DeltaBadge value={delta.ebitda} formatted={formatDeltaCr(delta.ebitda)} direction={getDeltaDirection(delta.ebitda, false)} size="md" />
            <div className="flex items-baseline gap-1.5">
              <AnimatePresence mode="wait">
                <motion.span
                  key={formatPct(result.ebitdaMargin)}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                  className="text-[30px] font-bold leading-none tabular-nums"
                  style={{ color: '#111111', letterSpacing: '-0.03em' }}
                >
                  {formatPct(result.ebitdaMargin)}
                </motion.span>
              </AnimatePresence>
              <span className="text-[12.5px] text-[#888888] leading-none">margin</span>
            </div>
            <DeltaBadge value={delta.ebitdaMargin} formatted={formatDeltaPp(delta.ebitdaMargin)} direction={getDeltaDirection(delta.ebitdaMargin, false)} size="md" />
          </div>
        </div>
      </div>
    </div>
  );
}
