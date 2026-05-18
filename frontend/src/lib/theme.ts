/**
 * Theme constants — TypeScript mirror of tokens.css
 *
 * Use CSS variables (var(--…)) in JSX styles wherever possible.
 * Use these constants for runtime logic, chart configuration, or when
 * CSS variables cannot reach the target (e.g. Recharts color props).
 */

/* ---------------------------------------------------------------------------
   Colors
   --------------------------------------------------------------------------- */

export const colors = {
  /* Surfaces */
  bgPage:    '#0B0B0C',
  bgPanel:   '#111318',
  bgCard:    '#15171C',
  bgSurface: '#1C1F24',

  /* Borders */
  border:       'rgba(255,255,255,0.06)',
  borderSubtle: 'rgba(255,255,255,0.04)',
  borderStrong: 'rgba(255,255,255,0.10)',

  /* Accent */
  accent:      '#F5D90A',
  accentDim:   'rgba(245,217,10,0.10)',
  accentGlow:  'rgba(245,217,10,0.06)',
  accentMuted: '#A89208',

  /* Text */
  text1: '#F5F7FA',   /* primary   */
  text2: '#A1A8B3',   /* secondary */
  text3: '#6B7280',   /* muted     */
  text4: '#374151',   /* disabled  */

  /* Status */
  green:    '#22C55E',
  greenDim: 'rgba(34,197,94,0.10)',
  red:      '#EF4444',
  redDim:   'rgba(239,68,68,0.10)',
  amber:    '#F59E0B',
  amberDim: 'rgba(245,158,11,0.10)',
  blue:     '#3B82F6',
  blueDim:  'rgba(59,130,246,0.10)',
} as const;

/* ---------------------------------------------------------------------------
   Layout
   --------------------------------------------------------------------------- */

export const layout = {
  sidebarWidth: 260,     /* px */
  topbarHeight: 64,      /* px */
  pagePadX:     40,      /* px */
  pagePadY:     40,      /* px */
  sectionGap:   32,      /* px */
  cardGap:      20,      /* px — spec: 20px gap system */
} as const;

/* ---------------------------------------------------------------------------
   Radius
   --------------------------------------------------------------------------- */

export const radius = {
  xs:   '4px',
  sm:   '6px',
  md:   '10px',
  lg:   '14px',
  card: '20px',   /* spec: 20px card corners */
  full: '9999px',
} as const;

/* ---------------------------------------------------------------------------
   Chart palette — use these when configuring Recharts / chart libraries
   --------------------------------------------------------------------------- */

export const chartColors = {
  primary:    '#F5D90A',
  secondary:  '#3B82F6',
  tertiary:   '#22C55E',
  quaternary: '#EF4444',
  quinary:    '#A78BFA',

  grid:       'rgba(255,255,255,0.04)',
  axis:       'rgba(255,255,255,0.28)',
  tooltip:    '#15171C',
} as const;

/* ---------------------------------------------------------------------------
   Shadows
   --------------------------------------------------------------------------- */

export const shadows = {
  card: '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
  lg:   '0 4px 32px rgba(0,0,0,0.5)',
  xl:   '0 8px 48px rgba(0,0,0,0.65)',
} as const;

/* ---------------------------------------------------------------------------
   cn — Tailwind class merger
   Wraps clsx for conditional class logic.
   --------------------------------------------------------------------------- */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
