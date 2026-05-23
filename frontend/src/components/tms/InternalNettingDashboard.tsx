'use client';

import { motion } from 'framer-motion';
import { ArrowRight, BarChart3, Clock, DollarSign, Zap } from 'lucide-react';
import { TreasuryKpiRow }  from './TreasuryKpiRow';
import { NettingTable }    from './NettingTable';
import { SettlementFlow }  from './SettlementFlow';
import { TreasuryInsights } from './TreasuryInsights';

/* ---------------------------------------------------------------------------
   Optimization comparison panel
   --------------------------------------------------------------------------- */

interface OptimMetric {
  label:  string;
  before: string;
  after:  string;
  icon:   React.ElementType;
  delta:  string;
}

const OPTIM_METRICS: OptimMetric[] = [
  { label: 'External FX Conversions', before: '14',        after: '5',         icon: ArrowRight,  delta: '−64%'   },
  { label: 'Bank Fees (₹ Cr)',        before: '₹9.4 Cr',  after: '₹3.1 Cr',  icon: DollarSign,  delta: '−67%'   },
  { label: 'Settlement Time',          before: '3 Days',   after: '4 Hours',   icon: Clock,       delta: '−94%'   },
  { label: 'Liquidity Efficiency',     before: '62%',      after: '91%',       icon: BarChart3,   delta: '+47%'   },
];

function OptimizationPanel() {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid #E5E5E3', background: '#FAFAF8' }}
      >
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.15em]" style={{ color: '#888888' }}>
            Netting Impact Analysis
          </p>
          <p className="text-[15px] font-semibold mt-0.5" style={{ color: '#111111' }}>
            Treasury Optimization Result
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-[11px] font-bold uppercase tracking-[0.07em]"
            style={{ background: 'rgba(255,230,0,0.15)', color: '#967A00', border: '1px solid rgba(255,230,0,0.30)' }}
          >
            <Zap className="w-[11px] h-[11px]" strokeWidth={2.5} />
            Netting Engine Active
          </div>
        </div>
      </div>

      {/* Column labels */}
      <div
        className="grid grid-cols-[2fr_1fr_1fr_1fr] px-6 py-2.5 gap-6"
        style={{ borderBottom: '1px solid #F0F0EE' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: '#BBBBBB' }}>Metric</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: '#888888' }}>Before Netting</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: '#888888' }}>After Netting</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: '#888888' }}>Improvement</span>
      </div>

      {/* Rows */}
      {OPTIM_METRICS.map((m, i) => {
        const Icon     = m.icon;
        const improve  = m.delta.startsWith('+') ? false : true;
        const deltaClr = m.label === 'Liquidity Efficiency' ? '#15803D' : '#15803D';

        return (
          <motion.div
            key={m.label}
            className="grid grid-cols-[2fr_1fr_1fr_1fr] px-6 py-4 gap-6 items-center hover:bg-[#FAFAF8] transition-colors duration-100"
            style={i < OPTIM_METRICS.length - 1 ? { borderBottom: '1px solid #F7F7F5' } : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.1 + i * 0.07 }}
          >
            {/* Label */}
            <div className="flex items-center gap-3">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px]"
                style={{ background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.28)' }}
              >
                <Icon className="w-[13px] h-[13px]" style={{ color: '#967A00' }} strokeWidth={2} />
              </div>
              <span className="text-[13px] font-medium" style={{ color: '#333333' }}>{m.label}</span>
            </div>

            {/* Before */}
            <span
              className="text-[13.5px] font-semibold tabular-nums"
              style={{ color: '#888888', fontVariantNumeric: 'tabular-nums', textDecoration: 'line-through' }}
            >
              {m.before}
            </span>

            {/* After */}
            <span
              className="text-[14px] font-bold tabular-nums"
              style={{ color: '#111111', fontVariantNumeric: 'tabular-nums' }}
            >
              {m.after}
            </span>

            {/* Delta */}
            <span
              className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-1 rounded-[3px]"
              style={{
                color:      deltaClr,
                background: 'rgba(22,163,74,0.08)',
                border:     '1px solid rgba(22,163,74,0.20)',
              }}
            >
              {m.delta}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   InternalNettingDashboard
   --------------------------------------------------------------------------- */

export function InternalNettingDashboard() {
  return (
    <motion.div
      key="internal"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.26, ease: [0.2, 0, 0, 1] }}
      className="space-y-6"
    >
      {/* KPI row */}
      <TreasuryKpiRow variant="internal" />

      {/* Subsidiary netting table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.15em]" style={{ color: '#888888' }}>
              Intercompany Positions
            </p>
            <p className="text-[16px] font-semibold" style={{ color: '#111111' }}>
              Subsidiary Netting Register
            </p>
          </div>
          <span
            className="text-[11px] font-bold uppercase tracking-[0.07em] px-3 py-1.5 rounded-[4px]"
            style={{ background: '#F0F0EE', color: '#555555', border: '1px solid #D8D8D8' }}
          >
            3 Entities · Netting Cycle T+0
          </span>
        </div>
        <NettingTable />
      </section>

      {/* Flow + Insights */}
      <div className="grid grid-cols-[1fr_340px] gap-5 items-stretch">
        <SettlementFlow />
        <TreasuryInsights variant="internal" />
      </div>

      {/* Optimization comparison */}
      <OptimizationPanel />
    </motion.div>
  );
}
