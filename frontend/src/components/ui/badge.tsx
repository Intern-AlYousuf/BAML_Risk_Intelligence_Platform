import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Variants
   --------------------------------------------------------------------------- */

type BadgeVariant =
  | 'accent'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'neutral';

type BadgeSize = 'sm' | 'md';

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; text: string; border: string }> = {
  accent:  {
    bg:     'rgba(245,217,10,0.10)',
    text:   '#F5D90A',
    border: 'rgba(245,217,10,0.22)',
  },
  success: {
    bg:     'rgba(34,197,94,0.10)',
    text:   '#22C55E',
    border: 'rgba(34,197,94,0.22)',
  },
  danger: {
    bg:     'rgba(239,68,68,0.10)',
    text:   '#EF4444',
    border: 'rgba(239,68,68,0.22)',
  },
  warning: {
    bg:     'rgba(245,158,11,0.10)',
    text:   '#F59E0B',
    border: 'rgba(245,158,11,0.22)',
  },
  info: {
    bg:     'rgba(59,130,246,0.10)',
    text:   '#3B82F6',
    border: 'rgba(59,130,246,0.22)',
  },
  neutral: {
    bg:     'rgba(255,255,255,0.06)',
    text:   '#A1A8B3',
    border: 'rgba(255,255,255,0.10)',
  },
};

const SIZE_STYLES: Record<BadgeSize, string> = {
  sm: 'px-[7px] py-[3px] text-[10px] tracking-[0.06em]',
  md: 'px-2.5   py-1     text-[11px] tracking-[0.04em]',
};

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface BadgeProps {
  variant?:   BadgeVariant;
  size?:      BadgeSize;
  dot?:       boolean;         /* show a colored status dot on the left */
  pulseDot?:  boolean;         /* animated pulse for live status */
  children:   React.ReactNode;
  className?: string;
}

/* ---------------------------------------------------------------------------
   Badge
   --------------------------------------------------------------------------- */

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
        'inline-flex items-center gap-1.5 rounded-full font-bold uppercase leading-none whitespace-nowrap',
        SIZE_STYLES[size],
        className,
      )}
      style={{
        background: s.bg,
        color:      s.text,
        border:     `1px solid ${s.border}`,
      }}
    >
      {(dot || pulseDot) && (
        <span
          className={cn('h-[6px] w-[6px] rounded-full shrink-0', pulseDot && 'animate-pulse')}
          style={{ background: s.text }}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   StatusDot — standalone pulsing dot, no text
   --------------------------------------------------------------------------- */

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
