'use client';

import { motion } from 'framer-motion';
import { cn } from '../../lib/theme';

export type TmsTab = 'internal' | 'external';

interface TmsSubTabsProps {
  activeTab: TmsTab;
  onChange:  (tab: TmsTab) => void;
}

const TABS: { id: TmsTab; label: string; sublabel: string }[] = [
  { id: 'internal', label: 'Internal Netting', sublabel: 'Intercompany FX Offset'    },
  { id: 'external', label: 'External Netting', sublabel: 'Bank Settlement & Hedging'  },
];

export function TmsSubTabs({ activeTab, onChange }: TmsSubTabsProps) {
  return (
    <div
      className="flex gap-1 p-1 rounded-[8px]"
      style={{ background: '#F0F0EE', border: '1px solid #D8D8D8' }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <motion.button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex flex-col gap-0.5 items-start px-7 py-4 rounded-[6px]',
              'transition-colors duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#FFE600]',
            )}
            style={{ minWidth: '200px' }}
            whileHover={!isActive ? { backgroundColor: 'rgba(255,255,255,0.55)' } : undefined}
            transition={{ duration: 0.12 }}
          >
            {isActive && (
              <motion.div
                layoutId="tms-tab-bg"
                className="absolute inset-0 rounded-[6px]"
                style={{
                  background:  '#FFFFFF',
                  boxShadow:   '0 1px 6px rgba(0,0,0,0.09), 0 0 0 1px rgba(255,230,0,0.22)',
                }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              />
            )}

            {/* Yellow bottom bar on active */}
            {isActive && (
              <motion.div
                layoutId="tms-tab-bar"
                className="absolute bottom-0 left-4 right-4 h-[2.5px] rounded-t-full"
                style={{ background: '#FFE600' }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              />
            )}

            <span
              className="relative z-10 text-[13px] font-bold leading-none tracking-[0.01em]"
              style={{ color: isActive ? '#111111' : '#555555' }}
            >
              {tab.label}
            </span>
            <span
              className="relative z-10 text-[11px] leading-none"
              style={{ color: isActive ? '#967A00' : '#888888' }}
            >
              {tab.sublabel}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
