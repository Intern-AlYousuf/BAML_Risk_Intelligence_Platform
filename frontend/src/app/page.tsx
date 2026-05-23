'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ChevronRight, ArrowRight, Cpu, Globe2, Shield } from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, AreaChart, Area,
} from 'recharts';

import { AppShell }      from '../components/layout/AppShell';
import { PageContainer } from '../components/layout/PageContainer';
import { StatCard }       from '../components/cards/StatCard';
import { ChartCard }      from '../components/cards/ChartCard';
import { SectionTitle }   from '../components/ui/sectiontile';
import { StatusDot }      from '../components/ui/badge';

import { useSofrForecast }    from '../hooks/useSofrForecast';
import { useFxForecast }      from '../hooks/useFxForecast';
import type { ForecastPoint } from '../components/charts/ForecastChart';
import {
  computeScenarioPnl,
  computePnlDelta,
  BASE_CASE,
} from '../lib/scenarioEngine';

/* ===========================================================================
   MiniSparkline
   =========================================================================== */

function MiniSparkline({ data, uid }: { data: ForecastPoint[]; uid: string }) {
  const step    = Math.max(1, Math.floor(data.length / 50));
  const sampled = data.filter((_, i) => i % step === 0);
  const gid     = `sg-${uid}`;

  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={sampled} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#E6B800" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#E6B800" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="forecast"
          stroke="#E6B800"
          strokeWidth={1.5}
          fill={`url(#${gid})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ===========================================================================
   ForecastSummaryCard
   =========================================================================== */

function ForecastSummaryCard({
  uid, title, value, unit, volLabel, confidence, chartData, href, loading,
}: {
  uid:         string;
  title:       string;
  value:       string;
  unit?:       string;
  volLabel?:   string;
  confidence?: string;
  chartData:   ForecastPoint[];
  href:        string;
  loading:     boolean;
}) {
  const forecastOnly = useMemo(
    () => chartData.filter(d => d.forecast != null),
    [chartData],
  );

  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      <div className="px-7 pt-7 pb-3">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#888888] leading-none">
          {title}
        </p>
        {loading ? (
          <div className="skeleton h-9 w-28 rounded mt-3" />
        ) : (
          <div className="flex items-baseline gap-1.5 mt-2.5">
            <span
              className="font-semibold leading-none"
              style={{
                fontSize: '2.25rem', color: '#E6B800',
                fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em',
              }}
            >
              {value}
            </span>
            {unit && (
              <span className="text-[1.1rem] font-medium leading-none text-[#888888]">{unit}</span>
            )}
          </div>
        )}
      </div>

      <div className="px-3">
        {!loading && forecastOnly.length > 0
          ? <MiniSparkline data={forecastOnly} uid={uid} />
          : <div className="h-[56px]" />
        }
      </div>

      <div
        className="grid grid-cols-2 gap-4 px-7 py-4"
        style={{ borderTop: '1px solid #F0F0EE' }}
      >
        {volLabel && (
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.10em] text-[#888888]">Volatility</p>
            <p className="text-[13.5px] font-semibold text-[#555555] mt-0.5 tabular-nums">{volLabel}</p>
          </div>
        )}
        {confidence && (
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.10em] text-[#888888]">Confidence</p>
            <p className="text-[13.5px] font-semibold text-[#555555] mt-0.5 tabular-nums">{confidence}%</p>
          </div>
        )}
      </div>

      <Link
        href={href}
        className="flex items-center justify-between px-7 py-4 text-[12.5px] font-semibold text-[#A89208] hover:text-[#F5D90A] transition-colors duration-150"
        style={{ borderTop: '1px solid #E5E5E3' }}
      >
        <span>Open Forecast</span>
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Link>
    </div>
  );
}

/* ===========================================================================
   InterpretationPanel
   =========================================================================== */

function InterpretationPanel({ insights }: { insights: string[] }) {
  return (
    <div
      className="flex flex-col rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      <div className="px-9 pt-8 pb-5" style={{ borderBottom: '1px solid #E5E5E3' }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#888888]">
          Treasury Intelligence
        </p>
        <p className="mt-2 text-[17px] font-semibold text-[#111111] leading-tight tracking-tight">
          Market Interpretation
        </p>
        <p className="mt-1.5 text-[13px] text-[#888888]">
          Deterministic signals derived from live forecast data
        </p>
      </div>

      <div className="flex flex-col flex-1 px-9 py-6 gap-5">
        {insights.map((text, i) => (
          <div key={i} className="flex items-start gap-3.5">
            <span
              className="h-[6px] w-[6px] rounded-full shrink-0 mt-[7px]"
              style={{ background: '#E6B800' }}
            />
            <p className="text-[13.5px] text-[#555555] leading-[1.65]">{text}</p>
          </div>
        ))}
      </div>

      <div className="px-9 py-4" style={{ borderTop: '1px solid #E5E5E3' }}>
        <div className="flex items-center gap-2">
          <StatusDot variant="success" pulse size="sm" />
          <p className="text-[11.5px] text-[#888888]">Signals updated on data load · Not AI-generated</p>
        </div>
      </div>
    </div>
  );
}

/* ===========================================================================
   SensitivityTable
   =========================================================================== */

type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'FAVORABLE';

interface SensitivityRow {
  scenario:    string;
  description: string;
  ebitdaDelta: number;
  marginDelta: number;
  riskLevel:   RiskLevel;
}

const RISK_TAG: Record<RiskLevel, { label: string; bg: string; border: string; color: string }> = {
  HIGH:      { label: 'High',      bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.22)',  color: '#DC2626' },
  MEDIUM:    { label: 'Medium',    bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.22)', color: '#D97706' },
  LOW:       { label: 'Low',       bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.22)',  color: '#16A34A' },
  FAVORABLE: { label: 'Favorable', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.22)',  color: '#16A34A' },
};

function SensitivityTable({ rows }: { rows: SensitivityRow[] }) {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      <div
        className="grid px-9 pt-7 pb-4"
        style={{ gridTemplateColumns: '2fr 1fr 1fr 110px', borderBottom: '1px solid #E5E5E3' }}
      >
        {['Scenario', 'EBITDA Impact', 'Margin Impact', 'Risk Level'].map(col => (
          <p key={col} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#888888]">
            {col}
          </p>
        ))}
      </div>

      {rows.map((row, i) => {
        const tag    = RISK_TAG[row.riskLevel];
        const isLast = i === rows.length - 1;
        const posE   = row.ebitdaDelta >= 0;
        const posM   = row.marginDelta >= 0;

        return (
          <div
            key={row.scenario}
            className="grid items-center px-9 py-5 cursor-default transition-colors duration-150"
            style={{
              gridTemplateColumns: '2fr 1fr 1fr 110px',
              borderBottom: isLast ? 'none' : '1px solid #F0F0EE',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div>
              <p className="text-[14.5px] font-semibold text-[#111111]">{row.scenario}</p>
              <p className="text-[12.5px] text-[#888888] mt-0.5">{row.description}</p>
            </div>
            <p
              className="text-[14.5px] font-semibold"
              style={{ color: posE ? '#16A34A' : '#DC2626', fontVariantNumeric: 'tabular-nums' }}
            >
              {posE ? '+' : '−'}₹{Math.abs(row.ebitdaDelta).toFixed(1)} Cr
            </p>
            <p
              className="text-[14.5px] font-semibold"
              style={{ color: posM ? '#16A34A' : '#DC2626', fontVariantNumeric: 'tabular-nums' }}
            >
              {posM ? '+' : '−'}{Math.abs(row.marginDelta * 100).toFixed(2)} pp
            </p>
            <span
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-[11.5px] font-semibold"
              style={{ background: tag.bg, border: `1px solid ${tag.border}`, color: tag.color }}
            >
              {tag.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ===========================================================================
   IntelligenceCard
   =========================================================================== */

function IntelligenceCard({
  icon: Icon, title, items,
}: {
  icon:  React.ElementType;
  title: string;
  items: string[];
}) {
  return (
    <div
      className="flex flex-col rounded-[8px] p-8"
      style={{ background: '#FFFFFF', border: '1px solid #D8D8D8' }}
    >
      <div className="flex items-center gap-3.5 mb-6">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'rgba(255,230,0,0.08)', border: '1px solid rgba(255,230,0,0.14)' }}
        >
          <Icon className="h-[18px] w-[18px]" style={{ color: '#E6B800' }} strokeWidth={1.75} />
        </div>
        <p className="text-[14.5px] font-semibold text-[#111111] leading-none">{title}</p>
      </div>
      <ul className="space-y-3">
        {items.map(item => (
          <li key={item} className="flex items-center gap-3">
            <span className="h-[5px] w-[5px] rounded-full shrink-0" style={{ background: '#E6B800' }} />
            <span className="text-[13.5px] text-[#555555]">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ===========================================================================
   DashboardPage
   =========================================================================== */

export default function DashboardPage() {

  /* ── Data fetching ───────────────────────────────────────────────────────── */
  const { metrics: sofrM, chartData: sofrChart, loading: sofrLoading } =
    useSofrForecast('12M');

  const { metrics: inrM, chartData: inrChart, loading: inrLoading } =
    useFxForecast('INRUSD', '12M');

  const { metrics: ngnM, chartData: ngnChart, loading: ngnLoading } =
    useFxForecast('NGNUSD', '12M');

  /* ── Deterministic scenario stress (pure arithmetic, memoised once) ──────── */
  const { ironOreDelta, fxDelta, freightDelta, sensitivityRows } = useMemo(() => {
    const ironOreRes  = computeScenarioPnl({ ironOre: 'SEVERE', fx: 'BASE',   freight: 'BASE'   });
    const fxRes       = computeScenarioPnl({ ironOre: 'BASE',   fx: 'SEVERE', freight: 'BASE'   });
    const freightRes  = computeScenarioPnl({ ironOre: 'BASE',   fx: 'BASE',   freight: 'SEVERE' });

    const ironOreDelta  = computePnlDelta(ironOreRes);
    const fxDelta       = computePnlDelta(fxRes);
    const freightDelta  = computePnlDelta(freightRes);

    const riskLevel = (absPct: number, isPositive: boolean): RiskLevel => {
      if (isPositive)  return 'FAVORABLE';
      if (absPct > 10) return 'HIGH';
      if (absPct > 5)  return 'MEDIUM';
      return 'LOW';
    };

    const sensitivityRows: SensitivityRow[] = [
      {
        scenario:    'Iron Ore +20%',
        description: 'Raw material cost inflation (severe)',
        ebitdaDelta: ironOreDelta.ebitda,
        marginDelta: ironOreDelta.ebitdaMargin,
        riskLevel:   riskLevel(Math.abs(ironOreDelta.ebitda) / BASE_CASE.ebitda * 100, false),
      },
      {
        scenario:    'INR/USD @ 101.5',
        description: 'Moderate INR depreciation (+5.7%)',
        ebitdaDelta: fxDelta.ebitda,
        marginDelta: fxDelta.ebitdaMargin,
        riskLevel:   riskLevel(Math.abs(fxDelta.ebitda) / BASE_CASE.ebitda * 100, fxDelta.ebitda > 0),
      },
      {
        scenario:    'Freight +20%',
        description: 'Logistics cost escalation (severe)',
        ebitdaDelta: freightDelta.ebitda,
        marginDelta: freightDelta.ebitdaMargin,
        riskLevel:   riskLevel(Math.abs(freightDelta.ebitda) / BASE_CASE.ebitda * 100, false),
      },
    ];

    return { ironOreDelta, fxDelta, freightDelta, sensitivityRows };
  }, []);

  /* ── Radar chart scores ──────────────────────────────────────────────────── */
  const radarData = useMemo(() => {
    const sofrConf = sofrM?.confidenceRaw ?? 50;
    const inrVol   = parseFloat(inrM?.volatility  ?? '3');

    // Normalise each dimension to 0–100
    const interestRate = Math.round(Math.min(100, (100 - sofrConf) * 1.1));
    const fxRisk       = Math.round(Math.min(100, inrVol * 14));
    const commodity    = Math.round(Math.min(100, (Math.abs(ironOreDelta.ebitda)  / BASE_CASE.ebitda * 100 / 20) * 100));
    const freight      = Math.round(Math.min(100, (Math.abs(freightDelta.ebitda) / BASE_CASE.ebitda * 100 / 20) * 100));
    const margin       = Math.round((interestRate + fxRisk + commodity + freight) / 4 * 0.85);

    return [
      { subject: 'Interest Rate', score: interestRate, fullMark: 100 },
      { subject: 'FX',            score: fxRisk,       fullMark: 100 },
      { subject: 'Commodity',     score: commodity,    fullMark: 100 },
      { subject: 'Freight',       score: freight,      fullMark: 100 },
      { subject: 'Margin',        score: margin,       fullMark: 100 },
    ];
  }, [sofrM, inrM, ironOreDelta, freightDelta]);

  /* ── Deterministic interpretation bullets ─────────────────────────────────── */
  const insights = useMemo(() => {
    const out: string[] = [];

    if (sofrM) {
      const proj = sofrM.projectedRaw;
      if (proj > 4.5) {
        out.push(`SOFR projects at ${sofrM.projected}% over 12 months — rates market continues pricing a higher-for-longer environment above 4.50%, compressing floating-rate financing economics.`);
      } else if (proj < 3.0) {
        out.push(`SOFR projects at ${sofrM.projected}% over 12 months — forward curve implies an accelerated Fed easing path; borrowing costs should decline materially.`);
      } else {
        out.push(`SOFR is projected at ${sofrM.projected}% in 12 months (${sofrM.projectedDelta} vs spot), consistent with a measured easing trajectory and moderate rate normalisation.`);
      }
    }

    if (inrM) {
      if (inrM.projectedSignal === 'negative') {
        out.push(`INR/USD projects ${inrM.projectedDelta} from current spot — INR depreciation supports export revenue uplift but increases USD-denominated input cost exposure across COGS.`);
      } else if (inrM.projectedSignal === 'positive') {
        out.push(`INR/USD projects ${inrM.projectedDelta} appreciation — a favourable macro signal that compresses import costs while slightly reducing export revenue in INR terms.`);
      } else {
        out.push(`INR/USD outlook is broadly stable vs spot — limited FX-driven revenue or cost variance is expected over the 12-month horizon.`);
      }
    }

    out.push(
      `Iron ore cost transmission is the dominant EBITDA tail risk — a +20% shock compresses operating income by ₹${Math.round(Math.abs(ironOreDelta.ebitda))} Cr, equivalent to ${(Math.abs(ironOreDelta.ebitda) / BASE_CASE.ebitda * 100).toFixed(1)}% of base EBITDA.`
    );

    if (sofrM) {
      const conf = sofrM.confidenceRaw;
      if (conf < 55) {
        out.push(`Monte Carlo forecast dispersion is elevated at ${sofrM.confidence}% ensemble confidence — rate projections should be treated as directional signals with wide terminal uncertainty.`);
      } else {
        out.push(`Monte Carlo ensemble convergence is strong at ${sofrM.confidence}% confidence across 5,000 simulation paths — directional signal reliability is high.`);
      }
    }

    if (ngnM) {
      out.push(`NGN/USD projects ${ngnM.projectedDelta} with ${ngnM.volatility}% annualised volatility — elevated structural depreciation pressure remains the base case; monitor CBN policy and FX reserve dynamics.`);
    }

    return out;
  }, [sofrM, inrM, ngnM, ironOreDelta]);

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  const anyLoading = sofrLoading || inrLoading;
  const today      = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const baseEbitdaMarginPct = (BASE_CASE.ebitdaMargin * 100).toFixed(1);

  /* ─────────────────────────────────────────────────────────────────────────── */

  return (
    <AppShell breadcrumb={['BAML Platform', 'Overview']}>
      <PageContainer size="wide">

        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          className="flex items-end justify-between mb-14"
        >
          <div className="space-y-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.20em] text-[#888888]">
              Executive Intelligence
            </p>
            <h1
              className="font-semibold text-[#111111] leading-none"
              style={{ fontSize: '50px', letterSpacing: '-0.03em' }}
            >
              Overview
            </h1>
            <p className="text-[15px] text-[#888888] leading-none">
              Treasury cockpit &middot; Real-time forecast &amp; risk summary &middot; {today}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-[#888888]">
            <StatusDot
              variant={anyLoading ? 'neutral' : 'success'}
              pulse={!anyLoading}
              size="sm"
            />
            <span>{anyLoading ? 'Loading…' : 'Live'}</span>
          </div>
        </motion.div>

        <div className="space-y-10">

          {/* ── S1: Executive Snapshot ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.04, ease: [0.2, 0, 0, 1] }}
          >
            <SectionTitle
              title="Executive Snapshot"
              subtitle="Live forecast projections and top risk exposures across instruments"
              eyebrow="Section 1 of 5"
              spacing="sm"
            />
            <div className="grid grid-cols-4 gap-5">

              {/* SOFR */}
              <StatCard
                label="12M SOFR Outlook"
                value={sofrM?.projected ?? '—'}
                unit="%"
                unitPosition="suffix"
                delta={sofrM?.projectedDelta}
                signal={sofrM?.projectedSignal ?? 'neutral'}
                annotation={sofrM ? `Confidence: ${sofrM.confidence}% · ${sofrM.projectedRaw > 4.5 ? 'Higher-for-longer bias' : 'Easing path priced'}` : undefined}
                accent="yellow"
                featured
                size="lg"
                loading={sofrLoading && !sofrM}
              />

              {/* INR/USD */}
              <StatCard
                label="INR/USD 12M Outlook"
                value={inrM?.projectedRate ?? '—'}
                delta={inrM?.projectedDelta}
                signal={inrM?.projectedSignal ?? 'neutral'}
                annotation={inrM ? `Vol: ${inrM.volatility}% ann. · ${inrM.projectedSignal === 'negative' ? 'Moderate INR weakness' : inrM.projectedSignal === 'positive' ? 'Mild appreciation' : 'Stable outlook'}` : undefined}
                accent="amber"
                size="lg"
                loading={inrLoading && !inrM}
              />

              {/* Top Stress Risk */}
              <StatCard
                label="Top Stress Exposure"
                value={String(Math.round(Math.abs(ironOreDelta.ebitda)))}
                unit="Cr"
                unitPosition="suffix"
                delta={`${Math.abs(ironOreDelta.ebitdaMargin * 100).toFixed(2)} pp margin compression`}
                signal="negative"
                annotation="Iron Ore +20% shock · Largest single-factor EBITDA tail risk"
                accent="red"
                size="lg"
                loading={false}
              />

              {/* Base EBITDA */}
              <StatCard
                label="Base Case EBITDA"
                value={BASE_CASE.ebitda.toLocaleString('en-US')}
                unit="Cr"
                unitPosition="suffix"
                delta={`${baseEbitdaMarginPct}% EBITDA margin`}
                signal="neutral"
                annotation={`Revenue ₹${(BASE_CASE.revenue / 1000).toFixed(1)}k Cr · SG&A ₹${Math.round(BASE_CASE.sga)} Cr`}
                accent="none"
                size="lg"
                loading={false}
              />
            </div>
          </motion.div>

          {/* ── S2: Risk Radar + Interpretation ─────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.08, ease: [0.2, 0, 0, 1] }}
          >
            <SectionTitle
              title="Treasury Risk Radar"
              subtitle="Normalised exposure scores across five risk dimensions · Calibrated from live forecast data"
              eyebrow="Section 2 of 5"
              spacing="sm"
            />
            <div className="grid grid-cols-[1fr_420px] gap-5">

              <ChartCard
                title="Risk Exposure Radar"
                subtitle="Score 0–100 per dimension · Interest rate, FX, commodity, freight, margin"
                height={480}
                loading={sofrLoading && !sofrM}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart
                    data={radarData}
                    outerRadius="80%"
                    margin={{ top: 10, right: 40, bottom: 28, left: 40 }}
                  >
                    <PolarGrid
                      stroke="#AAAAAA"
                      strokeWidth={0.8}
                      gridType="polygon"
                    />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fill: '#333333', fontSize: 13, fontWeight: 600 }}
                      tickLine={false}
                    />
                    <PolarRadiusAxis
                      angle={18}
                      domain={[0, 100]}
                      tick={{ fill: '#888888', fontSize: 10 }}
                      axisLine={{ stroke: '#BBBBBB', strokeWidth: 0.5 }}
                      tickCount={4}
                    />
                    <Radar
                      name="Risk Score"
                      dataKey="score"
                      stroke="#E6B800"
                      strokeWidth={1.75}
                      fill="#E6B800"
                      fillOpacity={0.13}
                      animationDuration={700}
                      animationEasing="ease-out"
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartCard>

              <InterpretationPanel insights={insights} />
            </div>
          </motion.div>

          {/* ── S3: Forecast Summary Strip ───────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.12, ease: [0.2, 0, 0, 1] }}
          >
            <SectionTitle
              title="Forecast Summary"
              subtitle="12-month Monte Carlo projections across all covered instruments"
              eyebrow="Section 3 of 5"
              spacing="sm"
            />
            <div className="grid grid-cols-3 gap-5">
              <ForecastSummaryCard
                uid="sofr"
                title="SOFR · 12M Horizon"
                value={sofrM?.projected ?? '—'}
                unit="%"
                volLabel={sofrM?.volatility ? `${sofrM.volatility} bps` : undefined}
                confidence={sofrM?.confidence}
                chartData={sofrChart}
                href="/sofr"
                loading={sofrLoading}
              />
              <ForecastSummaryCard
                uid="inr"
                title="INR/USD · 12M Horizon"
                value={inrM?.projectedRate ?? '—'}
                volLabel={inrM?.volatility ? `${inrM.volatility}%` : undefined}
                confidence={inrM?.confidence}
                chartData={inrChart}
                href="/fx"
                loading={inrLoading}
              />
              <ForecastSummaryCard
                uid="ngn"
                title="NGN/USD · 12M Horizon"
                value={ngnM?.projectedRate ?? '—'}
                volLabel={ngnM?.volatility ? `${ngnM.volatility}%` : undefined}
                confidence={ngnM?.confidence}
                chartData={ngnChart}
                href="/fx"
                loading={ngnLoading}
              />
            </div>
          </motion.div>

          {/* ── S4: Scenario Sensitivity Table ───────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.16, ease: [0.2, 0, 0, 1] }}
          >
            <SectionTitle
              title="Stress Sensitivity Analysis"
              subtitle="EBITDA and margin impact under severe stress — deterministic scenario engine"
              eyebrow="Section 4 of 5"
              spacing="sm"
              actions={
                <Link
                  href="/scenario"
                  className="flex items-center gap-1.5 text-[13px] font-medium text-[#A89208] hover:text-[#F5D90A] transition-colors duration-150"
                >
                  Full scenario analysis
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </Link>
              }
            />
            <SensitivityTable rows={sensitivityRows} />
          </motion.div>

          {/* ── S5: Platform Intelligence ─────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.20, ease: [0.2, 0, 0, 1] }}
          >
            <SectionTitle
              title="Platform Intelligence"
              subtitle="Analytical coverage and modelling stack"
              eyebrow="Section 5 of 5"
              spacing="sm"
            />
            <div className="grid grid-cols-3 gap-5">
              <IntelligenceCard
                icon={Cpu}
                title="Monte Carlo Engine"
                items={[
                  '5,000 simulation paths per instrument',
                  'ARIMA(p,0,q) log-return modelling',
                  'P10 / P25 / P50 / P75 / P90 confidence bands',
                  'Convergence-tested ensemble outputs',
                ]}
              />
              <IntelligenceCard
                icon={Globe2}
                title="Instrument Coverage"
                items={[
                  'SOFR overnight benchmark rate',
                  'NGN/USD exchange rate',
                  'INR/USD exchange rate',
                  'EUR/INR cross-currency pair',
                ]}
              />
              <IntelligenceCard
                icon={Shield}
                title="Risk Methodology"
                items={[
                  'Monte Carlo simulation (stochastic)',
                  'Deterministic P&L stress testing',
                  'Historical volatility calibration',
                  'Scenario EBITDA sensitivity attribution',
                ]}
              />
            </div>
          </motion.div>

        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.24 }}
          className="mt-12 pt-6 pb-6 flex items-center justify-between"
          style={{ borderTop: '1px solid #E5E5E3' }}
        >
          <p className="text-[11.5px] text-[#888888] max-w-lg">
            BAML Risk Intelligence Platform · Forecasts are model outputs and not investment advice.
            Scenario computations are deterministic and based on calibrated historical sensitivity factors.
          </p>
          <p className="text-[11.5px] text-[#888888]">
            {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })} EST
          </p>
        </motion.footer>

      </PageContainer>
    </AppShell>
  );
}
