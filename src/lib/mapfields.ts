// Pure, DOM-free Open-Meteo gridded-field helpers for /mapa field layers.

export interface LngLat {
  lat: number;
  lng: number;
}

export interface FieldGrid {
  /** ISO hourly timestamps (canonical, from the first result). */
  times: string[];
  /** One entry per input point, aligned by index; `values[h]` is the value at hour h (null when Open-Meteo has no data for that cell). */
  points: { lat: number; lng: number; values: (number | null)[] }[];
}

export interface LegendStop {
  label: string;
  color: string;
}

/** Bounding box in degrees. */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Evenly spaced sample points across `b`, edge-inclusive. Min 2x2. */
export function viewportGrid(b: Bounds, cols: number, rows: number): LngLat[] {
  const c = Math.max(2, Math.floor(cols));
  const r = Math.max(2, Math.floor(rows));
  const pts: LngLat[] = [];
  for (let j = 0; j < r; j++) {
    const lat = b.south + ((b.north - b.south) * j) / (r - 1);
    for (let i = 0; i < c; i++) {
      const lng = b.west + ((b.east - b.west) * i) / (c - 1);
      pts.push({ lng: Number(lng.toFixed(4)), lat: Number(lat.toFixed(4)) });
    }
  }
  return pts;
}

/** Time window of a field request (Story 15.1 — plan PRO_GRATIS E15).
 *
 *  Open-Meteo bills by call, not by payload, so a longer window costs
 *  nothing in quota — only bytes. The default keeps the 2-day hourly
 *  window the pre-baked snapshots use; the extended window trades
 *  hourly for 3-hourly steps so 10 days of 768 points stays ~400 KB
 *  per variable. */
export interface FieldRange {
  /** Days ahead (Open-Meteo allows up to 16). */
  forecastDays: number;
  /** Open-Meteo `temporal_resolution`. Omit for hourly. */
  temporalResolution?: 'hourly_3' | 'hourly_6';
  /** Days back (`past_days`). Omit for none. */
  pastDays?: number;
}

/** What the snapshots bake and what a layer loads first: 72 hourly
 *  frames — yesterday (Story 15.2, `past_days=1`: same call, same quota,
 *  so "hace 24 h" costs nothing) plus today and tomorrow. */
export const DEFAULT_FIELD_RANGE: FieldRange = { forecastDays: 2, pastDays: 1 };

/** What "Ver 10 días" fetches on demand: 3-hourly to +10 d. Merged on
 *  top of the default grid, the hourly frames win where they overlap. */
export const EXTENDED_FIELD_RANGE: FieldRange = {
  forecastDays: 10,
  temporalResolution: 'hourly_3',
};

function rangeParams(range: FieldRange | undefined): string {
  const r = range ?? DEFAULT_FIELD_RANGE;
  let s = `&forecast_days=${r.forecastDays}`;
  if (r.pastDays) s += `&past_days=${r.pastDays}`;
  if (r.temporalResolution) s += `&temporal_resolution=${r.temporalResolution}`;
  return s;
}

/** Keyless Open-Meteo bulk forecast URL for the given points + hourly
 *  variable. The optional `model` parameter routes the request to a
 *  specific NWP (e.g. 'icon_seamless'); omit it for Open-Meteo's
 *  default best_match selector. `range` widens the time window (see
 *  {@link FieldRange}); omitted ⇒ the 2-day default. */
export function buildFieldUrl(
  points: LngLat[],
  hourlyVar: string,
  model?: string,
  range?: FieldRange
): string {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  const modelParam = model && model !== 'best_match' ? `&models=${model}` : '';
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&hourly=${hourlyVar}${rangeParams(range)}&timezone=UTC${modelParam}`
  );
}

/** Open-Meteo's GET URL limit is ~8 KB (nginx default). At 4-dp
 *  coords each point takes ~7 chars in both lat= and lng=, plus a
 *  comma — so the URL grows by ~16 chars/point. 200 points yields
 *  a ~3 KB URL with comfortable margin. Without this cap, the
 *  32×24=768 point MX field grid triggers HTTP 414 (#280-prod
 *  diagnostic). */
export const FIELD_CHUNK_SIZE = 200;

/** Shared chunked fetcher: splits `points` into URL-safe chunks, fires
 *  all requests in parallel and merges the responses in input order.
 *  Throws AbortError immediately when the caller's signal is already
 *  aborted, and an Error carrying the HTTP status for non-ok chunks. */
async function fetchChunks(
  points: LngLat[],
  buildUrl: (chunk: LngLat[]) => string,
  fetchImpl: typeof fetch,
  label: string,
  signal?: AbortSignal
): Promise<unknown[]> {
  const jobs: Promise<unknown>[] = [];
  for (let i = 0; i < points.length; i += FIELD_CHUNK_SIZE) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const chunk = points.slice(i, i + FIELD_CHUNK_SIZE);
    const url = buildUrl(chunk);
    jobs.push(
      fetchImpl(url, { signal }).then((res) => {
        if (!res.ok) {
          throw new Error(`${label} chunk ${i} failed: HTTP ${res.status}`);
        }
        return res.json() as Promise<unknown>;
      })
    );
  }
  const results = await Promise.all(jobs);
  const out: unknown[] = [];
  for (const json of results) {
    if (Array.isArray(json)) out.push(...json);
    else out.push(json);
  }
  return out;
}

/** Fetch a field grid in URL-safe chunks. Mirrors the chunking
 *  done by scripts/build-field-grids.py so the client + the build
 *  see identical responses. Returns the merged Open-Meteo response
 *  array (one entry per input point, in input order), or throws if
 *  any chunk fails after the caller-supplied fetchImpl gives up. */
export async function fetchFieldChunks(
  points: LngLat[],
  hourlyVar: string,
  fetchImpl: typeof fetch,
  opts?: { signal?: AbortSignal; model?: string; range?: FieldRange }
): Promise<unknown[]> {
  return fetchChunks(
    points,
    (chunk) => buildFieldUrl(chunk, hourlyVar, opts?.model, opts?.range),
    fetchImpl,
    'field',
    opts?.signal
  );
}

/** Same as fetchFieldChunks but for the wind endpoint (separate
 *  hourly variables). */
export async function fetchWindChunks(
  points: LngLat[],
  speedVar: 'wind_speed_10m' | 'wind_gusts_10m',
  fetchImpl: typeof fetch,
  opts?: { signal?: AbortSignal; model?: string; range?: FieldRange }
): Promise<unknown[]> {
  return fetchChunks(
    points,
    (chunk) => buildWindUrl(chunk, speedVar, opts?.model, opts?.range),
    fetchImpl,
    'wind',
    opts?.signal
  );
}

function isNumberOrNullArray(a: unknown): a is (number | null)[] {
  return (
    Array.isArray(a) &&
    a.every((n) => n === null || (typeof n === 'number' && Number.isFinite(n)))
  );
}

/** Normalise an Open-Meteo response (array for many points, object for one) into a FieldGrid.
 *
 *  When the request was made with `&models=X` the response variable name
 *  is suffixed with the model id (e.g. `temperature_2m_icon_seamless`).
 *  We fall back to a prefix match so the caller doesn't need to know
 *  which model was used.
 */
export function parseFieldResponse(
  json: unknown,
  points: LngLat[],
  hourlyVar: string
): FieldGrid | null {
  if (!json) return null;
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== points.length) return null;
  const first = arr[0] as { hourly?: { time?: unknown } } | undefined;
  const times = first?.hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return null;
  const pickValues = (h: Record<string, unknown> | undefined): unknown => {
    if (!h) return undefined;
    if (h[hourlyVar] !== undefined) return h[hourlyVar];
    // Model-suffixed variant (e.g. temperature_2m_icon_seamless).
    const prefix = `${hourlyVar}_`;
    for (const k of Object.keys(h)) {
      if (k.startsWith(prefix)) return h[k];
    }
    return undefined;
  };
  const out: FieldGrid['points'] = [];
  for (let i = 0; i < arr.length; i++) {
    const h = (arr[i] as { hourly?: Record<string, unknown> } | undefined)
      ?.hourly;
    const values = pickValues(h);
    if (!isNumberOrNullArray(values)) return null;
    out.push({ lat: points[i].lat, lng: points[i].lng, values });
  }
  return { times: times as string[], points: out };
}

/** Parse an ISO string as UTC: bare strings (no Z / offset) are treated as UTC per Open-Meteo. */
export function parseUtcMs(s: string): number {
  return /[Zz]|[+-]\d{2}:\d{2}$/.test(s) ? Date.parse(s) : Date.parse(s + 'Z');
}

/** Merge an extended (longer, coarser) grid under a base grid over the
 *  same points. The result's `times` is the sorted union; where both
 *  grids carry a timestamp the base (hourly) value wins. Returns null
 *  when the point lists don't line up (different grid ⇒ can't merge). */
export function mergeFieldGrids(
  base: FieldGrid,
  ext: FieldGrid
): FieldGrid | null {
  const n = base.points.length;
  if (n !== ext.points.length) return null;
  for (let i = 0; i < n; i++) {
    if (
      base.points[i].lat !== ext.points[i].lat ||
      base.points[i].lng !== ext.points[i].lng
    ) {
      return null;
    }
  }
  const baseIdx = new Map<number, number>();
  base.times.forEach((t, i) => baseIdx.set(parseUtcMs(t), i));
  const extIdx = new Map<number, number>();
  ext.times.forEach((t, i) => extIdx.set(parseUtcMs(t), i));
  const allMs = Array.from(new Set([...baseIdx.keys(), ...extIdx.keys()])).sort(
    (a, b) => a - b
  );
  const times = allMs.map((ms) => {
    const bi = baseIdx.get(ms);
    if (bi !== undefined) return base.times[bi];
    return ext.times[extIdx.get(ms) as number];
  });
  const points = base.points.map((bp, i) => {
    const ep = ext.points[i];
    const values = allMs.map((ms) => {
      const bi = baseIdx.get(ms);
      if (bi !== undefined) return bp.values[bi] ?? null;
      const ei = extIdx.get(ms) as number;
      return ep.values[ei] ?? null;
    });
    return { lat: bp.lat, lng: bp.lng, values };
  });
  return { times, points };
}

/** Same as {@link mergeFieldGrids} for u/v wind grids. */
export function mergeWindGrids(base: WindGrid, ext: WindGrid): WindGrid | null {
  const toField = (g: WindGrid, comp: 'u' | 'v'): FieldGrid => ({
    times: g.times,
    points: g.points.map((p) => ({ lat: p.lat, lng: p.lng, values: p[comp] })),
  });
  const u = mergeFieldGrids(toField(base, 'u'), toField(ext, 'u'));
  const v = mergeFieldGrids(toField(base, 'v'), toField(ext, 'v'));
  if (!u || !v) return null;
  return {
    times: u.times,
    points: u.points.map((p, i) => ({
      lat: p.lat,
      lng: p.lng,
      u: p.values,
      v: v.points[i].values,
    })),
  };
}

/** True when the grid already spans more than the 2-day default window. */
export function isExtendedGrid(g: { times: string[] }): boolean {
  if (g.times.length < 2) return false;
  // The default window is −24 h … +48 h (< 3 days); the extension
  // reaches +10 d, so anything past 4 days of span is extended.
  const span = parseUtcMs(g.times[g.times.length - 1]) - parseUtcMs(g.times[0]);
  return span > 4 * 86_400_000;
}

/** Hourly index closest to `iso`; nearest to `nowMs` if iso null/invalid; -1 if empty. */
export function fieldFrameIndex(
  times: string[],
  iso: string | null,
  nowMs: number
): number {
  if (times.length === 0) return -1;
  const ms = iso ? parseUtcMs(iso) : NaN;
  const target = Number.isFinite(ms) ? ms : nowMs;
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(parseUtcMs(times[i]) - target);
    if (d < bestDelta) {
      best = i;
      bestDelta = d;
    }
  }
  return best;
}

/** Temperature (°C) → hex colour on a clamped cold→warm ramp.
 *
 *  Default palette is the perceptually-uniform RdYlBu-inverted set used
 *  by zoom.earth. When `colorBlindMode` is enabled (see setColorBlindMode)
 *  the ramp swaps to a viridis-derived sequence that's distinguishable
 *  for the most common forms of colour blindness (deutan/protan/tritan).
 */
let colorBlindMode = false;
export function setColorBlindMode(on: boolean): void {
  colorBlindMode = on;
}
export function getColorBlindMode(): boolean {
  return colorBlindMode;
}

const TEMP_STOPS_DEFAULT: [number, string][] = [
  [-10, '#3b4cc0'],
  [0, '#5b8ff9'],
  [10, '#7dd1c8'],
  [18, '#7ad151'],
  [25, '#f9d423'],
  [32, '#f08a24'],
  [45, '#d7191c'],
];
// viridis-style ramp (yellow → green → teal → blue → purple), reversed
// so warmer temps map to brighter ends. Distinguishable across the three
// major colour-blindness types.
const TEMP_STOPS_CBSAFE: [number, string][] = [
  [-10, '#440154'],
  [0, '#3b528b'],
  [10, '#21908d'],
  [18, '#5dc863'],
  [25, '#a8db34'],
  [32, '#fde725'],
  [45, '#fff5b1'],
];

/** Story 24.3 — the temperature ramp in force (colour-blind aware), so
 *  the legend draws the very bands `tempColor` paints. */
export function getTempStops(): readonly (readonly [number, string])[] {
  return colorBlindMode ? TEMP_STOPS_CBSAFE : TEMP_STOPS_DEFAULT;
}

export function tempColor(c: number): string {
  const stops = getTempStops();
  if (c <= stops[0][0]) return stops[0][1];
  if (c >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (c >= stops[i][0] && c < stops[i + 1][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

const TEMP_LEGEND_DEFAULT: LegendStop[] = [
  { label: '≤0°', color: '#5b8ff9' },
  { label: '10°', color: '#7dd1c8' },
  { label: '18°', color: '#7ad151' },
  { label: '25°', color: '#f9d423' },
  { label: '32°', color: '#f08a24' },
  { label: '≥45°', color: '#d7191c' },
];
const TEMP_LEGEND_CBSAFE: LegendStop[] = [
  { label: '≤0°', color: '#3b528b' },
  { label: '10°', color: '#21908d' },
  { label: '18°', color: '#5dc863' },
  { label: '25°', color: '#a8db34' },
  { label: '32°', color: '#fde725' },
  { label: '≥45°', color: '#fff5b1' },
];

/** Returns the current legend, accessor-style so the caller picks the
 *  ramp matching the colorBlindMode toggle when it renders. */
export function getTempLegend(): LegendStop[] {
  return colorBlindMode ? TEMP_LEGEND_CBSAFE : TEMP_LEGEND_DEFAULT;
}

/** Exposed for backwards compat; new code should call getTempLegend(). */
export const TEMP_LEGEND: LegendStop[] = TEMP_LEGEND_DEFAULT;

/** Relative humidity ramp: `[threshold %, colour]`, clamped. */
export const HUMIDITY_STOPS: readonly (readonly [number, string])[] = [
  [0, '#fde725'],
  [20, '#a8db34'],
  [40, '#5dc863'],
  [60, '#21908d'],
  [80, '#3b528b'],
  [100, '#440154'],
];

/** Relative humidity (%) → hex colour on a clamped dry→wet ramp. */
export function humidityColor(h: number): string {
  const stops = HUMIDITY_STOPS;
  if (h <= stops[0][0]) return stops[0][1];
  if (h >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (h >= stops[i][0] && h < stops[i + 1][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

/** MSL pressure ramp: `[threshold hPa, colour]`, clamped. */
export const PRESSURE_STOPS: readonly (readonly [number, string])[] = [
  [970, '#542788'],
  [990, '#998ec3'],
  [1005, '#d8daeb'],
  [1015, '#fee0b6'],
  [1025, '#f1a340'],
  [1040, '#b35806'],
];

/** Pressure (hPa, MSL) → hex colour on a clamped low→high ramp. */
export function pressureColor(p: number): string {
  const stops = PRESSURE_STOPS;
  if (p <= stops[0][0]) return stops[0][1];
  if (p >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (p >= stops[i][0] && p < stops[i + 1][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

export const HUMIDITY_LEGEND: LegendStop[] = [
  { label: '≤0%', color: '#fde725' },
  { label: '20%', color: '#a8db34' },
  { label: '40%', color: '#5dc863' },
  { label: '60%', color: '#21908d' },
  { label: '80%', color: '#3b528b' },
  { label: '≥100%', color: '#440154' },
];

/** Story 15.5 — forecast precipitation (mm/h) → colour. Dry cells are
 *  fully transparent (8-digit hex; fillFieldImageData honours the alpha
 *  nibble) so the field reads like a radar composite over the basemap:
 *  blue → purple like the RainViewer legend, magenta for downpours. */
export const PRECIP_TRANSPARENT = '#00000000';

/** Threshold ramps (Story 24.3 hoists them so the legend reads the very
 *  bands the field paints): `[lower bound, colour]`, ascending; below
 *  the first bound the cell is transparent, from the last one up it
 *  keeps the last colour. */
export const PRECIP_STEPS: readonly (readonly [number, string])[] = [
  [0.1, '#a6d8ff'],
  [0.5, '#5aaeff'],
  [1, '#1f6fe6'],
  [2.5, '#5b3fb8'],
  [5, '#9b2fb0'],
  [10, '#e01e9a'],
];
export const SNOW_STEPS: readonly (readonly [number, string])[] = [
  [0.1, '#e6f4ff'],
  [0.5, '#b8dcff'],
  [1, '#8ec2ff'],
  [2.5, '#6aa0e6'],
  [5, '#4c6fb3'],
];
export const PRECIP_PROB_STEPS: readonly (readonly [number, string])[] = [
  [10, '#cfe8ff'],
  [30, '#8ec2ff'],
  [50, '#4d94ff'],
  [70, '#1f5fd6'],
  [90, '#0b3a99'],
];

function thresholdColor(
  v: number,
  steps: readonly (readonly [number, string])[]
): string {
  if (!(v >= steps[0][0])) return PRECIP_TRANSPARENT;
  for (let i = steps.length - 1; i > 0; i--) {
    if (v >= steps[i][0]) return steps[i][1];
  }
  return steps[0][1];
}

/** Forecast precipitation (mm/h) → colour on `PRECIP_STEPS`. */
export function precipColor(mm: number): string {
  return thresholdColor(mm, PRECIP_STEPS);
}

/** Snowfall (cm/h) → colour; white-blue ramp, transparent when none. */
export function snowColor(cm: number): string {
  return thresholdColor(cm, SNOW_STEPS);
}

/** Precipitation probability (%) → colour; < 10 % is transparent. */
export function precipProbColor(p: number): string {
  return thresholdColor(p, PRECIP_PROB_STEPS);
}

export const PRECIP_LEGEND: LegendStop[] = [
  { label: '0.1', color: '#a6d8ff' },
  { label: '1', color: '#1f6fe6' },
  { label: '2.5', color: '#5b3fb8' },
  { label: '5', color: '#9b2fb0' },
  { label: '≥10 mm/h', color: '#e01e9a' },
];

export const SNOW_LEGEND: LegendStop[] = [
  { label: '0.1', color: '#e6f4ff' },
  { label: '1', color: '#8ec2ff' },
  { label: '2.5', color: '#6aa0e6' },
  { label: '≥5 cm/h', color: '#4c6fb3' },
];

export const PRECIP_PROB_LEGEND: LegendStop[] = [
  { label: '10%', color: '#cfe8ff' },
  { label: '30%', color: '#8ec2ff' },
  { label: '50%', color: '#4d94ff' },
  { label: '70%', color: '#1f5fd6' },
  { label: '≥90%', color: '#0b3a99' },
];

export const PRESSURE_LEGEND: LegendStop[] = [
  { label: '≤970', color: '#542788' },
  { label: '990', color: '#998ec3' },
  { label: '1005', color: '#d8daeb' },
  { label: '1015', color: '#fee0b6' },
  { label: '1025', color: '#f1a340' },
  { label: '≥1040 hPa', color: '#b35806' },
];

import { windUv } from './mapwind';

/** Wind grid: u/v per point per hour, with nulls for no-data cells. */
export interface WindGrid {
  times: string[];
  points: {
    lat: number;
    lng: number;
    u: (number | null)[];
    v: (number | null)[];
  }[];
}

/** Keyless Open-Meteo bulk URL fetching speed + direction together.
 *  Optional model routes the request to a specific NWP. */
export function buildWindUrl(
  points: LngLat[],
  speedVar: 'wind_speed_10m' | 'wind_gusts_10m' = 'wind_speed_10m',
  model?: string,
  range?: FieldRange
): string {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  const modelParam = model && model !== 'best_match' ? `&models=${model}` : '';
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&hourly=${speedVar},wind_direction_10m${rangeParams(range)}&timezone=UTC${modelParam}`
  );
}

function isSpeedDirArray(a: unknown): a is (number | null)[] {
  return (
    Array.isArray(a) &&
    a.every((n) => n === null || (typeof n === 'number' && Number.isFinite(n)))
  );
}

/** Normalise an Open-Meteo wind bulk response into a WindGrid (u/v decomposed). Null if unusable. */
export function parseWindResponse(
  json: unknown,
  points: LngLat[],
  speedVar: 'wind_speed_10m' | 'wind_gusts_10m' = 'wind_speed_10m'
): WindGrid | null {
  if (!json) return null;
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== points.length) return null;
  const first = arr[0] as { hourly?: { time?: unknown } } | undefined;
  const times = first?.hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return null;
  const out: WindGrid['points'] = [];
  const pickPrefix = (
    h: Record<string, unknown> | undefined,
    prefix: string
  ): unknown => {
    if (!h) return undefined;
    if (h[prefix] !== undefined) return h[prefix];
    const lead = `${prefix}_`;
    for (const k of Object.keys(h)) {
      if (k.startsWith(lead)) return h[k];
    }
    return undefined;
  };
  for (let i = 0; i < arr.length; i++) {
    const h = (arr[i] as { hourly?: Record<string, unknown> } | undefined)
      ?.hourly;
    const sp = pickPrefix(h, speedVar);
    const dr = pickPrefix(h, 'wind_direction_10m');
    if (
      !isSpeedDirArray(sp) ||
      !isSpeedDirArray(dr) ||
      sp.length !== times.length ||
      dr.length !== times.length
    ) {
      return null;
    }
    const u: (number | null)[] = [];
    const v: (number | null)[] = [];
    for (let h2 = 0; h2 < times.length; h2++) {
      const s = sp[h2];
      const d = dr[h2];
      if (s === null || d === null) {
        u.push(null);
        v.push(null);
      } else {
        const uv = windUv(s, d);
        u.push(uv.u);
        v.push(uv.v);
      }
    }
    out.push({ lat: points[i].lat, lng: points[i].lng, u, v });
  }
  return { times: times as string[], points: out };
}

// ---------------------------------------------------------------------
// Story 13.3 — multi-model disagreement ("incertidumbre").
// ---------------------------------------------------------------------

/** Per-point, per-hour spread (max − min) across several model grids
 *  for the same variable, aligned on `refTimes` (a model missing an
 *  hour, or fewer than two models with a value, yields null). Null when
 *  fewer than two grids share the reference point layout. */
export function spreadFieldGrid(
  grids: readonly FieldGrid[],
  refPoints: readonly { lat: number; lng: number }[],
  refTimes: readonly string[]
): FieldGrid | null {
  const usable = grids.filter(
    (g) =>
      g.points.length === refPoints.length &&
      g.points.every(
        (p, i) => p.lat === refPoints[i].lat && p.lng === refPoints[i].lng
      )
  );
  if (usable.length < 2) return null;
  const idx = usable.map((g) => {
    const m = new Map<string, number>();
    g.times.forEach((t, i) => m.set(t, i));
    return m;
  });
  const points: FieldGrid['points'] = refPoints.map((p, pi) => ({
    lat: p.lat,
    lng: p.lng,
    values: refTimes.map((t) => {
      let lo = Infinity;
      let hi = -Infinity;
      let n = 0;
      for (let gi = 0; gi < usable.length; gi++) {
        const ti = idx[gi].get(t);
        if (ti === undefined) continue;
        const v = usable[gi].points[pi].values[ti];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        n += 1;
      }
      return n >= 2 ? Math.round((hi - lo) * 100) / 100 : null;
    }),
  }));
  return { times: [...refTimes], points };
}

/** Spread thresholds per layer in the variable's own unit: below the
 *  first step the models agree; past the last they clearly diverge. */
export const SPREAD_STEPS: Record<string, [number, number, number, number]> = {
  temperature: [1, 2, 4, 6],
  humidity: [5, 10, 20, 30],
  pressure: [1, 2, 4, 6],
  precipitation: [0.5, 1, 3, 5],
};

export const SPREAD_COLORS: readonly string[] = [
  '#22c55e',
  '#a3e635',
  '#facc15',
  '#f97316',
  '#7e22ce',
];

/** Spread → colour (green = agreement … purple = strong disagreement). */
export function spreadColorFor(layerId: string): (v: number) => string {
  const steps = SPREAD_STEPS[layerId] ?? SPREAD_STEPS.temperature;
  return (v: number): string => {
    if (v < steps[0]) return SPREAD_COLORS[0];
    if (v < steps[1]) return SPREAD_COLORS[1];
    if (v < steps[2]) return SPREAD_COLORS[2];
    if (v < steps[3]) return SPREAD_COLORS[3];
    return SPREAD_COLORS[4];
  };
}

export function spreadLegendFor(layerId: string, unit: string): LegendStop[] {
  const steps = SPREAD_STEPS[layerId] ?? SPREAD_STEPS.temperature;
  return [
    { label: `<${steps[0]}`, color: SPREAD_COLORS[0] },
    { label: `${steps[0]}`, color: SPREAD_COLORS[1] },
    { label: `${steps[1]}`, color: SPREAD_COLORS[2] },
    { label: `${steps[2]}`, color: SPREAD_COLORS[3] },
    { label: `≥${steps[3]} ${unit}`.trim(), color: SPREAD_COLORS[4] },
  ];
}
