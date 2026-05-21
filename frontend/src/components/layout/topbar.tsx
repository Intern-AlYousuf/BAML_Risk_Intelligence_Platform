'use client';

import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface TopbarProps {
  breadcrumb?: string[];
  title?:      string;
}

/* ---------------------------------------------------------------------------
   Topbar — 72px fixed, offset 280px from left
   --------------------------------------------------------------------------- */

export function Topbar({ breadcrumb, title }: TopbarProps) {
  return (
    <header
      className="fixed top-0 right-0 z-40 flex items-center justify-between px-9"
      style={{
        left:            '280px',
        height:          '72px',
        backgroundColor: '#111318',
        borderBottom:    '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* ── Left: breadcrumb ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          breadcrumb.map((crumb, i) => (
            <div key={crumb} className="flex items-center gap-2">
              {i > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: 'rgba(255,255,255,0.18)' }}
                  strokeWidth={1.5}
                />
              )}
              <span
                className={cn(
                  'text-[15px] leading-none',
                  i === breadcrumb.length - 1
                    ? 'font-semibold text-[#F5F7FA]'
                    : 'font-normal text-[#6B7280]',
                )}
              >
                {crumb}
              </span>
            </div>
          ))
        ) : (
          <span className="text-[15px] font-semibold text-[#F5F7FA] leading-none">
            {title ?? 'Overview'}
          </span>
        )}
      </div>

      {/* ── Right: profile avatar only ────────────────────────────────── */}
      <div className="flex items-center shrink-0">
        <button
          className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)]"
          aria-label="Profile"
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: 'rgba(245,217,10,0.10)',
              border:     '1px solid rgba(245,217,10,0.18)',
            }}
          >
            <span className="text-[12px] font-bold leading-none text-[#F5D90A]">TA</span>
          </div>
          <span className="hidden xl:block text-[14px] font-medium text-[#A1A8B3]">
            Treasury Analyst
          </span>
        </button>
      </div>
    </header>
  );
}
