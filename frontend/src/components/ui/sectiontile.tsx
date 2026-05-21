import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   SectionTitle
   Spec: section titles 18px (--text-lg)
   Renders a consistent section heading with optional subtitle + action slot.
   --------------------------------------------------------------------------- */

export interface SectionTitleProps {
  /** Main section heading — rendered as h2, styled at 18px */
  title:      string;
  /** Optional one-line description below the title */
  subtitle?:  string;
  /** Small eyebrow text above the title */
  eyebrow?:   string;
  /** Right-aligned slot for actions, badges, etc. */
  actions?:   React.ReactNode;
  /** Bottom margin below the section header */
  spacing?:   'sm' | 'md' | 'lg';
  className?: string;
  /** Override the heading element (default: h2) */
  as?:        'h1' | 'h2' | 'h3' | 'h4';
}

const SPACING = { sm: 'mb-4', md: 'mb-6', lg: 'mb-8' };

export function SectionTitle({
  title,
  subtitle,
  eyebrow,
  actions,
  spacing   = 'md',
  className,
  as: Tag   = 'h2',
}: SectionTitleProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4', SPACING[spacing], className)}>
      <div className="space-y-1.5 min-w-0">
        {eyebrow && (
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">
            {eyebrow}
          </p>
        )}
        <Tag
          className="font-semibold text-[#F5F7FA] leading-tight"
          style={{ fontSize: '20px', letterSpacing: '-0.01em' }}
        >
          {title}
        </Tag>
        {subtitle && (
          <p className="text-[14.5px] text-[#6B7280] leading-none">
            {subtitle}
          </p>
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
   DividerLabel
   A thin horizontal rule with a centered text label — useful between
   logical groups of cards or within sections.
   --------------------------------------------------------------------------- */

export interface DividerLabelProps {
  label?:     string;
  className?: string;
}

export function DividerLabel({ label, className }: DividerLabelProps) {
  if (!label) {
    return (
      <div
        className={cn('w-full h-px', className)}
        style={{ background: 'rgba(255,255,255,0.05)' }}
      />
    );
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#374151] shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
    </div>
  );
}
