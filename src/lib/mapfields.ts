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

/** Keyless Open-Meteo bulk forecast URL for the given points + hourly
 *  variable. The optional `model` parameter routes the request to a
 *  specific NWP (e.g. 'icon_seamless'); omit it for Open-Meteo's
 *  default best_match selector. */
export function buildFieldUrl(
  points: LngLat[],
  hourlyVar: string,
  model?: string,
): string {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  const modelParam =
    model && model !== 'best_match' ? `&models=${model}` : '';
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&hourly=${hourlyVar}&forecast_days=2&timezone=UTC${modelParam}`
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
  signal?: AbortSignal,
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
      }),
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
  opts?: { signal?: AbortSignal; model?: string },
): Promise<unknown[]> {
  return fetchChunks(
    points,
    (chunk) => buildFieldUrl(chunk, hourlyVar, opts?.model),
    fetchImpl,
    'field',
    opts?.signal,
  );
}

/** Same as fetchFieldChunks but for the wind endpoint (separate
 *  hourly variables). */
export async function fetchWindChunks(
  points: LngLat[],
  speedVar: 'wind_speed_10m' | 'wind_gusts_10m',
  fetchImpl: typeof fetch,
  opts?: { signal?: AbortSignal; model?: string },
): Promise<unknown[]> {
  return fetchChunks(
    points,
    (chunk) => buildWindUrl(chunk, speedVar, opts?.model),
    fetchImpl,
    'wind',
    opts?.signal,
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
  hourlyVar: string,
): FieldGrid | null {
  if (!json) return null;
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== points.length) return null;
  const first = arr[0] as { hourly?: { time?: unknown } } | undefined;
  const times = first?.hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return null;
  const pickValues = (
    h: Record<string, unknown> | undefined,
  ): unknown => {
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
    const h = (arr[i] as { hourly?: Record<string, unknown> } | undefined)?.hourly;
    const values = pickValues(h);
    if (!isNumberOrNullArray(values)) return null;
    out.push({ lat: points[i].lat, lng: points[i].lng, values });
  }
  return { times: times as string[], points: out };
}

/** Parse an ISO string as UTC: bare strings (no Z / offset) are treated as UTC per Open-Meteo. */
function parseUtcMs(s: string): number {
  return /[Zz]|[+-]\d{2}:\d{2}$/.test(s) ? Date.parse(s) : Date.parse(s + 'Z');
}

/** Hourly index closest to `iso`; nearest to `nowMs` if iso null/invalid; -1 if empty. */
export function fieldFrameIndex(times: string[], iso: string | null, nowMs: number): number {
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

export function tempColor(c: number): string {
  const stops = colorBlindMode ? TEMP_STOPS_CBSAFE : TEMP_STOPS_DEFAULT;
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

/** Relative humidity (%) → hex colour on a clamped dry→wet ramp. */
export function humidityColor(h: number): string {
  const stops: [number, string][] = [
    [0, '#fde725'],
    [20, '#a8db34'],
    [40, '#5dc863'],
    [60, '#21908d'],
    [80, '#3b528b'],
    [100, '#440154'],
  ];
  if (h <= stops[0][0]) return stops[0][1];
  if (h >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (h >= stops[i][0] && h < stops[i + 1][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

/** Pressure (hPa, MSL) → hex colour on a clamped low→high ramp. */
export function pressureColor(p: number): string {
  const stops: [number, string][] = [
    [970, '#542788'],
    [990, '#998ec3'],
    [1005, '#d8daeb'],
    [1015, '#fee0b6'],
    [1025, '#f1a340'],
    [1040, '#b35806'],
  ];
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
  points: { lat: number; lng: number; u: (number | null)[]; v: (number | null)[] }[];
}

/** Keyless Open-Meteo bulk URL fetching speed + direction together.
 *  Optional model routes the request to a specific NWP. */
export function buildWindUrl(
  points: LngLat[],
  speedVar: 'wind_speed_10m' | 'wind_gusts_10m' = 'wind_speed_10m',
  model?: string,
): string {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  const modelParam =
    model && model !== 'best_match' ? `&models=${model}` : '';
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&hourly=${speedVar},wind_direction_10m&forecast_days=2&timezone=UTC${modelParam}`
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
  speedVar: 'wind_speed_10m' | 'wind_gusts_10m' = 'wind_speed_10m',
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
    prefix: string,
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
    const h = (arr[i] as { hourly?: Record<string, unknown> } | undefined)?.hourly;
    const sp = pickPrefix(h, speedVar);
    const dr = pickPrefix(h, 'wind_direction_10m');
    if (!isSpeedDirArray(sp) || !isSpeedDirArray(dr) || sp.length !== times.length || dr.length !== times.length) {
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
