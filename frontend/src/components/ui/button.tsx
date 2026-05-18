'use client';

import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Variants
   --------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize    = 'sm' | 'md' | 'lg';

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:   'bg-[#F5D90A] text-black border-[#F5D90A] hover:bg-[#E8CC08] hover:border-[#E8CC08]',
  secondary: 'bg-transparent text-[#F5F7FA] border-[rgba(255,255,255,0.10)] hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.16)]',
  ghost:     'bg-transparent text-[#A1A8B3] border-transparent hover:bg-[rgba(255,255,255,0.05)] hover:text-[#F5F7FA]',
  danger:    'bg-transparent text-[#EF4444] border-[rgba(239,68,68,0.25)] hover:bg-[rgba(239,68,68,0.08)]',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8  px-3.5 text-[12.5px] rounded-[8px]  gap-1.5',
  md: 'h-10 px-4.5 text-[13.5px] rounded-[10px] gap-2',
  lg: 'h-12 px-6   text-[15px]   rounded-[12px] gap-2.5',
};

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface ButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?:   ButtonVariant;
  size?:      ButtonSize;
  loading?:   boolean;
  iconLeft?:  React.ReactNode;
  iconRight?: React.ReactNode;
  children?:  React.ReactNode;
  className?: string;
}

/* ---------------------------------------------------------------------------
   Button
   --------------------------------------------------------------------------- */

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant  = 'secondary',
      size     = 'md',
      loading  = false,
      iconLeft,
      iconRight,
      children,
      className,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        whileHover={isDisabled ? undefined : { y: -1 }}
        whileTap={isDisabled  ? undefined : { scale: 0.98 }}
        transition={{ duration: 0.1, ease: 'easeOut' }}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center font-medium',
          'border transition-all duration-150',
          'select-none whitespace-nowrap',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          VARIANT_STYLES[variant],
          SIZE_STYLES[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span
            className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin"
            aria-hidden
          />
        ) : (
          iconLeft && <span className="shrink-0">{iconLeft}</span>
        )}

        {children && (
          <span className="leading-none">{children}</span>
        )}

        {!loading && iconRight && (
          <span className="shrink-0">{iconRight}</span>
        )}
      </motion.button>
    );
  },
);

Button.displayName = 'Button';
