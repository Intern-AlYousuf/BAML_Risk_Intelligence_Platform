'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw } from 'lucide-react';

import { AppShell }       from '@/components/layout/AppShell';
import { PageContainer }  from '@/components/layout/PageContainer';
import { SectionTitle }   from '@/components/ui/sectiontile';
import { StatusDot }      from '@/components/ui/badge';
import { Button }         from '@/components/ui/button';
import { ScenarioControlPanel }    from '@/components/scenario/ScenarioControlPanel';
import { PnlCard }                 from '@/components/scenario/PnlCard';
import { ScenarioExplanationCard, type ExplanationIcon } from '@/components/scenario/ScenarioExplanationCard';
import { useScenarioAnalysis }     from '@/hooks/useScenarioAnalysis';
import {
  type ScenarioState,
  type PnlResult,
  type PnlDelta,
  IRON_ORE_PCT,
  IRON_ORE_SENS,
  FREIGHT_PCT,
  FREIGHT_SENS,
  FX_SPOTS,
  FX_DEPRECIATION_PCT,
  BASE_FX_SPOT,
  FX_REV_SENS,
  FX_COGS_SENS,
  formatCr,
  formatDeltaCr,
  formatDeltaPp,
} from '@/lib/scenarioEngine';

/* ---------------------------------------------------------------------------
   Active-family detection
   --------------------------------------------------------------------------- */

type ActiveFamily = 'ironOre' | 'fx' | 'freight' | null;

function getActiveFamily(state: ScenarioState): ActiveFamily {
  if (state.ironOre !== 'BASE') return 'ironOre';
  if (state.fx      !== 'BASE') return 'fx';
  if (state.freight !== 'BASE') return 'freight';
  return null;
}

/* ---------------------------------------------------------------------------
   Dynamic explanation card content
   Returns rich, real-number body text for the active scenario family,
   and concise educational text for inactive families.
   --------------------------------------------------------------------------- */

interface ExplanationCard {
  icon:     ExplanationIcon;
  title:    string;
  body:     string;
  isActive: boolean;
}

function buildExplanationCards(
  state:  ScenarioState,
  result: PnlResult,
  delta:  PnlDelta,
): ExplanationCard[] {
  const active = getActiveFamily(state);

  // ── Iron Ore ──────────────────────────────────────────────────────────────
  const ironOreBody = active === 'ironOre'
    ? `A +${IRON_ORE_PCT[state.ironOre]}% iron ore price shock adds ` +
      `₹ ${delta.cogs.toFixed(2)} Cr to COGS, compressing EBITDA to ` +
      `${formatCr(result.ebitda)} ` +
      `(${formatDeltaCr(delta.ebitda)} vs base, ${formatDeltaPp(delta.ebitdaMargin)} on margin). ` +
      `Coking coal co-movement amplifies raw material inflation pressure at this stress level.`
    : `Iron ore price inflation flows directly into COGS through raw material procurement. ` +
      `Each +1% shock adds ₹ ${IRON_ORE_SENS.toFixed(2)} Cr to costs. ` +
      `Steel spread compression and coking coal co-movement amplify margin impact in high-intensity production cycles.`;

  // ── FX ────────────────────────────────────────────────────────────────────
  const fxSevereRevGain  = (FX_REV_SENS  * (FX_SPOTS.SEVERE - BASE_FX_SPOT)).toFixed(0);
  const fxSevereCogsRise = (FX_COGS_SENS * (FX_SPOTS.SEVERE - BASE_FX_SPOT)).toFixed(0);
  const fxBody = active === 'fx'
    ? `At ${FX_SPOTS[state.fx].toFixed(1)} INR/USD (+${FX_DEPRECIATION_PCT[state.fx]}% depreciation), ` +
      `export revenues gain ₹ ${delta.revenue.toFixed(2)} Cr while imported input costs ` +
      `rise ₹ ${delta.cogs.toFixed(2)} Cr. ` +
      `Net EBITDA impact: ${formatDeltaCr(delta.ebitda)} — ` +
      `export realisation outpaces input cost inflation.`
    : `INR depreciation creates a dual-channel P&L effect: export realisations improve while ` +
      `USD-denominated imports become costlier. ` +
      `At SEVERE (+${FX_DEPRECIATION_PCT.SEVERE}%), export uplift of ₹ ${fxSevereRevGain} Cr ` +
      `outpaces COGS inflation of ₹ ${fxSevereCogsRise} Cr, netting a positive EBITDA contribution.`;

  // ── Freight ───────────────────────────────────────────────────────────────
  const freightBody = active === 'freight'
    ? `A +${FREIGHT_PCT[state.freight]}% freight cost shock adds ` +
      `₹ ${delta.cogs.toFixed(2)} Cr to COGS, reducing EBITDA to ` +
      `${formatCr(result.ebitda)} ` +
      `(${formatDeltaCr(delta.ebitda)} vs base, ${formatDeltaPp(delta.ebitdaMargin)} on margin). ` +
      `Supply chain pressure concentrates in bulk carrier and container rates on raw material import channels.`
    : `Freight cost escalation raises landed import costs and export logistics expenses with no revenue offset. ` +
      `A +20% shock adds ₹ ${(FREIGHT_SENS * 20).toFixed(2)} Cr to COGS — direct EBITDA compression. ` +
      `Bulk carrier rate volatility and fuel surcharges drive episodic inflation in commodity-intensive supply chains.`;

  return [
    { icon: 'ironOre', title: 'Iron Ore Price Risk',    body: ironOreBody, isActive: active === 'ironOre' },
    { icon: 'fx',      title: 'INR Depreciation Impact', body: fxBody,      isActive: active === 'fx'      },
    { icon: 'freight', title: 'Freight Cost Escalation', body: freightBody,  isActive: active === 'freight' },
  ];
}

/* ---------------------------------------------------------------------------
   Active badge text for the page header
   --------------------------------------------------------------------------- */

function getActiveBadgeText(state: ScenarioState): string | null {
  if (state.ironOre !== 'BASE') return `Iron Ore · +${IRON_ORE_PCT[state.ironOre]}%`;
  if (state.fx      !== 'BASE') return `FX · ${FX_SPOTS[state.fx].toFixed(1)} INR/USD (+${FX_DEPRECIATION_PCT[state.fx]}%)`;
  if (state.freight !== 'BASE') return `Freight · +${FREIGHT_PCT[state.freight]}%`;
  return null;
}

/* ---------------------------------------------------------------------------
   ScenarioPage
   --------------------------------------------------------------------------- */

export default function ScenarioPage() {
  const {
    state,
    result,
    delta,
    isBase,
    setIronOre,
    setFx,
    setFreight,
    reset,
  } = useScenarioAnalysis();

  const explanationCards = buildExplanationCards(state, result, delta);
  const activeBadgeText  = getActiveBadgeText(state);

  return (
    <AppShell breadcrumb={['BAML Platform', 'Scenario Analysis']}>
      <PageContainer size="wide">

        {/* ── 1. Page Header ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          className="flex items-end justify-between mb-14"
        >
          {/* Title block */}
          <div className="space-y-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.20em] text-[#6B7280]">
              Treasury Risk
            </p>
            <h1
              className="font-semibold text-[#F5F7FA] leading-none"
              style={{ fontSize: '50px', letterSpacing: '-0.03em' }}
            >
              Scenario Analysis
            </h1>
            <p className="text-[15px] text-[#6B7280] leading-none">
              Deterministic stress-testing · Base case P&amp;L · Three risk factors
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {/* Animated status badge */}
            <AnimatePresence mode="wait">
              {isBase ? (
                <motion.div
                  key="base"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                  className="flex items-center gap-2 text-[13px] text-[#6B7280]"
                >
                  <StatusDot variant="success" pulse size="sm" />
                  <span>Base Case</span>
                </motion.div>
              ) : (
                <motion.div
                  key="stressed"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                  className="flex items-center gap-2 rounded-[10px] px-3 py-2"
                  style={{
                    background: 'rgba(245,158,11,0.08)',
                    border:     '1px solid rgba(245,158,11,0.18)',
                  }}
                >
                  <StatusDot variant="warning" pulse size="sm" />
                  <span
                    className="text-[12.5px] font-semibold"
                    style={{ color: '#F59E0B' }}
                  >
                    {activeBadgeText}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Reset button — appears only when stressed */}
            <AnimatePresence>
              {!isBase && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.88 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.88 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    onClick={reset}
                  >
                    Reset
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* ── 2. Main 3-Column Grid ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.04, ease: [0.2, 0, 0, 1] }}
          className="grid grid-cols-3 gap-5"
        >
          {/* LEFT — Scenario Control Panel */}
          <ScenarioControlPanel
            state={state}
            onIronOre={setIronOre}
            onFx={setFx}
            onFreight={setFreight}
            onReset={reset}
            isBase={isBase}
          />

          {/* CENTER — Unhedged P&L */}
          <PnlCard
            title="Unhedged P&L"
            subtitle="No hedge overlay applied"
            result={result}
            delta={delta}
            isBase={isBase}
          />

          {/* RIGHT — Hedged P&L (placeholder, ready for future hedge logic) */}
          <PnlCard
            title="Hedged P&L"
            subtitle="Hedge overlay applied"
            result={result}
            delta={delta}
            isBase={isBase}
            isPlaceholder
          />
        </motion.div>

        {/* ── 3. Dynamic Explanation Cards ────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.10, ease: [0.2, 0, 0, 1] }}
          className="mt-8"
        >
          <SectionTitle
            title="Scenario Mechanics"
            subtitle={
              isBase
                ? 'Select a stress scenario above to see real-time P&L impact'
                : 'Active scenario impact on revenue, COGS, and EBITDA'
            }
            spacing="md"
          />

          <div className="grid grid-cols-3 gap-5">
            {explanationCards.map((card, i) => (
              <ScenarioExplanationCard
                key={card.icon}
                icon={card.icon}
                title={card.title}
                body={card.body}
                index={i}
                isActive={card.isActive}
              />
            ))}
          </div>
        </motion.div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.18 }}
          className="mt-10 pt-6 pb-6 flex items-center justify-between"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <p className="text-[11.5px] text-[#374151] leading-relaxed max-w-3xl">
            All values in ₹ Cr. Calculations use linear sensitivity coefficients calibrated to known stress cases.
            Results are for illustrative stress-testing purposes only and do not constitute financial advice.
            SG&amp;A is held constant across all scenarios.
          </p>
          <p className="text-[11.5px] text-[#374151]">
            {new Date().toLocaleDateString('en-US', {
              day: 'numeric', month: 'long', year: 'numeric',
            })} EST
          </p>
        </motion.footer>

      </PageContainer>
    </AppShell>
  );
}
