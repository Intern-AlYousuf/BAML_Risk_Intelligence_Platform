'use client';

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/theme';

export interface NettingRow {
  subsidiary:  string;
  country:     string;
  currency:    string;
  receivable:  number;   /* $M */
  payable:     number;   /* $M */
}

const ROWS: NettingRow[] = [
  { subsidiary: 'BAML HQ India',  country: 'India',   currency: 'USD', receivable: 120, payable: 35 },
  { subsidiary: 'BAML Nigeria',   country: 'Nigeria', currency: 'USD', receivable: 28,  payable: 74 },
  { subsidiary: 'BAML Vietnam',   country: 'Vietnam', currency: 'USD', receivable: 16,  payable: 48 },
];

const COUNTRY_FLAGS: Record<string, string> = {
  India:   '🇮🇳',
  Nigeria: '🇳🇬',
  Vietnam: '🇻🇳',
};

const COL = 'grid grid-cols-[2fr_130px_100px_130px_130px_150px_120px]';

function fmt(n: number): string {
  return `$${n}M`;
}

function NetPositionCell({ net }: { net: number }) {
  const positive = net >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 font-bold tabular-nums"
      style={{
        color:               positive ? '#15803D' : '#B91C1C',
        fontVariantNumeric:  'tabular-nums',
        fontFeatureSettings: '"tnum" 1',
        letterSpacing:       '-0.01em',
        fontSize:            '13.5px',
      }}
    >
      {positive
        ? <TrendingUp  className="w-[13px] h-[13px] shrink-0" strokeWidth={2.5} />
        : <TrendingDown className="w-[13px] h-[13px] shrink-0" strokeWidth={2.5} />
      }
      {net >= 0 ? `+$${net}M` : `-$${Math.abs(net)}M`}
    </span>
  );
}

export function NettingTable() {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Table header */}
      <div
        className={cn(COL, 'px-5 py-3 gap-4 items-center')}
        style={{ background: '#F7F7F5', borderBottom: '1px solid #D8D8D8' }}
      >
        {['Subsidiary', 'Country', 'Currency', 'Receivable', 'Payable', 'Net Position', 'Status'].map((h) => (
          <span
            key={h}
            className="text-[10.5px] font-bold uppercase tracking-[0.13em]"
            style={{ color: '#888888' }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {ROWS.map((row, i) => {
        const net      = row.receivable - row.payable;
        const surplus  = net >= 0;

        return (
          <motion.div
            key={row.subsidiary}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: i * 0.06 }}
            className={cn(
              COL,
              'px-5 py-4 gap-4 items-center transition-colors duration-100',
              'hover:bg-[#FAFAF8] cursor-default',
            )}
            style={i < ROWS.length - 1 ? { borderBottom: '1px solid #F0F0EE' } : undefined}
          >
            {/* Subsidiary */}
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-black"
                style={{ background: 'rgba(255,230,0,0.15)', color: '#967A00', border: '1px solid rgba(255,230,0,0.30)' }}
              >
                {row.subsidiary.replace('BAML ', '').replace('HQ ', '').slice(0, 2).toUpperCase()}
              </div>
              <span className="truncate text-[13.5px] font-semibold" style={{ color: '#111111' }}>
                {row.subsidiary}
              </span>
            </div>

            {/* Country */}
            <span className="text-[13px]" style={{ color: '#555555' }}>
              {COUNTRY_FLAGS[row.country] ?? ''} {row.country}
            </span>

            {/* Currency */}
            <span
              className="inline-flex items-center px-2 py-1 rounded-[3px] text-[11px] font-bold tracking-[0.06em]"
              style={{ background: '#F0F0EE', color: '#555555', border: '1px solid #D8D8D8' }}
            >
              {row.currency}
            </span>

            {/* Receivable */}
            <span
              className="text-[13.5px] font-semibold tabular-nums"
              style={{ color: '#16A34A', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' }}
            >
              {fmt(row.receivable)}
            </span>

            {/* Payable */}
            <span
              className="text-[13.5px] font-semibold tabular-nums"
              style={{ color: '#DC2626', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' }}
            >
              {fmt(row.payable)}
            </span>

            {/* Net position */}
            <NetPositionCell net={net} />

            {/* Status badge */}
            <Badge
              variant={surplus ? 'success' : 'danger'}
              size="sm"
              dot
            >
              {surplus ? 'SURPLUS' : 'DEFICIT'}
            </Badge>
          </motion.div>
        );
      })}

      {/* Footer totals bar */}
      <div
        className={cn(COL, 'px-5 py-3.5 gap-4 items-center')}
        style={{ background: '#F7F7F5', borderTop: '1px solid #D8D8D8' }}
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: '#888888' }}>
          Aggregate
        </span>
        <span />
        <span />
        <span
          className="text-[13px] font-bold tabular-nums"
          style={{ color: '#16A34A', fontVariantNumeric: 'tabular-nums' }}
        >
          $164M
        </span>
        <span
          className="text-[13px] font-bold tabular-nums"
          style={{ color: '#DC2626', fontVariantNumeric: 'tabular-nums' }}
        >
          $157M
        </span>
        <span
          className="text-[13px] font-bold tabular-nums"
          style={{ color: '#111111', fontVariantNumeric: 'tabular-nums' }}
        >
          +$7M
        </span>
        <Badge variant="accent" size="sm" dot>NET LONG</Badge>
      </div>
    </div>
  );
}
