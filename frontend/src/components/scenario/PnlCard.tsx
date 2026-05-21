'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Lock } from 'lucide-react';
import { cn } from '../../lib/theme';
import {
  type PnlResult,
  type PnlDelta,
  formatCr,
  formatPct,
  formatDeltaCr,
  formatDeltaPp,
} from '../../lib/scenarioEngine';

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

interface PnlCardProps {
  title:       string;
  subtitle?:   string;
  result:      PnlResult;
  delta:       PnlDelta;
  isBase:      boolean;
  isPlaceholder?: boolean;
}

/* ---------------------------------------------------------------------------
   DeltaBadge — coloured pill showing the change vs base case
   --------------------------------------------------------------------------- */

type DeltaDirection = 'positive' | 'negative' | 'neutral';

function getDeltaDirection(value: number, isExpense: boolean): DeltaDirection {
  if (Math.abs(value) < 0.005) return 'neutral';
  if (isExpense) return value > 0 ? 'negative' : 'positive';
  return value > 0 ? 'positive' : 'negative';
}

const DELTA_STYLES: Record<DeltaDirection, { text: string; bg: string; border: string; Icon: React.ElementType }> = {
  positive: { text: '#22C55E', bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.22)',   Icon: TrendingUp   },
  negative: { text: '#EF4444', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.22)',   Icon: TrendingDown },
  neutral:  { text: '#6B7280', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.09)', Icon: Minus        },
};

interface DeltaBadgeProps {
  value:     number;
  formatted: string;
  direction: DeltaDirection;
  size?:     'sm' | 'md';
}

function DeltaBadge({ formatted, direction, size = 'sm' }: DeltaBadgeProps) {
  const s = DELTA_STYLES[direction];
  const isMd = size === 'md';
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={formatted}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3 }}
        transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
        className={cn(
          'inline-flex items-center gap-1 rounded-[6px] border font-semibold leading-none',
          isMd ? 'px-2.5 py-1.5 text-[12.5px]' : 'px-2 py-1 text-[10.5px]',
        )}
        style={{ color: s.text, background: s.bg, border: `1px solid ${s.border}` }}
      >
        <s.Icon
          className={cn('shrink-0', isMd ? 'w-[11px] h-[11px]' : 'w-[9px] h-[9px]')}
          strokeWidth={2.5}
        />
        {formatted}
      </motion.span>
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------------
   PnlRow — single line item in the P&L table
   --------------------------------------------------------------------------- */

interface PnlRowProps {
  label:       string;
  value:       number;
  deltaValue:  number;
  isExpense?:  boolean;
  isSubtotal?: boolean;
  indent?:     boolean;
}

function PnlRow({
  label,
  value,
  deltaValue,
  isExpense  = false,
  isSubtotal = false,
  indent     = false,
}: PnlRowProps) {
  const direction = getDeltaDirection(deltaValue, isExpense);
  const formatted = formatDeltaCr(deltaValue);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-2.5',
        indent && 'pl-4',
        isSubtotal && 'rounded-[8px] px-2',
      )}
      style={isSubtotal ? { background: 'rgba(255,255,255,0.03)' } : undefined}
    >
      <span
        className={cn(
          'text-[13px] leading-none',
          isSubtotal ? 'font-semibold text-[#F5F7FA]' : 'font-medium text-[#A1A8B3]',
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
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            className={cn(
              'text-right leading-none tabular-nums',
              isSubtotal ? 'text-[14px] font-semibold text-[#F5F7FA]' : 'text-[13px] font-medium text-[#F5F7FA]',
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

/* ---------------------------------------------------------------------------
   Divider
   --------------------------------------------------------------------------- */

function Divider() {
  return (
    <div
      className="h-px my-1"
      style={{ background: 'rgba(255,255,255,0.05)' }}
    />
  );
}

/* ---------------------------------------------------------------------------
   PnlCard
   --------------------------------------------------------------------------- */

export function PnlCard({
  title,
  subtitle,
  result,
  delta,
  isBase,
  isPlaceholder = false,
}: PnlCardProps) {
  return (
    <div
      className="relative flex flex-col rounded-[20px] overflow-hidden"
      style={{
        background: '#15171C',
        border:     '1px solid rgba(255,255,255,0.06)',
        boxShadow:  '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
      }}
    >
      {/* Top accent bar — yellow for unhedged, blue for hedged */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] rounded-t-[20px]"
        style={{ background: isPlaceholder ? '#3B82F6' : '#F5D90A' }}
      />

      {/* Header */}
      <div
        className="px-6 pt-6 pb-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">
              {isPlaceholder ? 'Hedged Outcome' : 'Unhedged Outcome'}
            </p>
            <h3 className="text-[17px] font-semibold text-[#F5F7FA] leading-tight">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[12.5px] text-[#6B7280]">{subtitle}</p>
            )}
          </div>

          {isPlaceholder && (
            <div
              className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5"
              style={{
                background: 'rgba(59,130,246,0.10)',
                border:     '1px solid rgba(59,130,246,0.20)',
              }}
            >
              <Lock className="w-[10px] h-[10px]" style={{ color: '#3B82F6' }} strokeWidth={2.2} />
              <span className="text-[10.5px] font-semibold" style={{ color: '#3B82F6' }}>
                Coming Soon
              </span>
            </div>
          )}
        </div>

        {/* Scenario status */}
        <div className="mt-3.5">
          <AnimatePresence mode="wait">
            {isBase ? (
              <motion.div
                key="base"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#22C55E' }} />
                <span className="text-[11.5px] text-[#6B7280]">Showing base case values</span>
              </motion.div>
            ) : (
              <motion.div
                key="stressed"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#F59E0B' }} />
                <span className="text-[11.5px] font-medium" style={{ color: '#F59E0B' }}>
                  Stress scenario applied — delta vs base case shown
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* P&L table */}
      <div className="flex-1 px-6 py-4 space-y-0.5">

        <PnlRow
          label="Revenue"
          value={result.revenue}
          deltaValue={delta.revenue}
        />

        <Divider />

        <PnlRow
          label="Cost of Goods Sold"
          value={result.cogs}
          deltaValue={delta.cogs}
          isExpense
          indent
        />

        <Divider />

        <PnlRow
          label="Gross Profit"
          value={result.grossProfit}
          deltaValue={delta.grossProfit}
          isSubtotal
        />

        <div className="py-1" />

        <PnlRow
          label="SG&A"
          value={result.sga}
          deltaValue={delta.sga}
          isExpense
          indent
        />

        <Divider />
      </div>

      {/* EBITDA — featured section */}
      <div
        className="mx-5 mb-5 rounded-[14px] px-5 py-4"
        style={{
          background: 'rgba(245,217,10,0.05)',
          border:     '1px solid rgba(245,217,10,0.12)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: '#A89208' }}>
              EBITDA
            </p>
            <AnimatePresence mode="wait">
              <motion.p
                key={formatCr(result.ebitda)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                className="text-[26px] font-semibold leading-none tabular-nums"
                style={{
                  color:              '#F5D90A',
                  letterSpacing:      '-0.025em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCr(result.ebitda)}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
            {/* EBITDA delta badge */}
            <DeltaBadge
              value={delta.ebitda}
              formatted={formatDeltaCr(delta.ebitda)}
              direction={getDeltaDirection(delta.ebitda, false)}
              size="md"
            />

            {/* Margin */}
            <div className="flex items-baseline gap-1.5">
              <AnimatePresence mode="wait">
                <motion.span
                  key={formatPct(result.ebitdaMargin)}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className="text-[34px] font-semibold leading-none tabular-nums"
                  style={{ color: '#F5F7FA', letterSpacing: '-0.03em' }}
                >
                  {formatPct(result.ebitdaMargin)}
                </motion.span>
              </AnimatePresence>
              <span className="text-[13px] text-[#6B7280] leading-none">margin</span>
            </div>

            {/* Margin delta */}
            <DeltaBadge
              value={delta.ebitdaMargin}
              formatted={formatDeltaPp(delta.ebitdaMargin)}
              direction={getDeltaDirection(delta.ebitdaMargin, false)}
              size="md"
            />
          </div>
        </div>
      </div>

      {/* Placeholder overlay */}
      {isPlaceholder && (
        <div
          className="absolute inset-0 rounded-[20px] flex items-center justify-center"
          style={{ background: 'rgba(11,11,12,0.55)', backdropFilter: 'blur(2px)' }}
        >
          <div className="text-center space-y-2">
            <Lock className="w-6 h-6 mx-auto" style={{ color: '#3B82F6' }} strokeWidth={1.5} />
            <p className="text-[14px] font-semibold text-[#F5F7FA]">Hedged Analysis</p>
            <p className="text-[12px] text-[#6B7280] max-w-[160px] leading-relaxed mx-auto">
              Hedge comparison will be available in a future release.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
