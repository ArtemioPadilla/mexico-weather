// Pure, DOM-free wind utilities for the /mapa GL particle layer.

/** Wind speed in m/s clamped to this maximum for colour + texture encoding. */
export const MAX_WIND_MPS = 40;

/** Meteorological direction (deg, 0=from north, 90=from east) + speed → u (east) / v (north) m/s. */
export function windUv(speedMps: number, directionDeg: number): { u: number; v: number } {
  const rad = (directionDeg * Math.PI) / 180;
  return { u: -speedMps * Math.sin(rad), v: -speedMps * Math.cos(rad) };
}

/** Magnitude of a wind vector. */
export function windSpeed(u: number, v: number): number {
  return Math.hypot(u, v);
}

export interface WindLegendStop {
  labelKey: string;
  color: string;
}

/** Wind speed (m/s) → hex colour on a clamped calm→gale ramp. */
export function windSpeedColor(s: number): string {
  const stops: [number, string][] = [
    [0, '#2b83ba'],
    [5, '#abdda4'],
    [10, '#ffffbf'],
    [15, '#fdae61'],
    [25, '#d7191c'],
    [MAX_WIND_MPS, '#67000d'],
  ];
  if (s <= stops[0][0]) return stops[0][1];
  if (s >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (s >= stops[i][0] && s < stops[i + 1][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

export const WIND_LEGEND: WindLegendStop[] = [
  { labelKey: 'legend_wind_calm', color: '#2b83ba' },
  { labelKey: 'legend_wind_breeze', color: '#abdda4' },
  { labelKey: 'legend_wind_strong', color: '#fdae61' },
  { labelKey: 'legend_wind_gale', color: '#67000d' },
];

export interface WindPoint {
  lat: number;
  lng: number;
  /** Eastward component in m/s; null when no data. */
  u: number | null;
  /** Northward component in m/s; null when no data. */
  v: number | null;
}

/** Encode a cols×rows wind grid into an RGBA byte texture. R=u_norm, G=v_norm, B=0, A=mask. */
export function encodeWindGrid(
  points: WindPoint[],
  cols: number,
  rows: number,
): { data: Uint8Array; width: number; height: number } {
  if (points.length !== cols * rows) {
    throw new Error(`encodeWindGrid: expected ${cols * rows} points, got ${points.length}`);
  }
  const data = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const off = i * 4;
    if (p.u === null || p.v === null || !Number.isFinite(p.u) || !Number.isFinite(p.v)) {
      data[off + 0] = 128;
      data[off + 1] = 128;
      data[off + 2] = 0;
      data[off + 3] = 0;
      continue;
    }
    const uNorm = clamp01((p.u + MAX_WIND_MPS) / (2 * MAX_WIND_MPS));
    const vNorm = clamp01((p.v + MAX_WIND_MPS) / (2 * MAX_WIND_MPS));
    data[off + 0] = Math.round(uNorm * 255);
    data[off + 1] = Math.round(vNorm * 255);
    data[off + 2] = 0;
    data[off + 3] = 255;
  }
  return { data, width: cols, height: rows };
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Deterministic mulberry32 PRNG. */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** N particles laid out as Float32Array [x,y,age,_]; x,y in [0,1]; deterministic with seed. */
export function initParticlePositions(n: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4 + 0] = r();
    out[i * 4 + 1] = r();
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 0;
  }
  return out;
}
