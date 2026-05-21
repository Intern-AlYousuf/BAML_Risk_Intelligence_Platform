'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Layers, TrendingDown, Package, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/theme';
import {
  type StressLevel,
  type ScenarioState,
  IRON_ORE_PCT,
  IRON_ORE_SENS,
  FREIGHT_PCT,
  FREIGHT_SENS,
  FX_SPOTS,
  FX_DEPRECIATION_PCT,
} from '../../lib/scenarioEngine';

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

interface ScenarioControlPanelProps {
  state:      ScenarioState;
  onIronOre:  (level: StressLevel) => void;
  onFx:       (level: StressLevel) => void;
  onFreight:  (level: StressLevel) => void;
  onReset:    () => void;
  isBase:     boolean;
}

/* ---------------------------------------------------------------------------
   StressSelector — animated pill selector with optional sub-labels
   --------------------------------------------------------------------------- */

interface StressSelectorProps {
  id:          string;
  value:       StressLevel;
  onChange:    (level: StressLevel) => void;
  subLabels?:  Partial<Record<StressLevel, string>>;
}

const LEVELS: StressLevel[] = ['BASE', 'MILD', 'MODERATE', 'SEVERE'];

const LEVEL_LABELS: Record<StressLevel, string> = {
  BASE:     'BASE',
  MILD:     'MILD',
  MODERATE: 'MOD',
  SEVERE:   'SEV',
};

function StressSelector({ id, value, onChange, subLabels }: StressSelectorProps) {
  return (
    <div
      className="flex rounded-[10px] p-[3px] gap-[2px]"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border:     '1px solid rgba(255,255,255,0.06)',
      }}
      role="tablist"
    >
      {LEVELS.map((level) => {
        const isActive = level === value;
        const sub      = subLabels?.[level];

        return (
          <button
            key={level}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(level)}
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-0.5',
              'rounded-[8px] py-2 px-1.5 transition-colors duration-150 cursor-pointer',
              isActive ? 'text-black' : 'text-[#A1A8B3] hover:text-[#F5F7FA]',
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`stress-pill-${id}`}
                className="absolute inset-0 rounded-[8px]"
                style={{ background: '#F5D90A' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              />
            )}
            <span className="relative z-10 text-[11px] font-bold leading-none tracking-[0.06em]">
              {LEVEL_LABELS[level]}
            </span>
            {sub && (
              <span
                className={cn(
                  'relative z-10 text-[9.5px] leading-none tracking-[0.02em]',
                  isActive ? 'text-black/60' : 'text-[#6B7280]',
                )}
              >
                {sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ScenarioRow — labeled section containing a StressSelector
   --------------------------------------------------------------------------- */

interface ScenarioRowProps {
  icon:     React.ElementType;
  label:    string;
  hint?:    string;
  children: React.ReactNode;
}

function ScenarioRow({ icon: Icon, label, hint, children }: ScenarioRowProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            className="w-[14px] h-[14px] shrink-0"
            style={{ color: '#6B7280' }}
            strokeWidth={1.75}
          />
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#A1A8B3]">
            {label}
          </span>
        </div>
        <AnimatePresence mode="wait">
          {hint && (
            <motion.span
              key={hint}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              className="text-[10.5px] font-semibold"
              style={{ color: '#F59E0B' }}
            >
              {hint}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ScenarioControlPanel
   --------------------------------------------------------------------------- */

export function ScenarioControlPanel({
  state,
  onIronOre,
  onFx,
  onFreight,
  onReset,
  isBase,
}: ScenarioControlPanelProps) {

  // FX sub-labels: spot rate derived from engine constants
  const fxSubLabels: Partial<Record<StressLevel, string>> = {
    BASE:     FX_SPOTS.BASE.toFixed(1),
    MILD:     FX_SPOTS.MILD.toFixed(1),
    MODERATE: FX_SPOTS.MODERATE.toFixed(1),
    SEVERE:   FX_SPOTS.SEVERE.toFixed(1),
  };

  const ironOreHint = state.ironOre !== 'BASE'
    ? `+${IRON_ORE_PCT[state.ironOre]}% shock`
    : undefined;

  const fxHint = state.fx !== 'BASE'
    ? `${FX_SPOTS[state.fx].toFixed(1)} INR/USD (+${FX_DEPRECIATION_PCT[state.fx]}%)`
    : undefined;

  const freightHint = state.freight !== 'BASE'
    ? `+${FREIGHT_PCT[state.freight]}% shock`
    : undefined;

  return (
    <div
      className="flex flex-col rounded-[20px] overflow-hidden"
      style={{
        background: '#1C1F24',
        border:     '1px solid rgba(255,255,255,0.08)',
        boxShadow:  '0 4px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        className="px-6 py-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">
              Stress Controls
            </p>
            <h3 className="text-[17px] font-semibold text-[#F5F7FA] leading-tight">
              Scenario Engine
            </h3>
          </div>

          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            onClick={onReset}
            disabled={isBase}
            className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[11.5px] font-semibold transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border:     '1px solid rgba(255,255,255,0.09)',
              color:      '#A1A8B3',
            }}
          >
            <RotateCcw className="w-[11px] h-[11px]" strokeWidth={2.2} />
            Reset
          </motion.button>
        </div>

        {/* Active scenario indicator */}
        <div className="mt-4">
          <AnimatePresence mode="wait">
            {isBase ? (
              <motion.div
                key="base"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2"
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#6B7280' }} />
                <span className="text-[12px] text-[#6B7280]">Base case — no stress applied</span>
              </motion.div>
            ) : (
              <motion.div
                key="stressed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2"
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#F59E0B' }} />
                <span className="text-[12px] font-medium" style={{ color: '#F59E0B' }}>
                  {state.ironOre !== 'BASE' && `Iron Ore · ${IRON_ORE_PCT[state.ironOre]}% shock`}
                  {state.fx      !== 'BASE' && `FX · ${FX_SPOTS[state.fx].toFixed(1)} INR/USD (+${FX_DEPRECIATION_PCT[state.fx]}%)`}
                  {state.freight !== 'BASE' && `Freight · ${FREIGHT_PCT[state.freight]}% shock`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-6 px-6 py-6">

        <ScenarioRow
          icon={Layers}
          label="Iron Ore Price"
          hint={ironOreHint}
        >
          <StressSelector
            id="ironOre"
            value={state.ironOre}
            onChange={onIronOre}
          />
          <p className="text-[10.5px] text-[#374151] mt-1.5">
            COGS impact: +{(IRON_ORE_SENS * IRON_ORE_PCT[state.ironOre]).toFixed(2)} Cr
          </p>
        </ScenarioRow>

        <div className="h-px" style={{ background: 'rgba(255,255,255,0.04)' }} />

        <ScenarioRow
          icon={TrendingDown}
          label="INR / USD Rate"
          hint={fxHint}
        >
          <StressSelector
            id="fx"
            value={state.fx}
            onChange={onFx}
            subLabels={fxSubLabels}
          />
          <p className="text-[10.5px] text-[#374151] mt-1.5">
            {state.fx === 'BASE'
              ? `Base spot: ${FX_SPOTS.BASE.toFixed(1)} INR/USD`
              : `Spot: ${FX_SPOTS[state.fx].toFixed(1)} · +${FX_DEPRECIATION_PCT[state.fx]}% depreciation`}
          </p>
        </ScenarioRow>

        <div className="h-px" style={{ background: 'rgba(255,255,255,0.04)' }} />

        <ScenarioRow
          icon={Package}
          label="Freight Cost"
          hint={freightHint}
        >
          <StressSelector
            id="freight"
            value={state.freight}
            onChange={onFreight}
          />
          <p className="text-[10.5px] text-[#374151] mt-1.5">
            COGS impact: +{(FREIGHT_SENS * FREIGHT_PCT[state.freight]).toFixed(2)} Cr
          </p>
        </ScenarioRow>
      </div>

      {/* Footer note */}
      <div
        className="px-6 py-4 mt-auto"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
      >
        <p className="text-[10.5px] text-[#374151] leading-relaxed">
          Selecting a scenario resets all others. Combined stresses are planned for a future release.
        </p>
      </div>
    </div>
  );
}
