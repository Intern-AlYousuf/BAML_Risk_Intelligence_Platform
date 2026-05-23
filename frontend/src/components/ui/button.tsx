'use client';

import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize    = 'sm' | 'md' | 'lg';

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:   'bg-[#FFE600] text-black border-[#D4B800] hover:bg-[#F5DC00] hover:border-[#C9A800] font-semibold',
  secondary: 'bg-white text-[#111111] border-[#D8D8D8] hover:bg-[#F0F0EE] hover:border-[#B8B8B6]',
  ghost:     'bg-transparent text-[#555555] border-transparent hover:bg-[#F0F0EE] hover:text-[#111111]',
  danger:    'bg-transparent text-[#DC2626] border-[rgba(220,38,38,0.25)] hover:bg-[rgba(220,38,38,0.06)]',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8   px-3.5 text-[12.5px] rounded-[4px] gap-1.5',
  md: 'h-9   px-4.5 text-[13.5px] rounded-[4px] gap-2',
  lg: 'h-11  px-6   text-[15px]   rounded-[4px] gap-2.5',
};

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
            className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
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
