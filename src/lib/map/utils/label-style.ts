/**
 * Story 24.3 — one type spec for every label MapLibre draws on the map
 * (city values, isobars, storm names and track times, the hurricane
 * outlook, historic storms, lakes, volcanoes, webcams, AQI, marine).
 *
 * - **One family, one weight:** `MAP_LABEL_FONT`. Before, the overlays
 *   that set no `text-font` fell back to MapLibre's default stack (Open
 *   Sans Regular + Arial Unicode MS) while the others asked for Open Sans
 *   Semibold — two weights side by side and two glyph downloads. The
 *   legend (HTML) uses the same face through a self-hosted @font-face
 *   (global.css, `--im-map-font`).
 * - **Size follows the zoom:** `labelSize(role)` — the role's size at
 *   the country view (z5), two px smaller at z3, larger as you zoom in
 *   (+2 at z8, +4 at z11), never under 9 px.
 * - **One halo:** `labelHalo(tone)` — the same width and blur everywhere;
 *   only its colour depends on the text: light text (white values over
 *   imagery) gets a dark halo, coloured / dark text (the point overlays)
 *   a white one.
 *
 * The glyph host (`glyphs` in interactive-map.ts, MapLibre's demotiles)
 * serves this stack; probed 2026-09-28: "Open Sans Semibold" → 200,
 * "Open Sans Regular" or "Open Sans Bold" on their own → 404.
 */
import type maplibregl from 'maplibre-gl';

export const MAP_LABEL_FONT: string[] = ['Open Sans Semibold'];

/** Size (px) of each label role at z5. */
export const LABEL_BASE_PX = {
  /** A value that is the point of the layer (city values). */
  value: 12,
  /** A feature's name (storm, volcano, webcam, historic track). */
  name: 11,
  /** Small print: contour values, track times, station readings. */
  detail: 10,
} as const;

export type LabelRole = keyof typeof LABEL_BASE_PX;

export const LABEL_MIN_PX = 9;

/** `[zoom, px]` stops of a role's size curve (linear in between). */
export function labelSizeStops(role: LabelRole): [number, number][] {
  const b = LABEL_BASE_PX[role];
  return [
    [3, Math.max(LABEL_MIN_PX, b - 2)],
    [5, b],
    [8, b + 2],
    [11, b + 4],
  ];
}

/** `text-size` expression for a role. */
export function labelSize(role: LabelRole): maplibregl.ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...labelSizeStops(role).flat(),
  ] as maplibregl.ExpressionSpecification;
}

/** Layout properties every text label shares: family and size. */
export function labelLayout(role: LabelRole): {
  'text-font': string[];
  'text-size': maplibregl.ExpressionSpecification;
} {
  return { 'text-font': MAP_LABEL_FONT, 'text-size': labelSize(role) };
}

/** Colour of the label's text: `light` = white/near-white text,
 *  `dark` = dark or saturated colour text. */
export type LabelTone = 'light' | 'dark';

export const LABEL_HALO_WIDTH = 1.4;
export const LABEL_HALO_BLUR = 0.3;

/** Paint properties for a consistent halo around a label. */
export function labelHalo(tone: LabelTone): {
  'text-halo-color': string;
  'text-halo-width': number;
  'text-halo-blur': number;
} {
  return {
    'text-halo-color':
      tone === 'light' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)',
    'text-halo-width': LABEL_HALO_WIDTH,
    'text-halo-blur': LABEL_HALO_BLUR,
  };
}
