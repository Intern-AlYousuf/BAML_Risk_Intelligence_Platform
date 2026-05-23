import { cn } from '../../lib/theme';

type BadgeVariant = 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'neutral';
type BadgeSize    = 'sm' | 'md';

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; text: string; border: string }> = {
  accent:  { bg: 'rgba(255,230,0,0.18)',  text: '#967A00', border: 'rgba(255,230,0,0.40)'  },
  success: { bg: 'rgba(22,163,74,0.10)',  text: '#15803D', border: 'rgba(22,163,74,0.25)'  },
  danger:  { bg: 'rgba(220,38,38,0.10)',  text: '#B91C1C', border: 'rgba(220,38,38,0.25)'  },
  warning: { bg: 'rgba(217,119,6,0.10)',  text: '#B45309', border: 'rgba(217,119,6,0.25)'  },
  info:    { bg: 'rgba(37,99,235,0.10)',  text: '#1D4ED8', border: 'rgba(37,99,235,0.25)'  },
  neutral: { bg: '#F0F0EE',               text: '#888888', border: '#D8D8D8'               },
};

const SIZE_STYLES: Record<BadgeSize, string> = {
  sm: 'px-[6px] py-[3px] text-[9.5px] tracking-[0.08em]',
  md: 'px-2.5   py-1     text-[10.5px] tracking-[0.05em]',
};

export interface BadgeProps {
  variant?:   BadgeVariant;
  size?:      BadgeSize;
  dot?:       boolean;
  pulseDot?:  boolean;
  children:   React.ReactNode;
  className?: string;
}

export function Badge({
  variant   = 'neutral',
  size      = 'sm',
  dot       = false,
  pulseDot  = false,
  children,
  className,
}: BadgeProps) {
  const s = VARIANT_STYLES[variant];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[3px] font-bold uppercase leading-none whitespace-nowrap',
        SIZE_STYLES[size],
        className,
      )}
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {(dot || pulseDot) && (
        <span
          className={cn('h-[5px] w-[5px] rounded-full shrink-0', pulseDot && 'animate-pulse')}
          style={{ background: s.text }}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

export interface StatusDotProps {
  variant?: BadgeVariant;
  pulse?:   boolean;
  size?:    'sm' | 'md' | 'lg';
}

const DOT_SIZES = { sm: 'h-[7px] w-[7px]', md: 'h-[9px] w-[9px]', lg: 'h-[11px] w-[11px]' };

export function StatusDot({ variant = 'success', pulse = false, size = 'sm' }: StatusDotProps) {
  return (
    <span
      className={cn('inline-block rounded-full shrink-0', DOT_SIZES[size], pulse && 'animate-pulse')}
      style={{ background: VARIANT_STYLES[variant].text }}
      aria-hidden
    />
  );
}
