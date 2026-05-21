import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   PageContainer
   Standard page-level content wrapper: max-width + consistent gutters.

   size variants:
     narrow  — max 1024px  (single-column focused pages)
     default — max 1440px  (standard dashboard pages)
     wide    — max 1680px  (data-heavy grid pages)
     full    — no max-width (full-bleed workspaces)
   --------------------------------------------------------------------------- */

const MAX_WIDTHS = {
  narrow:  'max-w-[1024px]',
  default: 'max-w-[1440px]',
  wide:    'max-w-[1680px]',
  full:    'max-w-none',
} as const;

export interface PageContainerProps {
  children:   React.ReactNode;
  size?:      keyof typeof MAX_WIDTHS;
  className?: string;
}

export function PageContainer({
  children,
  size = 'default',
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        'w-full mx-auto px-12 py-12',
        MAX_WIDTHS[size],
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   PageHeader
   Consistent page-level heading with optional subtitle and action slot.
   spec: page title 36px, subtitle 14–16px
   --------------------------------------------------------------------------- */

export interface PageHeaderProps {
  title:      string;
  subtitle?:  string;
  eyebrow?:   string;   /* small category label above the title */
  actions?:   React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-6 mb-10', className)}>
      <div className="space-y-2">
        {eyebrow && (
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">
            {eyebrow}
          </p>
        )}
        <h1
          className="font-semibold text-[#F5F7FA] leading-none"
          style={{ fontSize: '36px', letterSpacing: '-0.025em' }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[15px] text-[#6B7280] leading-none">{subtitle}</p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-3 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   PageSection
   Consistent spacing wrapper for sub-sections within a page.
   --------------------------------------------------------------------------- */

export interface PageSectionProps {
  children:   React.ReactNode;
  className?: string;
}

export function PageSection({ children, className }: PageSectionProps) {
  return (
    <section className={cn('space-y-5', className)}>
      {children}
    </section>
  );
}
