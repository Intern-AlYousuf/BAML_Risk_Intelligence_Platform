import { TrendingUp, AlertTriangle, Activity, Info, Zap } from 'lucide-react';
import { cn } from '../../lib/theme';

export type InsightIcon     = 'trend' | 'risk' | 'signal' | 'info' | 'alert';
export type InsightSeverity = 'accent' | 'warning' | 'danger' | 'info' | 'neutral';

export interface InsightCardProps {
  icon?:      InsightIcon;
  title:      string;
  body:       string;
  severity?:  InsightSeverity;
  featured?:  boolean;
  className?: string;
}

const ICON_MAP: Record<InsightIcon, React.ElementType> = {
  trend:  TrendingUp,
  risk:   AlertTriangle,
  signal: Activity,
  info:   Info,
  alert:  Zap,
};

const SEVERITY_CONFIG: Record<InsightSeverity, {
  iconBg:      string;
  iconColor:   string;
  labelColor:  string;
  cardBg:      string;
  cardBorder:  string;
  hoverBorder: string;
  barColor:    string;
}> = {
  accent: {
    iconBg:      'rgba(255,230,0,0.15)',
    iconColor:   '#967A00',
    labelColor:  '#967A00',
    cardBg:      '#FFFFFF',
    cardBorder:  '#D8D8D8',
    hoverBorder: '#B8B8B6',
    barColor:    '#FFE600',
  },
  warning: {
    iconBg:      'rgba(217,119,6,0.10)',
    iconColor:   '#D97706',
    labelColor:  '#B45309',
    cardBg:      '#FFFFFF',
    cardBorder:  '#D8D8D8',
    hoverBorder: '#B8B8B6',
    barColor:    '#D97706',
  },
  danger: {
    iconBg:      'rgba(220,38,38,0.08)',
    iconColor:   '#DC2626',
    labelColor:  '#B91C1C',
    cardBg:      '#FFFFFF',
    cardBorder:  '#D8D8D8',
    hoverBorder: '#B8B8B6',
    barColor:    '#DC2626',
  },
  info: {
    iconBg:      'rgba(37,99,235,0.08)',
    iconColor:   '#2563EB',
    labelColor:  '#888888',
    cardBg:      '#FFFFFF',
    cardBorder:  '#D8D8D8',
    hoverBorder: '#B8B8B6',
    barColor:    '#2563EB',
  },
  neutral: {
    iconBg:      '#F0F0EE',
    iconColor:   '#888888',
    labelColor:  '#888888',
    cardBg:      '#FFFFFF',
    cardBorder:  '#D8D8D8',
    hoverBorder: '#B8B8B6',
    barColor:    '#D8D8D8',
  },
};

export function InsightCard({
  icon     = 'info',
  title,
  body,
  severity = 'neutral',
  featured = false,
  className,
}: InsightCardProps) {
  const cfg  = SEVERITY_CONFIG[severity];
  const Icon = ICON_MAP[icon];

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-[8px] p-7 transition-all duration-200 overflow-hidden',
        className,
      )}
      style={{
        background:  cfg.cardBg,
        border:      `1px solid ${cfg.cardBorder}`,
        boxShadow:   '0 1px 4px rgba(0,0,0,0.05)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = cfg.hoverBorder;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = cfg.cardBorder;
      }}
    >
      {/* Top accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: cfg.barColor }}
      />

      <div className="flex items-start gap-4 mt-1">
        {/* Icon badge */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px]"
          style={{ background: cfg.iconBg }}
        >
          <Icon
            className="h-[18px] w-[18px]"
            style={{ color: cfg.iconColor }}
            strokeWidth={1.75}
          />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2.5 leading-none"
            style={{ color: cfg.labelColor }}
          >
            {title}
          </p>
          <p className="text-[13.5px] leading-[1.65] text-[#555555]">{body}</p>
        </div>
      </div>
    </div>
  );
}
