'use client';

import { motion } from 'framer-motion';
import { cn } from '../../lib/theme';

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
  fullWidth?: boolean;
}

const SIZE_TRACK: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'p-[3px] gap-px',
  md: 'p-1     gap-px',
  lg: 'p-1     gap-0.5',
};

const SIZE_OPTION: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'px-3    py-1.5  text-[12px]   rounded-[3px]',
  md: 'px-4    py-2    text-[13px]   rounded-[4px]',
  lg: 'px-5    py-2.5  text-[14.5px] rounded-[4px]',
};

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
        'inline-flex items-center rounded-[6px]',
        SIZE_TRACK[size],
        fullWidth && 'w-full',
        className,
      )}
      style={{
        background: '#F0F0EE',
        border:     '1px solid #D8D8D8',
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
              isActive ? 'text-[#111111]' : 'text-[#888888] hover:text-[#555555]',
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`seg-pill-${Math.random().toString(36).slice(2)}`}
                className="absolute inset-0 rounded-[inherit]"
                style={{
                  background: '#FFE600',
                  boxShadow:  '0 1px 3px rgba(0,0,0,0.10)',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
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
