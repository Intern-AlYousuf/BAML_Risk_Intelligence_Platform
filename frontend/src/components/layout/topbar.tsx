'use client';

import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/theme';

export interface TopbarProps {
  breadcrumb?: string[];
  title?:      string;
}

export function Topbar({ breadcrumb, title }: TopbarProps) {
  return (
    <header
      className="fixed top-0 right-0 z-40 flex items-center justify-between px-9"
      style={{
        left:            '280px',
        height:          '72px',
        backgroundColor: '#FFFFFF',
        borderBottom:    '1px solid #D8D8D8',
      }}
    >
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          breadcrumb.map((crumb, i) => (
            <div key={crumb} className="flex items-center gap-2">
              {i > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-[#D8D8D8]"
                  strokeWidth={1.5}
                />
              )}
              <span
                className={cn(
                  'text-[14px] leading-none',
                  i === breadcrumb.length - 1
                    ? 'font-semibold text-[#111111]'
                    : 'font-normal text-[#888888]',
                )}
              >
                {crumb}
              </span>
            </div>
          ))
        ) : (
          <span className="text-[14px] font-semibold text-[#111111] leading-none">
            {title ?? 'Overview'}
          </span>
        )}
      </div>

      {/* Right: profile */}
      <div className="flex items-center shrink-0">
        <button
          className="flex items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 transition-colors duration-150 hover:bg-[#F0F0EE]"
          aria-label="Profile"
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: '#FFE600', border: '1px solid #D4B800' }}
          >
            <span className="text-[11px] font-black leading-none text-black">TA</span>
          </div>
          <span className="hidden xl:block text-[13.5px] font-medium text-[#555555]">
            Treasury Analyst
          </span>
        </button>
      </div>
    </header>
  );
}
