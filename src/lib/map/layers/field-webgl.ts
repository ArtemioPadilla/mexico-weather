/**
 * Story 24.1 (= ROADMAP 13.4) — WebGL2 field renderer.
 *
 * The canvas path (`renderFieldRaster` in `mapraster.ts`) evaluates the
 * bicubic field on a fixed 1000×700 raster, encodes it as a PNG and hands
 * it to a MapLibre `image` source, which then stretches it bilinearly: the
 * field goes soft past z ≈ 6 and every frame pays ~30 ms of main-thread
 * work plus a PNG encode/decode. This custom layer uploads the 32×24 grid
 * of the frame as an RG32F texture (value, valid) and evaluates the same
 * Catmull-Rom bicubic per fragment, then colours it through a 1-D LUT
 * built from the very ramp function the canvas path uses (`mapfields.ts`,
 * 8-digit-hex transparency included), with the same edge alpha fade. The
 * gradient is exact at any zoom and a frame costs one 6 KB upload.
 *
 * Geometry matches the canvas fallback in `'mercator'` row space: the
 * quad spans the field bounds in Web Mercator, columns are linear in
 * longitude and rows linear in Mercator y, and the latitude of a fragment
 * is the inverse Mercator of its y — so the colour under the pointer is
 * the value the tooltip reads at that latitude.
 *
 * Everything the fragment shader computes is mirrored in
 * {@link fieldPixelReference} (pure JS), which the regression test
 * compares against `fillFieldImageData` pixel by pixel.
 *
 * Fallback: {@link pickFieldRenderer} keeps the canvas path when the map
 * has no WebGL2 context, or when `?field=canvas` /
 * `localStorage['mw:field-renderer'] = 'canvas'` asks for it; a shader
 * that fails to compile at runtime reports through `onError` so the
 * caller can switch to canvas for the session.
 */
import type maplibregl from 'maplibre-gl';
import type { FieldGrid } from '../../mapfields';
import {
  FIELD_EDGE_FADE_FRACTION,
  edgeFalloffAt,
  hexToRgba,
  mercatorY,
  rowLatitude,
  type FieldDetailLayer,
  type RasterBounds,
} from '../../mapraster';
import {
  FIELD_DETAIL_FADE,
  detailWeight,
  mergeFieldValue,
} from './field-detail';

/** Same id as the canvas raster layer: the boot retry, the e2e suite and
 *  removeField() look for `wx-field-layer` whichever renderer drew it. */
export const FIELD_GL_LAYER_ID = 'wx-field-layer';

/** Texels in the ramp LUT (WebGL2 guarantees MAX_TEXTURE_SIZE ≥ 2048). */
export const FIELD_LUT_SIZE = 2048;

export type FieldRendererKind = 'webgl' | 'canvas';
/** `?field=canvas` forces the canvas path for one visit… */
export const FIELD_RENDERER_PARAM = 'field';
/** …and `localStorage['mw:field-renderer'] = 'canvas'` for good. */
export const FIELD_RENDERER_STORAGE_KEY = 'mw:field-renderer';

// ---------------------------------------------------------------------
// Renderer selection (pure, jsdom-safe).
// ---------------------------------------------------------------------

/** True for a WebGL2 context (duck-typed: jsdom and Node have no
 *  `WebGL2RenderingContext` global to `instanceof` against). */
export function isWebGL2(gl: unknown): boolean {
  if (!gl || typeof gl !== 'object') return false;
  const g = gl as Record<string, unknown>;
  return (
    typeof g.texStorage2D === 'function' &&
    typeof g.createVertexArray === 'function' &&
    typeof g.texImage3D === 'function'
  );
}

function asKind(v: string | null | undefined): FieldRendererKind | null {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'canvas' || s === '2d' || s === 'off' || s === '0') return 'canvas';
  if (s === 'webgl' || s === 'gl' || s === 'on' || s === '1') return 'webgl';
  return null;
}

/** The renderer the visitor asked for, if any: the URL flag wins over the
 *  stored one (so `?field=webgl` undoes a stored `canvas` for a visit). */
export function fieldRendererFlag(
  search: string | null | undefined,
  stored: string | null | undefined
): FieldRendererKind | null {
  const fromUrl = asKind(
    new URLSearchParams(search ?? '').get(FIELD_RENDERER_PARAM)
  );
  return fromUrl ?? asKind(stored);
}

/** WebGL only when the map's context is WebGL2 and no flag says canvas. */
export function pickFieldRenderer(env: {
  gl: unknown;
  search?: string | null;
  stored?: string | null;
}): FieldRendererKind {
  if (fieldRendererFlag(env.search, env.stored) === 'canvas') return 'canvas';
  return isWebGL2(env.gl) ? 'webgl' : 'canvas';
}

// ---------------------------------------------------------------------
// Shader math, mirrored in JS (pure).
// ---------------------------------------------------------------------

/** Value range the LUT covers: texel k holds the colour of the value at
 *  its centre, `min + (k + 0.5)·step`. */
export interface FieldValueDomain {
  min: number;
  step: number;
  size: number;
}

const extentCache = new WeakMap<FieldGrid, [number, number]>();
const domainCache = new WeakMap<
  FieldGrid,
  WeakMap<FieldGrid, FieldValueDomain>
>();

/** Finite min / max of a grid over every hour (±Infinity when empty). */
function gridExtent(grid: FieldGrid): [number, number] {
  const cached = extentCache.get(grid);
  if (cached) return cached;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of grid.points) {
    for (const v of p.values) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const e: [number, number] = [lo, hi];
  extentCache.set(grid, e);
  return e;
}

/**
 * LUT domain for a grid: its finite min … max over every hour (so the
 * LUT is built once per grid, not per frame), padded by a quarter of the
 * range plus one unit for the Catmull-Rom overshoot. Values past the pad
 * clamp to the end texels, which is what the clamped ramps do anyway.
 * Story 24.2 — `extra` (the local grid merged over it) widens the range:
 * a finer grid resolves colder peaks and warmer valleys.
 */
export function fieldValueDomain(
  grid: FieldGrid,
  size = FIELD_LUT_SIZE,
  extra?: FieldGrid | null
): FieldValueDomain {
  // Cached per grid (and per local grid merged over it), so the same
  // frame pair hands setFrame the same object.
  let perExtra = domainCache.get(grid);
  const slot = extra ?? grid;
  const cached = perExtra?.get(slot);
  if (cached && cached.size === size) return cached;
  let [lo, hi] = gridExtent(grid);
  if (extra) {
    const [elo, ehi] = gridExtent(extra);
    lo = Math.min(lo, elo);
    hi = Math.max(hi, ehi);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  const pad = (hi - lo) * 0.25 + 1;
  const min = lo - pad;
  const max = hi + pad;
  const d: FieldValueDomain = { min, step: (max - min) / size, size };
  if (!perExtra) {
    perExtra = new WeakMap();
    domainCache.set(grid, perExtra);
  }
  perExtra.set(slot, d);
  return d;
}

/** LUT texel for value `v` — `clamp(floor((v − min) / step), 0, size − 1)`,
 *  exactly as the fragment shader indexes it. */
export function lutIndex(v: number, d: FieldValueDomain): number {
  const k = Math.floor((v - d.min) / d.step);
  return k < 0 ? 0 : k > d.size - 1 ? d.size - 1 : k;
}

/** RGBA8 ramp LUT (size × 1): the ramp colour at each texel centre,
 *  8-digit-hex alpha included (dry precipitation stays transparent). */
export function buildRampLut(
  color: (v: number) => string,
  d: FieldValueDomain
): Uint8Array {
  const out = new Uint8Array(d.size * 4);
  const memo = new Map<string, [number, number, number, number]>();
  for (let k = 0; k < d.size; k++) {
    const hex = color(d.min + (k + 0.5) * d.step);
    let rgba = memo.get(hex);
    if (!rgba) {
      rgba = hexToRgba(hex);
      memo.set(hex, rgba);
    }
    out.set(rgba, k * 4);
  }
  return out;
}

/** One frame of the grid as the RG32F texture's data: (value, valid) per
 *  point, row-major with rows south→north as `viewportGrid` emits them. */
export function packFieldFrame(
  grid: FieldGrid,
  hourIdx: number,
  out?: Float32Array
): Float32Array {
  const n = grid.points.length;
  const buf = out && out.length === n * 2 ? out : new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = grid.points[i]?.values[hourIdx];
    const ok = typeof v === 'number' && Number.isFinite(v);
    buf[i * 2] = ok ? v : 0;
    buf[i * 2 + 1] = ok ? 1 : 0;
  }
  return buf;
}

/** Catmull-Rom across 4 samples, t ∈ [0, 1] between b and c (the same
 *  polynomial as `mapraster.ts` and the fragment shader). */
export function catmullRom(
  t: number,
  a: number,
  b: number,
  c: number,
  d: number
): number {
  const a0 = d - c - a + b;
  const a1 = a - b - a0;
  const a2 = c - a;
  const a3 = b;
  return ((a0 * t + a1) * t + a2) * t + a3;
}

/** Layout of the field on the map and the virtual raster the edge fade
 *  is measured in (the canvas path's FIELD_RASTER_W × H). */
export interface FieldGeometry {
  rows: number;
  cols: number;
  bounds: RasterBounds;
  width: number;
  height: number;
}

/** Bicubic of a packed (value, valid) grid at grid coords (fx, fy),
 *  clamped to the edges; null when any of the 16 cells is missing. */
function packedBicubic(
  packed: Float32Array,
  cols: number,
  rows: number,
  fxIn: number,
  fyIn: number
): number | null {
  const fx = Math.min(Math.max(fxIn, 0), cols - 1);
  const fy = Math.min(Math.max(fyIn, 0), rows - 1);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const cell = (x: number, y: number): [number, number] => {
    const cx = Math.min(Math.max(x, 0), cols - 1);
    const cy = Math.min(Math.max(y, 0), rows - 1);
    const i = (cy * cols + cx) * 2;
    return [packed[i], packed[i + 1]];
  };
  const rowV: number[] = [];
  let ok = 1;
  for (let dy = -1; dy <= 2; dy++) {
    const s0 = cell(ix - 1, iy + dy);
    const s1 = cell(ix, iy + dy);
    const s2 = cell(ix + 1, iy + dy);
    const s3 = cell(ix + 2, iy + dy);
    ok = Math.min(ok, s0[1], s1[1], s2[1], s3[1]);
    rowV.push(catmullRom(tx, s0[0], s1[0], s2[0], s3[0]));
  }
  if (ok < 0.5) return null;
  return catmullRom(ty, rowV[0], rowV[1], rowV[2], rowV[3]);
}

/** Story 24.2 — the local grid of a frame, packed like the national one. */
export interface PackedFieldDetail {
  packed: Float32Array;
  rows: number;
  cols: number;
  bounds: RasterBounds;
}

/**
 * Pure JS reference of the fragment shader at raster pixel (px, py) —
 * px along the columns (west→east), py down the rows (north→south),
 * rows linear in Mercator y. Returns straight RGBA8 with the layer alpha
 * `alpha` (0–255) at full opacity: what `fillFieldImageData(…,
 * { rowSpace: 'mercator' })` writes for the same pixel. A pixel whose
 * 4×4 stencil touches a missing cell is [0, 0, 0, 0]. With `detail`
 * (Story 24.2) the local grid is merged by bounds exactly as
 * `fillFieldImageData(…, { detail })` does.
 */
export function fieldPixelReference(
  packed: Float32Array,
  geom: FieldGeometry,
  lut: Uint8Array,
  domain: FieldValueDomain,
  px: number,
  py: number,
  alpha: number,
  detail?: PackedFieldDetail | null
): [number, number, number, number] {
  const { rows, cols, bounds, width: W, height: H } = geom;
  const u = W > 1 ? px / (W - 1) : 0;
  const lat = rowLatitude(py, H, bounds, 'mercator');
  const fx = u * (cols - 1);
  const fy =
    ((lat - bounds.south) / (bounds.north - bounds.south)) * (rows - 1);
  let v = packedBicubic(packed, cols, rows, fx, fy);
  let detailAlpha = 1;
  if (detail) {
    const lng = bounds.west + u * (bounds.east - bounds.west);
    const b = detail.bounds;
    const w = detailWeight(lng, lat, b);
    if (w > 0) {
      const dv = packedBicubic(
        detail.packed,
        detail.cols,
        detail.rows,
        ((lng - b.west) / (b.east - b.west)) * (detail.cols - 1),
        ((lat - b.south) / (b.north - b.south)) * (detail.rows - 1)
      );
      const m = mergeFieldValue(v, dv, w);
      if (m) {
        v = m.value;
        detailAlpha = m.alpha;
      }
    }
  }
  if (v === null) return [0, 0, 0, 0];
  const k = lutIndex(v, domain) * 4;
  const a = Math.round(
    (alpha * lut[k + 3] * detailAlpha * edgeFalloffAt(px, py, W, H)) / 255
  );
  return [lut[k], lut[k + 1], lut[k + 2], a];
}

// ---------------------------------------------------------------------
// Shaders.
// ---------------------------------------------------------------------

export const FIELD_VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
// Mercator (0..1) of the quad: west, north, east, south.
uniform vec4 u_merc;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec2 m = vec2(mix(u_merc.x, u_merc.z, a_pos.x), mix(u_merc.y, u_merc.w, a_pos.y));
  gl_Position = u_matrix * vec4(m, 0.0, 1.0);
}
`;

export const FIELD_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_grid;   // RG32F cols × rows: (value, valid)
uniform sampler2D u_lut;    // RGBA8 size × 1
uniform vec2 u_dims;        // cols, rows
uniform vec2 u_lat;         // south, north (degrees)
uniform vec2 u_mercY;       // Mercator y of north, south
uniform vec3 u_domain;      // min, step, size
uniform vec2 u_size;        // virtual raster W, H (edge fade)
uniform float u_fade;       // edge fade fraction
uniform float u_alpha;      // layer alpha × opacity, 0..1
uniform vec2 u_lng;         // west, east (degrees)
// Story 24.2 — local grid merged by bounds (u_dOn 0 ⇒ national only).
uniform sampler2D u_detail; // RG32F dcols × drows: (value, valid)
uniform vec2 u_dDims;       // dcols, drows
uniform vec4 u_dBounds;     // west, south, east, north (degrees)
uniform float u_dFade;      // blend band, fraction of the local box
uniform float u_dOn;
in vec2 v_uv;
out vec4 fragColor;
const float PI = 3.141592653589793;

float cubic(float t, float a, float b, float c, float d) {
  float a0 = d - c - a + b;
  float a1 = a - b - a0;
  float a2 = c - a;
  float a3 = b;
  return ((a0 * t + a1) * t + a2) * t + a3;
}
vec2 cell(sampler2D tex, ivec2 hi, int x, int y) {
  return texelFetch(tex, clamp(ivec2(x, y), ivec2(0), hi), 0).rg;
}
// Catmull-Rom at grid coords (fx, fy): (value, 1 when all 16 cells valid).
vec2 bicubic(sampler2D tex, vec2 dims, float fxIn, float fyIn) {
  ivec2 hi = ivec2(dims) - 1;
  float fx = clamp(fxIn, 0.0, dims.x - 1.0);
  float fy = clamp(fyIn, 0.0, dims.y - 1.0);
  float ixf = floor(fx);
  float iyf = floor(fy);
  float tx = fx - ixf;
  float ty = fy - iyf;
  int ix = int(ixf);
  int iy = int(iyf);
  float r[4];
  float ok = 1.0;
  for (int dy = -1; dy <= 2; dy++) {
    vec2 s0 = cell(tex, hi, ix - 1, iy + dy);
    vec2 s1 = cell(tex, hi, ix, iy + dy);
    vec2 s2 = cell(tex, hi, ix + 1, iy + dy);
    vec2 s3 = cell(tex, hi, ix + 2, iy + dy);
    ok = min(ok, min(min(s0.g, s1.g), min(s2.g, s3.g)));
    r[dy + 1] = cubic(tx, s0.r, s1.r, s2.r, s3.r);
  }
  return vec2(cubic(ty, r[0], r[1], r[2], r[3]), ok);
}
float detailWeight(float lng, float lat) {
  vec2 uv = vec2(
    (lng - u_dBounds.x) / (u_dBounds.z - u_dBounds.x),
    (lat - u_dBounds.y) / (u_dBounds.w - u_dBounds.y)
  );
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec2 d = min(uv, 1.0 - uv);
  vec2 f = u_dFade > 0.0 ? clamp(d / u_dFade, 0.0, 1.0) : vec2(1.0);
  f = f * f * (3.0 - 2.0 * f);
  return f.x * f.y;
}
float falloff(float p, float n) {
  float fade = max(2.0, floor(n * u_fade));
  float d = min(p, n - 1.0 - p);
  float f = d >= fade ? 1.0 : max(d, 0.0) / fade;
  return f * f * (3.0 - 2.0 * f);
}
void main() {
  vec2 uv = clamp(v_uv, 0.0, 1.0);
  float my = mix(u_mercY.x, u_mercY.y, uv.y);
  float lat = degrees(2.0 * atan(exp(PI * (1.0 - 2.0 * my))) - PI / 2.0);
  vec2 n = bicubic(
    u_grid,
    u_dims,
    uv.x * (u_dims.x - 1.0),
    (lat - u_lat.x) / (u_lat.y - u_lat.x) * (u_dims.y - 1.0)
  );
  float v = n.x;
  float ok = n.y;
  float dAlpha = 1.0;
  if (u_dOn > 0.5) {
    float lng = mix(u_lng.x, u_lng.y, uv.x);
    float w = detailWeight(lng, lat);
    if (w > 0.0) {
      vec2 d = bicubic(
        u_detail,
        u_dDims,
        (lng - u_dBounds.x) / (u_dBounds.z - u_dBounds.x) * (u_dDims.x - 1.0),
        (lat - u_dBounds.y) / (u_dBounds.w - u_dBounds.y) * (u_dDims.y - 1.0)
      );
      if (d.y >= 0.5) {
        if (ok >= 0.5) {
          v = n.x + (d.x - n.x) * w;
        } else {
          v = d.x;
          dAlpha = w;
          ok = 1.0;
        }
      }
    }
  }
  if (ok < 0.5) discard;
  float k = clamp(floor((v - u_domain.x) / u_domain.y), 0.0, u_domain.z - 1.0);
  vec4 c = texelFetch(u_lut, ivec2(int(k), 0), 0);
  float a = u_alpha * c.a * dAlpha
    * falloff(uv.x * (u_size.x - 1.0), u_size.x)
    * falloff(uv.y * (u_size.y - 1.0), u_size.y);
  // MapLibre blends custom layers premultiplied (ONE, ONE_MINUS_SRC_ALPHA).
  fragColor = vec4(c.rgb * a, a);
}
`;

// ---------------------------------------------------------------------
// The MapLibre custom layer.
// ---------------------------------------------------------------------

/** What one frame needs: the grid and hour, its layout and the ramp. */
export interface FieldGlFrame {
  grid: FieldGrid;
  hourIdx: number;
  geometry: FieldGeometry;
  color: (v: number) => string;
  /** Extra LUT cache key for ramps whose output depends on more than the
   *  function (e.g. the colour-blind temperature ramp). */
  rampKey?: string;
  /** Layer alpha, 0–255 (the canvas path's `alpha`, 200 by default). */
  alpha: number;
  /** Story 24.2 — local grid merged by bounds (its own hour index). */
  detail?: FieldDetailLayer | null;
}

export interface FieldGlDeps {
  /** Main-thread ms spent on a new frame: packing it in setFrame plus the
   *  upload + draw in the render call that first shows it. */
  onFrame?: (ms: number) => void;
  /** The context or the shaders failed; the layer draws nothing from now
   *  on and the caller should fall back to canvas. Called asynchronously
   *  (never from inside MapLibre's addLayer / render). */
  onError?: (reason: string) => void;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface FieldGlLayer {
  layer: maplibregl.CustomLayerInterface;
  /** Show `frame` (uploads lazily on the next render). */
  setFrame(frame: FieldGlFrame): void;
  /** raster-opacity equivalent, 0..1. */
  setOpacity(opacity: number): void;
  /** True once onAdd / render hit an unrecoverable GL error. */
  failed(): boolean;
}

type GL2 = WebGL2RenderingContext;

export function createFieldGlLayer(
  map: Pick<maplibregl.Map, 'triggerRepaint'>,
  deps: FieldGlDeps = {}
): FieldGlLayer {
  const now = deps.now ?? (() => performance.now());
  let gl: GL2 | null = null;
  let prog: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let quad: WebGLBuffer | null = null;
  let gridTex: WebGLTexture | null = null;
  let lutTex: WebGLTexture | null = null;
  let detailTex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  let aPos = -1;
  let broken = false;

  let frame: FieldGlFrame | null = null;
  let packed: Float32Array | null = null;
  let packedDims = '';
  let gridDirty = false;
  let gridTexDims = '';
  // Story 24.2 — the local grid's texture (a 1×1 placeholder when none).
  let detailPacked: Float32Array | null = null;
  let detailDims = '';
  let detailDirty = false;
  let detailTexDims = '';
  let lut: Uint8Array | null = null;
  let lutDirty = false;
  let lutKey: {
    color: (v: number) => string;
    rampKey: string;
    min: number;
    step: number;
  } | null = null;
  let domain: FieldValueDomain | null = null;
  let opacity = 1;
  let pendingCpuMs: number | null = null;

  function fail(reason: string): void {
    if (broken) return;
    broken = true;
    void Promise.resolve().then(() => deps.onError?.(reason));
  }

  function compile(g: GL2, type: number, src: string): WebGLShader | null {
    const sh = g.createShader(type);
    if (!sh) return null;
    g.shaderSource(sh, src);
    g.compileShader(sh);
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
      console.error('[field-webgl] shader:', g.getShaderInfoLog(sh));
      g.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function release(g: GL2 | null): void {
    if (g) {
      if (prog) g.deleteProgram(prog);
      if (vao) g.deleteVertexArray(vao);
      if (quad) g.deleteBuffer(quad);
      if (gridTex) g.deleteTexture(gridTex);
      if (lutTex) g.deleteTexture(lutTex);
      if (detailTex) g.deleteTexture(detailTex);
    }
    prog = null;
    vao = null;
    quad = null;
    gridTex = null;
    lutTex = null;
    detailTex = null;
    gridTexDims = '';
    detailTexDims = '';
    gl = null;
    // A re-add (layer switched off and on) re-uploads everything.
    gridDirty = !!packed;
    lutDirty = !!lut;
    detailDirty = !!detailPacked;
  }

  function newTexture(g: GL2): WebGLTexture | null {
    const t = g.createTexture();
    if (!t) return null;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  }

  function setup(g: GL2): boolean {
    const vs = compile(g, g.VERTEX_SHADER, FIELD_VERTEX_SHADER);
    const fs = compile(g, g.FRAGMENT_SHADER, FIELD_FRAGMENT_SHADER);
    if (!vs || !fs) return false;
    const p = g.createProgram();
    if (!p) return false;
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(fs);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      console.error('[field-webgl] link:', g.getProgramInfoLog(p));
      g.deleteProgram(p);
      return false;
    }
    prog = p;
    aPos = g.getAttribLocation(p, 'a_pos');
    for (const name of [
      'u_matrix',
      'u_merc',
      'u_grid',
      'u_lut',
      'u_dims',
      'u_lat',
      'u_mercY',
      'u_domain',
      'u_size',
      'u_fade',
      'u_alpha',
      'u_lng',
      'u_detail',
      'u_dDims',
      'u_dBounds',
      'u_dFade',
      'u_dOn',
    ]) {
      loc[name] = g.getUniformLocation(p, name);
    }
    quad = g.createBuffer();
    vao = g.createVertexArray();
    if (!quad || !vao || aPos < 0) return false;
    g.bindVertexArray(vao);
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      g.STATIC_DRAW
    );
    g.enableVertexAttribArray(aPos);
    g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0);
    g.bindVertexArray(null);
    g.bindBuffer(g.ARRAY_BUFFER, null);
    gridTex = newTexture(g);
    lutTex = newTexture(g);
    detailTex = newTexture(g);
    if (detailTex) {
      // Complete from the start: the sampler is bound on every draw.
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RG32F,
        1,
        1,
        0,
        g.RG,
        g.FLOAT,
        new Float32Array(2)
      );
      detailTexDims = '1x1';
    }
    g.bindTexture(g.TEXTURE_2D, null);
    return !!gridTex && !!lutTex && !!detailTex;
  }

  function upload(g: GL2): void {
    if (!frame) return;
    const { cols, rows } = frame.geometry;
    if (gridDirty && packed && gridTex) {
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, gridTex);
      const dims = `${cols}x${rows}`;
      if (gridTexDims !== dims) {
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.RG32F,
          cols,
          rows,
          0,
          g.RG,
          g.FLOAT,
          packed
        );
        gridTexDims = dims;
      } else {
        g.texSubImage2D(
          g.TEXTURE_2D,
          0,
          0,
          0,
          cols,
          rows,
          g.RG,
          g.FLOAT,
          packed
        );
      }
      gridDirty = false;
    }
    const d = frame.detail;
    if (detailDirty && d && detailPacked && detailTex) {
      g.activeTexture(g.TEXTURE2);
      g.bindTexture(g.TEXTURE_2D, detailTex);
      const dims = `${d.cols}x${d.rows}`;
      if (detailTexDims !== dims) {
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.RG32F,
          d.cols,
          d.rows,
          0,
          g.RG,
          g.FLOAT,
          detailPacked
        );
        detailTexDims = dims;
      } else {
        g.texSubImage2D(
          g.TEXTURE_2D,
          0,
          0,
          0,
          d.cols,
          d.rows,
          g.RG,
          g.FLOAT,
          detailPacked
        );
      }
      detailDirty = false;
    }
    if (lutDirty && lut && lutTex && domain) {
      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D, lutTex);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA8,
        domain.size,
        1,
        0,
        g.RGBA,
        g.UNSIGNED_BYTE,
        lut
      );
      lutDirty = false;
    }
  }

  const layer: maplibregl.CustomLayerInterface = {
    id: FIELD_GL_LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map, context) {
      if (!isWebGL2(context)) {
        fail('no WebGL2 context');
        return;
      }
      gl = context as GL2;
      try {
        if (!setup(gl)) {
          release(gl);
          fail('shader or buffer setup failed');
        }
      } catch (e) {
        release(gl);
        fail(String(e));
      }
    },
    onRemove(_map, context) {
      release((gl ?? context) as GL2);
    },
    render(context, options) {
      const g = gl;
      if (broken || !g || !prog || !vao || !frame || !packed || !domain) return;
      const t0 = now();
      try {
        upload(g);
        const { bounds, cols, rows, width, height } = frame.geometry;
        const matrix =
          (
            options as {
              defaultProjectionData?: { mainMatrix?: ArrayLike<number> };
            }
          ).defaultProjectionData?.mainMatrix ??
          options.modelViewProjectionMatrix;
        g.useProgram(prog);
        g.uniformMatrix4fv(loc.u_matrix, false, Float32Array.from(matrix));
        const yN = mercatorY(bounds.north);
        const yS = mercatorY(bounds.south);
        g.uniform4f(
          loc.u_merc,
          (bounds.west + 180) / 360,
          yN,
          (bounds.east + 180) / 360,
          yS
        );
        g.uniform2f(loc.u_dims, cols, rows);
        g.uniform2f(loc.u_lat, bounds.south, bounds.north);
        g.uniform2f(loc.u_mercY, yN, yS);
        g.uniform3f(loc.u_domain, domain.min, domain.step, domain.size);
        g.uniform2f(loc.u_size, width, height);
        g.uniform1f(loc.u_fade, FIELD_EDGE_FADE_FRACTION);
        g.uniform1f(loc.u_alpha, (frame.alpha / 255) * opacity);
        g.uniform2f(loc.u_lng, bounds.west, bounds.east);
        const d = frame.detail;
        g.uniform1f(loc.u_dOn, d && detailPacked ? 1 : 0);
        g.uniform2f(loc.u_dDims, d?.cols ?? 1, d?.rows ?? 1);
        g.uniform4f(
          loc.u_dBounds,
          d?.bounds.west ?? 0,
          d?.bounds.south ?? 0,
          d?.bounds.east ?? 1,
          d?.bounds.north ?? 1
        );
        g.uniform1f(loc.u_dFade, FIELD_DETAIL_FADE);
        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, gridTex);
        g.uniform1i(loc.u_grid, 0);
        g.activeTexture(g.TEXTURE1);
        g.bindTexture(g.TEXTURE_2D, lutTex);
        g.uniform1i(loc.u_lut, 1);
        g.activeTexture(g.TEXTURE2);
        g.bindTexture(g.TEXTURE_2D, detailTex);
        g.uniform1i(loc.u_detail, 2);
        g.disable(g.DEPTH_TEST);
        g.disable(g.STENCIL_TEST);
        g.enable(g.BLEND);
        g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
        g.bindVertexArray(vao);
        g.drawArrays(g.TRIANGLES, 0, 6);
        g.bindVertexArray(null);
        g.bindTexture(g.TEXTURE_2D, null);
        g.activeTexture(g.TEXTURE1);
        g.bindTexture(g.TEXTURE_2D, null);
        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, null);
      } catch (e) {
        fail(String(e));
        return;
      }
      if (pendingCpuMs !== null) {
        const ms = pendingCpuMs + (now() - t0);
        pendingCpuMs = null;
        deps.onFrame?.(ms);
      }
    },
  };

  return {
    layer,
    setFrame(next) {
      const t0 = now();
      frame = next;
      const { cols, rows } = next.geometry;
      const dims = `${cols}x${rows}`;
      packed = packFieldFrame(
        next.grid,
        next.hourIdx,
        packedDims === dims && packed ? packed : undefined
      );
      packedDims = dims;
      gridDirty = true;
      const d = next.detail ?? null;
      if (d) {
        const ddims = `${d.cols}x${d.rows}`;
        detailPacked = packFieldFrame(
          d.grid,
          d.hourIdx,
          detailDims === ddims && detailPacked ? detailPacked : undefined
        );
        detailDims = ddims;
        detailDirty = true;
      } else {
        detailPacked = null;
      }
      domain = fieldValueDomain(next.grid, FIELD_LUT_SIZE, d?.grid);
      const rampKey = next.rampKey ?? '';
      if (
        !lutKey ||
        lutKey.color !== next.color ||
        lutKey.rampKey !== rampKey ||
        lutKey.min !== domain.min ||
        lutKey.step !== domain.step
      ) {
        lut = buildRampLut(next.color, domain);
        lutKey = {
          color: next.color,
          rampKey,
          min: domain.min,
          step: domain.step,
        };
        lutDirty = true;
      }
      pendingCpuMs = now() - t0;
      map.triggerRepaint();
    },
    setOpacity(o) {
      const v = Math.min(1, Math.max(0, o));
      if (v === opacity) return;
      opacity = v;
      map.triggerRepaint();
    },
    failed: () => broken,
  };
}
