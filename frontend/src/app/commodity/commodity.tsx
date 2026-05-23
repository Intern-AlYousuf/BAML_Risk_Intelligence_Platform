'use client';

/**
 * commodity.tsx — Commodity Volatility Models page
 * Bloomberg-style institutional procurement volatility workstation.
 */

import { useState }         from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart2, Cpu }   from 'lucide-react';
import { AppShell }         from '../../components/layout/AppShell';
import { PageContainer }    from '../../components/layout/PageContainer';
import { CommoditySubTabs, type CommodityTab } from '../../components/commodity/CommoditySubTabs';
import { VolatilityDashboard } from '../../components/commodity/VolatilityDashboard';

/* ── Header timestamp ── */
function DataStamp() {
  return (
    <div className="flex items-center gap-4 shrink-0">
      {/* LIVE chip */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-[4px]"
        style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
      >
        <span className="h-[6px] w-[6px] rounded-full bg-[#16A34A] animate-pulse" />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.09em]" style={{ color: '#333333' }}>
          LIVE
        </span>
      </div>
      {/* Model badge */}
      <span
        className="inline-flex items-center px-3 py-1.5 rounded-[4px] text-[10.5px] font-black uppercase tracking-[0.10em]"
        style={{
          background: 'rgba(255,230,0,0.12)',
          color:      '#967A00',
          border:     '1px solid rgba(255,230,0,0.35)',
        }}
      >
        GARCH(1,1)
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export function CommodityPage() {
  const [activeTab, setActiveTab] = useState<CommodityTab>('iron_ore');

  return (
    <AppShell breadcrumb={['Analytics', 'Commodity Volatility Models']}>
      <PageContainer size="wide">

        {/* ── Page header ── */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
        >
          {/* Eyebrow */}
          <div className="flex items-center gap-2.5 mb-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[5px]"
              style={{ background: 'rgba(255,230,0,0.20)', border: '1px solid rgba(255,230,0,0.38)' }}
            >
              <BarChart2 className="w-[15px] h-[15px]" style={{ color: '#967A00' }} strokeWidth={2} />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-[0.20em]" style={{ color: '#888888' }}>
              Commodity Risk · GARCH Volatility Engine
            </span>
          </div>

          {/* Title row */}
          <div className="flex items-end justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1
                  className="font-bold leading-none"
                  style={{ fontSize: '32px', letterSpacing: '-0.025em', color: '#111111' }}
                >
                  Commodity Volatility Models
                </h1>
              </div>
              <p className="text-[15px] leading-none" style={{ color: '#555555' }}>
                GARCH-based procurement volatility analytics · Institutional commodity risk monitoring
              </p>
            </div>

            <DataStamp />
          </div>
        </motion.div>

        {/* ── Sub-tabs ── */}
        <motion.div
          className="mb-7"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.2, 0, 0, 1], delay: 0.08 }}
        >
          <CommoditySubTabs activeTab={activeTab} onChange={setActiveTab} />
        </motion.div>

        {/* ── Dashboard content ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          >
            <VolatilityDashboard commodityId={activeTab} />
          </motion.div>
        </AnimatePresence>

        {/* ── Footer note ── */}
        <motion.div
          className="mt-10 pt-6"
          style={{ borderTop: '1px solid #E5E5E3' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          <div className="flex items-center gap-2.5">
            <Cpu className="w-[12px] h-[12px]" style={{ color: '#BBBBBB' }} strokeWidth={1.5} />
            <p className="text-[11px]" style={{ color: '#BBBBBB' }}>
              All calculations are performed client-side using historical local CSV datasets. No live market data feeds.
              GARCH(1,1) model — for institutional procurement risk reference only. Not investment advice.
            </p>
          </div>
        </motion.div>

      </PageContainer>
    </AppShell>
  );
}
