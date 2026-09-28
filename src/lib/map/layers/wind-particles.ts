/**
 * Wind particles WebGL custom layer (Story 24.4 — trails, density by
 * zoom, colour by speed; reduced motion → static arrows).
 *
 * GPU particle simulator over the 8×6 wind grid of the frame, drawn as
 * fading trails like zoom.earth / earth.nullschool:
 *
 *   prerender (offscreen, every map frame)
 *     1. update: ping-pong the particle state texture (x, y packed as
 *        16 bits each in RGBA8) through a fragment shader that looks the
 *        wind up **where the particle is on the map** (screen → Web
 *        Mercator → lng/lat → grid texel), moves it by
 *        `speed × WIND_PX_PER_MPS` CSS px per second along the wind as
 *        drawn on screen (bearing aware), and re-seeds it at random with
 *        a small per-frame probability (more when fast) or when it leaves
 *        the screen or the grid;
 *     2. trails: into a screen-sized texture, draw last frame's trails
 *        multiplied by {@link trailFade} (quantised down so faint trails
 *        reach zero instead of leaving 8-bit ghosts), then every particle
 *        as a short quad from its old to its new position, coloured by
 *        speed through a LUT of the legend's ramp;
 *   render (translucent pass)
 *     3. composite the trail texture over the map at the layer opacity.
 *
 * While the camera moves the layer draws nothing (trails are in screen
 * space and would smear across the pan) and starts clean on `moveend`.
 * How many particles are drawn follows {@link windParticleCount}: a
 * density per screen area that thins out as you zoom in.
 *
 * `prefers-reduced-motion` never gets here: the caller draws
 * {@link windArrowCollection} as static arrows (symbol layer with the
 * {@link windArrowSdf} icon) instead.
 *
 * GLSL 100 so it runs on a WebGL1 or WebGL2 MapLibre context. The pure
 * helpers (density, fade, colour LUT, packing, grid mapping, arrows) are
 * unit-tested in wind-particles.test.ts; the shader's grid lookup mirrors
 * {@link windGridTexCoord}.
 */
import type maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import {
  type WindPoint,
  MAX_WIND_MPS,
  encodeWindGrid,
  initParticlePositions,
  windSpeed,
  windSpeedColor,
} from '../../mapwind';
import type { WindGrid } from '../../mapfields';
import { hexToRgba, latFromMercatorY, mercatorY } from '../../mapraster';

export const WIND_PARTICLES_LAYER_ID = 'wx-wind-layer';

/** Side of the particle state texture: room for 16 384 particles. */
export const WIND_STATE_TEX_SIZE = 128;
/** Most particles ever drawn (a 4K desktop at the country view). */
export const WIND_PARTICLE_MAX = 8192;
/** Fewest particles drawn (a tiny embed still shows a flow). */
export const WIND_PARTICLE_MIN = 256;

/** Particles per 100 000 CSS px² by zoom (linear in between, clamped):
 *  dense at the country view, sparser up close where the 8×6 grid is
 *  nearly uniform and many particles only read as noise. */
export const WIND_DENSITY_STOPS: readonly (readonly [number, number])[] = [
  [3, 420],
  [5, 330],
  [7, 240],
  [9, 160],
];

/** Screen speed: CSS px per second per m/s of wind (10 m/s ⇒ 60 px/s). */
export const WIND_PX_PER_MPS = 6;
/** Share of last frame's trails kept per 60 Hz frame. */
export const WIND_TRAIL_FADE = 0.94;
/** Per-frame (60 Hz) chance that a particle is re-seeded, plus the bump
 *  a gale adds (fast particles leave the screen sooner anyway). */
export const WIND_DROP_RATE = 0.003;
export const WIND_DROP_RATE_BUMP = 0.01;
/** Trail width in CSS px, calm → {@link WIND_WIDTH_REF_MPS} and up. */
export const WIND_TRAIL_WIDTH: readonly [number, number] = [1, 2.4];
export const WIND_WIDTH_REF_MPS = 25;
/** Texels in the speed → colour LUT (0 … MAX_WIND_MPS). */
export const WIND_LUT_SIZE = 256;
/** The trail texture never exceeds this many texels (≈ 1920×1080). */
export const WIND_TRAIL_MAX_PIXELS = 2_100_000;
/** Trails are drawn at no more than this device-pixel ratio. */
export const WIND_TRAIL_MAX_DPR = 1.5;

export interface WindParticlesDeps {
  /** Returns the current wind grid (8×6 of u/v vectors per hour). */
  getWindGrid: () => WindGrid | null;
  /** Returns the hour index currently being rendered. */
  getHourIndex: () => number;
  /** True when wind grid or hour index changed since last upload. The
   *  layer reads this on each prerender to decide whether to refresh
   *  the wind texture; consumers should call markTexClean() inside
   *  the layer's onRemove. */
  isTexDirty: () => boolean;
  markTexClean: () => void;
  /** Layer opacity (the rail's slider), 0…1. Default 1. */
  getOpacity?: () => number;
  /** Called once per requestAnimationFrame tick; consumer typically
   *  forwards this to its own raf tracker so it can cancel from
   *  removeWind(). */
  onTick?: (id: number) => void;
}

export function windPointsAtHour(g: WindGrid, h: number): WindPoint[] {
  return g.points.map((p: WindGrid['points'][number]): WindPoint => ({
    lat: p.lat,
    lng: p.lng,
    u: p.u[h],
    v: p.v[h],
  }));
}

// ---------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** Particles per 100 000 CSS px² at `zoom` ({@link WIND_DENSITY_STOPS}). */
export function windParticleDensity(zoom: number): number {
  const s = WIND_DENSITY_STOPS;
  if (!Number.isFinite(zoom) || zoom <= s[0][0]) return s[0][1];
  const last = s[s.length - 1];
  if (zoom >= last[0]) return last[1];
  for (let i = 0; i < s.length - 1; i++) {
    const [z0, d0] = s[i];
    const [z1, d1] = s[i + 1];
    if (zoom >= z0 && zoom <= z1)
      return d0 + ((d1 - d0) * (zoom - z0)) / (z1 - z0);
  }
  return last[1];
}

/** How many particles to draw on a `cssWidth × cssHeight` map at `zoom`:
 *  the density times the area, clamped to
 *  [{@link WIND_PARTICLE_MIN}, `max`]. */
export function windParticleCount(
  zoom: number,
  cssWidth: number,
  cssHeight: number,
  max: number = WIND_PARTICLE_MAX
): number {
  const area = Math.max(0, cssWidth) * Math.max(0, cssHeight);
  const n = Math.round((windParticleDensity(zoom) * area) / 100_000);
  return clamp(n, Math.min(WIND_PARTICLE_MIN, max), max);
}

/** Share of the trails kept after `dtMs` (frame-rate independent:
 *  {@link WIND_TRAIL_FADE} per 60 Hz frame; a stall is capped at 100 ms
 *  so a returning tab does not wipe or freeze the trails). */
export function trailFade(
  dtMs: number,
  fade: number = WIND_TRAIL_FADE
): number {
  const dt = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, 100);
  return Math.pow(fade, dt / (1000 / 60));
}

/** Per-frame re-seed probability after `dtMs` for a particle at `speed`. */
export function windDropRate(dtMs: number, speedMps: number): number {
  const t = clamp(speedMps / MAX_WIND_MPS, 0, 1);
  const perFrame = WIND_DROP_RATE + t * WIND_DROP_RATE_BUMP;
  const frames = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, 100) / (1000 / 60);
  return 1 - Math.pow(1 - perFrame, frames);
}

/** Opacity of a particle at `speedMps`: faint in a calm, solid in a
 *  gale, so the two read apart even without the colours. */
export function windParticleAlpha(speedMps: number): number {
  const t = clamp(speedMps / 20, 0, 1);
  const s = t * t * (3 - 2 * t);
  return 0.45 + 0.55 * s;
}

/** Trail width (CSS px) at `speedMps` ({@link WIND_TRAIL_WIDTH}). */
export function windTrailWidth(speedMps: number): number {
  const t = clamp(speedMps / WIND_WIDTH_REF_MPS, 0, 1);
  return WIND_TRAIL_WIDTH[0] + (WIND_TRAIL_WIDTH[1] - WIND_TRAIL_WIDTH[0]) * t;
}

/** Wind speed (m/s) at the centre of LUT texel `i`. */
export function windLutSpeed(i: number, size: number = WIND_LUT_SIZE): number {
  return ((i + 0.5) / size) * MAX_WIND_MPS;
}

/** RGBA8 speed → colour LUT for the particles: the colour is exactly
 *  `windSpeedColor` (the bands of the wind legend bar, Story 24.3) and
 *  the alpha {@link windParticleAlpha}. Straight (not premultiplied)
 *  alpha; the shader premultiplies. */
export function windColorLut(size: number = WIND_LUT_SIZE): Uint8Array {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const s = windLutSpeed(i, size);
    const [r, g, b] = hexToRgba(windSpeedColor(s));
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = Math.round(windParticleAlpha(s) * 255);
  }
  return out;
}

/** Pack particle positions (x, y in [0, 1]) as 16-bit fixed point in
 *  RGBA8: R = low byte of x, G = low byte of y, B = high byte of x,
 *  A = high byte of y — what the update shader decodes as
 *  `vec2(c.r / 255 + c.b, c.g / 255 + c.a)`. `pos` is laid out
 *  `[x, y, _, _]` per particle ({@link initParticlePositions}). */
export function packParticlePositions(
  pos: Float32Array,
  n: number
): Uint8Array {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      const v = clamp(pos[i * 4 + k] ?? 0, 0, 1) * 255;
      const hi = Math.min(255, Math.floor(v));
      const lo = Math.min(255, Math.floor((v - hi) * 255));
      out[i * 4 + k] = lo;
      out[i * 4 + 2 + k] = hi;
    }
  }
  return out;
}

/** Inverse of {@link packParticlePositions} for particle `i`. */
export function unpackParticlePosition(
  bytes: Uint8Array,
  i: number
): [number, number] {
  const o = i * 4;
  return [
    bytes[o] / 255 / 255 + bytes[o + 2] / 255,
    bytes[o + 1] / 255 / 255 + bytes[o + 3] / 255,
  ];
}

export interface WindGridBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  cols: number;
  rows: number;
}

/** Extent and shape of an 8×6 (or any row-major, south → north) wind
 *  grid, read from its own points. Null for a degenerate grid. */
export function windGridBounds(
  g: WindGrid | null,
  cols = 8,
  rows = 6
): WindGridBounds | null {
  if (!g || g.points.length !== cols * rows) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of g.points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  if (!(east > west) || !(north > south)) return null;
  return { west, south, east, north, cols, rows };
}

/** Texture coordinate (s, t) of `lng, lat` in the wind texture: points
 *  sit at texel centres, row 0 is the grid's south edge (the order
 *  `viewportGrid` emits and `encodeWindGrid` keeps). Null outside the
 *  grid. The update and draw shaders do the same lookup. */
export function windGridTexCoord(
  lng: number,
  lat: number,
  b: WindGridBounds
): [number, number] | null {
  const gx = (lng - b.west) / (b.east - b.west);
  const gy = (lat - b.south) / (b.north - b.south);
  if (!(gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1)) return null;
  return [
    (gx * (b.cols - 1) + 0.5) / b.cols,
    (gy * (b.rows - 1) + 0.5) / b.rows,
  ];
}

/** Longitude / latitude under screen fraction (`x`, `y` in [0, 1], y
 *  down) given the Web Mercator of three screen corners — the affine
 *  map the shaders use (exact for an unpitched map at any bearing). */
export function screenFractionToLngLat(
  x: number,
  y: number,
  corners: ScreenMercator
): [number, number] {
  const mx = corners.origin[0] + corners.xAxis[0] * x + corners.yAxis[0] * y;
  const my = corners.origin[1] + corners.xAxis[1] * x + corners.yAxis[1] * y;
  return [mx * 360 - 180, latFromMercatorY(my)];
}

export interface ScreenMercator {
  /** Mercator (x, y) of the top-left corner. */
  origin: [number, number];
  /** Mercator change from the left edge to the right edge. */
  xAxis: [number, number];
  /** Mercator change from the top edge to the bottom edge. */
  yAxis: [number, number];
}

/** {@link ScreenMercator} from the lng/lat of the top-left, top-right
 *  and bottom-left screen corners. */
export function screenMercator(
  topLeft: { lng: number; lat: number },
  topRight: { lng: number; lat: number },
  bottomLeft: { lng: number; lat: number }
): ScreenMercator {
  const m = (p: { lng: number; lat: number }): [number, number] => [
    (p.lng + 180) / 360,
    mercatorY(clamp(p.lat, -85.05, 85.05)),
  ];
  const o = m(topLeft);
  const r = m(topRight);
  const d = m(bottomLeft);
  return {
    origin: o,
    xAxis: [r[0] - o[0], r[1] - o[1]],
    yAxis: [d[0] - o[0], d[1] - o[1]],
  };
}

/** Screen directions (CSS px, y down, unit length) of east and north on
 *  a map rotated to `bearingDeg`. */
export function windScreenBasis(bearingDeg: number): {
  east: [number, number];
  north: [number, number];
} {
  const r = ((Number.isFinite(bearingDeg) ? bearingDeg : 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { east: [c, -s], north: [-s, -c] };
}

/** Trail texture size for a `cssWidth × cssHeight` map at `dpr`: the
 *  device pixels up to {@link WIND_TRAIL_MAX_DPR}, scaled down to at
 *  most {@link WIND_TRAIL_MAX_PIXELS} texels. */
export function trailTextureSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number
): { width: number; height: number } {
  const k = clamp(
    Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
    0.5,
    WIND_TRAIL_MAX_DPR
  );
  let w = Math.max(1, Math.round(cssWidth * k));
  let h = Math.max(1, Math.round(cssHeight * k));
  if (w * h > WIND_TRAIL_MAX_PIXELS) {
    const f = Math.sqrt(WIND_TRAIL_MAX_PIXELS / (w * h));
    w = Math.max(1, Math.floor(w * f));
    h = Math.max(1, Math.floor(h * f));
  }
  return { width: w, height: h };
}

// ---------------------------------------------------------------------
// Reduced motion: static arrows
// ---------------------------------------------------------------------

/** Icon id of the arrow the reduced-motion layer draws. */
export const WIND_ARROW_IMAGE = 'wx-wind-arrow';
/** Side of the arrow image in image px (drawn at pixelRatio 2). */
export const WIND_ARROW_SIZE = 48;

/** Compass bearing (deg, 0 = north, clockwise) the wind blows **toward**. */
export function windBearing(u: number, v: number): number {
  const deg = (Math.atan2(u, v) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Icon scale of an arrow at `speedMps`: a calm arrow is small, a gale
 *  one twice as big. */
export function windArrowScale(speedMps: number): number {
  const t = clamp(speedMps / WIND_WIDTH_REF_MPS, 0, 1);
  return 0.6 + 0.6 * t;
}

/** One arrow per grid point with data at hour `h`: rotated to where the
 *  wind blows, coloured like the particles, sized by speed. */
export function windArrowCollection(g: WindGrid, h: number): FeatureCollection {
  const features: Feature[] = [];
  for (const p of g.points) {
    const u = p.u[h];
    const v = p.v[h];
    if (u === null || v === null || u === undefined || v === undefined)
      continue;
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    const s = windSpeed(u, v);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        color: windSpeedColor(s),
        bearing: Math.round(windBearing(u, v)),
        scale: Math.round(windArrowScale(s) * 100) / 100,
        speed: Math.round(s),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Outline of an arrow pointing up (north) in a 48×48 box. */
const ARROW_POLYGON: readonly (readonly [number, number])[] = [
  [24, 5],
  [37, 22],
  [28, 22],
  [28, 43],
  [20, 43],
  [20, 22],
  [11, 22],
];

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insidePolygon(
  px: number,
  py: number,
  poly: readonly (readonly [number, number])[]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** The arrow as a signed-distance-field image for `map.addImage(…, {
 *  sdf: true })` (so `icon-color` tints it and `icon-halo-*` outlines
 *  it): alpha 0.75 on the outline, +1/8 per px inside, −1/8 per px
 *  outside — MapLibre's glyph SDF convention. */
export function windArrowSdf(size: number = WIND_ARROW_SIZE): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const k = size / 48;
  const poly = ARROW_POLYGON.map(([x, y]) => [x * k, y * k] as const);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let d = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        d = Math.min(
          d,
          distToSegment(px, py, poly[j][0], poly[j][1], poly[i][0], poly[i][1])
        );
      }
      const signed = insidePolygon(px, py, poly) ? d : -d;
      const a = clamp(0.75 + signed / 8, 0, 1);
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  }
  return { width: size, height: size, data };
}

// ---------------------------------------------------------------------
// WebGL layer
// ---------------------------------------------------------------------

/** GLSL: the wind (u, v in m/s) and its mask under screen fraction `uv`
 *  (y down). Mirrors {@link screenFractionToLngLat} +
 *  {@link windGridTexCoord}. */
const WIND_LOOKUP_GLSL = `
  uniform sampler2D u_wind;
  uniform float u_max;
  uniform vec2 u_scrOrigin;
  uniform vec2 u_scrX;
  uniform vec2 u_scrY;
  uniform vec4 u_grid;   // west, south, east, north (deg)
  uniform vec2 u_gridDims; // cols, rows
  const float PI = 3.141592653589793;
  vec3 windAt(vec2 uv) {
    vec2 m = u_scrOrigin + u_scrX * uv.x + u_scrY * uv.y;
    float lng = m.x * 360.0 - 180.0;
    float lat = degrees(2.0 * atan(exp(PI * (1.0 - 2.0 * m.y))) - 0.5 * PI);
    vec2 g = vec2((lng - u_grid.x) / (u_grid.z - u_grid.x),
                  (lat - u_grid.y) / (u_grid.w - u_grid.y));
    if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) return vec3(0.0);
    vec2 st = (g * (u_gridDims - 1.0) + 0.5) / u_gridDims;
    vec4 w = texture2D(u_wind, st);
    return vec3((w.rg * 2.0 - 1.0) * u_max, w.a);
  }
`;

const PACK_GLSL = `
  vec2 unpackPos(vec4 c) { return vec2(c.r / 255.0 + c.b, c.g / 255.0 + c.a); }
  vec4 packPos(vec2 p) { return vec4(fract(p * 255.0), floor(p * 255.0) / 255.0); }
`;

const QUAD_VS = `
  precision highp float;
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const UPDATE_FS = `
  precision highp float;
  uniform sampler2D u_pos;
  uniform float u_dt;       // seconds
  uniform vec2 u_viewPx;    // CSS px
  uniform vec2 u_east;      // screen direction of east (y down)
  uniform vec2 u_north;
  uniform float u_pxPerMps;
  uniform float u_seed;
  uniform float u_drop;     // per-frame drop at 60 Hz, calm
  uniform float u_dropBump;
  uniform float u_frames;   // dt in 60 Hz frames
  varying vec2 v_uv;
  ${WIND_LOOKUP_GLSL}
  ${PACK_GLSL}
  const vec3 RC = vec3(12.9898, 78.233, 4375.85453);
  float rand(vec2 co) {
    float t = dot(RC.xy, co);
    return fract(sin(t) * (RC.z + t));
  }
  void main() {
    vec2 pos = unpackPos(texture2D(u_pos, v_uv));
    vec3 w = windAt(pos);
    vec2 px = (u_east * w.x + u_north * w.y) * u_pxPerMps * u_dt;
    pos += px / u_viewPx;
    float speedT = clamp(length(w.xy) / u_max, 0.0, 1.0);
    float rate = 1.0 - pow(1.0 - (u_drop + speedT * u_dropBump), u_frames);
    vec2 seed = (pos + v_uv) * u_seed;
    float drop = step(1.0 - rate, rand(seed));
    if (w.z < 0.5 || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0)
      drop = 1.0;
    vec2 fresh = vec2(rand(seed + 1.3), rand(seed + 2.1));
    pos = mix(pos, fresh, drop);
    gl_FragColor = packPos(clamp(pos, 0.0, 1.0));
  }
`;

/** Fade (quantised) or composite a screen texture. */
const SCREEN_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform float u_opacity;
  uniform float u_quantise;
  varying vec2 v_uv;
  void main() {
    vec4 c = texture2D(u_tex, v_uv) * u_opacity;
    // Round down to the 8-bit step so faint trails reach 0 (no ghosts).
    if (u_quantise > 0.5) c = floor(255.0 * c) / 255.0;
    gl_FragColor = c;
  }
`;

/** One quad (6 vertices) per particle from its old to its new position. */
const SEGMENT_VS = `
  precision highp float;
  attribute float a_vid;
  uniform sampler2D u_old;
  uniform sampler2D u_new;
  uniform sampler2D u_lut;
  uniform float u_stateSize;
  uniform vec2 u_target;     // trail texture px
  uniform float u_pxPerCss;
  uniform vec2 u_width;      // CSS px, calm → ref speed
  uniform float u_widthRef;
  uniform float u_maxJump;   // target px; longer = a re-seed, not motion
  varying vec4 v_color;
  ${WIND_LOOKUP_GLSL}
  ${PACK_GLSL}
  void main() {
    float particle = floor(a_vid / 6.0 + 0.001);
    float corner = a_vid - particle * 6.0;
    float row = floor(particle / u_stateSize + 0.001);
    float col = particle - row * u_stateSize;
    vec2 st = (vec2(col, row) + 0.5) / u_stateSize;
    vec2 p0 = unpackPos(texture2D(u_old, st));
    vec2 p1 = unpackPos(texture2D(u_new, st));
    vec3 w = windAt(p1);
    float speed = length(w.xy);
    vec2 a = p0 * u_target;
    vec2 b = p1 * u_target;
    vec2 d = b - a;
    float len = length(d);
    if (w.z < 0.5 || len > u_maxJump) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      v_color = vec4(0.0);
      return;
    }
    vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float hw = 0.5 * mix(u_width.x, u_width.y, clamp(speed / u_widthRef, 0.0, 1.0)) * u_pxPerCss;
    // corners: 0 a- 1 b- 2 a+ | 3 a+ 4 b- 5 b+
    float along = (corner == 1.0 || corner == 4.0 || corner == 5.0) ? 1.0 : 0.0;
    float side = (corner == 2.0 || corner == 3.0 || corner == 5.0) ? 1.0 : -1.0;
    vec2 p = mix(a - dir * hw, b + dir * hw, along) + nrm * side * hw;
    vec2 clip = p / u_target * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    vec4 c = texture2D(u_lut, vec2(clamp(speed / u_max, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5));
    v_color = vec4(c.rgb * c.a, c.a);
  }
`;

const SEGMENT_FS = `
  precision mediump float;
  varying vec4 v_color;
  void main() { gl_FragColor = v_color; }
`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

/** Unbind whatever vertex array MapLibre left bound so our attribute
 *  setup never edits one of its VAOs. */
function unbindVertexArray(gl: GL): void {
  const g2 = gl as WebGL2RenderingContext;
  if (typeof g2.bindVertexArray === 'function') {
    g2.bindVertexArray(null);
    return;
  }
  const ext = gl.getExtension('OES_vertex_array_object');
  ext?.bindVertexArrayOES(null);
}

export function makeWindParticlesLayer(
  map: maplibregl.Map,
  deps: WindParticlesDeps
): maplibregl.CustomLayerInterface {
  const S = WIND_STATE_TEX_SIZE;
  const CAP = S * S;
  let updateProg: WebGLProgram | null = null;
  let screenProg: WebGLProgram | null = null;
  let segProg: WebGLProgram | null = null;
  let posTexA: WebGLTexture | null = null;
  let posTexB: WebGLTexture | null = null;
  let windTex: WebGLTexture | null = null;
  let lutTex: WebGLTexture | null = null;
  let trailTexA: WebGLTexture | null = null;
  let trailTexB: WebGLTexture | null = null;
  let trailW = 0;
  let trailH = 0;
  let fbo: WebGLFramebuffer | null = null;
  let quadBuf: WebGLBuffer | null = null;
  let vidBuf: WebGLBuffer | null = null;
  const shaders: WebGLShader[] = [];
  let raf = 0;
  let lastT = 0;
  let moving = false;
  let clearTrails = true;
  let grid: WindGridBounds | null = null;
  let hasTrails = false;
  const uni = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  const u = (
    gl: GL,
    p: WebGLProgram,
    name: string
  ): WebGLUniformLocation | null => {
    let m = uni.get(p);
    if (!m) {
      m = new Map();
      uni.set(p, m);
    }
    if (!m.has(name)) m.set(name, gl.getUniformLocation(p, name));
    return m.get(name) ?? null;
  };

  function compile(gl: GL, type: number, src: string): WebGLShader {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[wind] shader compile failed:', gl.getShaderInfoLog(sh));
    }
    shaders.push(sh);
    return sh;
  }
  function link(gl: GL, vs: string, fs: string): WebGLProgram {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[wind] program link failed:', gl.getProgramInfoLog(p));
    }
    return p;
  }
  function newTex(gl: GL, filter: number): WebGLTexture {
    const tx = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tx;
  }
  function upload(
    gl: GL,
    tx: WebGLTexture,
    w: number,
    h: number,
    data: Uint8Array | null
  ): void {
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
  }

  function ensureWindTex(gl: GL): void {
    const g = deps.getWindGrid();
    if (!g || !windTex || !deps.isTexDirty()) return;
    const cols = 8;
    const rows = 6;
    const pts = windPointsAtHour(g, deps.getHourIndex());
    if (pts.length !== cols * rows) return;
    grid = windGridBounds(g, cols, rows);
    const enc = encodeWindGrid(pts, cols, rows);
    upload(gl, windTex, cols, rows, enc.data);
    deps.markTexClean();
  }

  function cssSize(): { w: number; h: number } {
    const c = map.getCanvas();
    return {
      w: c.clientWidth || c.width || 1,
      h: c.clientHeight || c.height || 1,
    };
  }

  /** (Re)allocate the trail textures to the map's size; true if new. */
  function ensureTrails(gl: GL): boolean {
    if (!trailTexA || !trailTexB) return false;
    const { w, h } = cssSize();
    const size = trailTextureSize(w, h, window.devicePixelRatio || 1);
    if (size.width === trailW && size.height === trailH) return false;
    trailW = size.width;
    trailH = size.height;
    upload(gl, trailTexA, trailW, trailH, null);
    upload(gl, trailTexB, trailW, trailH, null);
    return true;
  }

  function setLookupUniforms(gl: GL, p: WebGLProgram, unit: number): void {
    const b = grid!;
    const tl = map.unproject([0, 0]);
    const { w, h } = cssSize();
    const tr = map.unproject([w, 0]);
    const bl = map.unproject([0, h]);
    const sm = screenMercator(tl, tr, bl);
    gl.uniform2f(u(gl, p, 'u_scrOrigin'), sm.origin[0], sm.origin[1]);
    gl.uniform2f(u(gl, p, 'u_scrX'), sm.xAxis[0], sm.xAxis[1]);
    gl.uniform2f(u(gl, p, 'u_scrY'), sm.yAxis[0], sm.yAxis[1]);
    gl.uniform4f(u(gl, p, 'u_grid'), b.west, b.south, b.east, b.north);
    gl.uniform2f(u(gl, p, 'u_gridDims'), b.cols, b.rows);
    gl.uniform1f(u(gl, p, 'u_max'), MAX_WIND_MPS);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, windTex);
    gl.uniform1i(u(gl, p, 'u_wind'), unit);
  }

  function bindQuad(gl: GL, p: WebGLProgram): number {
    const loc = gl.getAttribLocation(p, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return loc;
  }

  function drawScreen(
    gl: GL,
    tex: WebGLTexture,
    opacity: number,
    quantise: boolean
  ): void {
    const p = screenProg!;
    gl.useProgram(p);
    const loc = bindQuad(gl, p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u(gl, p, 'u_tex'), 0);
    gl.uniform1f(u(gl, p, 'u_opacity'), opacity);
    gl.uniform1f(u(gl, p, 'u_quantise'), quantise ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc);
  }

  const onMoveStart = (): void => {
    moving = true;
  };
  const onMoveEnd = (): void => {
    moving = false;
    clearTrails = true;
    map.triggerRepaint();
  };

  return {
    id: WIND_PARTICLES_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map: maplibregl.Map, gl: GL) {
      updateProg = link(gl, QUAD_VS, UPDATE_FS);
      screenProg = link(gl, QUAD_VS, SCREEN_FS);
      segProg = link(gl, SEGMENT_VS, SEGMENT_FS);
      const seeds = packParticlePositions(
        initParticlePositions(CAP, 1234),
        CAP
      );
      posTexA = newTex(gl, gl.NEAREST);
      upload(gl, posTexA, S, S, seeds);
      posTexB = newTex(gl, gl.NEAREST);
      upload(gl, posTexB, S, S, seeds);
      // Bilinear between the 8×6 grid points (was nearest: blocky).
      windTex = newTex(gl, gl.LINEAR);
      lutTex = newTex(gl, gl.NEAREST);
      upload(gl, lutTex, WIND_LUT_SIZE, 1, windColorLut());
      trailTexA = newTex(gl, gl.LINEAR);
      trailTexB = newTex(gl, gl.LINEAR);
      fbo = gl.createFramebuffer();
      quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      const vids = new Float32Array(WIND_PARTICLE_MAX * 6);
      for (let i = 0; i < vids.length; i++) vids[i] = i;
      vidBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vidBuf);
      gl.bufferData(gl.ARRAY_BUFFER, vids, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      ensureWindTex(gl);
      map.on('movestart', onMoveStart);
      map.on('moveend', onMoveEnd);
      const tick = (): void => {
        map.triggerRepaint();
        raf = window.requestAnimationFrame(tick);
        deps.onTick?.(raf);
      };
      raf = window.requestAnimationFrame(tick);
      deps.onTick?.(raf);
    },
    onRemove(_map: maplibregl.Map, gl: GL) {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      for (const p of [updateProg, screenProg, segProg])
        if (p) gl.deleteProgram(p);
      for (const sh of shaders) gl.deleteShader(sh);
      shaders.length = 0;
      for (const t of [posTexA, posTexB, windTex, lutTex, trailTexA, trailTexB])
        if (t) gl.deleteTexture(t);
      if (fbo) gl.deleteFramebuffer(fbo);
      if (quadBuf) gl.deleteBuffer(quadBuf);
      if (vidBuf) gl.deleteBuffer(vidBuf);
      updateProg = screenProg = segProg = null;
      posTexA = posTexB = windTex = lutTex = trailTexA = trailTexB = null;
      fbo = null;
      quadBuf = vidBuf = null;
      uni.clear();
      trailW = trailH = 0;
      hasTrails = false;
    },
    prerender(gl: GL) {
      if (
        !updateProg ||
        !screenProg ||
        !segProg ||
        !posTexA ||
        !posTexB ||
        !windTex ||
        !lutTex ||
        !trailTexA ||
        !trailTexB ||
        !fbo ||
        !quadBuf ||
        !vidBuf
      )
        return;
      ensureWindTex(gl);
      const now = performance.now();
      const dtMs = lastT ? Math.min(100, Math.max(0, now - lastT)) : 1000 / 60;
      lastT = now;
      if (!grid || moving) return;
      if (ensureTrails(gl)) clearTrails = true;
      const { w, h } = cssSize();
      const n = windParticleCount(map.getZoom(), w, h);
      const basis = windScreenBasis(map.getBearing());

      unbindVertexArray(gl);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

      // 1 — advance the particles: posTexA → posTexB.
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        posTexB,
        0
      );
      gl.viewport(0, 0, S, S);
      gl.disable(gl.BLEND);
      let p = updateProg;
      gl.useProgram(p);
      let loc = bindQuad(gl, p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTexA);
      gl.uniform1i(u(gl, p, 'u_pos'), 0);
      setLookupUniforms(gl, p, 1);
      gl.uniform1f(u(gl, p, 'u_dt'), dtMs / 1000);
      gl.uniform2f(u(gl, p, 'u_viewPx'), w, h);
      gl.uniform2f(u(gl, p, 'u_east'), basis.east[0], basis.east[1]);
      gl.uniform2f(u(gl, p, 'u_north'), basis.north[0], basis.north[1]);
      gl.uniform1f(u(gl, p, 'u_pxPerMps'), WIND_PX_PER_MPS);
      gl.uniform1f(u(gl, p, 'u_seed'), Math.random() + 0.5);
      gl.uniform1f(u(gl, p, 'u_drop'), WIND_DROP_RATE);
      gl.uniform1f(u(gl, p, 'u_dropBump'), WIND_DROP_RATE_BUMP);
      gl.uniform1f(u(gl, p, 'u_frames'), dtMs / (1000 / 60));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(loc);

      // 2 — trails: fade last frame's into trailTexB, then the segments.
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        trailTexB,
        0
      );
      gl.viewport(0, 0, trailW, trailH);
      if (clearTrails || !hasTrails) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        clearTrails = false;
      } else {
        drawScreen(gl, trailTexA, trailFade(dtMs), true);
      }
      p = segProg;
      gl.useProgram(p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      loc = gl.getAttribLocation(p, 'a_vid');
      gl.bindBuffer(gl.ARRAY_BUFFER, vidBuf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTexA);
      gl.uniform1i(u(gl, p, 'u_old'), 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, posTexB);
      gl.uniform1i(u(gl, p, 'u_new'), 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.uniform1i(u(gl, p, 'u_lut'), 3);
      setLookupUniforms(gl, p, 1);
      gl.uniform1f(u(gl, p, 'u_stateSize'), S);
      gl.uniform2f(u(gl, p, 'u_target'), trailW, trailH);
      const pxPerCss = trailW / w;
      gl.uniform1f(u(gl, p, 'u_pxPerCss'), pxPerCss);
      gl.uniform2f(
        u(gl, p, 'u_width'),
        WIND_TRAIL_WIDTH[0],
        WIND_TRAIL_WIDTH[1]
      );
      gl.uniform1f(u(gl, p, 'u_widthRef'), WIND_WIDTH_REF_MPS);
      // A step longer than a gale moves in 100 ms is a re-seed.
      gl.uniform1f(
        u(gl, p, 'u_maxJump'),
        MAX_WIND_MPS * WIND_PX_PER_MPS * 0.1 * pxPerCss + 2
      );
      gl.drawArrays(gl.TRIANGLES, 0, Math.min(n, CAP, WIND_PARTICLE_MAX) * 6);
      gl.disableVertexAttribArray(loc);
      gl.disable(gl.BLEND);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const unit of [3, 2, 1, 0]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      [posTexA, posTexB] = [posTexB, posTexA];
      [trailTexA, trailTexB] = [trailTexB, trailTexA];
      hasTrails = true;
    },
    render(gl: GL) {
      if (
        !screenProg ||
        !trailTexA ||
        !quadBuf ||
        !hasTrails ||
        moving ||
        !grid
      )
        return;
      const opacity = clamp(deps.getOpacity?.() ?? 1, 0, 1);
      if (opacity <= 0) return;
      unbindVertexArray(gl);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawScreen(gl, trailTexA, opacity, false);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.BLEND);
    },
  };
}
