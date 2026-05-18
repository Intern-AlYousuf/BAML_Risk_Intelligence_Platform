'use client';

import { motion } from 'framer-motion';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export interface SegmentOption<T extends string = string> {
  label:    string;
  value:    T;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options:    SegmentOption<T>[];
  value:      T;
  onChange:   (value: T) => void;
  size?:      'sm' | 'md' | 'lg';
  className?: string;
  /** Full-width: each option expands to fill equal space */
  fullWidth?: boolean;
}

const SIZE_TRACK: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'p-[3px] gap-[2px]',
  md: 'p-1     gap-[3px]',
  lg: 'p-1.5   gap-1',
};

const SIZE_OPTION: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'px-3   py-1.5  text-[12px] rounded-[6px]',
  md: 'px-4   py-2    text-[13.5px] rounded-[8px]',
  lg: 'px-5   py-2.5  text-[15px]  rounded-[10px]',
};

/* ---------------------------------------------------------------------------
   SegmentedControl
   Animated pill selector — used for horizon pickers (3M / 6M / 12M), tabs,
   view toggles, etc.
   --------------------------------------------------------------------------- */

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  size      = 'md',
  className,
  fullWidth = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-[12px]',
        SIZE_TRACK[size],
        fullWidth && 'w-full',
        className,
      )}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border:     '1px solid rgba(255,255,255,0.07)',
      }}
      role="tablist"
      aria-label="Segmented control"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;

        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={isActive}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={cn(
              'relative font-semibold transition-colors duration-150 cursor-pointer select-none',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              SIZE_OPTION[size],
              fullWidth && 'flex-1 text-center',
              isActive
                ? 'text-black'
                : 'text-[#A1A8B3] hover:text-[#F5F7FA]',
            )}
          >
            {/* Animated background pill */}
            {isActive && (
              <motion.span
                layoutId={`seg-pill-${Math.random().toString(36).slice(2)}`}
                className="absolute inset-0 rounded-[inherit]"
                style={{ background: '#F5D90A' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              />
            )}

            <span className="relative z-10 leading-none whitespace-nowrap">
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
