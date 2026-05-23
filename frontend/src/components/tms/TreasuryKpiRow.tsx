'use client';

import { motion } from 'framer-motion';
import { StatCard } from '../cards/StatCard';

interface KpiDef {
  label:      string;
  value:      string;
  annotation: string;
  accent:     'yellow' | 'green' | 'red' | 'amber' | 'blue' | 'none';
  signal:     'positive' | 'negative' | 'warning' | 'neutral';
}

const INTERNAL_KPI: KpiDef[] = [
  {
    label:      'Gross Exposure',
    value:      '$321M',
    annotation: 'Total intercompany exposure across 3 entities',
    accent:     'yellow',
    signal:     'neutral',
  },
  {
    label:      'Netted Internally',
    value:      '$198M',
    annotation: 'Matched via India HQ treasury offsets',
    accent:     'green',
    signal:     'positive',
  },
  {
    label:      'External FX Required',
    value:      '$123M',
    annotation: 'Residual bank-facing exposure',
    accent:     'amber',
    signal:     'warning',
  },
  {
    label:      'Estimated FX Savings',
    value:      '₹12.8 Cr',
    annotation: 'Reduced spreads, fees & execution cost',
    accent:     'green',
    signal:     'positive',
  },
];

const EXTERNAL_KPI: KpiDef[] = [
  {
    label:      'Residual Exposure',
    value:      '$123M',
    annotation: 'Post internal netting bank-facing exposure',
    accent:     'amber',
    signal:     'warning',
  },
  {
    label:      'Required FX Swaps',
    value:      '4',
    annotation: 'Active hedge instruments in pipeline',
    accent:     'yellow',
    signal:     'neutral',
  },
  {
    label:      'Forward Hedge Coverage',
    value:      '58%',
    annotation: 'Forward contract hedged portion',
    accent:     'blue',
    signal:     'neutral',
  },
  {
    label:      'Settlement Cost',
    value:      '₹4.2 Cr',
    annotation: 'Estimated bank execution cost',
    accent:     'amber',
    signal:     'warning',
  },
];

interface TreasuryKpiRowProps {
  variant: 'internal' | 'external';
}

export function TreasuryKpiRow({ variant }: TreasuryKpiRowProps) {
  const kpis = variant === 'internal' ? INTERNAL_KPI : EXTERNAL_KPI;

  return (
    <div className="grid grid-cols-4 gap-5">
      {kpis.map((kpi, i) => (
        <motion.div
          key={kpi.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.2, 0, 0, 1], delay: i * 0.07 }}
          whileHover={{ y: -2 }}
        >
          <StatCard
            label={kpi.label}
            value={kpi.value}
            annotation={kpi.annotation}
            accent={kpi.accent}
            signal={kpi.signal}
            size="sm"
          />
        </motion.div>
      ))}
    </div>
  );
}
