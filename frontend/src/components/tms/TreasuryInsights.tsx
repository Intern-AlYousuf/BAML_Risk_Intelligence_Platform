'use client';

import { motion } from 'framer-motion';
import { Cpu, AlertTriangle, CheckCircle2, TrendingUp, Zap } from 'lucide-react';

interface InsightItem {
  icon:    React.ElementType;
  text:    string;
  type:    'success' | 'warning' | 'info' | 'accent';
}

const INTERNAL_INSIGHTS: InsightItem[] = [
  {
    icon: CheckCircle2,
    text: 'India HQ surplus of +$85M successfully offsets Nigeria and Vietnam deficits of −$46M and −$32M respectively.',
    type: 'success',
  },
  {
    icon: AlertTriangle,
    text: 'Treasury concentration risk is moderate — all three entities carry USD-denominated exposure with no currency diversification.',
    type: 'warning',
  },
  {
    icon: CheckCircle2,
    text: 'Nigeria and Vietnam deficits are fully matched through India HQ internal routing. Residual of $7M is manageable via spot.',
    type: 'success',
  },
  {
    icon: TrendingUp,
    text: 'Centralised India HQ netting model improved liquidity efficiency by approximately 38 percentage points vs. bilateral execution.',
    type: 'info',
  },
  {
    icon: Zap,
    text: 'Internal matching reduced estimated execution costs by ₹8.6 Cr against gross bilateral bank fee exposure of ₹12.8 Cr.',
    type: 'accent',
  },
];

const ICON_STYLES: Record<string, { color: string; bg: string }> = {
  success: { color: '#15803D', bg: 'rgba(22,163,74,0.10)'  },
  warning: { color: '#B45309', bg: 'rgba(217,119,6,0.10)'  },
  info:    { color: '#1D4ED8', bg: 'rgba(37,99,235,0.10)'  },
  accent:  { color: '#967A00', bg: 'rgba(255,230,0,0.18)'  },
};

interface TreasuryInsightsProps {
  variant?: 'internal' | 'external';
}

export function TreasuryInsights({ variant = 'internal' }: TreasuryInsightsProps) {
  const insights = INTERNAL_INSIGHTS;

  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden h-full"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid #E5E5E3', background: '#FAFAF8' }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px]"
          style={{ background: 'rgba(255,230,0,0.20)', border: '1px solid rgba(255,230,0,0.35)' }}
        >
          <Cpu className="w-[15px] h-[15px]" style={{ color: '#967A00' }} strokeWidth={2} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: '#888888' }}>
            Institutional Analysis
          </p>
          <p className="text-[14.5px] font-bold leading-none mt-0.5" style={{ color: '#111111' }}>
            Treasury Intelligence
          </p>
        </div>
      </div>

      {/* Insight bullets */}
      <div className="flex-1 px-5 py-4 space-y-3.5">
        {insights.map((item, i) => {
          const style = ICON_STYLES[item.type];
          const Icon  = item.icon;
          return (
            <motion.div
              key={i}
              className="flex gap-3"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: 0.15 + i * 0.08 }}
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] mt-0.5"
                style={{ background: style.bg }}
              >
                <Icon className="w-[11px] h-[11px] shrink-0" style={{ color: style.color }} strokeWidth={2.5} />
              </div>
              <p
                className="text-[12.5px] leading-snug"
                style={{ color: '#444444' }}
              >
                {item.text}
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* Footer: model tag */}
      <div
        className="px-5 py-3"
        style={{ borderTop: '1px solid #F0F0EE' }}
      >
        <span
          className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: '#BBBBBB' }}
        >
          <span className="h-[5px] w-[5px] rounded-full bg-[#16A34A] animate-pulse" />
          Simulated treasury analysis — T+0
        </span>
      </div>
    </div>
  );
}
