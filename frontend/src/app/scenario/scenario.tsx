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
  IRON_ORE_UNHEDGED_SENS,
  IRON_ORE_HEDGE_GAIN_SENS,
  FREIGHT_PCT,
  FREIGHT_UNHEDGED_SENS,
  FREIGHT_HEDGE_GAIN_SENS,
  FX_SPOTS,
  FX_DEPRECIATION_PCT,
  SEV_FX_DEPR_PCT,
  SEAGULL_SHORT_PUT,
  SEAGULL_LONG_CALL,
  SEAGULL_SHORT_CALL,
  computeSeagullPayoff,
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
   Active card: live numbers for both scenario impact AND hedge effectiveness.
   Inactive card: concise educational text explaining the hedge strategy.
   --------------------------------------------------------------------------- */

interface ExplanationCard {
  icon:     ExplanationIcon;
  title:    string;
  body:     string;
  isActive: boolean;
}

function buildExplanationCards(
  state:        ScenarioState,
  result:       PnlResult,
  delta:        PnlDelta,
  hedgedResult: PnlResult,
  hedgedDelta:  PnlDelta,
): ExplanationCard[] {
  const active = getActiveFamily(state);

  // ── Iron Ore ──────────────────────────────────────────────────────────────
  const sevUnhedgedShock = (IRON_ORE_UNHEDGED_SENS * 20).toFixed(2);
  const sevHedgeGain     = (IRON_ORE_HEDGE_GAIN_SENS * 20).toFixed(2);

  let ironOreBody: string;
  if (active === 'ironOre') {
    const pct           = IRON_ORE_PCT[state.ironOre];
    const unhedgedShock = IRON_ORE_UNHEDGED_SENS   * pct;
    const hedgeGain     = IRON_ORE_HEDGE_GAIN_SENS * pct;
    const netCogs       = unhedgedShock - hedgeGain;
    const netSign       = netCogs >= 0 ? '+' : '−';
    ironOreBody =
      `A +${pct}% iron ore shock adds ₹ ${unhedgedShock.toFixed(2)} Cr to COGS unhedged ` +
      `(EBITDA: ${formatCr(result.ebitda)}, ${formatDeltaCr(delta.ebitda)} vs base). ` +
      `Iron ore futures and pellet premium forwards deliver a ₹ ${hedgeGain.toFixed(2)} Cr hedge gain, ` +
      `netting to a ${netSign}₹ ${Math.abs(netCogs).toFixed(2)} Cr COGS movement. ` +
      `Hedged EBITDA: ${formatCr(hedgedResult.ebitda)} (${formatDeltaCr(hedgedDelta.ebitda)} vs base, ` +
      `${formatDeltaPp(hedgedDelta.ebitdaMargin)} on margin).`;
  } else {
    ironOreBody =
      `Iron ore price inflation flows directly into raw material COGS. ` +
      `Each +1% shock adds ₹ ${IRON_ORE_UNHEDGED_SENS.toFixed(2)} Cr unhedged. ` +
      `Iron ore futures and pellet premium forwards act as an offset — ` +
      `at SEVERE (+20%), ₹ ${sevHedgeGain} Cr of hedge gain fully covers the ` +
      `₹ ${sevUnhedgedShock} Cr COGS inflation and protects EBITDA above the base case.`;
  }

  // ── FX ────────────────────────────────────────────────────────────────────
  const seagullDesc = `Short Put ₹ ${SEAGULL_SHORT_PUT} / Long Call ₹ ${SEAGULL_LONG_CALL} / Short Call ₹ ${SEAGULL_SHORT_CALL}`;
  const sevSpot     = FX_SPOTS.SEVERE;
  const sevPayoff   = computeSeagullPayoff(sevSpot);
  const sevEffRate  = sevSpot - sevPayoff;

  let fxBody: string;
  if (active === 'fx') {
    const spot          = FX_SPOTS[state.fx];
    const depPct        = FX_DEPRECIATION_PCT[state.fx];
    const payoff        = computeSeagullPayoff(spot);
    const effectiveRate = spot - payoff;
    // delta.cogs is the unhedged COGS change; hedgedDelta.cogs is the hedged COGS change
    // Both are pre-computed via the percentage-depreciation engine.
    fxBody =
      `At ${spot.toFixed(1)} INR/USD (+${depPct}% depreciation), exports gain ₹ ${delta.revenue.toFixed(2)} Cr ` +
      `while unhedged imports rise ₹ ${delta.cogs.toFixed(2)} Cr ` +
      `(unhedged EBITDA: ${formatCr(result.ebitda)}, ${formatDeltaCr(delta.ebitda)}). ` +
      `The zero-cost seagull (${seagullDesc}) delivers a ₹ ${payoff.toFixed(2)} option payoff, ` +
      `locking the effective import rate at ${effectiveRate.toFixed(1)} INR/USD. ` +
      `Hedged COGS inflation: ₹ ${hedgedDelta.cogs.toFixed(2)} Cr. ` +
      `Hedged EBITDA: ${formatCr(hedgedResult.ebitda)} (${formatDeltaCr(hedgedDelta.ebitda)} vs base).`;
  } else {
    fxBody =
      `INR depreciation creates a dual-channel P&L effect: export revenues improve while ` +
      `USD-denominated imports become costlier. ` +
      `Sensitivities: ₹ 57.13 Cr revenue uplift and ₹ 46.07 Cr COGS inflation per 1% depreciation (calibrated at ${SEV_FX_DEPR_PCT}%). ` +
      `A zero-cost long seagull (${seagullDesc}) caps the effective import rate — ` +
      `at SEVERE (${sevSpot.toFixed(1)} INR/USD, +${FX_DEPRECIATION_PCT.SEVERE}%) the option delivers ` +
      `a ₹ ${sevPayoff.toFixed(2)} payoff, locking import costs at ${sevEffRate.toFixed(1)} INR/USD ` +
      `while exports benefit fully from depreciation.`;
  }

  // ── Freight ───────────────────────────────────────────────────────────────
  const sevFreightShock = (FREIGHT_UNHEDGED_SENS * 20).toFixed(2);
  const sevFFAGain      = (FREIGHT_HEDGE_GAIN_SENS * 20).toFixed(2);

  let freightBody: string;
  if (active === 'freight') {
    const pct           = FREIGHT_PCT[state.freight];
    const freightShock  = FREIGHT_UNHEDGED_SENS   * pct;
    const ffaGain       = FREIGHT_HEDGE_GAIN_SENS * pct;
    const netCogs       = freightShock - ffaGain;
    freightBody =
      `A +${pct}% freight escalation adds ₹ ${freightShock.toFixed(2)} Cr to COGS unhedged ` +
      `(EBITDA: ${formatCr(result.ebitda)}, ${formatDeltaCr(delta.ebitda)} vs base). ` +
      `Freight Forward Agreements (FFAs) deliver a ₹ ${ffaGain.toFixed(2)} Cr offset, ` +
      `reducing net COGS exposure to ₹ ${netCogs.toFixed(2)} Cr. ` +
      `Hedged EBITDA: ${formatCr(hedgedResult.ebitda)} (${formatDeltaCr(hedgedDelta.ebitda)} vs base, ` +
      `${formatDeltaPp(hedgedDelta.ebitdaMargin)} on margin).`;
  } else {
    freightBody =
      `Freight cost escalation raises landed import costs with no direct revenue offset. ` +
      `Each +1% escalation adds ₹ ${FREIGHT_UNHEDGED_SENS.toFixed(2)} Cr to COGS. ` +
      `Freight Forward Agreements (FFAs) hedge approximately 50% of exposure — ` +
      `at SEVERE (+20%), ₹ ${sevFFAGain} Cr of FFA gains offset ₹ ${sevFreightShock} Cr of cost inflation, ` +
      `stabilising EBITDA and protecting import/export freight margins.`;
  }

  return [
    { icon: 'ironOre', title: 'Iron Ore Futures Hedge',    body: ironOreBody, isActive: active === 'ironOre' },
    { icon: 'fx',      title: 'Zero-Cost Seagull Strategy', body: fxBody,      isActive: active === 'fx'      },
    { icon: 'freight', title: 'Freight Forward Agreements', body: freightBody,  isActive: active === 'freight' },
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
    hedgedResult,
    hedgedDelta,
    isBase,
    setIronOre,
    setFx,
    setFreight,
    reset,
  } = useScenarioAnalysis();

  const explanationCards = buildExplanationCards(state, result, delta, hedgedResult, hedgedDelta);
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
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.20em] text-[#888888]">
              Treasury Risk
            </p>
            <h1
              className="font-bold text-[#111111] leading-none"
              style={{ fontSize: '44px', letterSpacing: '-0.03em' }}
            >
              Scenario Analysis
            </h1>
            <p className="text-[15px] text-[#888888] leading-none">
              Deterministic stress-testing · Unhedged &amp; Hedged P&amp;L · Three risk factors
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
                  className="flex items-center gap-2 text-[13px] text-[#888888]"
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
                  className="flex items-center gap-2 rounded-[4px] px-3 py-2"
                  style={{
                    background: 'rgba(217,119,6,0.07)',
                    border:     '1px solid rgba(217,119,6,0.22)',
                  }}
                >
                  <StatusDot variant="warning" pulse size="sm" />
                  <span
                    className="text-[12.5px] font-semibold"
                    style={{ color: '#D97706' }}
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
            variant="unhedged"
          />

          {/* RIGHT — Hedged P&L */}
          <PnlCard
            title="Hedged P&L"
            subtitle="Commodity futures · Seagull · FFAs"
            result={hedgedResult}
            delta={hedgedDelta}
            isBase={isBase}
            variant="hedged"
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
            title="Hedge Strategy Mechanics"
            subtitle={
              isBase
                ? 'Select a stress scenario above to see real-time unhedged and hedged P&L impact'
                : 'Active scenario — unhedged exposure vs hedge-adjusted outcome'
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
          style={{ borderTop: '1px solid #E5E5E3' }}
        >
          <p className="text-[11.5px] text-[#888888] leading-relaxed max-w-3xl">
            All values in ₹ Cr. Sensitivities calibrated to known stress cases; MILD/MOD scale proportionally.
            Seagull payoff is a linear approximation between strikes. SG&amp;A held constant across all scenarios.
            Results are for illustrative stress-testing purposes only and do not constitute financial advice.
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
