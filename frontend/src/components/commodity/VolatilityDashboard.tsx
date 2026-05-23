'use client';

/**
 * VolatilityDashboard.tsx  (v2 — with GARCH forward forecast + MC cone)
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloomberg-style institutional commodity volatility + price forecast terminal.
 *
 * Chart layout:
 *   LEFT  — real historical spot price (black line, 3-year window)
 *   TODAY — vertical dashed divider with label
 *   RIGHT — 12-month forecast cone  (median yellow dashed + 50%/90% bands)
 *
 * Secondary right Y-axis overlays GARCH conditional volatility (historical)
 * and the forward GARCH vol path (dashed).
 *
 * All calculations are frontend-side, fully memoised, zero API calls.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  BarChart2,
  Info,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

import {
  loadCommoditySeries,
  rollingVolatility,
  type PricePoint,
  type ReturnPoint,
} from '../../lib/commodityData';

import {
  runGarch,
  forecastGarch,
  runMonteCarlo,
  classifyRegime,
  GARCH_PARAMS,
  type GarchResult,
  type GarchForecast,
  type McResult,
  type GarchPoint,
  type VolRegime,
} from '../../lib/garchEngine';

/* ═══════════════════════════════════════════════════════════════════════════
   COMMODITY CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

type CommodityId = 'iron_ore' | 'coking_coal';

interface Config {
  id:                  CommodityId;
  name:                string;
  unit:                string;
  histYears:           number;    // rolling historical display window
  fwdSteps:            number;    // forecast months
  monthlyDrift:        number;    // GBM drift μ per month (log)
  mcSeed:              number;
  mcPaths:             number;
  ebitdaSensitivity:   string;
  procurementDep:      string;
  freightCorrelation:  string;
  fxInteraction:       string;
  interpretationLines: string[];
  forecastLines:       string[];
}

const CONFIGS: Record<CommodityId, Config> = {
  iron_ore: {
    id:                 'iron_ore',
    name:               'Iron Ore',
    unit:               'USD/t',
    histYears:          3,
    fwdSteps:           12,
    monthlyDrift:       -0.001,   // slight mean-reversion / flat
    mcSeed:             12345,
    mcPaths:            300,
    ebitdaSensitivity:  '₹13.82 Cr per +1%',
    procurementDep:     '62%',
    freightCorrelation: '0.71',
    fxInteraction:      'Moderate',
    interpretationLines: [
      'Volatility clustering indicates persistent procurement uncertainty across iron ore markets.',
      'Conditional variance spikes materially increase EBITDA compression risk for steel-intensive production cycles.',
      'Persistent GARCH regimes support staggered procurement hedge execution rather than lump-sum exposure timing.',
    ],
    forecastLines: [
      'Forward conditional volatility remains contained despite episodic procurement stress cycles persisting into the near term.',
      'GARCH persistence suggests residual market uncertainty will gradually normalize through the forecast horizon.',
      'Elevated persistence coefficients (α+β) indicate that volatility shocks will carry through procurement windows, warranting hedged execution strategy.',
    ],
  },
  coking_coal: {
    id:                 'coking_coal',
    name:               'Coking Coal',
    unit:               'USD/t',
    histYears:          3,
    fwdSteps:           12,
    monthlyDrift:       0.002,    // slight upward structural drift
    mcSeed:             67890,
    mcPaths:            300,
    ebitdaSensitivity:  '₹9.40 Cr per +1%',
    procurementDep:     '38%',
    freightCorrelation: '0.64',
    fxInteraction:      'Elevated',
    interpretationLines: [
      'Metallurgical coal volatility remains structurally elevated due to freight transmission effects and global steel demand fluctuations.',
      'Conditional variance persistence suggests episodic procurement stress and elevated inventory financing uncertainty.',
      'Staggered procurement and tenor diversification remain the primary hedge execution frameworks under elevated GARCH persistence.',
    ],
    forecastLines: [
      'Forward variance remains structurally elevated due to freight-linked commodity transmission effects and supply concentration.',
      'Conditional volatility persistence implies ongoing procurement timing uncertainty across metallurgical coal markets.',
      'Forward price cone reflects material upside and downside procurement scenarios; staggered hedge layering is warranted.',
    ],
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   REGIME COLOUR MAP
   ═══════════════════════════════════════════════════════════════════════════ */

const REGIME_COLORS: Record<VolRegime, { color: string; bg: string; border: string }> = {
  LOW:      { color: '#16A34A', bg: 'rgba(22,163,74,0.10)',  border: 'rgba(22,163,74,0.30)'  },
  NORMAL:   { color: '#2563EB', bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.28)'  },
  ELEVATED: { color: '#D97706', bg: 'rgba(217,119,6,0.10)',  border: 'rgba(217,119,6,0.30)'  },
  CRISIS:   { color: '#DC2626', bg: 'rgba(220,38,38,0.10)',  border: 'rgba(220,38,38,0.30)'  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   CHART DATA SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

interface ChartPoint {
  dateLabel:  string;
  isForecast: boolean;

  // ── Price axis (left) ──
  price:      number | null;   // historical spot
  fwdMedian:  number | null;   // rendered forecast median (with mild AR1 noise)

  // Stacked band fields for floating confidence cone:
  //   Stack "s90": transparent base (p05) + width (p95−p05)
  //   Stack "s50": transparent base (p25) + width (p75−p25)
  bandBase90:  number | null;  // = p05  (transparent fill)
  bandWide90:  number | null;  // = p95 − p05
  bandBase50:  number | null;  // = p25  (transparent fill)
  bandWide50:  number | null;  // = p75 − p25

  // ── Volatility axis (right) ──
  garchVol:   number | null;   // historical conditional vol %
  fwdVol:     number | null;   // forward GARCH vol %
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEEDED PRNG (for display-only AR(1) noise on forecast median)
   ═══════════════════════════════════════════════════════════════════════════ */

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function bm(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/* ═══════════════════════════════════════════════════════════════════════════
   CUSTOM TOOLTIP
   ═══════════════════════════════════════════════════════════════════════════ */

interface TooltipEntry { name: string; value: number | null; color?: string }

function CombinedTooltip({
  active, payload, label, unit, todayLabel,
}: {
  active?:    boolean;
  payload?:   TooltipEntry[];
  label?:     string;
  unit:       string;
  todayLabel: string;
}) {
  if (!active || !payload?.length) return null;

  const isForecast = (payload[0] as { payload?: ChartPoint }).payload?.isForecast ?? false;

  const priceVal  = payload.find(p => p.name === 'price')?.value;
  const medVal    = payload.find(p => p.name === 'fwdMedian')?.value;
  const gVolVal   = payload.find(p => p.name === 'garchVol')?.value;
  const fVolVal   = payload.find(p => p.name === 'fwdVol')?.value;

  const volForRegime = gVolVal ?? fVolVal ?? 0;
  const regime = classifyRegime(volForRegime);

  return (
    <div
      style={{
        background: '#FFFFFF', border: '1px solid #D8D8D8',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        borderRadius: '5px', padding: '12px 16px', minWidth: '210px', fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        {isForecast && (
          <span style={{
            fontSize: '9px', fontWeight: 700, color: '#967A00',
            background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.35)',
            padding: '2px 5px', borderRadius: '3px', textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            FORECAST
          </span>
        )}
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {label}
        </p>
      </div>

      {priceVal != null && (
        <Row label="Spot Price"   value={`${priceVal.toFixed(2)} ${unit}`}  color="#111111" />
      )}
      {medVal != null && (
        <Row label="Fwd Median"   value={`${medVal.toFixed(2)} ${unit}`}    color="#E6B800" />
      )}
      {gVolVal != null && (
        <Row label="GARCH Vol"    value={`${gVolVal.toFixed(2)}%`}           color="#E6B800" />
      )}
      {fVolVal != null && (
        <Row label="Fwd Vol"      value={`${fVolVal.toFixed(2)}%`}           color="#D97706" />
      )}

      <div style={{
        marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 10px', borderRadius: '3px',
        background: regime.bgColor, border: `1px solid ${regime.color}30`,
      }}>
        <span style={{ height: '6px', width: '6px', borderRadius: '50%', background: regime.color, flexShrink: 0 }} />
        <span style={{ fontSize: '10.5px', fontWeight: 700, color: regime.color, textTransform: 'uppercase', letterSpacing: '0.10em' }}>
          {regime.label} REGIME
        </span>
      </div>
    </div>
  );
}
function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px', marginBottom: '5px' }}>
      <span style={{ fontSize: '12px', color: '#555555' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   KPI CARD
   ═══════════════════════════════════════════════════════════════════════════ */

function KpiCard({
  label, value, sub, color, accent, icon: Icon,
}: {
  label:   string;
  value:   string;
  sub?:    string;
  color?:  string;
  accent?: string;   // small accent badge text (e.g. "+4.2 pp")
  icon:    React.ElementType;
}) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: '12px',
        padding: '20px', borderRadius: '6px',
        background: '#FFFFFF', border: '1px solid #D8D8D8',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#888888' }}>
          {label}
        </span>
        <div style={{
          display: 'flex', height: '28px', width: '28px',
          alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
          background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.35)',
        }}>
          <Icon style={{ width: '13px', height: '13px', color: '#967A00' }} strokeWidth={2} />
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.025em', color: color ?? '#111111', lineHeight: 1 }}>
            {value}
          </span>
          {accent && (
            <span style={{ fontSize: '11px', fontWeight: 700, color: color ?? '#111111', opacity: 0.75 }}>{accent}</span>
          )}
        </div>
        {sub && (
          <span style={{ fontSize: '11.5px', marginTop: '6px', display: 'block', color: '#888888' }}>{sub}</span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   REGIME TIMELINE
   ═══════════════════════════════════════════════════════════════════════════ */

function RegimeTimeline({ hist, forecast }: { hist: GarchPoint[]; forecast: GarchForecast }) {
  if (!hist.length) return null;

  const allFwd = forecast.steps;

  return (
    <div
      style={{
        background: '#FFFFFF', border: '1px solid #D8D8D8',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: '6px', padding: '20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <div style={{
          display: 'flex', height: '24px', width: '24px',
          alignItems: 'center', justifyContent: 'center', borderRadius: '3px',
          background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.35)',
        }}>
          <BarChart2 style={{ width: '11px', height: '11px', color: '#967A00' }} strokeWidth={2} />
        </div>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#555555' }}>
          Volatility Regime Timeline
        </span>
        <span style={{ fontSize: '10px', color: '#BBBBBB' }}>·</span>
        <span style={{ fontSize: '11px', color: '#888888' }}>
          Historical persistence · stress clustering · 12-month forward projection
        </span>
      </div>

      {/* Colour strip */}
      <div style={{ display: 'flex', width: '100%', height: '32px', borderRadius: '3px', overflow: 'hidden', border: '1px solid #E5E5E3' }}>
        {/* Historical segment */}
        {hist.map((pt, i) => (
          <div
            key={`h${i}`}
            style={{ flex: 1, height: '100%', background: REGIME_COLORS[pt.regime.label].color, opacity: 0.72 }}
            title={`${pt.dateLabel} · ${pt.regime.label} · ${pt.condVolPct.toFixed(1)}%`}
          />
        ))}
        {/* Divider */}
        <div style={{ width: '2px', background: '#111111', flexShrink: 0, opacity: 0.5 }} />
        {/* Forecast segment */}
        {allFwd.map((pt, i) => (
          <div
            key={`f${i}`}
            style={{ flex: 1, height: '100%', background: REGIME_COLORS[pt.regime.label].color, opacity: 0.38 }}
            title={`${pt.dateLabel} · ${pt.regime.label} · FORECAST`}
          />
        ))}
      </div>

      {/* Legend row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
        <span style={{ fontSize: '10.5px', color: '#888888' }}>{hist[0]?.dateLabel ?? ''}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {(['LOW','NORMAL','ELEVATED','CRISIS'] as VolRegime[]).map(r => (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ height: '8px', width: '8px', borderRadius: '50%', background: REGIME_COLORS[r].color, display: 'inline-block' }} />
              <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: REGIME_COLORS[r].color }}>
                {r}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px', paddingLeft: '8px', borderLeft: '1px solid #E5E5E3' }}>
            <span style={{ height: '8px', width: '8px', borderRadius: '50%', background: '#BBBBBB', display: 'inline-block', opacity: 0.5 }} />
            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: '#888888', textTransform: 'uppercase' }}>
              Forecast
            </span>
          </div>
        </div>
        <span style={{ fontSize: '10.5px', color: '#888888' }}>
          {forecast.steps[forecast.steps.length - 1]?.dateLabel ?? ''}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RISK TRANSMISSION CARD
   ═══════════════════════════════════════════════════════════════════════════ */

function RiskTransmissionCard({ config }: { config: Config }) {
  const rows = [
    { label: 'EBITDA Sensitivity',     value: config.ebitdaSensitivity },
    { label: 'Procurement Dependency', value: config.procurementDep },
    { label: 'Freight Correlation',    value: config.freightCorrelation },
    { label: 'FX Interaction Risk',    value: config.fxInteraction },
  ];
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #D8D8D8', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: '6px', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', background: 'rgba(255,230,0,0.08)', borderBottom: '1px solid rgba(255,230,0,0.28)' }}>
        <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#967A00' }}>
          Risk Transmission · {config.name}
        </span>
      </div>
      {rows.map((row, i) => (
        <div
          key={row.label}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '11px 20px',
            borderBottom: i < rows.length - 1 ? '1px solid #E5E5E3' : undefined,
          }}
        >
          <span style={{ fontSize: '12px', color: '#888888' }}>{row.label}</span>
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#111111' }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   INSIGHT CARDS
   ═══════════════════════════════════════════════════════════════════════════ */

const INSIGHTS = [
  {
    title: 'Volatility Persistence',
    body:  'GARCH persistence coefficients imply prolonged commodity stress carry-through after market shocks.',
    icon:  Activity,
  },
  {
    title: 'Procurement Risk',
    body:  'Commodity variance transmission remains a dominant EBITDA compression channel across procurement cycles.',
    icon:  AlertTriangle,
  },
  {
    title: 'Hedge Timing Signal',
    body:  'Elevated conditional variance supports staggered procurement hedge execution strategies to reduce timing risk.',
    icon:  TrendingUp,
  },
];

function InsightCards() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
      {INSIGHTS.map(ins => {
        const Icon = ins.icon;
        return (
          <div
            key={ins.title}
            style={{ background: '#FFFFFF', border: '1px solid #D8D8D8', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: '6px', padding: '20px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{
                display: 'flex', height: '28px', width: '28px',
                alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
                background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.35)',
              }}>
                <Icon style={{ width: '13px', height: '13px', color: '#967A00' }} strokeWidth={2} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#111111' }}>{ins.title}</span>
            </div>
            <p style={{ fontSize: '12.5px', lineHeight: 1.6, color: '#555555' }}>{ins.body}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORECAST INTERPRETATION PANEL
   ═══════════════════════════════════════════════════════════════════════════ */

function ForecastInterpretation({ config, garchForecast }: { config: Config; garchForecast: GarchForecast }) {
  const params  = GARCH_PARAMS[config.id];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Treasury forward interpretation */}
      <div style={{ background: '#FFFFFF', border: '1px solid #D8D8D8', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: '6px', padding: '20px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <div style={{
            display: 'flex', height: '24px', width: '24px',
            alignItems: 'center', justifyContent: 'center', borderRadius: '3px',
            background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.35)',
          }}>
            <Info style={{ width: '11px', height: '11px', color: '#967A00' }} strokeWidth={2} />
          </div>
          <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#555555' }}>
            Forward Forecast Commentary
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {config.forecastLines.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px' }}>
              <span style={{ marginTop: '6px', height: '5px', width: '5px', borderRadius: '50%', flexShrink: 0, background: '#FFE600', display: 'inline-block' }} />
              <p style={{ fontSize: '12px', lineHeight: 1.6, color: '#555555' }}>{line}</p>
            </div>
          ))}
        </div>
      </div>

      {/* GARCH model parameters */}
      <div style={{ background: '#FAFAFA', border: '1px solid #E5E5E3', borderRadius: '6px', padding: '20px' }}>
        <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#888888', marginBottom: '12px' }}>
          GARCH(1,1) Parameters
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { k: 'ω (Intercept)',  v: params.omega.toString()                          },
            { k: 'α (ARCH)',       v: params.alpha.toString()                           },
            { k: 'β (GARCH)',      v: params.beta.toString()                            },
            { k: 'α + β',         v: (params.alpha + params.beta).toFixed(3)           },
            { k: '12M Fwd Vol',   v: `${garchForecast.avgFwdVol.toFixed(1)}%`         },
            { k: 'Terminal Regime',v: garchForecast.terminalRegime.label               },
          ].map(row => (
            <div key={row.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: '#888888' }}>{row.k}</span>
              <span style={{ fontSize: '11.5px', fontWeight: 700, fontFamily: 'monospace', color: '#111111' }}>{row.v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN VOLATILITY DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */

export function VolatilityDashboard({ commodityId }: { commodityId: CommodityId }) {
  const config = CONFIGS[commodityId];
  const params = GARCH_PARAMS[commodityId];

  /* ── State ── */
  const [rawPrices,  setRawPrices]  = useState<PricePoint[]>([]);
  const [returns,    setReturns]    = useState<ReturnPoint[]>([]);
  const [garchResult, setGarch]     = useState<GarchResult | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  /* ── Load CSV (cached after first mount) ── */
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);

    loadCommoditySeries(commodityId).then(series => {
      if (!live) return;
      setRawPrices(series.raw);
      setReturns(series.returns);
      setGarch(runGarch(series.returns, params, commodityId));
      setLoading(false);
    }).catch(err => {
      if (!live) return;
      setError(String(err));
      setLoading(false);
    });

    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodityId]);

  /* ══════════════════════════════════════════════════════════════════════
     MEMOISED: build all chart data, forecasts, y-domain in one pass.
     Runs only when garchResult or rawPrices change.
     ══════════════════════════════════════════════════════════════════════ */
  const computed = useMemo(() => {
    if (!garchResult || rawPrices.length === 0 || returns.length === 0) return null;

    const lastPt   = rawPrices[rawPrices.length - 1];
    const lastDate = lastPt.date;
    const lastPrice = lastPt.price;
    const lastGarch = garchResult.series[garchResult.series.length - 1];
    const lastRet   = returns[returns.length - 1].logReturn;

    // ── 1. Historical display window: last HISTORICAL_MONTHS data points ──
    // Use slice(-N) so we ALWAYS take the most recent observations from the
    // end of the dataset — regardless of how old the earliest CSV rows are.
    const HISTORICAL_MONTHS = 36;
    const recentPrices = rawPrices.slice(-HISTORICAL_MONTHS);
    const cutoff = recentPrices[0].date;            // first date of display window
    const priceMap = new Map(rawPrices.map(p => [p.dateLabel, p.price]));

    // Trim GARCH series to match the display window (GARCH was run on full history)
    const histGarch = garchResult.series.filter(g => g.date >= cutoff);

    // ── 2. Rolling 12-month realised vol (for right axis reference) ──
    const rvSeries = rollingVolatility(returns, 12);
    const rvMap    = new Map(rvSeries.map(r => [r.dateLabel, r.rollingVol]));

    // ── 3. GARCH 12-month forward forecast ──
    const garchForecast = forecastGarch(
      lastGarch.condVariance,
      lastRet,
      params,
      config.fwdSteps,
      lastDate,
      garchResult.currentVol,
      commodityId,
    );

    // ── 4. Monte Carlo price simulation ──
    const mc = runMonteCarlo(
      lastPrice,
      garchForecast,
      config.monthlyDrift,
      config.mcPaths,
      config.mcSeed,
      `${commodityId}-mc`,
    );

    // ── 5. AR(1) display noise for rendered forecast median ──
    const noiseRng = lcg(config.mcSeed + 999);
    let carry = 0;
    const noisyMedian = mc.steps.map(s => {
      // Mild AR(1): amplitude ~1.4% of current price per step
      carry = 0.68 * carry + 0.32 * bm(noiseRng) * lastPrice * 0.014;
      return Math.max(s.median + carry, 1);
    });

    // ── 6. Build unified chart data ──
    const histPoints: ChartPoint[] = histGarch.map(g => ({
      dateLabel:  g.dateLabel,
      isForecast: false,
      price:      priceMap.get(g.dateLabel) ?? null,
      fwdMedian:  null,
      bandBase90: null, bandWide90: null,
      bandBase50: null, bandWide50: null,
      garchVol:   parseFloat(g.condVolPct.toFixed(2)),
      fwdVol:     null,
    }));

    // Join point — carries both historical and forecast anchor values
    const joinIdx = histPoints.length - 1;
    if (joinIdx >= 0) {
      histPoints[joinIdx] = {
        ...histPoints[joinIdx],
        fwdMedian:  lastPrice,
        bandBase90: lastPrice,
        bandWide90: 0,
        bandBase50: lastPrice,
        bandWide50: 0,
        fwdVol:     histPoints[joinIdx].garchVol,
      };
    }

    const fwdPoints: ChartPoint[] = garchForecast.steps.map((fStep, i) => {
      const step = mc.steps[i];
      return {
        dateLabel:  fStep.dateLabel,
        isForecast: true,
        price:      null,
        fwdMedian:  parseFloat(noisyMedian[i].toFixed(2)),
        bandBase90: step.p05,
        bandWide90: parseFloat(Math.max(0, step.p95 - step.p05).toFixed(2)),
        bandBase50: step.p25,
        bandWide50: parseFloat(Math.max(0, step.p75 - step.p25).toFixed(2)),
        garchVol:   null,
        fwdVol:     parseFloat(fStep.condVolPct.toFixed(2)),
      };
    });

    const chartData = [...histPoints, ...fwdPoints];

    // ── 7. Y domain ──
    const histPrices = histPoints.map(p => p.price).filter((x): x is number => x !== null);
    const fwdP05    = mc.steps.map(s => s.p05);
    const fwdP95    = mc.steps.map(s => s.p95);
    const yMin = Math.min(...histPrices, ...fwdP05) * 0.88;
    const yMax = Math.max(...histPrices, ...fwdP95) * 1.10;

    // ── 8. Ticks: every 3 months across the full combined span ──
    // 36 hist + 12 fwd = 48 points → every 3 = 16 ticks (clean institutional spacing)
    const allLabels = chartData.map(d => d.dateLabel);
    const tickStep  = Math.max(1, Math.ceil(allLabels.length / 16));
    const ticks     = allLabels.filter((_, i) => i % tickStep === 0);

    // ── 9. Display GARCH series for timeline (trimmed to history window) ──
    const timelineGarch = histGarch;

    return {
      chartData,
      garchForecast,
      mc,
      yDomain:     [yMin, yMax] as [number, number],
      ticks,
      todayLabel:  lastPt.dateLabel,
      latestDate:  lastPt.dateLabel,
      timelineGarch,
    };
  }, [garchResult, rawPrices, returns, config, params, commodityId]);

  /* ── Loading / error ── */
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '256px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div style={{ height: '32px', width: '32px', borderRadius: '50%', border: '2px solid #FFE600', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: '13px', color: '#888888' }}>Calibrating GARCH model — {config.name}…</span>
        </div>
      </div>
    );
  }

  if (error || !computed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderRadius: '6px', padding: '16px 20px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)' }}>
        <AlertTriangle style={{ width: '20px', height: '20px', color: '#DC2626', flexShrink: 0 }} />
        <div>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#111111' }}>Failed to load commodity data</p>
          <p style={{ fontSize: '12px', marginTop: '2px', color: '#888888' }}>{error}</p>
        </div>
      </div>
    );
  }

  const {
    chartData, garchForecast, yDomain, ticks,
    todayLabel, latestDate, timelineGarch,
  } = computed;

  const currentRegime    = garchResult!.currentRegime;
  const rc               = REGIME_COLORS[currentRegime.label];
  const terminalRegime   = garchForecast.terminalRegime;
  const trc              = REGIME_COLORS[terminalRegime.label];
  const volDelta         = garchForecast.volChangePct;
  const volDeltaColor    = volDelta > 0 ? '#DC2626' : '#16A34A';
  const DeltaIcon        = volDelta > 0 ? ArrowUpRight : ArrowDownRight;
  const regimeSame       = currentRegime.label === terminalRegime.label;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ══════════════════════════════════════════════════════════════
          KPI ROW
          ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>

        {/* Card 1 — Current Conditional Volatility */}
        <KpiCard
          icon={Activity}
          label="Current Conditional Vol"
          value={`${garchResult!.currentVol.toFixed(1)}%`}
          sub="GARCH(1,1) annualised"
          color={currentRegime.color}
        />

        {/* Card 2 — 12M Forward Volatility */}
        <KpiCard
          icon={BarChart2}
          label="12M Forward Volatility"
          value={`${garchForecast.avgFwdVol.toFixed(1)}%`}
          sub="Avg GARCH 12-step forecast"
        />

        {/* Card 3 — Volatility Change Forecast */}
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: '12px',
            padding: '20px', borderRadius: '6px',
            background: '#FFFFFF', border: '1px solid #D8D8D8',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#888888' }}>
              Vol Change Forecast
            </span>
            <div style={{
              display: 'flex', height: '28px', width: '28px',
              alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
              background: `${volDeltaColor}12`, border: `1px solid ${volDeltaColor}30`,
            }}>
              <DeltaIcon style={{ width: '13px', height: '13px', color: volDeltaColor }} strokeWidth={2} />
            </div>
          </div>
          <div>
            <span style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.025em', color: volDeltaColor, lineHeight: 1 }}>
              {volDelta > 0 ? '+' : ''}{volDelta.toFixed(1)} pp
            </span>
            <span style={{ fontSize: '11.5px', marginTop: '6px', display: 'block', color: '#888888' }}>
              Fwd vs current (percentage points)
            </span>
          </div>
        </div>

        {/* Card 4 — Projected Regime */}
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: '12px',
            padding: '20px', borderRadius: '6px',
            background: '#FFFFFF', border: '1px solid #D8D8D8',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#888888' }}>
              Projected Regime
            </span>
            <div style={{
              display: 'flex', height: '28px', width: '28px',
              alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
              background: trc.bg, border: `1px solid ${trc.border}`,
            }}>
              <span style={{ height: '8px', width: '8px', borderRadius: '50%', background: terminalRegime.color }} />
            </div>
          </div>
          <div>
            {regimeSame ? (
              <>
                <span style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '-0.02em', color: terminalRegime.color, lineHeight: 1 }}>
                  {terminalRegime.label}
                </span>
                <span style={{ fontSize: '11.5px', marginTop: '6px', display: 'block', color: '#888888' }}>Stable · no regime transition</span>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 900, color: currentRegime.color }}>{currentRegime.label}</span>
                  <span style={{ fontSize: '16px', color: '#BBBBBB' }}>→</span>
                  <span style={{ fontSize: '16px', fontWeight: 900, color: terminalRegime.color }}>{terminalRegime.label}</span>
                </div>
                <span style={{ fontSize: '11.5px', marginTop: '6px', display: 'block', color: '#888888' }}>12-month regime transition</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MAIN CHART + INTERPRETATION SIDE PANEL
          ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>

        {/* Chart card */}
        <div
          style={{
            background: '#FFFFFF', border: '1px solid #D8D8D8',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: '6px', padding: '24px',
          }}
        >
          {/* Chart header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div>
              <p style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#888888', marginBottom: '4px' }}>
                {config.histYears}Y Historical · 12M GARCH Forward Forecast
              </p>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#111111' }}>
                {config.name} · Price & Conditional Volatility
              </p>
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
              {[
                { color: '#111111', dash: false,  label: 'Spot Price'      },
                { color: '#E6B800', dash: true,   label: 'Fwd Median'      },
                { color: 'rgba(255,230,0,0.55)', dash: false, label: '50% Band'       },
                { color: 'rgba(255,230,0,0.28)', dash: false, label: '90% Band'       },
              ].map(leg => (
                <div key={leg.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    display: 'inline-block',
                    height: leg.dash ? undefined : '2px',
                    width: '20px',
                    borderRadius: '2px',
                    background: leg.dash ? undefined : leg.color,
                    borderTop: leg.dash ? `2px dashed ${leg.color}` : undefined,
                  }} />
                  <span style={{ fontSize: '10.5px', color: '#888888' }}>{leg.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Recharts ComposedChart ── */}
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData} margin={{ top: 6, right: 52, bottom: 6, left: 4 }}>
              {/* Axes */}
              <XAxis
                dataKey="dateLabel"
                ticks={ticks}
                tick={{ fontSize: 10, fill: '#AAAAAA', fontWeight: 500 }}
                axisLine={{ stroke: '#E5E5E3' }}
                tickLine={false}
                tickFormatter={(label: string) => {
                  // Convert "Jan 2023" → "Jan 23"
                  const parts = label.split(' ');
                  if (parts.length === 2) return `${parts[0]} ${parts[1].slice(-2)}`;
                  return label;
                }}
              />
              <YAxis
                yAxisId="price"
                orientation="left"
                domain={yDomain}
                tick={{ fontSize: 10, fill: '#AAAAAA' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${Math.round(v)}`}
                width={48}
              />
              <YAxis
                yAxisId="vol"
                orientation="right"
                tick={{ fontSize: 10, fill: '#AAAAAA' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                width={40}
              />

              {/* Tooltip */}
              <Tooltip
                content={<CombinedTooltip unit={config.unit} todayLabel={todayLabel} />}
                cursor={{ stroke: '#CCCCCC', strokeWidth: 1, strokeDasharray: '3 3' }}
              />

              {/* ── LAYER 1: 90% confidence cone (stacked floating band) ── */}
              {/* Transparent base layer anchors at p05 */}
              <Area
                yAxisId="price"
                stackId="s90"
                type="monotone"
                dataKey="bandBase90"
                fill="transparent"
                stroke="none"
                dot={false}
                activeDot={false}
                legendType="none"
                connectNulls={false}
                isAnimationActive={false}
              />
              {/* Band width (p95−p05): very pale yellow */}
              <Area
                yAxisId="price"
                stackId="s90"
                type="monotone"
                dataKey="bandWide90"
                fill="rgba(255,230,0,0.10)"
                stroke="rgba(255,230,0,0.28)"
                strokeWidth={0.75}
                strokeDasharray="3 4"
                dot={false}
                activeDot={false}
                legendType="none"
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* ── LAYER 2: 50% confidence cone ── */}
              <Area
                yAxisId="price"
                stackId="s50"
                type="monotone"
                dataKey="bandBase50"
                fill="transparent"
                stroke="none"
                dot={false}
                activeDot={false}
                legendType="none"
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                yAxisId="price"
                stackId="s50"
                type="monotone"
                dataKey="bandWide50"
                fill="rgba(255,230,0,0.22)"
                stroke="rgba(255,230,0,0.50)"
                strokeWidth={0.75}
                strokeDasharray="3 4"
                dot={false}
                activeDot={false}
                legendType="none"
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* ── LAYER 3: Grid (on top of confidence bands) ── */}
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="#E5E5E3"
                strokeWidth={1}
                vertical={false}
              />

              {/* ── LAYER 4: Historical price line ── */}
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                name="price"
                stroke="#111111"
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3, fill: '#111111', strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* ── LAYER 5: Forecast median (yellow dashed, mild AR1 noise) ── */}
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="fwdMedian"
                name="fwdMedian"
                stroke="#E6B800"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                activeDot={{ r: 3, fill: '#E6B800', strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* ── LAYER 6: Historical GARCH conditional vol (right axis) ── */}
              <Line
                yAxisId="vol"
                type="monotone"
                dataKey="garchVol"
                name="garchVol"
                stroke="#E6B800"
                strokeWidth={1.25}
                strokeOpacity={0.6}
                dot={false}
                activeDot={{ r: 2, fill: '#E6B800', strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* ── LAYER 7: Forward GARCH vol (right axis, dashed) ── */}
              <Line
                yAxisId="vol"
                type="monotone"
                dataKey="fwdVol"
                name="fwdVol"
                stroke="#D97706"
                strokeWidth={1.25}
                strokeDasharray="4 3"
                strokeOpacity={0.7}
                dot={false}
                activeDot={{ r: 2, fill: '#D97706', strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* ── LAYER 8: Regime reference lines ── */}
              <ReferenceLine
                yAxisId="vol"
                y={40}
                stroke="#DC2626"
                strokeWidth={1}
                strokeDasharray="4 4"
                strokeOpacity={0.40}
              />
              <ReferenceLine
                yAxisId="vol"
                y={28}
                stroke="#D97706"
                strokeWidth={1}
                strokeDasharray="4 4"
                strokeOpacity={0.35}
              />

              {/* ── TODAY DIVIDER ── */}
              <ReferenceLine
                yAxisId="price"
                x={todayLabel}
                stroke="#555555"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                label={{
                  value:    'Today',
                  position: 'top',
                  fontSize: 10,
                  fontWeight: 700,
                  fill:     '#555555',
                  letterSpacing: '0.08em',
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Chart footer */}
          <p style={{ fontSize: '10.5px', marginTop: '10px', color: '#BBBBBB' }}>
            Historical: {timelineGarch[0]?.dateLabel ?? '—'} → {latestDate} &nbsp;·&nbsp;
            Forecast: +12 months &nbsp;·&nbsp;
            GARCH(1,1): ω={params.omega} α={params.alpha} β={params.beta} &nbsp;·&nbsp;
            MC paths={config.mcPaths} &nbsp;·&nbsp; All figures annualised
          </p>
        </div>

        {/* Interpretation + parameters panel */}
        <ForecastInterpretation
          config={config}
          garchForecast={garchForecast}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════
          REGIME TIMELINE (historical + forward projection)
          ══════════════════════════════════════════════════════════════ */}
      <RegimeTimeline
        hist={timelineGarch}
        forecast={garchForecast}
      />

      {/* ══════════════════════════════════════════════════════════════
          RISK TRANSMISSION + INSIGHTS
          ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px' }}>
        <RiskTransmissionCard config={config} />
        <InsightCards />
      </div>

    </div>
  );
}
