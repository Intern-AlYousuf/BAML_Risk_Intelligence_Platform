'use client';

import { motion, AnimatePresence } from 'framer-motion';

export type ExplanationIcon = 'ironOre' | 'fx' | 'freight';

interface ScenarioExplanationCardProps {
  icon:      ExplanationIcon;
  title:     string;
  body:      string;
  index?:    number;
  isActive?: boolean;
}

const ICON_CONFIG: Record<ExplanationIcon, {
  bg:     string;
  border: string;
  bar:    string;
  color:  string;
  svg:    React.ReactNode;
}> = {
  ironOre: {
    bg:     'rgba(217,119,6,0.09)',
    border: '#D8D8D8',
    bar:    '#D97706',
    color:  '#B45309',
    svg: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M8 2L2 6v8h12V6L8 2z"/>
        <path d="M8 14V8"/>
        <path d="M5 10l3-2 3 2"/>
      </svg>
    ),
  },
  fx: {
    bg:     'rgba(37,99,235,0.08)',
    border: '#D8D8D8',
    bar:    '#2563EB',
    color:  '#1D4ED8',
    svg: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M2 10l4-6 3 4 2-3 3 5"/>
        <path d="M13 7l1 3-1 0"/>
      </svg>
    ),
  },
  freight: {
    bg:     'rgba(22,163,74,0.08)',
    border: '#D8D8D8',
    bar:    '#16A34A',
    color:  '#15803D',
    svg: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <rect x="1" y="5" width="9" height="7" rx="1"/>
        <path d="M10 7h2.5L14 9.5V12h-4V7z"/>
        <circle cx="4" cy="13" r="1.5"/>
        <circle cx="12" cy="13" r="1.5"/>
      </svg>
    ),
  },
};

export function ScenarioExplanationCard({
  icon,
  title,
  body,
  index    = 0,
  isActive = false,
}: ScenarioExplanationCardProps) {
  const cfg = ICON_CONFIG[icon];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.07, ease: [0.2, 0, 0, 1] }}
      className="relative flex flex-col gap-4 rounded-[8px] px-6 py-6 overflow-hidden"
      style={{
        background:  '#FFFFFF',
        border:      isActive ? `1px solid ${cfg.bar}` : `1px solid ${cfg.border}`,
        boxShadow:   isActive
          ? `0 0 0 1px ${cfg.bar}22, 0 4px 16px rgba(0,0,0,0.08)`
          : '0 1px 4px rgba(0,0,0,0.05)',
        transition: 'border-color 0.22s ease, box-shadow 0.22s ease',
      }}
    >
      {/* Top accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: isActive ? cfg.bar : '#D8D8D8' }}
      />

      {/* Icon + Active badge */}
      <div className="flex items-center justify-between mt-1">
        <div
          className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] shrink-0"
          style={{
            background: isActive ? cfg.bg : '#F0F0EE',
            color:      isActive ? cfg.color : '#888888',
          }}
        >
          {cfg.svg}
        </div>

        <AnimatePresence>
          {isActive && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8, x: 6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: 6 }}
              transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
              className="inline-flex items-center rounded-[3px] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] leading-none"
              style={{
                color:      cfg.color,
                background: cfg.bg,
                border:     `1px solid ${cfg.bar}40`,
              }}
            >
              Active
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Text */}
      <div className="space-y-2">
        <h4
          className="font-semibold leading-tight"
          style={{
            fontSize:      '14.5px',
            letterSpacing: '-0.01em',
            color:         isActive ? cfg.color : '#111111',
            transition:    'color 0.18s ease',
          }}
        >
          {title}
        </h4>

        <AnimatePresence mode="wait">
          <motion.p
            key={body}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            className="text-[13px] leading-relaxed"
            style={{ color: isActive ? '#555555' : '#888888' }}
          >
            {body}
          </motion.p>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
