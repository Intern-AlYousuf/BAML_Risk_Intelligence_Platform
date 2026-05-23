import { cn } from '../../lib/theme';

export interface SectionTitleProps {
  title:      string;
  subtitle?:  string;
  eyebrow?:   string;
  actions?:   React.ReactNode;
  spacing?:   'sm' | 'md' | 'lg';
  className?: string;
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
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#888888]">
            {eyebrow}
          </p>
        )}
        <Tag
          className="font-semibold text-[#111111] leading-tight"
          style={{ fontSize: '19px', letterSpacing: '-0.01em' }}
        >
          {title}
        </Tag>
        {subtitle && (
          <p className="text-[13.5px] text-[#888888] leading-none">
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

export interface DividerLabelProps {
  label?:     string;
  className?: string;
}

export function DividerLabel({ label, className }: DividerLabelProps) {
  if (!label) {
    return <div className={cn('w-full h-px bg-[#E5E5E3]', className)} />;
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex-1 h-px bg-[#E5E5E3]" />
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#BBBBBB] shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-[#E5E5E3]" />
    </div>
  );
}
