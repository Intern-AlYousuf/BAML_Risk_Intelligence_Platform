import { AppShell } from '../components/layout/AppShell';
import { PageContainer, PageHeader, PageSection } from '../components/layout/PageContainer';
import { SectionTitle } from '../components/ui/sectiontile';
import { Badge, StatusDot } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Download, RefreshCw, TrendingUp, Shield, Activity, BarChart3 } from 'lucide-react';

/* ---------------------------------------------------------------------------
   Placeholder KPI card — skeleton until real StatCard is wired up
   --------------------------------------------------------------------------- */

function PlaceholderKPI({
  label,
  value,
  unit,
  delta,
  featured,
}: {
  label:    string;
  value:    string;
  unit?:    string;
  delta?:   string;
  featured?: boolean;
}) {
  return (
    <div
      className="flex flex-col rounded-[20px] p-8 min-h-[180px]"
      style={{
        background:  featured ? 'rgba(245,217,10,0.05)' : '#15171C',
        border:      featured
          ? '1px solid rgba(245,217,10,0.15)'
          : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Top accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] rounded-t-[20px]"
        style={{ background: featured ? '#F5D90A' : 'rgba(255,255,255,0.06)' }}
      />

      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#6B7280] leading-none">
        {label}
      </p>

      <div className="mt-auto pt-6 flex items-baseline gap-2">
        <span
          className="font-semibold leading-none"
          style={{
            fontSize:      '48px',
            letterSpacing: '-0.025em',
            color:         featured ? '#F5D90A' : '#F5F7FA',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[18px] font-medium text-[#6B7280] leading-none">
            {unit}
          </span>
        )}
      </div>

      {delta && (
        <p className="mt-3 text-[13px] text-[#6B7280]">{delta}</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Placeholder chart block
   --------------------------------------------------------------------------- */

function PlaceholderChart({
  title,
  subtitle,
  height = 280,
  icon: Icon,
}: {
  title:    string;
  subtitle: string;
  height?:  number;
  icon:     React.ElementType;
}) {
  return (
    <div
      className="rounded-[20px] overflow-hidden"
      style={{
        background: '#15171C',
        border:     '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-8 py-6"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div>
          <p className="text-[16px] font-semibold text-[#F5F7FA] leading-none tracking-tight">
            {title}
          </p>
          <p className="mt-1.5 text-[13px] text-[#6B7280]">{subtitle}</p>
        </div>
        <Icon className="h-5 w-5 text-[#374151]" strokeWidth={1.5} />
      </div>

      {/* Chart placeholder */}
      <div
        className="flex items-center justify-center"
        style={{ height }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-[14px]"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <Icon className="h-5 w-5 text-[#374151]" strokeWidth={1.5} />
          </div>
          <p className="text-[13px] text-[#374151]">Chart data loads here</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Dashboard page
   --------------------------------------------------------------------------- */

export default function DashboardPage() {
  return (
    <AppShell breadcrumb={['BAML Platform', 'Overview']}>
      <PageContainer size="wide">

        {/* Page header */}
        <PageHeader
          eyebrow="Risk Analytics"
          title="Overview"
          subtitle="Portfolio health and key risk indicators"
          actions={
            <>
              <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
                <StatusDot variant="success" pulse size="sm" />
                <span>Live</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Download className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                Export
              </Button>
            </>
          }
        />

        {/* Sections */}
        <div className="space-y-12">

          {/* KPI row */}
          <PageSection>
            <SectionTitle
              title="Portfolio Metrics"
              subtitle="Real-time risk and performance indicators"
              eyebrow="Key figures"
              spacing="sm"
            />
            <div className="grid grid-cols-4 gap-5">
              <div className="relative">
                <PlaceholderKPI
                  label={`Projected SOFR · 12M`}
                  value="4.38"
                  unit="%"
                  delta="Monte Carlo ensemble · 10,000 paths"
                  featured
                />
              </div>
              <PlaceholderKPI
                label="Implied Volatility"
                value="42"
                unit="bps"
                delta="Annualised"
              />
              <PlaceholderKPI
                label="Hedge Ratio"
                value="78"
                unit="%"
                delta="Portfolio coverage"
              />
              <PlaceholderKPI
                label="Model Confidence"
                value="83"
                unit="%"
                delta="Ensemble agreement"
              />
            </div>
          </PageSection>

          {/* Charts row */}
          <PageSection>
            <SectionTitle
              title="Analytics"
              subtitle="Forecast trajectories and risk exposure"
              eyebrow="Charts"
              spacing="sm"
              actions={
                <Badge variant="accent" dot pulseDot>Live model</Badge>
              }
            />
            <div className="grid grid-cols-[1fr_1fr] gap-5">
              <PlaceholderChart
                title="SOFR Rate Forecast"
                subtitle="12-month Monte Carlo ensemble · 90% CI"
                height={320}
                icon={TrendingUp}
              />
              <PlaceholderChart
                title="FX Exposure"
                subtitle="Portfolio currency risk by bucket"
                height={320}
                icon={Activity}
              />
            </div>
          </PageSection>

          {/* Bottom row */}
          <PageSection>
            <div className="grid grid-cols-[1fr_380px] gap-5">
              <PlaceholderChart
                title="Risk Exposure"
                subtitle="Notional risk by asset class and tenor"
                height={260}
                icon={Shield}
              />
              <PlaceholderChart
                title="Hedge Portfolio"
                subtitle="Instrument breakdown"
                height={260}
                icon={BarChart3}
              />
            </div>
          </PageSection>

        </div>

        {/* Footer */}
        <footer
          className="mt-12 pt-6 pb-4 flex items-center justify-between"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <p className="text-[11.5px] text-[#374151]">
            BAML Risk Intelligence Platform · Data is for analytical purposes only.
          </p>
          <p className="text-[11.5px] text-[#374151]">
            v2 · {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </footer>

      </PageContainer>
    </AppShell>
  );
}
