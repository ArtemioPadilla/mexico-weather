/**
 * Story 24.3 — the map legend as one continuous colour bar with tick
 * marks and the unit (plan PARIDAD_VISUAL E24), instead of a row of
 * swatches.
 *
 * Pure and DOM-free: `legendScaleFor()` turns the active legend kind
 * plus the display units (Story 19.3) into a `LegendScale` — the bar's
 * CSS gradient, its ticks (position 0…1 + label) and the unit — and
 * `fitTickLabels()` drops the labels that would collide on a narrow bar.
 * `legend-bar.ts` paints it.
 *
 * **The bar draws the ramps the map paints.** Every field ramp in
 * `mapfields.ts` / `mapwind.ts` is stepped (a colour per band, hard
 * edges), and the WebGL LUT of Story 24.1 is built from those same
 * functions, so a smooth gradient would show colours the map never
 * draws. The bar is therefore one gradient with hard colour stops at
 * the band edges — continuous along its length, banded exactly like
 * the field — and each band gets the same width (an ordinal axis, as
 * on most weather legends), which keeps the thresholds legible at
 * 360 px where a linear axis would squeeze 18 / 25 / 32 °C together.
 * Ticks sit on the band edges and carry the edge value converted to
 * the chosen unit. Radar (RainViewer's own palette, qualitative
 * categories) keeps its four words, centred in their bands.
 */
import {
  getTempStops,
  HUMIDITY_STOPS,
  PRESSURE_STOPS,
  PRECIP_STEPS,
  SNOW_STEPS,
  PRECIP_PROB_STEPS,
  SPREAD_STEPS,
  SPREAD_COLORS,
} from '../../mapfields';
import { WIND_SPEED_STOPS } from '../../mapwind';
import { RADAR_LEGEND } from '../../maplayers';
import {
  convertPressure,
  convertSpeed,
  convertTemp,
  PRESSURE_LABEL,
  SPEED_LABEL,
  TEMP_LABEL,
  type Units,
} from '../../units';

export type LegendKind =
  | 'radar'
  | 'temperature'
  | 'humidity'
  | 'pressure'
  | 'precipitation'
  | 'confidence'
  | 'wind';

/** A tick on the bar. `pos` runs 0 (left end) … 1 (right end). `edge`
 *  ticks mark a band boundary (a value); `band` ticks name the band
 *  they sit in the middle of (radar's categories). */
export interface LegendTick {
  pos: number;
  label: string;
  kind: 'edge' | 'band';
}

export interface LegendScale {
  /** Band colours, left to right; each band gets the same width. */
  bands: string[];
  ticks: LegendTick[];
  /** Unit shown next to the bar ("°C", "mm/h", "± hPa"). */
  unit: string;
  /** CSS `background-image` for the bar. */
  gradient: string;
}

type Stops = readonly (readonly [number, string])[];

/** A 0…1 fraction as a CSS percentage, three decimals at most (plenty
 *  for a bar a few hundred px wide), no trailing zeros. */
export function cssPercent(f: number): string {
  return `${Number((f * 100).toFixed(3))}%`;
}

/** One gradient, hard stops at every band edge (see the header). */
export function bandGradient(bands: readonly string[]): string {
  const n = bands.length;
  if (n === 0) return 'none';
  if (n === 1) return `linear-gradient(to right, ${bands[0]}, ${bands[0]})`;
  const parts = bands.map(
    (c, i) => `${c} ${cssPercent(i / n)} ${cssPercent((i + 1) / n)}`
  );
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

function scale(
  bands: string[],
  ticks: LegendTick[],
  unit: string
): LegendScale {
  return { bands, ticks, unit, gradient: bandGradient(bands) };
}

/**
 * A clamped stepped ramp (`tempColor`, `humidityColor`, `pressureColor`,
 * `windSpeedColor`): colour i holds from threshold i to threshold i+1,
 * the first colour also everything below threshold 1 and the last one
 * everything from the last threshold up. Bands = the colours; edge
 * ticks at thresholds 1…n. `closedTop` drops the last band when the
 * last threshold is the variable's ceiling (humidity's 100 %, where
 * the last colour covers a single value) and puts that tick at the
 * right end instead.
 */
export function steppedScale(
  stops: Stops,
  fmt: (v: number) => string,
  unit: string,
  closedTop = false
): LegendScale {
  const colors = stops.map((s) => s[1]);
  const bands = closedTop ? colors.slice(0, -1) : colors;
  const n = bands.length;
  const ticks: LegendTick[] = [];
  for (let i = 1; i < stops.length; i++) {
    ticks.push({
      pos: Math.min(1, i / n),
      label: fmt(stops[i][0]),
      kind: 'edge',
    });
  }
  return scale(bands, ticks, unit);
}

/**
 * A threshold ramp (`precipColor`, `snowColor`, `precipProbColor`):
 * transparent below the first bound, so the bar starts there — an edge
 * tick at the left end — and the last colour runs on to the right end.
 */
export function thresholdScale(
  steps: Stops,
  fmt: (v: number) => string,
  unit: string
): LegendScale {
  const bands = steps.map((s) => s[1]);
  const n = bands.length;
  const ticks: LegendTick[] = steps.map((s, i) => ({
    pos: i / n,
    label: fmt(s[0]),
    kind: 'edge',
  }));
  return scale(bands, ticks, unit);
}

/** Named categories, one band each, the name centred in its band. */
export function categoryScale(
  items: readonly { label: string; color: string }[],
  unit: string
): LegendScale {
  const n = items.length;
  return scale(
    items.map((it) => it.color),
    items.map((it, i) => ({
      pos: (i + 0.5) / n,
      label: it.label,
      kind: 'band',
    })),
    unit
  );
}

/** "0.1", "2.5", "10" — no trailing zeros, at most `dp` decimals. */
export function formatTickNumber(v: number, dp = 1): string {
  const r = Number(v.toFixed(dp));
  return String(Object.is(r, -0) ? 0 : r);
}

export interface LegendContext {
  units: Units;
  /** Active field layer id (the confidence legend follows its steps). */
  layer: string;
  /** Precipitation sub-option ('lluvia' | 'nieve' | 'probabilidad'). */
  precipSub: string;
  /** Radar category names in the page language, in RADAR_LEGEND order,
   *  keyed by their `labelKey`. */
  radarLabel: (labelKey: string) => string;
}

/** Unit of the confidence (spread) bar: spread stays in metric steps
 *  (Story 13.3), so its unit is the metric one of the field. */
function spreadUnit(ctx: LegendContext): string {
  switch (ctx.layer) {
    case 'temperature':
      return '°C';
    case 'humidity':
      return '%';
    case 'pressure':
      return 'hPa';
    case 'precipitation':
      return precipUnit(ctx.precipSub);
    default:
      return '';
  }
}

function precipUnit(sub: string): string {
  if (sub === 'nieve') return 'cm/h';
  if (sub === 'probabilidad') return '%';
  return 'mm/h';
}

/** The bar for the active legend kind, in the display units. */
export function legendScaleFor(
  kind: LegendKind,
  ctx: LegendContext
): LegendScale {
  const U = ctx.units;
  switch (kind) {
    case 'temperature':
      return steppedScale(
        getTempStops(),
        (c) => String(Math.round(convertTemp(c, U.temp))),
        TEMP_LABEL[U.temp]
      );
    case 'humidity':
      return steppedScale(HUMIDITY_STOPS, (h) => String(h), '%', true);
    case 'pressure':
      return steppedScale(
        PRESSURE_STOPS,
        (p) =>
          U.pressure === 'inHg'
            ? convertPressure(p, 'inHg').toFixed(1)
            : String(Math.round(p)),
        PRESSURE_LABEL[U.pressure]
      );
    case 'precipitation': {
      const steps =
        ctx.precipSub === 'nieve'
          ? SNOW_STEPS
          : ctx.precipSub === 'probabilidad'
            ? PRECIP_PROB_STEPS
            : PRECIP_STEPS;
      return thresholdScale(
        steps,
        (v) => formatTickNumber(v),
        precipUnit(ctx.precipSub)
      );
    }
    case 'confidence': {
      const steps = SPREAD_STEPS[ctx.layer] ?? SPREAD_STEPS.temperature;
      const stops: [number, string][] = SPREAD_COLORS.map((c, i) => [
        i === 0 ? -Infinity : steps[i - 1],
        c,
      ]);
      const unit = spreadUnit(ctx);
      return steppedScale(
        stops,
        (v) => formatTickNumber(v),
        `± ${unit}`.trim()
      );
    }
    case 'wind':
      // The grid is m/s; the tooltip converts through km/h the same way.
      return steppedScale(
        WIND_SPEED_STOPS,
        (mps) => {
          const v = convertSpeed(mps * 3.6, U.speed);
          return U.speed === 'ms' ? formatTickNumber(v) : String(Math.round(v));
        },
        SPEED_LABEL[U.speed]
      );
    case 'radar':
      return categoryScale(
        RADAR_LEGEND.map((s) => ({
          label: ctx.radarLabel(s.labelKey),
          color: s.color,
        })),
        'mm/h'
      );
  }
}

/** Rough advance of a label at `fontPx` (Open Sans Semibold: digits
 *  ≈ 0.57 em, lower case ≈ 0.55 em); a little generous on purpose. */
export function estimateLabelWidth(label: string, fontPx = 10): number {
  return label.length * fontPx * 0.6;
}

/**
 * Which tick labels fit on a bar `widthPx` wide without touching (the
 * tick marks always stay). A label is centred on its tick, except at
 * the ends where it is pinned inside the bar. The last label is placed
 * first, so the top of the scale is never the one dropped, then the
 * rest greedily from the left; returns one boolean per tick, `true` =
 * show the label.
 */
export function fitTickLabels(
  ticks: readonly LegendTick[],
  widthPx: number,
  opts: {
    fontPx?: number;
    gapPx?: number;
    /** Rendered width of label `i`; defaults to `estimateLabelWidth`. */
    measure?: (label: string, i: number) => number;
  } = {}
): boolean[] {
  const fontPx = opts.fontPx ?? 10;
  const gap = opts.gapPx ?? 4;
  const measure =
    opts.measure ?? ((l: string) => estimateLabelWidth(l, fontPx));
  const spans = ticks.map((t, i) => {
    const w = measure(t.label, i);
    const x = t.pos * widthPx;
    let left = x - w / 2;
    if (left < 0) left = 0;
    if (left + w > widthPx) left = Math.max(0, widthPx - w);
    return { left, right: left + w };
  });
  const show = ticks.map(() => false);
  if (ticks.length === 0) return show;
  const last = ticks.length - 1;
  show[last] = true;
  let prevRight = -Infinity;
  for (let i = 0; i < last; i++) {
    if (
      spans[i].left >= prevRight + gap &&
      spans[i].right + gap <= spans[last].left
    ) {
      show[i] = true;
      prevRight = spans[i].right;
    }
  }
  return show;
}
