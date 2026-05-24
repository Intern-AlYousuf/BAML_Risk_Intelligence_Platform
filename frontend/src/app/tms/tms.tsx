'use client';

import { useState }  from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Globe2, Activity, Shield, AlertTriangle } from 'lucide-react';
import { AppShell }      from '../../components/layout/AppShell';
import { PageContainer } from '../../components/layout/PageContainer';
import { TmsSubTabs, type TmsTab } from '../../components/tms/TmsSubTabs';
import { InternalNettingDashboard } from '../../components/tms/InternalNettingDashboard';
import { ExternalNettingDashboard } from '../../components/tms/ExternalNettingDashboard';

/* ---------------------------------------------------------------------------
   Status bar — always visible at top of page
   --------------------------------------------------------------------------- */

function TmsStatusBar() {
  const items = [
    { icon: Activity, label: 'Netting Engine',   value: 'ACTIVE',     color: '#16A34A' },
    { icon: Globe2,   label: 'Netting Cycle',    value: 'T+0 Daily',  color: '#2563EB' },
    { icon: Shield,   label: 'Entities',         value: '3 Live',     color: '#967A00' },
    { icon: Network,  label: 'Settlement Status',value: 'On Track',   color: '#16A34A' },
  ];

  return (
    <div
      className="flex items-center gap-0 rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex items-center gap-3 px-5 py-3 flex-1"
            style={i < items.length - 1 ? { borderRight: '1px solid #E5E5E3' } : undefined}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px]"
              style={{ background: `${item.color}18`, border: `1px solid ${item.color}33` }}
            >
              <Icon className="w-[13px] h-[13px]" style={{ color: item.color }} strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: '#888888' }}>
                {item.label}
              </span>
              <span className="text-[12.5px] font-bold leading-none" style={{ color: '#111111' }}>
                {item.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   TmsPage
   --------------------------------------------------------------------------- */

export function TmsPage() {
  const [activeTab, setActiveTab] = useState<TmsTab>('internal');

  return (
    <AppShell breadcrumb={['Treasury', 'Netting TMS']}>
      <PageContainer size="wide">

        {/* Page header */}
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
              <Network className="w-[15px] h-[15px]" style={{ color: '#967A00' }} strokeWidth={2} />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-[0.20em]" style={{ color: '#888888' }}>
              Enterprise Treasury · TMS Platform
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
                  Netting Treasury Management System
                </h1>
                {/* Mock environment badge */}
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[10px] font-bold uppercase tracking-[0.10em] shrink-0"
                  style={{
                    background:  'rgba(255,230,0,0.10)',
                    color:       '#967A00',
                    border:      '1px solid rgba(255,230,0,0.38)',
                    marginBottom: '2px',
                  }}
                >
                  <span className="h-[4px] w-[4px] rounded-full" style={{ background: '#C9A800' }} />
                  Mock TMS Environment
                </span>
              </div>
              <p className="text-[15px] leading-none" style={{ color: '#555555' }}>
                Enterprise FX netting, settlement optimization, and treasury liquidity management
              </p>
            </div>

          </div>
        </motion.div>

        {/* ── Prominent disclaimer banner ── */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0, 0, 1], delay: 0.05 }}
        >
          <div
            className="flex items-start gap-4 rounded-[8px] px-5 py-4"
            style={{
              background:   'rgba(255,230,0,0.10)',
              border:       '1px solid rgba(255,230,0,0.40)',
              borderLeft:   '4px solid #C9A800',
            }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] mt-0.5"
              style={{ background: 'rgba(255,230,0,0.22)', border: '1px solid rgba(201,168,0,0.40)' }}
            >
              <AlertTriangle className="w-[15px] h-[15px]" style={{ color: '#967A00' }} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-[13px] font-bold leading-snug" style={{ color: '#5C4600' }}>
                Mock Treasury Management Environment — All entities, exposures, counterparties, and transaction values shown are fictional and created solely for treasury workflow demonstration purposes.
              </p>
              <p className="text-[12px] leading-snug" style={{ color: '#967A00' }}>
                No live bank connectivity or production settlement infrastructure is involved. This environment simulates enterprise treasury operations for demonstration only.
              </p>
            </div>
            <span
              className="shrink-0 inline-flex items-center px-2 py-1 rounded-[3px] text-[9.5px] font-black uppercase tracking-[0.12em]"
              style={{ background: 'rgba(201,168,0,0.18)', color: '#7A5C00', border: '1px solid rgba(201,168,0,0.35)' }}
            >
              DEMO ONLY
            </span>
          </div>
        </motion.div>

        {/* Status bar */}
        <motion.div
          className="mb-7"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0, 0, 1], delay: 0.09 }}
        >
          <TmsStatusBar />
        </motion.div>

        {/* Sub-tabs */}
        <motion.div
          className="mb-7"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.2, 0, 0, 1], delay: 0.12 }}
        >
          <TmsSubTabs activeTab={activeTab} onChange={setActiveTab} />
        </motion.div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          {activeTab === 'internal' ? (
            <InternalNettingDashboard key="internal" />
          ) : (
            <ExternalNettingDashboard key="external" />
          )}
        </AnimatePresence>

      </PageContainer>
    </AppShell>
  );
}
