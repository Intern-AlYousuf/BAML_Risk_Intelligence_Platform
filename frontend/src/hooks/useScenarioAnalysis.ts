'use client';

import { useState, useCallback } from 'react';
import {
  computeScenarioPnl,
  computePnlDelta,
  type ScenarioState,
  type StressLevel,
  type PnlResult,
  type PnlDelta,
} from '../lib/scenarioEngine';

export type { StressLevel, ScenarioState, PnlResult, PnlDelta };

const DEFAULT_STATE: ScenarioState = {
  ironOre: 'BASE',
  fx:      'BASE',
  freight: 'BASE',
};

export interface UseScenarioAnalysisReturn {
  state:      ScenarioState;
  result:     PnlResult;
  delta:      PnlDelta;
  isBase:     boolean;
  setIronOre: (level: StressLevel) => void;
  setFx:      (level: StressLevel) => void;
  setFreight: (level: StressLevel) => void;
  reset:      () => void;
}

/* ---------------------------------------------------------------------------
   useScenarioAnalysis
   Manages the scenario state with mutual-exclusion enforcement:
   changing one scenario family resets the others to BASE.
   Internally structured to support future combined scenarios.
   --------------------------------------------------------------------------- */

export function useScenarioAnalysis(): UseScenarioAnalysisReturn {
  const [state, setState] = useState<ScenarioState>(DEFAULT_STATE);

  const setIronOre = useCallback((level: StressLevel) => {
    setState({ ironOre: level, fx: 'BASE', freight: 'BASE' });
  }, []);

  const setFx = useCallback((level: StressLevel) => {
    setState({ ironOre: 'BASE', fx: level, freight: 'BASE' });
  }, []);

  const setFreight = useCallback((level: StressLevel) => {
    setState({ ironOre: 'BASE', fx: 'BASE', freight: level });
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  const result = computeScenarioPnl(state);
  const delta  = computePnlDelta(result);
  const isBase = state.ironOre === 'BASE' && state.fx === 'BASE' && state.freight === 'BASE';

  return { state, result, delta, isBase, setIronOre, setFx, setFreight, reset };
}
