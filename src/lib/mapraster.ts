// Continuous-gradient raster renderer for /mapa field layers.
//
// Replaces the dotted-circle stack used in PRs #119/#121 with a
// Zoom.Earth-style smooth color band. The input grid is 10×7 lat/lng
// samples from Open-Meteo; we bicubically (Catmull-Rom) interpolate the
// value at every pixel of an N×M offscreen canvas and paint it with the
// field's color ramp, then hand the resulting PNG to MapLibre as an
// `image` source. MapLibre's `raster-resampling: linear` does a second
// bilinear pass at render time so the resulting overlay stays continuous
// at any zoom.
//
// Bicubic preserves gradient curvature (peaks/troughs stay round), which
// at 600×420 from a 10×7 grid is the visual difference between zoom.earth
// and the dotted-grid look of bilinear-at-large-upsample. `bilerpValue`
// is still exported for callers that need a cheaper sample (e.g. the
// hover tooltip, which calls per pointermove and only cares about a
// single point, not a 252k-pixel field).
//
// Pure helpers — no DOM, no MapLibre. The caller (interactive-map.ts)
// is responsible for picking the canvas factory (OffscreenCanvas /
// HTMLCanvasElement) and wiring the Blob URL into the map.

import type { FieldGrid } from './mapfields';
import { detailWeight, mergeFieldValue } from './map/layers/field-detail';

/** Story 24.2 — a local grid merged over the national one by bounds:
 *  inside `bounds` the renderer uses it (blended across the outer
 *  `FIELD_DETAIL_FADE` of the box), outside the national grid. */
export interface FieldDetailLayer {
  grid: FieldGrid;
  rows: number;
  cols: number;
  bounds: RasterBounds;
  /** The local grid's own index of the hour being drawn. */
  hourIdx: number;
}

/** Bounding box in degrees (same shape used in mapfields.viewportGrid). */
export interface RasterBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Image-source corner coordinates: top-left, top-right, bottom-right, bottom-left. */
export type ImageCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/** Parse `#rrggbb` (or `#rgb`) to a [r, g, b] tuple. */
/** `#rgb`, `#rrggbb` or `#rrggbbaa` → [r, g, b, a] with a in 0..255
 *  (255 when the hex carries no alpha). */
export function hexToRgba(hex: string): [number, number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const h = hex.replace('#', '');
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, Number.isFinite(a) ? a : 255];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return [r, g, b];
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Bilinear interpolation of the field value at (lat, lng) for hour `hourIdx`.
 * Grid is laid out row-major (j outer = rows, i inner = cols), with rows
 * going south→north and cols going west→east — matching
 * `mapfields.viewportGrid`. Returns null if any of the 4 corner cells is
 * missing data for this hour.
 */
export function bilerpValue(
  grid: FieldGrid,
  rows: number,
  cols: number,
  bounds: RasterBounds,
  lat: number,
  lng: number,
  hourIdx: number
): number | null {
  if (rows < 2 || cols < 2) return null;
  if (grid.points.length !== rows * cols) return null;
  const dLng = bounds.east - bounds.west;
  const dLat = bounds.north - bounds.south;
  if (dLng <= 0 || dLat <= 0) return null;
  // Map (lat, lng) into integer grid index space, clamping to [0..cols-1] /
  // [0..rows-1] so points outside the sampled region still pick up the
  // nearest-edge value (avoids a hard cutoff at the bounds).
  let fx = ((lng - bounds.west) / dLng) * (cols - 1);
  let fy = ((lat - bounds.south) / dLat) * (rows - 1);
  if (fx < 0) fx = 0;
  if (fx > cols - 1) fx = cols - 1;
  if (fy < 0) fy = 0;
  if (fy > rows - 1) fy = rows - 1;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, cols - 1);
  const y1 = Math.min(y0 + 1, rows - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  // viewportGrid emits j (rows, south→north) outer × i (cols, west→east) inner.
  const i00 = y0 * cols + x0;
  const i10 = y0 * cols + x1;
  const i01 = y1 * cols + x0;
  const i11 = y1 * cols + x1;
  const v00 = grid.points[i00]?.values[hourIdx];
  const v10 = grid.points[i10]?.values[hourIdx];
  const v01 = grid.points[i01]?.values[hourIdx];
  const v11 = grid.points[i11]?.values[hourIdx];
  if (
    v00 == null ||
    v10 == null ||
    v01 == null ||
    v11 == null ||
    !Number.isFinite(v00) ||
    !Number.isFinite(v10) ||
    !Number.isFinite(v01) ||
    !Number.isFinite(v11)
  ) {
    return null;
  }
  const a = v00 * (1 - tx) + v10 * tx;
  const b = v01 * (1 - tx) + v11 * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Catmull-Rom cubic interpolation across 4 collinear samples.
 * `t ∈ [0, 1]` is the position between b (sample 2) and c (sample 3).
 * Derived as a standard polynomial — same shape used by image editors
 * for high-quality bicubic upsampling.
 */
function cubic(t: number, a: number, b: number, c: number, d: number): number {
  const a0 = d - c - a + b;
  const a1 = a - b - a0;
  const a2 = c - a;
  const a3 = b;
  return ((a0 * t + a1) * t + a2) * t + a3;
}

/**
 * Sample the value at grid index (gx, gy) at hour `hourIdx`, clamping to
 * the grid edges. Returns null if the clamped sample is missing data so
 * callers can short-circuit. (gx,gy) may be any integer; out-of-range
 * values pull the nearest in-range sample.
 */
function sampleGrid(
  grid: FieldGrid,
  rows: number,
  cols: number,
  gx: number,
  gy: number,
  hourIdx: number
): number | null {
  let x = gx;
  let y = gy;
  if (x < 0) x = 0;
  if (x > cols - 1) x = cols - 1;
  if (y < 0) y = 0;
  if (y > rows - 1) y = rows - 1;
  const v = grid.points[y * cols + x]?.values[hourIdx];
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Bicubic (Catmull-Rom) interpolation of the field value at (lat, lng).
 * Uses a 4×4 neighbourhood around the target cell; edges are handled by
 * clamping neighbour indices into [0, cols-1] / [0, rows-1] so the
 * function is well-defined for points anywhere inside `bounds`. Returns
 * null if any of the 16 neighbours is missing data for `hourIdx`.
 *
 * Visually: produces smoother gradients than bilerp at the same input
 * grid density because the cubic kernel preserves curvature — the
 * piecewise-linear bumps you get from bilerp around peaks (e.g. a heat
 * island, a low-pressure centre) are replaced by a continuous curve.
 */
export function bicubicValue(
  grid: FieldGrid,
  rows: number,
  cols: number,
  bounds: RasterBounds,
  lat: number,
  lng: number,
  hourIdx: number
): number | null {
  if (rows < 2 || cols < 2) return null;
  if (grid.points.length !== rows * cols) return null;
  const dLng = bounds.east - bounds.west;
  const dLat = bounds.north - bounds.south;
  if (dLng <= 0 || dLat <= 0) return null;
  let fx = ((lng - bounds.west) / dLng) * (cols - 1);
  let fy = ((lat - bounds.south) / dLat) * (rows - 1);
  if (fx < 0) fx = 0;
  if (fx > cols - 1) fx = cols - 1;
  if (fy < 0) fy = 0;
  if (fy > rows - 1) fy = rows - 1;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  // 4 cubic interpolations across rows (one per row in the 4-row stencil)
  // then a final cubic across the 4 row-results down the column.
  const rowResults: number[] = new Array(4);
  for (let dy = -1; dy <= 2; dy++) {
    const y = iy + dy;
    const s0 = sampleGrid(grid, rows, cols, ix - 1, y, hourIdx);
    const s1 = sampleGrid(grid, rows, cols, ix, y, hourIdx);
    const s2 = sampleGrid(grid, rows, cols, ix + 1, y, hourIdx);
    const s3 = sampleGrid(grid, rows, cols, ix + 2, y, hourIdx);
    if (s0 === null || s1 === null || s2 === null || s3 === null) return null;
    rowResults[dy + 1] = cubic(tx, s0, s1, s2, s3);
  }
  return cubic(ty, rowResults[0], rowResults[1], rowResults[2], rowResults[3]);
}

/** Web Mercator y of a latitude, normalised like MapLibre's
 *  `MercatorCoordinate` (0 at ~85.05° N, 1 at ~85.05° S). */
export function mercatorY(lat: number): number {
  const phi = (lat * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
}

/** Inverse of {@link mercatorY}: latitude (degrees) of a normalised y. */
export function latFromMercatorY(y: number): number {
  return (
    ((2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2) * 180) /
    Math.PI
  );
}

/**
 * How image rows map to latitude (Story 24.1).
 *
 * - `'lat'` (the historical default): rows are evenly spaced in latitude.
 * - `'mercator'`: rows are evenly spaced in Web Mercator y, which is how
 *   MapLibre stretches an `image` source between its corners. Without it a
 *   lat-linear image lands ~3° north of its data around 20° N on the
 *   −5…50° field box (the tooltip, which samples at the true latitude,
 *   disagreed with the colour under the pointer).
 */
export type RasterRowSpace = 'lat' | 'mercator';

/** Latitude of image row `py` of `H` rows over `bounds`. */
export function rowLatitude(
  py: number,
  H: number,
  bounds: RasterBounds,
  rowSpace: RasterRowSpace = 'lat'
): number {
  const t = H > 1 ? py / (H - 1) : 0;
  if (rowSpace === 'mercator') {
    const yN = mercatorY(bounds.north);
    const yS = mercatorY(bounds.south);
    return latFromMercatorY(yN + t * (yS - yN));
  }
  return bounds.north - t * (bounds.north - bounds.south);
}

/** Fraction of the raster edge that fades to transparent (see
 *  {@link edgeFalloffAt}). Shared with the WebGL renderer (Story 24.1). */
export const FIELD_EDGE_FADE_FRACTION = 0.12;

/** Soft alpha fade near the raster edges for pixel (px, py) of a W×H
 *  raster; `px`/`py` may be fractional (the WebGL renderer evaluates it
 *  per fragment). 1 inside, smoothstep to 0 at the border. */
export function edgeFalloffAt(
  px: number,
  py: number,
  W: number,
  H: number
): number {
  const fadePxW = Math.max(2, Math.floor(W * FIELD_EDGE_FADE_FRACTION));
  const fadePxH = Math.max(2, Math.floor(H * FIELD_EDGE_FADE_FRACTION));
  const dx = Math.min(px, W - 1 - px);
  const dy = Math.min(py, H - 1 - py);
  const fx = dx >= fadePxW ? 1 : Math.max(0, dx) / fadePxW;
  const fy = dy >= fadePxH ? 1 : Math.max(0, dy) / fadePxH;
  // Smoothstep both axes for a perceptually nicer fade than linear.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return sx * sy;
}

/** Fill an ImageData buffer with the bicubic-interpolated field. */
export function fillFieldImageData(
  img: { data: Uint8ClampedArray; width: number; height: number },
  grid: FieldGrid,
  rows: number,
  cols: number,
  bounds: RasterBounds,
  hourIdx: number,
  colorHex: (v: number) => string,
  alpha: number,
  opts?: { rowSpace?: RasterRowSpace; detail?: FieldDetailLayer | null }
): void {
  const W = img.width;
  const detail = opts?.detail ?? null;
  const H = img.height;
  const dLng = bounds.east - bounds.west;
  const rowSpace = opts?.rowSpace ?? 'lat';
  // Cache the color ramp lookups in a small bucket. The ramp itself is
  // piecewise constant so identical values hash to identical hex strings;
  // a Map keyed on the integer-rounded value is a >50× perf win on the
  // typical 400×280 loop.
  const colorCache = new Map<number, [number, number, number, number]>();
  function rgbFor(v: number): [number, number, number, number] {
    const key = Math.round(v * 10);
    const cached = colorCache.get(key);
    if (cached) return cached;
    const rgb = hexToRgba(colorHex(v));
    colorCache.set(key, rgb);
    return rgb;
  }
  // Soft alpha fade near the raster edges: when the field is rendered on
  // a FIXED bounding box (so values stay stable across zoom levels), the
  // viewport at low zoom shows the raster's rectangular boundary as a
  // hard edge against the basemap. Fading the outermost ~12% of pixels
  // to fully transparent makes the field blend smoothly with the
  // basemap beyond, eliminating the rectangle look (edgeFalloffAt).
  for (let py = 0; py < H; py++) {
    // Image y goes top→bottom (north→south); flip to grid lat (south→north).
    const lat = rowLatitude(py, H, bounds, rowSpace);
    for (let px = 0; px < W; px++) {
      const lng = bounds.west + (px / (W - 1)) * dLng;
      let v = bicubicValue(grid, rows, cols, bounds, lat, lng, hourIdx);
      // Story 24.2 — the local grid wins inside its box.
      let detailAlpha = 1;
      if (detail) {
        const w = detailWeight(lng, lat, detail.bounds);
        if (w > 0) {
          const dv = bicubicValue(
            detail.grid,
            detail.rows,
            detail.cols,
            detail.bounds,
            lat,
            lng,
            detail.hourIdx
          );
          const m = mergeFieldValue(v, dv, w);
          if (m) {
            v = m.value;
            detailAlpha = m.alpha;
          }
        }
      }
      const i = (py * W + px) * 4;
      if (v === null) {
        img.data[i + 3] = 0;
        continue;
      }
      const [r, g, b, a] = rgbFor(v);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      // Ramp alpha (Story 15.5: dry precipitation cells are #00000000)
      // multiplies the layer alpha and the edge fade.
      img.data[i + 3] = Math.round(
        (alpha * a * detailAlpha * edgeFalloffAt(px, py, W, H)) / 255
      );
    }
  }
}

/** Four image-source corners for a lat/lng bounding box, CCW from top-left. */
export function boundsToCorners(bounds: RasterBounds): ImageCorners {
  return [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
  ];
}

/** Minimal interface we need from a 2D canvas (OffscreenCanvas or HTMLCanvasElement). */
interface RasterCanvas {
  width: number;
  height: number;
  getContext(
    type: '2d'
  ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  convertToBlob?: (opts?: { type?: string }) => Promise<Blob>;
  toBlob?: (cb: (blob: Blob | null) => void, type?: string) => void;
}

/** Create the right kind of canvas for the current environment (returns null in pure-Node tests). */
export function createRasterCanvas(W: number, H: number): RasterCanvas | null {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(W, H) as unknown as RasterCanvas;
  }
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c as unknown as RasterCanvas;
  }
  return null;
}

/** Convert a canvas to a Blob using whichever API is available. */
export async function canvasToBlob(
  canvas: RasterCanvas,
  type = 'image/png'
): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type });
  }
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('canvas has neither convertToBlob nor toBlob'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, type);
  });
}

export interface RasterRender {
  blobUrl: string;
  coords: ImageCorners;
}

/**
 * Render the full bilinear-interpolated field at a fixed pixel resolution
 * and return a Blob URL + the 4 image-source corners. Returns null when
 * no canvas factory is available (e.g. Node-only tests) or rendering
 * fails for any reason.
 */
export async function renderFieldRaster(
  grid: FieldGrid,
  rows: number,
  cols: number,
  bounds: RasterBounds,
  hourIdx: number,
  colorHex: (v: number) => string,
  opts?: {
    width?: number;
    height?: number;
    alpha?: number;
    rowSpace?: RasterRowSpace;
    detail?: FieldDetailLayer | null;
  }
): Promise<RasterRender | null> {
  const W = opts?.width ?? 400;
  const H = opts?.height ?? 280;
  const alpha = opts?.alpha ?? 200;
  const canvas = createRasterCanvas(W, H);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  fillFieldImageData(img, grid, rows, cols, bounds, hourIdx, colorHex, alpha, {
    rowSpace: opts?.rowSpace,
    detail: opts?.detail,
  });
  ctx.putImageData(img, 0, 0);
  try {
    const blob = await canvasToBlob(canvas);
    const blobUrl = URL.createObjectURL(blob);
    return { blobUrl, coords: boundsToCorners(bounds) };
  } catch {
    return null;
  }
}
