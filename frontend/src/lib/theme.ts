/**
 * Theme constants v3 — EY Light Institutional Theme
 * TypeScript mirror of tokens.css
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
  bgPage:    '#F7F7F5',
  bgPanel:   '#FFFFFF',
  bgCard:    '#FFFFFF',
  bgSurface: '#F0F0EE',

  /* Borders */
  border:       '#D8D8D8',
  borderSubtle: '#E5E5E3',
  borderStrong: '#B8B8B6',

  /* Accent — EY Yellow */
  accent:      '#FFE600',
  accentDim:   'rgba(255,230,0,0.15)',
  accentGlow:  'rgba(255,230,0,0.08)',
  accentMuted: '#C9A800',
  accentText:  '#967A00',   /* for text on light backgrounds */
  accentChart: '#E6B800',   /* slightly richer for chart lines on white */

  /* Text */
  text1: '#111111',   /* primary   */
  text2: '#555555',   /* secondary */
  text3: '#888888',   /* muted     */
  text4: '#BBBBBB',   /* disabled  */

  /* Status */
  green:    '#16A34A',
  greenDim: 'rgba(22,163,74,0.10)',
  red:      '#DC2626',
  redDim:   'rgba(220,38,38,0.10)',
  amber:    '#D97706',
  amberDim: 'rgba(217,119,6,0.10)',
  blue:     '#2563EB',
  blueDim:  'rgba(37,99,235,0.10)',
} as const;

/* ---------------------------------------------------------------------------
   Layout
   --------------------------------------------------------------------------- */

export const layout = {
  sidebarWidth: 280,     /* px */
  topbarHeight: 72,      /* px */
  pagePadX:     48,      /* px */
  pagePadY:     48,      /* px */
  sectionGap:   40,      /* px */
  cardGap:      20,      /* px */
} as const;

/* ---------------------------------------------------------------------------
   Radius — sharp institutional style
   --------------------------------------------------------------------------- */

export const radius = {
  xs:   '2px',
  sm:   '4px',
  md:   '6px',
  lg:   '8px',
  card: '8px',
  full: '9999px',
} as const;

/* ---------------------------------------------------------------------------
   Chart palette — Recharts / chart library configuration
   --------------------------------------------------------------------------- */

export const chartColors = {
  /* Primary forecast + distribution line */
  primary:    '#E6B800',   /* EY yellow, slightly richer for white bg    */
  accent:     '#FFE600',   /* raw EY yellow for fills / highlights        */

  /* Historical line */
  history:    '#111111',   /* solid black                                 */

  /* Confidence band fills (translucent yellow) */
  bandOuter:  'rgba(230,184,0,0.10)',
  bandInner:  'rgba(230,184,0,0.22)',

  /* Chart infrastructure */
  grid:       'rgba(0,0,0,0.06)',
  gridSubtle: 'rgba(0,0,0,0.04)',
  axis:       '#888888',

  /* Tooltip */
  tooltipBg:     '#FFFFFF',
  tooltipBorder: '#D8D8D8',

  /* Status */
  secondary:  '#2563EB',
  tertiary:   '#16A34A',
  quaternary: '#DC2626',
  quinary:    '#7C3AED',
} as const;

/* ---------------------------------------------------------------------------
   Shadows
   --------------------------------------------------------------------------- */

export const shadows = {
  card: '0 1px 4px rgba(0,0,0,0.07), 0 0 0 1px #D8D8D8',
  lg:   '0 4px 24px rgba(0,0,0,0.10)',
  xl:   '0 8px 40px rgba(0,0,0,0.14)',
} as const;

/* ---------------------------------------------------------------------------
   cn — Tailwind class merger
   --------------------------------------------------------------------------- */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
