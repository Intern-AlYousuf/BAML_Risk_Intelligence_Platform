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
  Network,
} from 'lucide-react';
import { cn } from '../../lib/theme';

type NavItem = {
  label:  string;
  href:   string;
  icon:   React.ElementType;
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
  {
    label: 'Treasury',
    items: [
      { label: 'Netting TMS',       href: '/tms',      icon: Network,        badge: 'NEW'  },
    ],
  },
];

function NavItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;

  return (
    <Link href={item.href} className="block outline-none focus-visible:outline-none">
      <motion.div
        whileHover={{ x: 1 }}
        transition={{ duration: 0.1, ease: 'easeOut' }}
        className={cn(
          'group relative flex items-center gap-3.5 rounded-[4px] px-3.5 py-2.5',
          'text-[14px] font-medium cursor-pointer select-none',
          'transition-colors duration-150',
          isActive ? 'text-[#111111]' : 'text-[#555555] hover:text-[#111111]',
        )}
        style={{
          background: isActive ? 'rgba(255,230,0,0.18)' : undefined,
        }}
        onMouseEnter={e => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F0F0EE';
        }}
        onMouseLeave={e => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = '';
        }}
      >
        {/* Active left accent bar */}
        <AnimatePresence>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute left-0 top-[6px] bottom-[6px] w-[3px] rounded-r-full"
              style={{ background: '#FFE600' }}
              initial={{ opacity: 0, scaleY: 0.4 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0.4 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            />
          )}
        </AnimatePresence>

        <Icon
          className={cn(
            'shrink-0 w-[16px] h-[16px] transition-colors duration-150',
            isActive ? 'text-[#111111]' : 'text-[#888888] group-hover:text-[#555555]',
          )}
          strokeWidth={isActive ? 2 : 1.75}
        />

        <span className="flex-1 leading-none">{item.label}</span>

        {item.badge && (
          <span
            className="inline-flex items-center px-[5px] py-[2.5px] rounded-[3px] text-[9px] font-bold tracking-[0.08em] leading-none uppercase"
            style={
              isActive
                ? { background: 'rgba(255,230,0,0.25)', color: '#967A00', border: '1px solid rgba(255,230,0,0.40)' }
                : { background: '#F0F0EE', color: '#888888', border: '1px solid #D8D8D8' }
            }
          >
            {item.badge}
          </span>
        )}
      </motion.div>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-50 flex flex-col"
      style={{
        width:           '280px',
        backgroundColor: '#FFFFFF',
        borderRight:     '1px solid #D8D8D8',
      }}
    >
      {/* Brand */}
      <div
        className="flex h-[72px] shrink-0 items-center gap-4 px-5"
        style={{ borderBottom: '1px solid #D8D8D8' }}
      >
        {/* Logo mark */}
        <div
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px]"
          style={{ background: '#FFE600', border: '1px solid #D4B800' }}
        >
          <span className="text-[14px] font-black leading-none tracking-tight text-black">B</span>
          <span
            className="absolute -right-[3px] -top-[3px] h-[8px] w-[8px] rounded-full border-[1.5px]"
            style={{ background: '#16A34A', borderColor: '#FFFFFF' }}
          />
        </div>

        {/* Wordmark */}
        <div className="flex flex-col gap-1 leading-none">
          <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#111111]">
            BAML
          </span>
          <span className="text-[11.5px] text-[#888888] tracking-[0.02em]">
            Risk Intelligence
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-5 space-y-5">
        {NAV.map((section) => (
          <div key={section.label}>
            <p
              className="mb-2 px-3.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#BBBBBB]"
            >
              {section.label}
            </p>
            <ul className="space-y-px">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavItem item={item} isActive={pathname === item.href} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div
        className="shrink-0 p-3"
        style={{ borderTop: '1px solid #D8D8D8' }}
      >
        <button
          className="group flex w-full items-center gap-3.5 rounded-[4px] px-3.5 py-2.5 transition-colors duration-150"
          style={{ background: 'transparent' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F0F0EE'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {/* Avatar */}
          <div className="relative shrink-0">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: '#FFE600', border: '1px solid #D4B800' }}
            >
              <span className="text-[11px] font-black leading-none text-black">TA</span>
            </div>
            <span
              className="absolute -bottom-px -right-px h-[9px] w-[9px] rounded-full border-[1.5px]"
              style={{ background: '#16A34A', borderColor: '#FFFFFF' }}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1 text-left leading-none">
            <span className="truncate text-[13.5px] font-semibold text-[#111111]">
              Treasury Analyst
            </span>
            <span className="text-[11.5px] text-[#888888]">EY Advisory</span>
          </div>

          <ChevronsUpDown
            className="h-[14px] w-[14px] shrink-0 text-[#BBBBBB] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            strokeWidth={1.75}
          />
        </button>
      </div>
    </aside>
  );
}
