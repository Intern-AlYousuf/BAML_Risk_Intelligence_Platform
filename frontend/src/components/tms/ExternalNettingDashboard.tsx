'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Clock, CheckCircle2, AlertTriangle, TrendingUp,
  Zap, Shield, ArrowRight, Globe2, Info,
  Layers, GitMerge, FileText,
} from 'lucide-react';
import { StatCard } from '../cards/StatCard';
import { Badge }           from '../ui/badge';
import { cn }              from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Shared status map
   --------------------------------------------------------------------------- */

const STATUS_MAP: Record<string, { variant: 'warning' | 'success' | 'neutral' | 'info' | 'danger'; label: string }> = {
  pending:       { variant: 'warning', label: 'Pending'        },
  approved:      { variant: 'success', label: 'Approved'       },
  stable:        { variant: 'neutral', label: 'Stable'         },
  processing:    { variant: 'info',    label: 'Processing'     },
  completed:     { variant: 'success', label: 'Completed'      },
  matched:       { variant: 'success', label: 'Matched'        },
  nettable:      { variant: 'info',    label: 'Nettable'       },
  requires_hedge:{ variant: 'danger',  label: 'Requires Hedge' },
};

/* ---------------------------------------------------------------------------
   Strategy tooltip component
   --------------------------------------------------------------------------- */

function StrategyCell({ action, tooltip }: { action: string; tooltip: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold cursor-default"
        style={{ color: '#111111' }}
      >
        {action}
        <Info
          className="w-[11px] h-[11px] shrink-0"
          style={{ color: '#BBBBBB' }}
          strokeWidth={1.75}
        />
      </span>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 2, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
            className="absolute z-30 left-0 top-full mt-2 w-[240px] rounded-[6px] px-3.5 py-2.5"
            style={{
              background:  '#FFFFFF',
              border:      '1px solid #D8D8D8',
              boxShadow:   '0 4px 16px rgba(0,0,0,0.12)',
            }}
          >
            <p
              className="text-[11.5px] leading-snug"
              style={{ color: '#444444', fontStyle: 'italic' }}
            >
              {tooltip}
            </p>
            <div
              className="absolute -top-[5px] left-3 h-[8px] w-[8px] rotate-45"
              style={{ background: '#FFFFFF', borderTop: '1px solid #D8D8D8', borderLeft: '1px solid #D8D8D8' }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   External position table — advanced derivative strategies
   --------------------------------------------------------------------------- */

interface ExternalRow {
  currency: string;
  exposure: string;
  action:   string;
  tooltip:  string;
  status:   'pending' | 'approved' | 'processing';
}

const EXTERNAL_ROWS: ExternalRow[] = [
  {
    currency: 'USD',
    exposure: '−$41M',
    action:   'Iron Condor',
    tooltip:  'Neutral volatility strategy designed for stable FX ranges. Combines a bull put spread and bear call spread to collect premium in low-volatility environments.',
    status:   'approved',
  },
  {
    currency: 'USD',
    exposure: '−$52M',
    action:   'Long Seagull Strategy',
    tooltip:  'Zero-cost collar variation with capped upside participation. Provides asymmetric downside protection with controlled premium exposure, commonly used for INR depreciation hedging.',
    status:   'processing',
  },
  {
    currency: 'USD',
    exposure: '−$37M',
    action:   'Ratio Backspread',
    tooltip:  'Convex hedge structure benefiting from sharp directional moves. Provides tail-risk protection with net premium credit, suitable for volatile USD/INR regimes.',
    status:   'pending',
  },
];

const COL_EXT = 'grid grid-cols-[100px_200px_1fr_130px]';

function ExternalTable() {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Header */}
      <div
        className={cn(COL_EXT, 'px-6 py-3 gap-6 items-center')}
        style={{ background: '#F7F7F5', borderBottom: '1px solid #D8D8D8' }}
      >
        {['Currency', 'Residual Exposure', 'Recommended Action', 'Status'].map((h) => (
          <span key={h} className="text-[10.5px] font-bold uppercase tracking-[0.13em]" style={{ color: '#888888' }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {EXTERNAL_ROWS.map((row, i) => {
        const st = STATUS_MAP[row.status];
        return (
          <motion.div
            key={`ext-${i}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: i * 0.08 }}
            className={cn(COL_EXT, 'px-6 py-4 gap-6 items-center hover:bg-[#FAFAF8] transition-colors duration-100')}
            style={i < EXTERNAL_ROWS.length - 1 ? { borderBottom: '1px solid #F0F0EE' } : undefined}
          >
            {/* Currency */}
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-[3px] text-[12px] font-black tracking-[0.08em]"
              style={{ background: 'rgba(255,230,0,0.15)', color: '#967A00', border: '1px solid rgba(255,230,0,0.28)' }}
            >
              {row.currency}
            </span>

            {/* Exposure */}
            <span
              className="text-[14px] font-bold tabular-nums"
              style={{ color: '#B91C1C', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1', letterSpacing: '-0.01em' }}
            >
              {row.exposure}
            </span>

            {/* Action + tooltip */}
            <StrategyCell action={row.action} tooltip={row.tooltip} />

            {/* Status */}
            <Badge variant={st.variant as 'warning' | 'success' | 'info'} size="sm" dot pulseDot={row.status === 'processing'}>
              {st.label}
            </Badge>
          </motion.div>
        );
      })}

      {/* Footer */}
      <div
        className={cn(COL_EXT, 'px-6 py-3 gap-6 items-center')}
        style={{ background: '#F7F7F5', borderTop: '1px solid #D8D8D8' }}
      >
        <span className="text-[10.5px] font-bold uppercase tracking-[0.10em]" style={{ color: '#888888' }}>
          Total
        </span>
        <span
          className="text-[13px] font-bold tabular-nums"
          style={{ color: '#B91C1C', fontVariantNumeric: 'tabular-nums' }}
        >
          −$130M
        </span>
        <span className="text-[11.5px]" style={{ color: '#888888' }}>3 derivative structures active</span>
        <Badge variant="warning" size="sm" dot>1 Pending</Badge>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Bilateral netting KPI mini-cards
   --------------------------------------------------------------------------- */

function BilateralKpiRow() {
  const cards = [
    { label: 'Gross Payables',             value: '$43.5M', signal: 'negative' as const, accent: 'red'    as const },
    { label: 'Gross Receivables',          value: '$59.3M', signal: 'positive' as const, accent: 'green'  as const },
    { label: 'Net Bilateral Exposure',     value: '−$15.8M',signal: 'warning'  as const, accent: 'amber'  as const },
    { label: 'Internal Compression Ratio', value: '63%',    signal: 'positive' as const, accent: 'yellow' as const },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: i * 0.06 }}
          whileHover={{ y: -2 }}
        >
          <StatCard
            label={c.label}
            value={c.value}
            accent={c.accent}
            signal={c.signal}
            size="sm"
          />
        </motion.div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Bilateral netting ledger table
   --------------------------------------------------------------------------- */

interface BilateralRow {
  counterparty: string;
  invoiceRef:   string;
  receivable:   string;
  payable:      string;
  netAmount:    string;
  netPositive:  boolean;
  currency:     string;
  settlStatus:  'matched' | 'pending' | 'requires_hedge' | 'nettable';
}

const BILATERAL_ROWS: BilateralRow[] = [
  {
    counterparty: 'Bechtel Infrastructure LLC (USA)',
    invoiceRef:   'INF-2041-US',
    receivable:   '$18.4M',
    payable:      '$6.2M',
    netAmount:    '+$12.2M',
    netPositive:  true,
    currency:     'USD',
    settlStatus:  'matched',
  },
  {
    counterparty: 'Siemens Energy GmbH (Germany)',
    invoiceRef:   'ENG-1182-DE',
    receivable:   '$9.1M',
    payable:      '$14.8M',
    netAmount:    '−$5.7M',
    netPositive:  false,
    currency:     'USD',
    settlStatus:  'pending',
  },
  {
    counterparty: 'Fluor Corporation (USA)',
    invoiceRef:   'MAT-8821-US',
    receivable:   '$0',
    payable:      '$22.5M',
    netAmount:    '−$22.5M',
    netPositive:  false,
    currency:     'USD',
    settlStatus:  'requires_hedge',
  },
  {
    counterparty: 'VINCI Construction SA (France)',
    invoiceRef:   'EXP-5510-FR',
    receivable:   '$31.8M',
    payable:      '$0',
    netAmount:    '+$31.8M',
    netPositive:  true,
    currency:     'USD',
    settlStatus:  'nettable',
  },
];

const COL_BIL = 'grid grid-cols-[1fr_120px_110px_110px_120px_80px_140px]';

function BilateralLedgerTable() {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Column header */}
      <div
        className={cn(COL_BIL, 'px-5 py-2.5 gap-3 items-center')}
        style={{ background: '#F7F7F5', borderBottom: '1px solid #D8D8D8' }}
      >
        {['Counterparty', 'Invoice Ref', 'Receivable', 'Payable', 'Net Amount', 'CCY', 'Settlement Status'].map((h) => (
          <span key={h} className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: '#888888' }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {BILATERAL_ROWS.map((row, i) => {
        const st = STATUS_MAP[row.settlStatus];
        return (
          <motion.div
            key={row.invoiceRef}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1], delay: 0.06 + i * 0.06 }}
            className={cn(COL_BIL, 'px-5 py-3.5 gap-3 items-center hover:bg-[#FAFAF8] transition-colors duration-100')}
            style={i < BILATERAL_ROWS.length - 1 ? { borderBottom: '1px solid #F0F0EE' } : undefined}
          >
            {/* Counterparty */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-black"
                style={{ background: 'rgba(255,230,0,0.14)', color: '#967A00', border: '1px solid rgba(255,230,0,0.28)' }}
              >
                {row.counterparty.slice(0, 2).toUpperCase()}
              </div>
              <span className="truncate text-[12.5px] font-semibold" style={{ color: '#111111' }}>
                {row.counterparty}
              </span>
            </div>

            {/* Invoice ref */}
            <span
              className="text-[11px] font-mono font-semibold tracking-[0.04em]"
              style={{ color: '#888888' }}
            >
              {row.invoiceRef}
            </span>

            {/* Receivable */}
            <span
              className="text-[12.5px] font-semibold tabular-nums"
              style={{ color: row.receivable === '$0' ? '#BBBBBB' : '#15803D', fontVariantNumeric: 'tabular-nums' }}
            >
              {row.receivable}
            </span>

            {/* Payable */}
            <span
              className="text-[12.5px] font-semibold tabular-nums"
              style={{ color: row.payable === '$0' ? '#BBBBBB' : '#DC2626', fontVariantNumeric: 'tabular-nums' }}
            >
              {row.payable}
            </span>

            {/* Net amount */}
            <span
              className="text-[13px] font-bold tabular-nums"
              style={{
                color:               row.netPositive ? '#15803D' : '#B91C1C',
                fontVariantNumeric:  'tabular-nums',
                fontFeatureSettings: '"tnum" 1',
              }}
            >
              {row.netAmount}
            </span>

            {/* Currency */}
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-black tracking-[0.06em]"
              style={{ background: '#F0F0EE', color: '#555555', border: '1px solid #D8D8D8' }}
            >
              {row.currency}
            </span>

            {/* Status */}
            <Badge variant={st.variant as 'warning' | 'success' | 'info' | 'neutral' | 'danger'} size="sm" dot>
              {st.label}
            </Badge>
          </motion.div>
        );
      })}

      {/* Summary footer */}
      <div
        className={cn(COL_BIL, 'px-5 py-3 gap-3 items-center')}
        style={{ background: '#F7F7F5', borderTop: '1px solid #D8D8D8' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: '#888888' }}>Ledger Total</span>
        <span />
        <span className="text-[12.5px] font-bold tabular-nums" style={{ color: '#15803D' }}>$59.3M</span>
        <span className="text-[12.5px] font-bold tabular-nums" style={{ color: '#DC2626' }}>$43.5M</span>
        <span className="text-[13px] font-bold tabular-nums" style={{ color: '#111111' }}>+$15.8M</span>
        <span />
        <Badge variant="info" size="sm" dot>4 Entries</Badge>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Pre-Hedge Netting Workflow explanation panel
   --------------------------------------------------------------------------- */

function PreHedgeWorkflowPanel() {
  const steps = [
    {
      step:  '01',
      title: 'Receivable / Payable Compression',
      body:  'Before entering external derivative contracts, treasury operations first compress reciprocal receivables and payables through bilateral settlement matching. This reduces gross notional and minimises counterparty settlement volume.',
    },
    {
      step:  '02',
      title: 'Residual Identification',
      body:  'This reduces gross notional exposure, minimises settlement friction, and lowers downstream hedge execution costs. Only residual unmatched balances are eligible for external bank execution.',
    },
    {
      step:  '03',
      title: 'External Hedge Deployment',
      body:  'Residual unmatched positions after bilateral compression are routed to external derivative structures. Operational efficiency improvements lower liquidity usage and reduce counterparty credit exposure.',
    },
  ];

  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden h-full"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid #E5E5E3', background: '#FAFAF8' }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px]"
          style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.20)' }}
        >
          <GitMerge className="w-[14px] h-[14px]" style={{ color: '#1D4ED8' }} strokeWidth={2} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: '#888888' }}>
            Treasury Operations
          </p>
          <p className="text-[14px] font-bold leading-none mt-0.5" style={{ color: '#111111' }}>
            Pre-Hedge Netting Workflow
          </p>
        </div>
      </div>

      {/* Steps */}
      <div className="flex-1 px-5 py-5 space-y-5">
        {steps.map((s, i) => (
          <motion.div
            key={s.step}
            className="flex gap-3.5"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1], delay: 0.12 + i * 0.09 }}
          >
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black mt-0.5"
              style={{ background: 'rgba(37,99,235,0.10)', color: '#1D4ED8', border: '1px solid rgba(37,99,235,0.22)' }}
            >
              {s.step}
            </div>
            <div className="space-y-1">
              <p className="text-[12.5px] font-bold leading-none" style={{ color: '#111111' }}>
                {s.title}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: '#666666' }}>
                {s.body}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="px-5 py-3 flex items-center gap-1.5"
        style={{ borderTop: '1px solid #F0F0EE' }}
      >
        <FileText className="w-[11px] h-[11px] shrink-0" style={{ color: '#BBBBBB' }} strokeWidth={1.5} />
        <span className="text-[10.5px]" style={{ color: '#BBBBBB' }}>
          ISDA/IFEMA bilateral netting framework — Simulated
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Treasury Execution Panel
   --------------------------------------------------------------------------- */

function TreasuryExecutionPanel() {
  const points = [
    {
      icon:  ArrowRight,
      title: 'Post-Netting Residual Management',
      body:  'Internal netting materially reduced gross FX settlement requirements, allowing treasury to minimise external market execution and optimise advanced derivative deployment across counterparty banks.',
    },
    {
      icon:  Globe2,
      title: 'Derivative Strategy Selection',
      body:  'Residual USD exposures are structured through Iron Condor, Long Seagull, and Ratio Backspread instruments — selected based on current implied volatility levels and USD/INR directional outlook.',
    },
    {
      icon:  Shield,
      title: 'Volatility-Adaptive Execution',
      body:  'Strategy selection dynamically adapts to the prevailing FX volatility regime. Low-volatility environments favour Iron Condor premium collection; high-volatility events trigger Ratio Backspread convex structures.',
    },
  ];

  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid #E5E5E3', background: '#FAFAF8' }}
      >
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.15em]" style={{ color: '#888888' }}>
            Bank Execution Strategy
          </p>
          <p className="text-[15px] font-semibold mt-0.5" style={{ color: '#111111' }}>
            External Treasury Execution
          </p>
        </div>
        <span
          className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] px-3 py-1.5 rounded-[4px]"
          style={{ background: 'rgba(255,230,0,0.12)', color: '#967A00', border: '1px solid rgba(255,230,0,0.30)' }}
        >
          <Zap className="w-[11px] h-[11px]" strokeWidth={2.5} />
          Execution Active
        </span>
      </div>

      {/* Body */}
      <div className="px-6 py-5 space-y-5">
        {points.map((pt, i) => {
          const Icon = pt.icon;
          return (
            <motion.div
              key={pt.title}
              className="flex gap-4"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: 0.08 + i * 0.09 }}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] mt-0.5"
                style={{ background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.28)' }}
              >
                <Icon className="w-[14px] h-[14px]" style={{ color: '#967A00' }} strokeWidth={2} />
              </div>
              <div className="space-y-1">
                <p className="text-[13px] font-bold leading-none" style={{ color: '#111111' }}>
                  {pt.title}
                </p>
                <p className="text-[12.5px] leading-relaxed" style={{ color: '#555555' }}>
                  {pt.body}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Treasury Intelligence Engine
   --------------------------------------------------------------------------- */

interface Recommendation {
  icon:  React.ElementType;
  text:  string;
  level: 'high' | 'medium' | 'low';
}

const RECOMMENDATIONS: Recommendation[] = [
  { icon: AlertTriangle, text: 'Internal liquidity matching reduced external FX dependency by approximately 62%. India HQ surplus capacity remains the primary offset mechanism.',              level: 'high'   },
  { icon: CheckCircle2,  text: 'Treasury HQ retains sufficient USD surplus capacity to absorb short-term subsidiary deficits without triggering additional external hedge instruments.',          level: 'low'    },
  { icon: TrendingUp,    text: 'Rolling hedge structures recommended under elevated FX volatility — current 30-day implied volatility is trending above the 60-day average.',                  level: 'high'   },
  { icon: Shield,        text: 'Forward execution laddering is advised to reduce concentration risk. Stagger USD derivative purchases across 30/60/90-day tenors.',                            level: 'medium' },
  { icon: Zap,           text: 'Vietnam exposure remains moderately sensitive to USD strength. A 2% USD appreciation would increase Vietnam deficit by approximately $1.4M.',                  level: 'medium' },
];

const LEVEL_STYLE: Record<string, { color: string; bg: string; border: string; label: string }> = {
  high:   { color: '#B91C1C', bg: 'rgba(220,38,38,0.07)',  border: 'rgba(220,38,38,0.20)',  label: 'HIGH'  },
  medium: { color: '#B45309', bg: 'rgba(217,119,6,0.07)',  border: 'rgba(217,119,6,0.20)',  label: 'MED'   },
  low:    { color: '#15803D', bg: 'rgba(22,163,74,0.07)',  border: 'rgba(22,163,74,0.20)',  label: 'LOW'   },
};

function TreasuryIntelligenceCard() {
  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid #E5E5E3', background: '#FAFAF8' }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px]"
          style={{ background: 'rgba(255,230,0,0.18)', border: '1px solid rgba(255,230,0,0.32)' }}
        >
          <Cpu className="w-[15px] h-[15px]" style={{ color: '#967A00' }} strokeWidth={2} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: '#888888' }}>
            Quantitative Analytics
          </p>
          <p className="text-[14.5px] font-bold leading-none mt-0.5" style={{ color: '#111111' }}>
            Treasury Intelligence Engine
          </p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {RECOMMENDATIONS.map((rec, i) => {
          const style = LEVEL_STYLE[rec.level];
          const Icon  = rec.icon;
          return (
            <motion.div
              key={i}
              className="flex gap-3"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: 0.1 + i * 0.08 }}
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] mt-0.5"
                style={{ background: style.bg, border: `1px solid ${style.border}` }}
              >
                <Icon className="w-[11px] h-[11px]" style={{ color: style.color }} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-[12.5px] leading-snug" style={{ color: '#333333' }}>
                  {rec.text}
                </p>
                <span
                  className="inline-block text-[9.5px] font-black uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-[2px]"
                  style={{ background: style.bg, color: style.color }}
                >
                  {style.label} PRIORITY
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="px-5 py-3" style={{ borderTop: '1px solid #F0F0EE' }}>
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#BBBBBB' }}>
          <span className="h-[5px] w-[5px] rounded-full bg-[#16A34A] animate-pulse" />
          Simulated intelligence — T+0 cycle
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Settlement queue
   --------------------------------------------------------------------------- */

interface QueueItem {
  txnId:       string;
  transaction: string;
  type:        string;
  amount:      string;
  status:      'pending' | 'completed' | 'processing' | 'approved';
}

const QUEUE: QueueItem[] = [
  { txnId: 'TXN-1042', transaction: 'USD Iron Condor Hedge',    type: 'Options Structure',  amount: '$41M', status: 'approved'   },
  { txnId: 'TXN-1043', transaction: 'USD Long Seagull',        type: 'Collar + Call Spread',amount: '$52M', status: 'processing' },
  { txnId: 'TXN-1044', transaction: 'Vietnam Ratio Backspread', type: 'Vol Expansion',       amount: '$37M', status: 'pending'    },
];

const QUEUE_COL = 'grid grid-cols-[80px_1fr_150px_75px_110px]';

function SettlementQueue() {
  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid #E5E5E3', background: '#FAFAF8' }}
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: '#888888' }}>
            Execution Pipeline
          </p>
          <p className="text-[14.5px] font-bold leading-none mt-0.5" style={{ color: '#111111' }}>
            Settlement Queue
          </p>
        </div>
        <span
          className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] px-2.5 py-1.5 rounded-[4px]"
          style={{ background: 'rgba(37,99,235,0.08)', color: '#1D4ED8', border: '1px solid rgba(37,99,235,0.20)' }}
        >
          <span className="h-[5px] w-[5px] rounded-full bg-[#2563EB] animate-pulse" />
          3 Active
        </span>
      </div>

      <div
        className={cn(QUEUE_COL, 'px-5 py-2.5 gap-3')}
        style={{ background: '#F7F7F5', borderBottom: '1px solid #E5E5E3' }}
      >
        {['Txn ID', 'Transaction', 'Type', 'Notional', 'Status'].map((h) => (
          <span key={h} className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: '#BBBBBB' }}>
            {h}
          </span>
        ))}
      </div>

      {QUEUE.map((item, i) => {
        const st = STATUS_MAP[item.status];
        return (
          <motion.div
            key={item.txnId}
            className={cn(QUEUE_COL, 'px-5 py-3.5 gap-3 items-center hover:bg-[#FAFAF8] transition-colors duration-100')}
            style={i < QUEUE.length - 1 ? { borderBottom: '1px solid #F5F5F3' } : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.05 + i * 0.08 }}
          >
            <span className="text-[10.5px] font-bold tracking-[0.04em]" style={{ color: '#888888', fontVariantNumeric: 'tabular-nums' }}>
              {item.txnId}
            </span>
            <span className="text-[12.5px] font-semibold truncate" style={{ color: '#111111' }}>
              {item.transaction}
            </span>
            <span className="text-[11.5px]" style={{ color: '#555555' }}>
              {item.type}
            </span>
            <span className="text-[12.5px] font-bold tabular-nums" style={{ color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
              {item.amount}
            </span>
            <Badge variant={st.variant as 'warning' | 'success' | 'info'} size="sm" dot pulseDot={item.status === 'processing'}>
              {st.label}
            </Badge>
          </motion.div>
        );
      })}

      <div className="px-5 py-3 flex items-center gap-1.5" style={{ borderTop: '1px solid #F0F0EE' }}>
        <Clock className="w-[11px] h-[11px] shrink-0" style={{ color: '#BBBBBB' }} strokeWidth={1.5} />
        <span className="text-[10.5px]" style={{ color: '#BBBBBB' }}>
          Queue last updated: T+0 · Simulated environment
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ExternalNettingDashboard — composed layout
   --------------------------------------------------------------------------- */

export function ExternalNettingDashboard() {
  return (
    <motion.div
      key="external"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.26, ease: [0.2, 0, 0, 1] }}
      className="space-y-7"
    >
      {/* ── Bilateral Netting Ledger section ── */}
      <section className="space-y-4">
        {/* Section header */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.15em]" style={{ color: '#888888' }}>
              Pre-Execution Compression
            </p>
            <p className="text-[16px] font-semibold" style={{ color: '#111111' }}>
              Bilateral Netting Ledger
            </p>
            <p className="text-[12.5px] mt-0.5" style={{ color: '#888888' }}>
              Counterparty-level receivable / payable compression before external hedge execution
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] px-3 py-1.5 rounded-[4px]"
              style={{ background: 'rgba(37,99,235,0.07)', color: '#1D4ED8', border: '1px solid rgba(37,99,235,0.18)' }}
            >
              <Layers className="w-[11px] h-[11px]" strokeWidth={2} />
              4 Ledger Entries
            </span>
          </div>
        </div>

        {/* Bilateral mini KPI cards */}
        <BilateralKpiRow />

        {/* Table + workflow panel side by side */}
        <div className="grid grid-cols-[1fr_300px] gap-5 items-stretch">
          <BilateralLedgerTable />
          <PreHedgeWorkflowPanel />
        </div>
      </section>

      {/* ── External FX Position Register ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.15em]" style={{ color: '#888888' }}>
              Post-Bilateral Residual Exposure
            </p>
            <p className="text-[16px] font-semibold" style={{ color: '#111111' }}>
              External FX Position Register
            </p>
          </div>
          <span
            className="text-[11px] font-bold uppercase tracking-[0.07em] px-3 py-1.5 rounded-[4px]"
            style={{ background: 'rgba(37,99,235,0.08)', color: '#1D4ED8', border: '1px solid rgba(37,99,235,0.20)' }}
          >
            Advanced Derivatives · USD Residuals
          </span>
        </div>
        <ExternalTable />
      </section>

      {/* Execution strategy panel — full width */}
      <TreasuryExecutionPanel />

      {/* Intelligence + Queue */}
      <div className="grid grid-cols-[1fr_380px] gap-5 items-start">
        <TreasuryIntelligenceCard />
        <SettlementQueue />
      </div>
    </motion.div>
  );
}
