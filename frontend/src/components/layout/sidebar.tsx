'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  TrendingUp,
  ChevronsUpDown,
  Percent,
  ArrowLeftRight,
} from 'lucide-react';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Nav data
   --------------------------------------------------------------------------- */

type NavItem = {
  label: string;
  href:  string;
  icon:  React.ElementType;
  badge?: string;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV: NavSection[] = [
  {
    label: 'Analytics',
    items: [
      { label: 'Overview',          href: '/',         icon: LayoutDashboard },
      { label: 'Scenario Analysis', href: '/scenario', icon: TrendingUp,     badge: 'LIVE' },
      { label: 'SOFR Forecast',     href: '/sofr',     icon: Percent,        badge: 'NEW'  },
      { label: 'FX Forecast',       href: '/fx',       icon: ArrowLeftRight, badge: 'NEW'  },
    ],
  },
];

/* ---------------------------------------------------------------------------
   NavItem
   --------------------------------------------------------------------------- */

function NavItem({
  item,
  isActive,
}: {
  item: NavItem;
  isActive: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link href={item.href} className="block outline-none focus-visible:outline-none">
      <motion.div
        whileHover={{ x: 1 }}
        transition={{ duration: 0.1, ease: 'easeOut' }}
        className={cn(
          'group relative flex items-center gap-3.5 rounded-[10px] px-3.5 py-3',
          'text-[15px] font-medium cursor-pointer select-none',
          'transition-colors duration-150',
          isActive
            ? 'text-[#F5D90A]'
            : 'text-[#A1A8B3] hover:text-[#F5F7FA]',
        )}
        style={{
          background: isActive
            ? 'rgba(245,217,10,0.09)'
            : undefined,
        }}
        onMouseEnter={e => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
          }
        }}
        onMouseLeave={e => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = '';
          }
        }}
      >
        {/* Active left pill */}
        <AnimatePresence>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-r-full"
              style={{ background: '#F5D90A' }}
              initial={{ opacity: 0, scaleY: 0.4 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0.4 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            />
          )}
        </AnimatePresence>

        {/* Icon */}
        <Icon
          className={cn(
            'shrink-0 w-[17px] h-[17px] transition-colors duration-150',
            isActive
              ? 'text-[#F5D90A]'
              : 'text-[#6B7280] group-hover:text-[#A1A8B3]',
          )}
          strokeWidth={isActive ? 2 : 1.75}
        />

        {/* Label */}
        <span className="flex-1 leading-none">{item.label}</span>

        {/* Badge */}
        {item.badge && (
          <span
            className="inline-flex items-center px-[6px] py-[3px] rounded-full text-[9.5px] font-bold tracking-[0.06em] leading-none uppercase"
            style={
              isActive
                ? { background: 'rgba(245,217,10,0.18)', color: '#F5D90A', border: '1px solid rgba(245,217,10,0.30)' }
                : { background: 'rgba(245,217,10,0.07)', color: '#A89208', border: '1px solid rgba(245,217,10,0.14)' }
            }
          >
            {item.badge}
          </span>
        )}
      </motion.div>
    </Link>
  );
}

/* ---------------------------------------------------------------------------
   Sidebar — 260px fixed, full viewport height
   --------------------------------------------------------------------------- */

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-50 flex flex-col"
      style={{
        width:           '280px',
        backgroundColor: '#111318',
        borderRight:     '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Brand ────────────────────────────────────────────────────────── */}
      <div
        className="flex h-[72px] shrink-0 items-center gap-4 px-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        {/* Logo mark */}
        <div
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: '#F5D90A' }}
        >
          <span className="text-[14px] font-black leading-none tracking-tight text-black">B</span>
          {/* Online indicator */}
          <span
            className="absolute -right-[3px] -top-[3px] h-[9px] w-[9px] rounded-full border-[1.5px]"
            style={{ background: '#22C55E', borderColor: '#111318' }}
          />
        </div>

        {/* Wordmark */}
        <div className="flex flex-col gap-1 leading-none">
          <span className="text-[14px] font-bold uppercase tracking-[0.18em] text-[#F5F7FA]">
            BAML
          </span>
          <span className="text-[12px] text-[#6B7280] tracking-[0.02em]">
            Risk Intelligence
          </span>
        </div>
      </div>

      {/* Navigation ───────────────────────────────────────────────────── */}
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {NAV.map((section) => (
          <div key={section.label}>
            <p
              className="mb-2 px-3.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'rgba(255,255,255,0.22)' }}
            >
              {section.label}
            </p>
            <ul className="space-y-[1px]">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavItem item={item} isActive={pathname === item.href} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer ──────────────────────────────────────────────────── */}
      <div
        className="shrink-0 p-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <button
          className="group flex w-full items-center gap-3.5 rounded-[10px] px-3.5 py-3 transition-colors duration-150"
          style={{ background: 'transparent' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {/* Avatar */}
          <div className="relative shrink-0">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{
                background: 'rgba(245,217,10,0.10)',
                border:     '1px solid rgba(245,217,10,0.18)',
              }}
            >
              <span className="text-[12px] font-bold leading-none text-[#F5D90A]">TA</span>
            </div>
            <span
              className="absolute -bottom-px -right-px h-[10px] w-[10px] rounded-full border-[1.5px]"
              style={{ background: '#22C55E', borderColor: '#111318' }}
            />
          </div>

          {/* Name */}
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-left leading-none">
            <span className="truncate text-[14px] font-semibold text-[#F5F7FA]">
              Treasury Analyst
            </span>
            <span className="text-[12px] text-[#6B7280]">EY Advisory</span>
          </div>

          <ChevronsUpDown
            className="h-[15px] w-[15px] shrink-0 text-[#6B7280] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            strokeWidth={1.75}
          />
        </button>
      </div>
    </aside>
  );
}
