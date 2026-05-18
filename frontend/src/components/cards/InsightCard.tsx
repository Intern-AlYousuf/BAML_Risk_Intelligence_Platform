import { TrendingUp, AlertTriangle, Activity, Info, Zap } from 'lucide-react';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export type InsightIcon     = 'trend' | 'risk' | 'signal' | 'info' | 'alert';
export type InsightSeverity = 'accent' | 'warning' | 'danger' | 'info' | 'neutral';

export interface InsightCardProps {
  /** Icon type */
  icon?:      InsightIcon;
  /** Bold compact heading */
  title:      string;
  /** Explanatory body text */
  body:       string;
  /** Colour treatment */
  severity?:  InsightSeverity;
  /** Larger featured card with tinted background */
  featured?:  boolean;
  className?: string;
}

/* ---------------------------------------------------------------------------
   Config
   --------------------------------------------------------------------------- */

const ICON_MAP: Record<InsightIcon, React.ElementType> = {
  trend:  TrendingUp,
  risk:   AlertTriangle,
  signal: Activity,
  info:   Info,
  alert:  Zap,
};

const SEVERITY_CONFIG: Record<InsightSeverity, {
  iconBg:     string;
  iconColor:  string;
  labelColor: string;
  cardBg:     string;
  cardBorder: string;
  hoverBorder: string;
}> = {
  accent: {
    iconBg:      'rgba(245,217,10,0.10)',
    iconColor:   '#F5D90A',
    labelColor:  '#A89208',
    cardBg:      'rgba(245,217,10,0.035)',
    cardBorder:  'rgba(245,217,10,0.11)',
    hoverBorder: 'rgba(245,217,10,0.20)',
  },
  warning: {
    iconBg:      'rgba(245,158,11,0.10)',
    iconColor:   '#F59E0B',
    labelColor:  '#D97706',
    cardBg:      'rgba(245,158,11,0.04)',
    cardBorder:  'rgba(245,158,11,0.12)',
    hoverBorder: 'rgba(245,158,11,0.22)',
  },
  danger: {
    iconBg:      'rgba(239,68,68,0.10)',
    iconColor:   '#EF4444',
    labelColor:  '#DC2626',
    cardBg:      'rgba(239,68,68,0.04)',
    cardBorder:  'rgba(239,68,68,0.12)',
    hoverBorder: 'rgba(239,68,68,0.22)',
  },
  info: {
    iconBg:      'rgba(59,130,246,0.10)',
    iconColor:   '#3B82F6',
    labelColor:  '#6B7280',
    cardBg:      '#15171C',
    cardBorder:  'rgba(255,255,255,0.06)',
    hoverBorder: 'rgba(255,255,255,0.11)',
  },
  neutral: {
    iconBg:      'rgba(255,255,255,0.06)',
    iconColor:   '#6B7280',
    labelColor:  '#6B7280',
    cardBg:      '#15171C',
    cardBorder:  'rgba(255,255,255,0.06)',
    hoverBorder: 'rgba(255,255,255,0.11)',
  },
};

/* ---------------------------------------------------------------------------
   InsightCard
   --------------------------------------------------------------------------- */

export function InsightCard({
  icon     = 'info',
  title,
  body,
  severity = 'neutral',
  featured = false,
  className,
}: InsightCardProps) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = ICON_MAP[icon];

  return (
    <div
      className={cn(
        'group flex flex-col rounded-[20px] p-7 transition-all duration-200',
        featured && 'ring-0',
        className,
      )}
      style={{
        background: cfg.cardBg,
        border:     `1px solid ${cfg.cardBorder}`,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = cfg.hoverBorder;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = cfg.cardBorder;
      }}
    >
      <div className="flex items-start gap-4">
        {/* Icon badge */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
          style={{ background: cfg.iconBg }}
        >
          <Icon
            className="h-[17px] w-[17px]"
            style={{ color: cfg.iconColor }}
            strokeWidth={1.75}
          />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.14em] mb-2.5 leading-none"
            style={{ color: cfg.labelColor }}
          >
            {title}
          </p>
          <p className="text-[14px] leading-[1.65] text-[#A1A8B3]">{body}</p>
        </div>
      </div>
    </div>
  );
}
