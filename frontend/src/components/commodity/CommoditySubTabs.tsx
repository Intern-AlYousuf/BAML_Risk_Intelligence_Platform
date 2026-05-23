'use client';

import { motion } from 'framer-motion';
import { cn } from '../../lib/theme';

export type CommodityTab = 'iron_ore' | 'coking_coal';

interface CommoditySubTabsProps {
  activeTab: CommodityTab;
  onChange:  (tab: CommodityTab) => void;
}

const TABS: { id: CommodityTab; label: string; sublabel: string; ticker: string }[] = [
  { id: 'iron_ore',    label: 'Iron Ore Volatility',    sublabel: 'GARCH(1,1) · Procurement Risk', ticker: 'IO/CFR' },
  { id: 'coking_coal', label: 'Coking Coal Volatility', sublabel: 'GARCH(1,1) · Met Coal Risk',    ticker: 'HCC/FOB' },
];

export function CommoditySubTabs({ activeTab, onChange }: CommoditySubTabsProps) {
  return (
    <div
      className="flex gap-1 p-1 rounded-[6px]"
      style={{ background: '#F0F0EE', border: '1px solid #D8D8D8' }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <motion.button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex items-center gap-4 px-6 py-3.5 rounded-[5px]',
              'transition-colors duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#FFE600]',
            )}
            style={{ minWidth: '230px' }}
            whileHover={!isActive ? { backgroundColor: 'rgba(255,255,255,0.55)' } : undefined}
            transition={{ duration: 0.12 }}
          >
            {isActive && (
              <motion.div
                layoutId="commodity-tab-bg"
                className="absolute inset-0 rounded-[5px]"
                style={{
                  background: '#FFFFFF',
                  boxShadow:  '0 1px 6px rgba(0,0,0,0.09), 0 0 0 1px rgba(255,230,0,0.22)',
                }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              />
            )}

            {isActive && (
              <motion.div
                layoutId="commodity-tab-bar"
                className="absolute bottom-0 left-4 right-4 h-[2.5px] rounded-t-full"
                style={{ background: '#FFE600' }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              />
            )}

            {/* Ticker chip */}
            <span
              className="relative z-10 inline-flex items-center px-2 py-0.5 rounded-[3px] text-[9.5px] font-black tracking-[0.10em] shrink-0"
              style={
                isActive
                  ? { background: 'rgba(255,230,0,0.20)', color: '#967A00', border: '1px solid rgba(255,230,0,0.38)' }
                  : { background: '#E5E5E3',             color: '#888888', border: '1px solid #D8D8D8' }
              }
            >
              {tab.ticker}
            </span>

            <div className="relative z-10 flex flex-col gap-0.5 text-left">
              <span
                className="text-[13px] font-bold leading-none tracking-[0.01em]"
                style={{ color: isActive ? '#111111' : '#555555' }}
              >
                {tab.label}
              </span>
              <span
                className="text-[11px] leading-none"
                style={{ color: isActive ? '#967A00' : '#888888' }}
              >
                {tab.sublabel}
              </span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
