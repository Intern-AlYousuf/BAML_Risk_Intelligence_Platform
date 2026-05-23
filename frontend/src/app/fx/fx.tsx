'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, AlertTriangle,
  Activity, AlertCircle, ChevronRight,
} from 'lucide-react';

import { AppShell }         from '@/components/layout/AppShell';
import { PageContainer }    from '@/components/layout/PageContainer';
import { StatCard }          from '@/components/cards/StatCard';
import { ChartCard }         from '@/components/cards/ChartCard';
import { InsightCard }       from '@/components/cards/InsightCard';
import { ForecastChart, FORECAST_LEGEND } from '@/components/charts/ForecastChart';
import { DistributionChart } from '@/components/charts/DistributionCharrt';
import { SegmentedControl }  from '@/components/ui/segmentedcontrol';
import { StatusDot }         from '@/components/ui/badge';
import { Button }            from '@/components/ui/button';
import { SectionTitle }      from '@/components/ui/sectiontile';
import {
  useFxForecast,
  type Horizon,
  type CurrencyPair,
} from '@/hooks/useFxForecast';

/* ---------------------------------------------------------------------------
   Control options
   --------------------------------------------------------------------------- */

const PAIR_OPTIONS = [
  { label: 'NGN/USD', value: 'NGNUSD' as CurrencyPair },
  { label: 'INR/USD', value: 'INRUSD' as CurrencyPair },
  { label: 'EUR/INR', value: 'EURINR' as CurrencyPair },
];

const HORIZON_OPTIONS = [
  { label: '3M',  value: '3M'  as Horizon },
  { label: '6M',  value: '6M'  as Horizon },
  { label: '12M', value: '12M' as Horizon },
];

const PAIR_LABELS: Record<CurrencyPair, string> = {
  NGNUSD: 'NGN/USD',
  INRUSD: 'INR/USD',
  EURINR: 'EUR/INR',
};

/* ---------------------------------------------------------------------------
   Static hedging insights per pair × horizon
   --------------------------------------------------------------------------- */

type InsightDef = {
  icon:     'trend' | 'risk' | 'signal';
  severity: 'accent' | 'warning' | 'danger' | 'info' | 'neutral';
  title:    string;
  body:     string;
};

const INSIGHTS: Record<CurrencyPair, Record<Horizon, InsightDef[]>> = {
  NGNUSD: {
    '3M': [
      {
        icon: 'trend', severity: 'danger',
        title: 'Structural Depreciation Risk',
        body:  'NGN/USD continues to face structural selling pressure driven by Nigeria\'s external account deficit and limited FX reserves relative to import cover. Near-term depreciation remains the base case.',
      },
      {
        icon: 'risk', severity: 'warning',
        title: 'USD Hedge Pressure Elevated',
        body:  'Corporates with USD-denominated liabilities face significant hedge costs as carry differentials widen. Forward points on NGN remain elevated, compressing the economics of forward contracts.',
      },
      {
        icon: 'signal', severity: 'neutral',
        title: 'CBN Intervention Risk',
        body:  'Central Bank of Nigeria reserve deployments can temporarily compress spot volatility. P10 tail reflects a coordinated FX intervention scenario that arrests near-term depreciation.',
      },
    ],
    '6M': [
      {
        icon: 'trend', severity: 'danger',
        title: 'Accelerated Depreciation Path',
        body:  'Six-month horizon captures the full impact of Nigeria\'s fiscal financing cycle. Without sustained oil revenue uplift, NGN is projected to weaken materially toward the P75–P90 band.',
      },
      {
        icon: 'risk', severity: 'warning',
        title: 'Oil Revenue Sensitivity',
        body:  'Nigeria\'s FX income is materially correlated with crude oil prices. A sustained Brent decline below $70/bbl would tighten reserve accumulation and accelerate the depreciation trajectory.',
      },
      {
        icon: 'signal', severity: 'info',
        title: 'Wide Uncertainty Cone',
        body:  'The P10–P90 spread widens substantially at 6M, reflecting genuine macro ambiguity around CBN policy, oil prices, and capital flow reversals. Treat the base case as directional, not precise.',
      },
    ],
    '12M': [
      {
        icon: 'trend', severity: 'danger',
        title: 'Long-Run Equilibrium Reset',
        body:  'Over a 12-month horizon, NGN depreciation expectations are embedded in the forward curve. The base case embeds continued real exchange rate adjustment toward purchasing power parity.',
      },
      {
        icon: 'risk', severity: 'warning',
        title: 'Hedging Instrument Scarcity',
        body:  'Liquid FX hedging instruments for NGN at the 12M tenor are limited in depth. Corporates should consider rolling short-dated forward contracts or NDF structures to manage exposure efficiently.',
      },
      {
        icon: 'signal', severity: 'danger',
        title: 'Tail Risk: Policy Reversal',
        body:  'Reintroduction of capital controls or dual exchange rate regimes remains a non-trivial tail risk. Such a policy shift would generate immediate P90+ NGN depreciation as investor confidence collapses.',
      },
    ],
  },

  INRUSD: {
    '3M': [
      {
        icon: 'trend', severity: 'accent',
        title: 'Moderate Volatility Regime',
        body:  'INR/USD is forecast to trade within a moderate volatility band over the 3M horizon, supported by India\'s robust reserve buffer and RBI\'s active intervention framework.',
      },
      {
        icon: 'signal', severity: 'neutral',
        title: 'Carry Trade Stability',
        body:  'India\'s positive carry differential relative to USD supports near-term INR stability. The risk-adjusted carry remains attractive for EM fund flows into Indian fixed income assets.',
      },
      {
        icon: 'risk', severity: 'warning',
        title: 'Seasonal CAD Widening',
        body:  'India\'s current account deficit typically widens in Q1–Q2 due to gold import seasonality. This creates periodic INR depreciation pressure concentrated in the 3M window.',
      },
    ],
    '6M': [
      {
        icon: 'trend', severity: 'accent',
        title: 'Managed Float Support',
        body:  'RBI\'s active FX management limits the tail distribution width at 6M, compressing both the P10 and P90 bands relative to free-floating peers. The base case implies gradual, orderly depreciation.',
      },
      {
        icon: 'signal', severity: 'info',
        title: 'FII Flow Sensitivity',
        body:  'Foreign institutional investor flows into Indian equity and debt markets are the dominant short-run driver of INR. A Fed pivot or US yield spike can materially shift flow dynamics over this horizon.',
      },
      {
        icon: 'risk', severity: 'warning',
        title: 'Oil Import Channel',
        body:  'India is a major crude oil importer. A sustained oil price rally increases USD demand from refiners and pressures INR toward the P75 scenario regardless of domestic macro conditions.',
      },
    ],
    '12M': [
      {
        icon: 'trend', severity: 'accent',
        title: 'Structural Appreciation Bias',
        body:  'India\'s strong services export growth and FDI inflows support a structural INR appreciation bias at the 12M horizon. The P50 projects modest INR gains relative to current spot.',
      },
      {
        icon: 'signal', severity: 'neutral',
        title: 'RBI Accumulation Cycle',
        body:  'RBI reserves remain near record levels, providing sufficient ammunition to absorb external shocks. This backstop compresses the downside tail at the 12M horizon meaningfully.',
      },
      {
        icon: 'risk', severity: 'info',
        title: 'Election Cycle Uncertainty',
        body:  'Fiscal slippage risk around the election cycle could weigh on INR through the rating watch channel. The P75–P90 bands embed a scenario where the fiscal deficit widens above the 4.5% of GDP target.',
      },
    ],
  },

  EURINR: {
    '3M': [
      {
        icon: 'trend', severity: 'accent',
        title: 'Cross-Rate Divergence',
        body:  'EUR/INR dynamics are driven by the divergence between ECB easing expectations and RBI\'s hold bias. Near-term EUR weakness relative to USD compounds into a mild EUR/INR depreciation path.',
      },
      {
        icon: 'signal', severity: 'warning',
        title: 'ECB/RBI Policy Spread',
        body:  'The ECB is in an active cutting cycle while RBI holds rates stable. This policy divergence compresses the EUR carry advantage and creates structural selling pressure on EUR/INR.',
      },
      {
        icon: 'risk', severity: 'neutral',
        title: 'Eurozone Growth Sensitivity',
        body:  'Weak German PMI data and below-trend Eurozone GDP growth weigh on EUR fundamentals. A positive data surprise could temporarily push EUR/INR toward the P75 scenario.',
      },
    ],
    '6M': [
      {
        icon: 'trend', severity: 'warning',
        title: 'Compounding Cross Effects',
        body:  'Over 6M, EUR/INR captures compounding cross-currency effects from both EUR/USD and USD/INR legs. Divergent central bank paths widen the uncertainty cone at this horizon significantly.',
      },
      {
        icon: 'signal', severity: 'info',
        title: 'Geopolitical Premium',
        body:  'European energy security concerns and ongoing Ukraine conflict dynamics maintain an elevated geopolitical risk premium on EUR. This structurally limits EUR appreciation against EM pairs including INR.',
      },
      {
        icon: 'risk', severity: 'warning',
        title: 'ECB Pivot Tail Risk',
        body:  'A material ECB pause or hawkish pivot — triggered by sticky Eurozone services CPI — would compress the EUR depreciation trajectory and push EUR/INR toward the P75–P90 band.',
      },
    ],
    '12M': [
      {
        icon: 'trend', severity: 'neutral',
        title: 'Neutral Long-Run Drift',
        body:  'EUR/INR exhibits low structural drift at the 12M horizon as both legs — EUR/USD and USD/INR — partially offset one another. The P50 projects near-flat cross-rate movement from current spot.',
      },
      {
        icon: 'signal', severity: 'info',
        title: 'Wider CI Bands',
        body:  'The P10–P90 spread at 12M reflects the compounded uncertainty of two managed exchange rate pairs. Model confidence is lower than for direct USD pairs at this horizon.',
      },
      {
        icon: 'risk', severity: 'warning',
        title: 'European Election Risk',
        body:  'EU parliamentary dynamics and potential policy shifts on fiscal rules could generate episodic EUR volatility. A fragmented political outcome would widen credit spreads and weaken EUR across EM crosses.',
      },
    ],
  },
};

/* ---------------------------------------------------------------------------
   Percentile panel — FX-specific labels
   --------------------------------------------------------------------------- */

interface PercentilePanelProps {
  p10?:     number;
  p25?:     number;
  p50?:     number;
  p75?:     number;
  p90?:     number;
  pair:     CurrencyPair;
  horizon:  Horizon;
  nSims:    number;
  loading:  boolean;
}

const PERCENTILE_ROWS = [
  { key: 'p90' as const, label: 'P90', desc: 'Severe depreciation', note: 'Worst 10% outcome', color: '#EF4444' },
  { key: 'p75' as const, label: 'P75', desc: 'Upside risk',         note: 'Moderate weakness', color: '#F59E0B' },
  { key: 'p50' as const, label: 'P50', desc: 'Base case',           note: 'Consensus path',    color: '#E6B800', featured: true },
  { key: 'p25' as const, label: 'P25', desc: 'Stable scenario',     note: 'Limited moves',     color: '#22C55E' },
  { key: 'p10' as const, label: 'P10', desc: 'Strong appreciation', note: 'Best 10% outcome',  color: '#22C55E' },
];

function PercentilePanel({
  p10, p25, p50, p75, p90, pair, horizon, nSims, loading,
}: PercentilePanelProps) {
  const vals = { p10, p25, p50, p75, p90 };

  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
    >
      {/* Header */}
      <div
        className="px-8 pt-7 pb-5"
        style={{ borderBottom: '1px solid #E5E5E3' }}
      >
        <p className="text-[16px] font-semibold text-[#111111] leading-none tracking-tight">
          Scenario Percentiles
        </p>
        <p className="mt-1.5 text-[12.5px] text-[#888888]">
          Terminal {PAIR_LABELS[pair]} · {horizon} horizon
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
              className="flex items-center justify-between"
              style={{
                borderBottom: isLast ? 'none' : '1px solid #E5E5E3',
                background:   featured ? 'rgba(255,230,0,0.07)' : 'transparent',
                borderRadius: featured ? '4px' : undefined,
                padding:      featured ? '16px 12px' : '16px 0',
                margin:       featured ? '0 -12px' : undefined,
              }}
            >
              <div className="flex items-center gap-3.5">
                <span
                  className="h-[8px] w-[8px] rounded-full shrink-0"
                  style={{ background: color }}
                />
                <div>
                  <p
                    className="text-[14px] font-semibold leading-none"
                    style={{ color: featured ? '#967A00' : '#555555' }}
                  >
                    {label}
                    <span className="ml-2 font-normal text-[12px] text-[#888888]">
                      {desc}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[11.5px] text-[#BBBBBB]">{note}</p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {loading && value === undefined ? (
                  <motion.div
                    key="skel"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="h-4 w-16 skeleton rounded"
                  />
                ) : (
                  <motion.span
                    key={String(value)}
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.15 }}
                    className="text-[18px] font-bold leading-none"
                    style={{
                      color:              featured ? '#967A00' : '#111111',
                      fontVariantNumeric: 'tabular-nums',
                      letterSpacing:      '-0.025em',
                    }}
                  >
                    {value !== undefined ? value.toFixed(2) : '—'}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-8 py-4" style={{ borderTop: '1px solid #E5E5E3' }}>
        <p className="text-[11px] text-[#BBBBBB]">
          Terminal {PAIR_LABELS[pair]} rate · {nSims.toLocaleString()} paths
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   FX Page
   --------------------------------------------------------------------------- */

export default function FXPage() {
  const [pair,    setPair]    = useState<CurrencyPair>('NGNUSD');
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
  } = useFxForecast(pair, horizon);

  const insights = INSIGHTS[pair][horizon];
  const nSims    = metrics?.nSimulations ?? 5_000;
  const today    = new Date().toLocaleDateString('en-US', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const pairLabel = PAIR_LABELS[pair];

  return (
    <AppShell breadcrumb={['BAML Platform', 'FX Forecast']}>
      <PageContainer size="wide">

        {/* ── 1. Page Header ────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          className="flex items-end justify-between mb-14"
        >
          {/* Title block */}
          <div className="space-y-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.20em] text-[#888888]">
              FX Analytics
            </p>
            <h1
              className="font-semibold text-[#111111] leading-none"
              style={{ fontSize: '50px', letterSpacing: '-0.03em' }}
            >
              FX Forecast
            </h1>
            <p className="text-[15px] text-[#888888] leading-none">
              Monte Carlo ensemble &middot; {nSims.toLocaleString()} simulations &middot; {today}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {/* Live status */}
            <div className="flex items-center gap-2 text-[13px] text-[#888888] mr-1">
              <StatusDot
                variant={loading ? 'neutral' : error ? 'danger' : 'success'}
                pulse={!loading && !error}
                size="sm"
              />
              <span>{loading ? 'Loading…' : error ? 'Offline' : 'Live'}</span>
            </div>

            {/* Currency pair selector */}
            <SegmentedControl
              options={PAIR_OPTIONS}
              value={pair}
              onChange={setPair}
              size="md"
            />

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

        {/* ── Error Banner ──────────────────────────────────────────────── */}
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
                    {error.message ?? `Unable to load ${pairLabel} forecast data.`}
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

          {/* ── 2. Hero Chart ───────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.04, ease: [0.2, 0, 0, 1] }}
          >
            <ChartCard
              title={`${pairLabel} Rate Trajectory · ${horizon}`}
              subtitle={`Exchange rate forecast · Confidence bands from ${nSims.toLocaleString()} Monte Carlo paths`}
              legend={FORECAST_LEGEND}
              height={520}
              loading={loading && !chartData.length}
              actions={
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-[12px] text-[#888888]"
                  style={{ background: '#F0F0EE', border: '1px solid #D8D8D8' }}
                >
                  <AlertCircle className="h-3.5 w-3.5 opacity-60" strokeWidth={1.5} />
                  ARIMA + MC
                </div>
              }
            >
              <ForecastChart
                data={chartData}
                tickDates={forecastTickDates}
                splitDate={splitDate ?? undefined}
                height={480}
                showHistory
                assetType="fx"
              />
            </ChartCard>
          </motion.div>

          {/* ── 3. KPI Row ──────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.08, ease: [0.2, 0, 0, 1] }}
            className="grid grid-cols-4 gap-5"
          >
            <StatCard
              label={`Projected ${pairLabel} · ${horizon}`}
              value={metrics?.projectedRate ?? '—'}
              delta={metrics?.projectedDelta}
              signal={metrics?.projectedSignal ?? 'neutral'}
              accent="yellow"
              featured
              size="lg"
              loading={loading && !metrics}
            />
            <StatCard
              label="Annualised Volatility"
              value={metrics?.volatility ?? '—'}
              unit="%"
              unitPosition="suffix"
              annotation="ARIMA residual dispersion"
              signal="warning"
              accent="amber"
              size="lg"
              loading={loading && !metrics}
            />
            <StatCard
              label="VaR (95%)"
              value={metrics?.var95 ?? '—'}
              annotation="95th percentile downside move"
              signal="negative"
              accent="red"
              size="lg"
              loading={loading && !metrics}
            />
            <StatCard
              label="Model Confidence"
              value={metrics?.confidence ?? '—'}
              unit="%"
              unitPosition="suffix"
              annotation="MC convergence metric"
              signal={metrics?.confSignal ?? 'neutral'}
              accent={
                !metrics                       ? 'none'  :
                metrics.confidenceRaw >= 80    ? 'green' :
                metrics.confidenceRaw >= 68    ? 'amber' : 'red'
              }
              size="lg"
              loading={loading && !metrics}
            />
          </motion.div>

          {/* ── 4. Distribution + Percentiles ───────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.12, ease: [0.2, 0, 0, 1] }}
            className="grid grid-cols-[1fr_400px] gap-5"
          >
            {/* Distribution histogram */}
            <ChartCard
              title={`Outcome Distribution · ${horizon}`}
              subtitle={`Terminal ${pairLabel} probability mass · ${nSims.toLocaleString()} paths`}
              height={400}
              loading={loading && !distributionData.length}
              actions={
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-[12px] text-[#888888]"
                  style={{ background: '#F0F0EE', border: '1px solid #D8D8D8' }}
                >
                  <Activity className="h-3.5 w-3.5 opacity-60" strokeWidth={1.5} />
                  Monte Carlo
                </div>
              }
            >
              <DistributionChart
                data={distributionData}
                baseRange={baseRateRange.low ? baseRateRange : undefined}
                assetLabel={pairLabel}
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
              pair={pair}
              horizon={horizon}
              nSims={nSims}
              loading={loading}
            />
          </motion.div>

          {/* ── 5. Hedging Insights ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.16, ease: [0.2, 0, 0, 1] }}
          >
            <SectionTitle
              title="Hedging Insights"
              subtitle={`${pairLabel} scenario analysis · ${horizon} horizon`}
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

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.2 }}
          className="mt-12 pt-6 pb-6 flex items-center justify-between"
          style={{ borderTop: '1px solid #E5E5E3' }}
        >
          <p className="text-[11.5px] text-[#888888] max-w-lg">
            BAML Risk Intelligence Platform · FX forecasts are model outputs and not
            investment advice. Past model performance does not guarantee future accuracy.
          </p>
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
