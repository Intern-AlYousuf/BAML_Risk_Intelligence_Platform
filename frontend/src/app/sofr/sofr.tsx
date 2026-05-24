'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, AlertTriangle, ChevronRight,
} from 'lucide-react';

import { AppShell }           from '@/components/layout/AppShell';
import { PageContainer }      from '@/components/layout/PageContainer';
import { StatCard }            from '@/components/cards/StatCard';
import { ChartCard }           from '@/components/cards/ChartCard';
import { InsightCard }         from '@/components/cards/InsightCard';
import { ForecastChart, FORECAST_LEGEND } from '@/components/charts/ForecastChart';
import { DistributionChart }   from '@/components/charts/DistributionCharrt';
import { SegmentedControl }    from '@/components/ui/segmentedcontrol';
import { Button }              from '@/components/ui/button';
import { SectionTitle }        from '@/components/ui/sectiontile';
import { useSofrForecast, type Horizon } from '@/hooks/useSofrForecast';

/* ---------------------------------------------------------------------------
   Horizon options
   --------------------------------------------------------------------------- */

const HORIZON_OPTIONS = [
  { label: '90D',  value: '3M'  as Horizon },
  { label: '180D', value: '6M'  as Horizon },
  { label: '12M',  value: '12M' as Horizon },
];

/* ---------------------------------------------------------------------------
   Static insights — qualitative analysis per horizon
   --------------------------------------------------------------------------- */

const INSIGHTS: Record<Horizon, Array<{
  icon:     'trend' | 'risk' | 'signal';
  severity: 'accent' | 'warning' | 'danger' | 'info' | 'neutral';
  title:    string;
  body:     string;
}>> = {
  '3M': [
    {
      icon:     'trend',
      severity: 'accent',
      title:    'Easing Trajectory',
      body:     'Fed funds futures price in one 25 bps cut near-term. SOFR expected to track 2–5 bps below the effective fed funds rate throughout the quarter, consistent with current spread dynamics.',
    },
    {
      icon:     'signal',
      severity: 'neutral',
      title:    'Moderate Right Skew',
      body:     'The terminal distribution carries a modest positive tail reflecting residual upside risk from sticky CPI. Base case is dovish but conviction remains moderate at this horizon.',
    },
    {
      icon:     'risk',
      severity: 'warning',
      title:    'FOMC Event Risk',
      body:     'The next FOMC meeting is the primary event risk for this horizon. A hold decision would shift the 3M forecast meaningfully higher toward the P90 confidence boundary.',
    },
  ],
  '6M': [
    {
      icon:     'trend',
      severity: 'accent',
      title:    'Two-Cut Scenario',
      body:     'Base case embeds two sequential 25 bps cuts over the next six months. SOFR is projected to exit the period representing a meaningful reduction from current spot levels.',
    },
    {
      icon:     'signal',
      severity: 'info',
      title:    'Confidence Erosion',
      body:     'The P10–P90 spread widens materially after Q2 as macro uncertainty compounds. Model accuracy degrades over longer horizons — treat the 6M projection as a directional signal, not a precise target.',
    },
    {
      icon:     'risk',
      severity: 'warning',
      title:    'Core PCE Sensitivity',
      body:     'A re-acceleration in core PCE above 2.8% would likely suspend the easing cycle. Under that scenario SOFR converges toward the P75 band, approximately 30–40 bps above base case.',
    },
  ],
  '12M': [
    {
      icon:     'trend',
      severity: 'accent',
      title:    'Normalization Path',
      body:     'The 12-month projection embeds cumulative easing aligned with the FOMC dot-plot median. This represents the market consensus for a soft landing with inflation returning to target.',
    },
    {
      icon:     'signal',
      severity: 'info',
      title:    'Wide Uncertainty Band',
      body:     'The P10–P90 spread at 12M reflects genuine macro ambiguity. Both a shallow easing cycle and a deeper rate cut sequence are statistically plausible under current data conditions.',
    },
    {
      icon:     'risk',
      severity: 'danger',
      title:    'Recession Tail Risk',
      body:     'A hard landing scenario would accelerate cuts substantially, driving SOFR well below the base case and toward the P10 boundary. This tail carries a non-trivial probability in current macro conditions.',
    },
  ],
};

/* ---------------------------------------------------------------------------
   Percentile panel — inline component, specific to this page
   --------------------------------------------------------------------------- */

interface PercentilePanelProps {
  p10?:      number;
  p25?:      number;
  p50?:      number;
  p75?:      number;
  p90?:      number;
  horizon:   Horizon;
  nSims:     number;
  loading:   boolean;
}

const PERCENTILE_ROWS = [
  { key: 'p90' as const, label: 'P90', desc: 'Hawkish tail',  note: 'Persistent inflation, no cuts', color: '#EF4444' },
  { key: 'p75' as const, label: 'P75', desc: 'Upside case',   note: 'Slower easing',                 color: '#F59E0B' },
  { key: 'p50' as const, label: 'P50', desc: 'Base case',     note: 'Consensus Fed path',            color: '#E6B800', featured: true },
  { key: 'p25' as const, label: 'P25', desc: 'Dovish case',   note: 'Faster easing',                 color: '#22C55E' },
  { key: 'p10' as const, label: 'P10', desc: 'Dovish tail',   note: 'Hard landing',                  color: '#22C55E' },
];

function PercentilePanel({
  p10, p25, p50, p75, p90, horizon, nSims, loading,
}: PercentilePanelProps) {
  const vals = { p10, p25, p50, p75, p90 };

  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      {/* Header */}
      <div
        className="px-8 pt-8 pb-6"
        style={{ borderBottom: '1px solid #E5E5E3' }}
      >
        <p className="text-[17px] font-semibold text-[#111111] leading-none tracking-tight">
          Scenario Percentiles
        </p>
        <p className="mt-2 text-[13.5px] text-[#888888]">
          Terminal SOFR · {horizon} horizon
        </p>
      </div>

      {/* Percentile rows */}
      <div className="flex flex-1 flex-col px-7 py-2">
        {PERCENTILE_ROWS.map(({ key, label, desc, note, color, featured }, i) => {
          const value = vals[key];
          const isLast = i === PERCENTILE_ROWS.length - 1;

          return (
            <div
              key={key}
              className="flex items-center justify-between py-4"
              style={{
                borderBottom: isLast ? 'none' : '1px solid #F0F0EE',
                background:   featured ? 'rgba(255,230,0,0.07)' : 'transparent',
                borderRadius: featured ? '10px' : undefined,
                padding:      featured ? '16px 12px' : '16px 0',
                margin:       featured ? '0 -12px' : undefined,
              }}
            >
              {/* Left: dot + labels */}
              <div className="flex items-center gap-3.5">
                <span
                  className="h-[8px] w-[8px] rounded-full shrink-0"
                  style={{ background: color }}
                />
                <div>
                  <p
                    className="text-[14.5px] font-semibold leading-none"
                    style={{ color: featured ? '#E6B800' : '#555555' }}
                  >
                    {label}
                    <span
                      className="ml-2 font-normal text-[12.5px]"
                      style={{ color: '#888888' }}
                    >
                      {desc}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[12px] text-[#888888]">{note}</p>
                </div>
              </div>

              {/* Right: value */}
              <AnimatePresence mode="wait">
                {loading && value === undefined ? (
                  <motion.div
                    key="skel"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="h-4 w-12 skeleton rounded"
                  />
                ) : (
                  <motion.span
                    key={String(value)}
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.15 }}
                    className="text-[19px] font-semibold leading-none"
                    style={{
                      color:              featured ? '#E6B800' : '#111111',
                      fontVariantNumeric: 'tabular-nums',
                      letterSpacing:      '-0.02em',
                    }}
                  >
                    {value !== undefined ? `${value.toFixed(2)}%` : '—'}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="px-8 py-4"
        style={{ borderTop: '1px solid #E5E5E3' }}
      >
        <p className="text-[11.5px] text-[#888888]">
          End-of-period SOFR · {nSims.toLocaleString()} paths
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   SOFR Page
   --------------------------------------------------------------------------- */

export default function SOFRPage() {
  const [horizon, setHorizon] = useState<Horizon>('12M');

  const {
    chartData,
    forecastTickDates,
    splitDate,
    distributionData,
    percentileValues,
    baseRateRange,
    metrics,
    loading,
    error,
    refetch,
  } = useSofrForecast(horizon);

  const insights  = INSIGHTS[horizon];
  const nSims     = metrics?.nSimulations ?? 5_000;
  const today     = new Date().toLocaleDateString('en-US', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <AppShell breadcrumb={['BAML Platform', 'SOFR Forecast']}>
      <PageContainer size="wide">

        {/* ── 1. Page Header ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          className="flex items-end justify-between mb-6"
        >
          {/* Title block */}
          <div className="space-y-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.20em] text-[#888888]">
              Rate Analytics
            </p>
            <h1
              className="font-semibold text-[#111111] leading-none"
              style={{ fontSize: '50px', letterSpacing: '-0.03em' }}
            >
              SOFR Forecast
            </h1>
            <p className="text-[15px] text-[#888888] leading-none">
              Monte Carlo ensemble &middot; {nSims.toLocaleString()} simulations &middot; {today}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {/* Horizon selector */}
            <SegmentedControl
              options={HORIZON_OPTIONS}
              value={horizon}
              onChange={setHorizon}
              size="md"
            />

            {/* Actions */}
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
              onClick={refetch}
              loading={loading}
            >
              Refresh
            </Button>
          </div>
        </motion.div>

        {/* ── Methodology Strip ───────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.03, ease: [0.2, 0, 0, 1] }}
          className="mb-10 pb-5 flex items-center justify-between"
          style={{ borderBottom: '1px solid #E5E5E3' }}
        >
          {/* Label sequence with yellow dot separators */}
          <div className="flex items-center">
            {[
              'ARIMA Rate Forecasting',
              'Monte Carlo Path Generation',
              `${nSims.toLocaleString()} Simulation Paths`,
              'Interest Rate Probability Bands',
            ].map((item, i, arr) => (
              <span key={item} className="flex items-center">
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.15em]"
                  style={{ color: '#777777' }}
                >
                  {item}
                </span>
                {i < arr.length - 1 && (
                  <span
                    className="mx-4 h-[5px] w-[5px] rounded-full shrink-0 inline-block"
                    style={{ background: '#E6B800' }}
                  />
                )}
              </span>
            ))}
          </div>
          {/* Compact model tags */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="text-[9px] font-black uppercase tracking-[0.11em] px-2.5 py-[4px] rounded-[3px]"
              style={{ background: 'rgba(230,184,0,0.12)', border: '1px solid rgba(230,184,0,0.32)', color: '#967A00' }}
            >
              ARIMA
            </span>
            <span
              className="text-[9px] font-black uppercase tracking-[0.11em] px-2.5 py-[4px] rounded-[3px]"
              style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#555555' }}
            >
              MONTE CARLO
            </span>
            <span
              className="text-[9px] font-black uppercase tracking-[0.11em] px-2.5 py-[4px] rounded-[3px]"
              style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#555555' }}
            >
              {nSims.toLocaleString()} PATHS
            </span>
          </div>
        </motion.div>

        {/* ── Error Banner ────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-8 rounded-[16px] flex items-center justify-between px-7 py-5"
              style={{
                background: 'rgba(239,68,68,0.06)',
                border:     '1px solid rgba(239,68,68,0.18)',
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
                  style={{ background: 'rgba(239,68,68,0.10)' }}
                >
                  <AlertTriangle className="h-4 w-4 text-[#EF4444]" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-[#111111]">Forecast unavailable</p>
                  <p className="text-[13px] text-[#888888] mt-0.5">
                    {error.message ?? 'Unable to load SOFR forecast data.'}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
                onClick={refetch}
              >
                Retry
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-10">

          {/* ── 2. Hero Chart ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.04, ease: [0.2, 0, 0, 1] }}
          >
            <ChartCard
              title={`SOFR Forecast · ${horizon}`}
              subtitle={`SOFR overnight rate · Confidence bands from ${nSims.toLocaleString()} Monte Carlo paths`}
              legend={FORECAST_LEGEND}
              height={520}
              loading={loading && !chartData.length}
              actions={
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2.5 py-[4px] rounded-[3px]"
                    style={{ background: 'rgba(230,184,0,0.13)', border: '1px solid rgba(230,184,0,0.32)', color: '#967A00' }}
                  >
                    ARIMA
                  </span>
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2.5 py-[4px] rounded-[3px]"
                    style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#555555' }}
                  >
                    MONTE CARLO
                  </span>
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2.5 py-[4px] rounded-[3px]"
                    style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#888888' }}
                  >
                    {nSims.toLocaleString()} PATHS
                  </span>
                </div>
              }
            >
              <ForecastChart
                data={chartData}
                tickDates={forecastTickDates}
                splitDate={splitDate ?? undefined}
                height={480}
                showHistory
              />
            </ChartCard>
          </motion.div>

          {/* ── 3. KPI Row ────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.08, ease: [0.2, 0, 0, 1] }}
            className="grid grid-cols-4 gap-5"
          >
            <StatCard
              label={`Projected SOFR · ${horizon}`}
              value={metrics?.projected ?? '—'}
              unit="%"
              unitPosition="suffix"
              delta={metrics?.projectedDelta}
              signal={metrics?.projectedSignal ?? 'neutral'}
              accent="yellow"
              featured
              size="lg"
              loading={loading && !metrics}
            />
            <StatCard
              label="Implied Volatility"
              value={metrics?.volatility ?? '—'}
              unit="bps"
              unitPosition="suffix"
              annotation="Annualised, 1σ estimate"
              signal="warning"
              accent="amber"
              size="lg"
              loading={loading && !metrics}
            />
            <StatCard
              label={`Probability Range · ${horizon}`}
              value={metrics?.probRange ?? '—'}
              unit="bps"
              unitPosition="suffix"
              annotation="P10 – P90 terminal spread"
              signal="neutral"
              accent="none"
              size="lg"
              loading={loading && !metrics}
            />
            <StatCard
              label="Model Confidence"
              value={metrics?.confidence ?? '—'}
              unit="%"
              unitPosition="suffix"
              annotation="Ensemble convergence"
              signal={metrics?.confSignal ?? 'neutral'}
              accent={
                !metrics                  ? 'none'  :
                metrics.confidenceRaw >= 80 ? 'green' :
                metrics.confidenceRaw >= 68 ? 'amber' : 'red'
              }
              size="lg"
              loading={loading && !metrics}
            />
          </motion.div>

          {/* ── 3b. Model Explanation Panel ──────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.10, ease: [0.2, 0, 0, 1] }}
          >
            <div
              className="flex items-start gap-6 px-7 py-5 rounded-[8px]"
              style={{ background: '#FAFAF8', border: '1px solid #E5E5E3', borderLeft: '3px solid #E6B800' }}
            >
              {/* Left: methodology tags */}
              <div className="shrink-0 flex flex-col gap-2 pt-0.5 min-w-[120px]">
                <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: '#C9A800' }}>
                  Forecast Engine
                </p>
                <div className="flex flex-col gap-1.5">
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2 py-[3px] rounded-[2px] text-center"
                    style={{ background: 'rgba(230,184,0,0.12)', border: '1px solid rgba(230,184,0,0.30)', color: '#967A00' }}
                  >
                    ARIMA
                  </span>
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2 py-[3px] rounded-[2px] text-center"
                    style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#555555' }}
                  >
                    MONTE CARLO
                  </span>
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2 py-[3px] rounded-[2px] text-center"
                    style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#888888' }}
                  >
                    {nSims.toLocaleString()} PATHS
                  </span>
                </div>
              </div>
              {/* Divider */}
              <div className="self-stretch w-px shrink-0" style={{ background: '#E5E5E3' }} />
              {/* Right: explanation */}
              <p className="text-[13px] leading-[1.75]" style={{ color: '#555555' }}>
                The SOFR projection framework combines{' '}
                <span className="font-semibold" style={{ color: '#111111' }}>ARIMA rate forecasting</span>
                {' '}with{' '}
                <span className="font-semibold" style={{ color: '#111111' }}>Monte Carlo path generation</span>
                {' '}to estimate forward interest-rate dispersion and scenario probability bands.
                Each run draws{' '}
                <span className="font-semibold" style={{ color: '#111111' }}>{nSims.toLocaleString()} stochastic rate paths</span>
                {' '}from the ARIMA residual distribution, producing a full P10–P90 terminal fan
                that captures the plausible range of Fed policy outcomes across the selected horizon.
                The distribution histogram reflects the probability mass of simulated endpoint rates.
              </p>
            </div>
          </motion.div>

          {/* ── 4. Distribution + Percentiles ────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.12, ease: [0.2, 0, 0, 1] }}
            className="grid grid-cols-[1fr_400px] gap-5"
          >
            {/* Distribution histogram */}
            <ChartCard
              title={`Outcome Distribution · ${horizon}`}
              subtitle={`Terminal SOFR probability mass · ${nSims.toLocaleString()} paths`}
              height={400}
              loading={loading && !distributionData.length}
              actions={
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2.5 py-[4px] rounded-[3px]"
                    style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#555555' }}
                  >
                    TERMINAL DIST.
                  </span>
                  <span
                    className="text-[9px] font-black uppercase tracking-[0.10em] px-2.5 py-[4px] rounded-[3px]"
                    style={{ background: '#F0F0EE', border: '1px solid #D8D8D8', color: '#888888' }}
                  >
                    {nSims.toLocaleString()} PATHS
                  </span>
                </div>
              }
            >
              <DistributionChart
                data={distributionData}
                baseRange={baseRateRange.low ? baseRateRange : undefined}
                assetLabel="SOFR"
                height={360}
              />
            </ChartCard>

            {/* Percentile panel */}
            <PercentilePanel
              p10={percentileValues?.p10}
              p25={percentileValues?.p25}
              p50={percentileValues?.p50}
              p75={percentileValues?.p75}
              p90={percentileValues?.p90}
              horizon={horizon}
              nSims={nSims}
              loading={loading}
            />
          </motion.div>

          {/* ── 5. Insights ───────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.16, ease: [0.2, 0, 0, 1] }}
          >
            <SectionTitle
              title="Forecast Insights"
              subtitle={`Scenario analysis · ${horizon} horizon`}
              eyebrow="Analysis"
              spacing="md"
              actions={
                <button className="flex items-center gap-1.5 text-[13px] font-medium text-[#A89208] hover:text-[#F5D90A] transition-colors duration-150">
                  Full report
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              }
            />
            <div className="grid grid-cols-3 gap-5">
              {insights.map((ins) => (
                <InsightCard
                  key={ins.title}
                  icon={ins.icon}
                  severity={ins.severity}
                  title={ins.title}
                  body={ins.body}
                  featured={ins.severity === 'accent'}
                />
              ))}
            </div>
          </motion.div>

        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.2 }}
          className="mt-12 pt-6 pb-6 flex items-center justify-end"
          style={{ borderTop: '1px solid #E5E5E3' }}
        >
          <p className="text-[11.5px] text-[#888888]">
            {new Date().toLocaleDateString('en-US', {
              day: 'numeric', month: 'long', year: 'numeric',
            })} EST
          </p>
        </motion.footer>

      </PageContainer>
    </AppShell>
  );
}
