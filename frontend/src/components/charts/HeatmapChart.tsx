'use client';

import { useState } from 'react';
import { cn } from '../../lib/theme';

/* ---------------------------------------------------------------------------
   Data types
   --------------------------------------------------------------------------- */

export interface HeatmapChartProps {
  /** Row labels — e.g. asset classes or currency pairs */
  rows:           string[];
  /** Column labels — e.g. tenor buckets */
  cols:           string[];
  /**
   * 2D values array: values[rowIndex][colIndex].
   * Can be positive (long) or negative (short/hedged).
   */
  values:         number[][];
  /** Optional: override the max value for colour normalisation */
  maxValue?:      number;
  /** Format displayed in each cell (default: compact locale) */
  formatValue?:   (v: number) => string;
  /** Row axis label */
  rowAxisLabel?:  string;
  /** Column axis label */
  colAxisLabel?:  string;
  className?:     string;
}

/* ---------------------------------------------------------------------------
   Colour scale helpers
   Positive exposure  → yellow scale (accent)
   Negative/hedged    → blue scale (info)
   Near-zero          → very dim
   --------------------------------------------------------------------------- */

function valueToColor(
  value:    number,
  maxAbs:   number,
): string {
  if (maxAbs === 0) return 'rgba(255,255,255,0.03)';
  const ratio = Math.min(Math.abs(value) / maxAbs, 1);

  if (value >= 0) {
    // Yellow scale: dim → vivid accent
    const opacity = 0.05 + ratio * 0.80;
    return `rgba(245,217,10,${opacity.toFixed(2)})`;
  } else {
    // Blue scale: dim → vivid blue
    const opacity = 0.05 + ratio * 0.70;
    return `rgba(59,130,246,${opacity.toFixed(2)})`;
  }
}

function valueToTextColor(value: number, maxAbs: number): string {
  if (maxAbs === 0) return '#374151';
  const ratio = Math.abs(value) / maxAbs;
  if (ratio < 0.2) return '#374151';
  if (ratio < 0.55) return value >= 0 ? '#A89208' : '#6B7280';
  return value >= 0 ? '#0A0A0B' : '#F5F7FA';
}

/* ---------------------------------------------------------------------------
   HeatmapChart
   CSS grid-based — Recharts has no native heatmap primitive.
   --------------------------------------------------------------------------- */

export function HeatmapChart({
  rows,
  cols,
  values,
  maxValue,
  formatValue  = (v) => v === 0 ? '—' : Math.abs(v) >= 1000
    ? `${(v / 1000).toFixed(1)}k`
    : v.toFixed(0),
  rowAxisLabel,
  colAxisLabel,
  className,
}: HeatmapChartProps) {
  const [hoveredCell, setHoveredCell] = useState<{ r: number; c: number } | null>(null);

  // Compute max absolute value for normalisation
  const flatValues = values.flat().filter(v => v !== undefined && v !== null);
  const computedMax = maxValue ?? Math.max(...flatValues.map(Math.abs), 1);

  const ROW_LABEL_W = '120px';
  const CELL_H      = '44px';

  return (
    <div className={cn('w-full overflow-auto', className)}>
      {/* Column axis label */}
      {colAxisLabel && (
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7280] mb-3"
          style={{ paddingLeft: ROW_LABEL_W }}
        >
          {colAxisLabel}
        </p>
      )}

      <div className="inline-flex flex-col min-w-full">
        {/* Column header row */}
        <div
          className="flex items-end mb-1"
          style={{ gap: '3px' }}
        >
          {/* Empty corner above row labels */}
          <div
            className="shrink-0 flex items-end pb-1"
            style={{ width: ROW_LABEL_W }}
          >
            {rowAxisLabel && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7280]">
                {rowAxisLabel}
              </span>
            )}
          </div>

          {/* Col labels */}
          {cols.map((col) => (
            <div
              key={col}
              className="flex items-end justify-center flex-1 pb-1"
              style={{ minWidth: '52px' }}
            >
              <span className="text-[11px] font-semibold text-[#6B7280] whitespace-nowrap">
                {col}
              </span>
            </div>
          ))}
        </div>

        {/* Data rows */}
        {rows.map((row, ri) => (
          <div
            key={row}
            className="flex items-center"
            style={{ gap: '3px', marginBottom: '3px' }}
          >
            {/* Row label */}
            <div
              className="shrink-0 flex items-center"
              style={{ width: ROW_LABEL_W, height: CELL_H }}
            >
              <span className="text-[12.5px] font-medium text-[#A1A8B3] truncate pr-3">
                {row}
              </span>
            </div>

            {/* Cells */}
            {cols.map((col, ci) => {
              const v       = values[ri]?.[ci] ?? 0;
              const bg      = valueToColor(v, computedMax);
              const textClr = valueToTextColor(v, computedMax);
              const isHov   = hoveredCell?.r === ri && hoveredCell?.c === ci;

              return (
                <div
                  key={col}
                  className="relative flex-1 flex items-center justify-center rounded-[6px] transition-all duration-100 cursor-default select-none"
                  style={{
                    background: isHov
                      ? v >= 0
                        ? 'rgba(245,217,10,0.75)'
                        : 'rgba(59,130,246,0.65)'
                      : bg,
                    height:    CELL_H,
                    minWidth:  '52px',
                  }}
                  onMouseEnter={() => setHoveredCell({ r: ri, c: ci })}
                  onMouseLeave={() => setHoveredCell(null)}
                >
                  <span
                    className="text-[11.5px] font-semibold leading-none"
                    style={{
                      color:              isHov ? '#0A0A0B' : textClr,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatValue(v)}
                  </span>

                  {/* Hover tooltip */}
                  {isHov && (
                    <div
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 rounded-[10px] px-3 py-2 whitespace-nowrap pointer-events-none"
                      style={{
                        background:  'rgba(15,17,20,0.96)',
                        border:      '1px solid rgba(255,255,255,0.10)',
                        backdropFilter: 'blur(12px)',
                        boxShadow:   '0 4px 20px rgba(0,0,0,0.5)',
                      }}
                    >
                      <p className="text-[10.5px] font-semibold text-[#6B7280] uppercase tracking-[0.12em] leading-none mb-1.5">
                        {row} · {col}
                      </p>
                      <p
                        className="text-[14px] font-semibold leading-none"
                        style={{
                          color:              v >= 0 ? '#F5D90A' : '#3B82F6',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {v >= 0 ? '+' : ''}{v.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Colour scale legend */}
        <div className="flex items-center gap-4 mt-5" style={{ paddingLeft: ROW_LABEL_W }}>
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-20 rounded-full"
              style={{
                background: 'linear-gradient(to right, rgba(245,217,10,0.06), rgba(245,217,10,0.90))',
              }}
            />
            <span className="text-[11px] text-[#6B7280]">Long exposure</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-20 rounded-full"
              style={{
                background: 'linear-gradient(to right, rgba(59,130,246,0.06), rgba(59,130,246,0.70))',
              }}
            />
            <span className="text-[11px] text-[#6B7280]">Short / hedged</span>
          </div>
        </div>
      </div>
    </div>
  );
}
