'use client';

import { motion } from 'framer-motion';
import { ArrowRight, TrendingUp, TrendingDown, CheckCircle2 } from 'lucide-react';

interface FlowPair {
  from:       string;
  fromSub:    string;
  fromAmt:    string;
  to:         string;
  toSub:      string;
  toAmt:      string;
  currency:   string;
  matched:    string;
  status:     'matched' | 'partial';
}

const FLOW_PAIRS: FlowPair[] = [
  {
    from:     'BAML HQ India',
    fromSub:  'Treasury Hub · USD Surplus',
    fromAmt:  '+$85M',
    to:       'BAML Nigeria',
    toSub:    'USD Deficit Position',
    toAmt:    '−$46M',
    currency: 'USD',
    matched:  '$46M',
    status:   'matched',
  },
  {
    from:     'BAML HQ India',
    fromSub:  'Treasury Hub · USD Surplus',
    fromAmt:  '+$85M',
    to:       'BAML Vietnam',
    toSub:    'USD Deficit Position',
    toAmt:    '−$32M',
    currency: 'USD',
    matched:  '$32M',
    status:   'matched',
  },
];

function FlowNode({
  name,
  sub,
  amount,
  type,
}: {
  name:   string;
  sub:    string;
  amount: string;
  type:   'surplus' | 'deficit' | 'external';
}) {
  const isSurplus  = type === 'surplus';
  const isExternal = type === 'external';

  const bg     = isExternal ? '#F0F0EE' : isSurplus ? 'rgba(22,163,74,0.07)'  : 'rgba(220,38,38,0.07)';
  const border = isExternal ? '#D8D8D8' : isSurplus ? 'rgba(22,163,74,0.25)'  : 'rgba(220,38,38,0.25)';
  const color  = isExternal ? '#555555' : isSurplus ? '#15803D'                : '#B91C1C';
  const Icon   = isExternal ? null       : isSurplus ? TrendingUp              : TrendingDown;

  return (
    <div
      className="flex flex-col gap-1.5 px-4 py-3.5 rounded-[8px] min-w-[170px]"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div className="flex items-center gap-2">
        {Icon && (
          <Icon className="shrink-0 w-[13px] h-[13px]" style={{ color }} strokeWidth={2.5} />
        )}
        <span className="text-[12.5px] font-bold" style={{ color: '#111111' }}>
          {name}
        </span>
      </div>
      <span className="text-[11px]" style={{ color: '#888888' }}>{sub}</span>
      <span
        className="text-[14px] font-bold tabular-nums"
        style={{ color, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' }}
      >
        {amount}
      </span>
    </div>
  );
}

function ArrowConnector({
  currency,
  matched,
  status,
  index,
}: {
  currency: string;
  matched:  string;
  status:   'matched' | 'partial';
  index:    number;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-2">
      {/* Animated flow dots */}
      <div className="relative flex items-center gap-0" style={{ width: '80px', height: '20px' }}>
        {[0, 1, 2, 3].map((j) => (
          <motion.div
            key={j}
            className="absolute h-[6px] w-[6px] rounded-full"
            style={{ background: status === 'matched' ? '#16A34A' : '#D97706', left: `${j * 18}px`, top: '7px' }}
            animate={{ opacity: [0.2, 1, 0.2], x: [0, 4, 0] }}
            transition={{
              duration:    1.4,
              ease:        'easeInOut',
              repeat:      Infinity,
              delay:       index * 0.3 + j * 0.25,
            }}
          />
        ))}
        <ArrowRight
          className="absolute right-0 top-[4px] w-[12px] h-[12px]"
          style={{ color: status === 'matched' ? '#16A34A' : '#D97706' }}
          strokeWidth={2.5}
        />
      </div>

      <span
        className="text-[9.5px] font-bold uppercase tracking-[0.10em] px-2 py-0.5 rounded-[3px]"
        style={{
          background: status === 'matched' ? 'rgba(22,163,74,0.10)' : 'rgba(217,119,6,0.10)',
          color:      status === 'matched' ? '#15803D' : '#B45309',
          border:     `1px solid ${status === 'matched' ? 'rgba(22,163,74,0.25)' : 'rgba(217,119,6,0.25)'}`,
        }}
      >
        {currency} · {matched}
      </span>
    </div>
  );
}

export function SettlementFlow() {
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
            Internal Liquidity Routing
          </p>
          <p className="text-[15px] font-semibold mt-0.5" style={{ color: '#111111' }}>
            Treasury Settlement Flow
          </p>
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px]"
          style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.22)' }}
        >
          <CheckCircle2 className="w-[12px] h-[12px]" style={{ color: '#16A34A' }} strokeWidth={2.5} />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#15803D' }}>
            2 Active Routes
          </span>
        </div>
      </div>

      {/* Flow rows */}
      <div className="px-6 py-5 space-y-4">
        {FLOW_PAIRS.map((pair, i) => (
          <motion.div
            key={pair.from}
            className="flex items-center gap-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.2, 0, 0, 1], delay: 0.1 + i * 0.1 }}
          >
            {/* Route number */}
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black"
              style={{ background: 'rgba(255,230,0,0.20)', color: '#967A00', border: '1px solid rgba(255,230,0,0.35)' }}
            >
              {i + 1}
            </div>

            <FlowNode
              name={pair.from}
              sub={pair.fromSub}
              amount={pair.fromAmt}
              type="surplus"
            />

            <ArrowConnector
              currency={pair.currency}
              matched={pair.matched}
              status={pair.status}
              index={i}
            />

            <FlowNode
              name={pair.to}
              sub={pair.toSub}
              amount={pair.toAmt}
              type={pair.to.includes('External') ? 'external' : 'deficit'}
            />

            {/* Status pill */}
            <div className="ml-auto shrink-0">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[4px] text-[10.5px] font-bold uppercase tracking-[0.07em]"
                style={
                  pair.status === 'matched'
                    ? { background: 'rgba(22,163,74,0.10)', color: '#15803D', border: '1px solid rgba(22,163,74,0.22)' }
                    : { background: 'rgba(217,119,6,0.10)', color: '#B45309', border: '1px solid rgba(217,119,6,0.22)' }
                }
              >
                <span
                  className="h-[5px] w-[5px] rounded-full"
                  style={{ background: pair.status === 'matched' ? '#16A34A' : '#D97706' }}
                />
                {pair.status === 'matched' ? 'Fully Matched' : 'Partial Route'}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
