'use client';

import { Bell, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface TopbarProps {
  /** Breadcrumb segments — last item is the active page name */
  breadcrumb?: string[];
  /** Fallback title when no breadcrumb is provided */
  title?: string;
}

/* ---------------------------------------------------------------------------
   Topbar — 64px fixed, offset 260px from left
   --------------------------------------------------------------------------- */

export function Topbar({ breadcrumb, title }: TopbarProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <header
      className="fixed top-0 right-0 z-40 flex items-center justify-between px-8"
      style={{
        left:            '260px',
        height:          '64px',
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
                  'text-[14px] leading-none',
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
          <span className="text-[14px] font-semibold text-[#F5F7FA] leading-none">
            {title ?? 'Overview'}
          </span>
        )}
      </div>

      {/* ── Right: search + notifications + avatar ────────────────────── */}
      <div className="flex items-center gap-4 shrink-0">

        {/* Search */}
        <div
          className="hidden lg:flex items-center gap-2.5 rounded-[10px] px-3.5 py-2 transition-all duration-150"
          style={{
            background:   searchFocused ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
            border:       searchFocused ? '1px solid rgba(245,217,10,0.25)' : '1px solid rgba(255,255,255,0.06)',
            minWidth:     '200px',
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Search…"
            className="flex-1 bg-transparent text-[13.5px] text-[#F5F7FA] placeholder:text-[#6B7280] outline-none border-none"
            style={{ fontFamily: 'var(--font-inter, Inter, sans-serif)' }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          <kbd
            className="hidden xl:inline-flex items-center gap-0.5 text-[10.5px] font-medium text-[#6B7280]"
            style={{ fontFamily: 'var(--font-inter, Inter, sans-serif)' }}
          >
            ⌘K
          </kbd>
        </div>

        {/* Divider */}
        <div
          className="h-5 w-px"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        />

        {/* Notifications */}
        <button
          className="relative p-1.5 text-[#6B7280] hover:text-[#F5F7FA] transition-colors duration-150 rounded-[8px] hover:bg-[rgba(255,255,255,0.05)]"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          {/* Unread indicator */}
          <span
            className="absolute top-1 right-1 h-[7px] w-[7px] rounded-full border-[1.5px]"
            style={{ background: '#F5D90A', borderColor: '#111318' }}
          />
        </button>

        {/* Divider */}
        <div
          className="h-5 w-px"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        />

        {/* Profile avatar */}
        <button
          className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)]"
          aria-label="Profile"
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{
              background: 'rgba(245,217,10,0.10)',
              border:     '1px solid rgba(245,217,10,0.18)',
            }}
          >
            <span className="text-[11px] font-bold leading-none text-[#F5D90A]">TA</span>
          </div>
          <span className="hidden xl:block text-[13px] font-medium text-[#A1A8B3]">
            Treasury Analyst
          </span>
        </button>
      </div>
    </header>
  );
}
