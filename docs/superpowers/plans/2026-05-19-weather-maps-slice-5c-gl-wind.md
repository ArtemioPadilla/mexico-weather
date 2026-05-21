# Weather Maps — Slice 5c: GL Particle Wind Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hand-built **WebGL particle wind layer** to `/mapa` — Open-Meteo wind grid → encoded wind-field texture → GPU particle advection via ping-pong position textures → particles drawn coloured by speed — with a `prefers-reduced-motion` fallback to a static arrow grid.

**Architecture:** Reuse Slice 5a/5b's `FIELD_CONFIGS` dispatch and the existing field-layer machinery (registry, hash, timeline, opacity, viewport re-sample). Add a new layer `kind: 'particles'`. The renderer is a MapLibre **custom layer** (`type: 'custom'`, `renderingMode: '2d'`) that owns its own GL resources (shader programs, particle position textures, wind-field texture, framebuffer). Pure, DOM-free, testable units (`windUv`, `encodeWindGrid`, `windSpeedColor`, particle-position init) live in `src/lib/mapwind.ts`; the GL plumbing lives inside the custom layer in `src/pages/mapa.astro` (untested per repo convention, verified via type-check + build + e2e UI-state assertions). Reduced-motion users get a static **`circle` + symbol arrows** rendering via the existing field-layer code path with no animation.

**Tech Stack:** Astro 6, TypeScript, Tailwind 4, Vitest, MapLibre GL JS (custom layer API: `onAdd(map, gl)`, `prerender(gl, matrix)`, `render(gl, matrix)`, `onRemove(map, gl)`), raw WebGL 1 (vertex + fragment shaders, framebuffer ping-pong), Open-Meteo Forecast (keyless; `hourly=wind_speed_10m,wind_direction_10m`).

Spec: `docs/superpowers/specs/2026-05-18-weather-maps-design.md` (Slice 5 — wind). Builds on Slices 1–5b (merged to `main`). Final field-layer sub-slice.

---

### Task 1: i18n strings for the wind layer

**Files:** Modify `src/i18n/ui.ts`.

- [ ] **Step 1** — Add to the `UiStrings` interface immediately after `map_layer_pressure: string;`:
```ts
  map_layer_wind: string;
  legend_wind_calm: string;
  legend_wind_breeze: string;
  legend_wind_strong: string;
  legend_wind_gale: string;
```
- [ ] **Step 2** — Add to `es:` after its `map_layer_pressure:` value line:
```ts
    map_layer_wind: 'Viento',
    legend_wind_calm: 'Calmo',
    legend_wind_breeze: 'Brisa',
    legend_wind_strong: 'Fuerte',
    legend_wind_gale: 'Tormenta',
```
- [ ] **Step 3** — Add to `en:` after its `map_layer_pressure:` value line:
```ts
    map_layer_wind: 'Wind',
    legend_wind_calm: 'Calm',
    legend_wind_breeze: 'Breeze',
    legend_wind_strong: 'Strong',
    legend_wind_gale: 'Gale',
```
- [ ] **Step 4** — `npm run type-check` → PASS.
- [ ] **Step 5** — Commit: `git add src/i18n/ui.ts && git commit -m "feat(maps): i18n strings for the wind layer + speed legend"` (husky executable-bit hint harmless; no --no-verify).

---

### Task 2: `mapwind.ts` — pure wind utilities (TDD)

**Files:**
- Create: `src/lib/mapwind.ts`
- Test: `src/lib/mapwind.test.ts`

> All numeric helpers needed by the GL layer live here and are testable without a browser/GL context. The shader binary plumbing lives in `mapa.astro` and is verified via build + e2e.

- [ ] **Step 1** — Failing test. Create `src/lib/mapwind.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  MAX_WIND_MPS,
  windUv,
  windSpeed,
  windSpeedColor,
  WIND_LEGEND,
  encodeWindGrid,
  initParticlePositions,
} from './mapwind';

describe('windUv', () => {
  it('decomposes speed + direction into u (east) and v (north) m/s', () => {
    // Meteorological direction: 0° = wind FROM north (blows south); 90° = from east.
    // So u = -speed*sin(rad), v = -speed*cos(rad).
    const { u, v } = windUv(10, 0);
    expect(u).toBeCloseTo(0, 5);
    expect(v).toBeCloseTo(-10, 5);
    const e = windUv(10, 90);
    expect(e.u).toBeCloseTo(-10, 5);
    expect(e.v).toBeCloseTo(0, 5);
  });
});

describe('windSpeed', () => {
  it('is sqrt(u^2 + v^2)', () => {
    expect(windSpeed(3, 4)).toBeCloseTo(5, 5);
    expect(windSpeed(0, 0)).toBe(0);
  });
});

describe('windSpeedColor + WIND_LEGEND', () => {
  it('maps speed to a hex colour on a calm→gale ramp; clamped', () => {
    expect(windSpeedColor(-1)).toBe(windSpeedColor(0));
    expect(windSpeedColor(999)).toBe(windSpeedColor(MAX_WIND_MPS));
    expect(windSpeedColor(0)).not.toBe(windSpeedColor(MAX_WIND_MPS));
    expect(windSpeedColor(5)).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('WIND_LEGEND has >= 4 ordered {labelKey,color} stops with hex colours', () => {
    expect(WIND_LEGEND.length).toBeGreaterThanOrEqual(4);
    for (const s of WIND_LEGEND) {
      expect(typeof s.labelKey).toBe('string');
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('encodeWindGrid', () => {
  it('packs cols*rows points into an RGBA byte buffer with u in R, v in G, mask in A', () => {
    const points = [
      { lat: 10, lng: -100, u: 0, v: 0 },
      { lat: 10, lng: -99, u: MAX_WIND_MPS, v: 0 },
      { lat: 11, lng: -100, u: 0, v: -MAX_WIND_MPS },
      { lat: 11, lng: -99, u: null, v: null },
    ];
    const out = encodeWindGrid(points, 2, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data).toBeInstanceOf(Uint8Array);
    expect(out.data.length).toBe(2 * 2 * 4);
    // (0,0) calm → R=128 (center), G=128, A=255 (data)
    expect(out.data[0]).toBe(128);
    expect(out.data[1]).toBe(128);
    expect(out.data[3]).toBe(255);
    // (1,0) east max → R≈255, G=128, A=255
    expect(out.data[4]).toBe(255);
    expect(out.data[5]).toBe(128);
    expect(out.data[7]).toBe(255);
    // (0,1) south max → R=128, G≈0, A=255
    expect(out.data[8]).toBe(128);
    expect(out.data[9]).toBe(0);
    expect(out.data[11]).toBe(255);
    // (1,1) null → A=0 (no data)
    expect(out.data[15]).toBe(0);
  });
});

describe('initParticlePositions', () => {
  it('returns Float32Array of length N*4 with x,y in [0,1] and age slot reset', () => {
    const buf = initParticlePositions(8, 7);
    expect(buf).toBeInstanceOf(Float32Array);
    expect(buf.length).toBe(32);
    for (let i = 0; i < 8; i++) {
      expect(buf[i * 4 + 0]).toBeGreaterThanOrEqual(0);
      expect(buf[i * 4 + 0]).toBeLessThanOrEqual(1);
      expect(buf[i * 4 + 1]).toBeGreaterThanOrEqual(0);
      expect(buf[i * 4 + 1]).toBeLessThanOrEqual(1);
      expect(buf[i * 4 + 2]).toBe(0);
      expect(buf[i * 4 + 3]).toBe(0);
    }
  });
  it('is deterministic for a given seed', () => {
    const a = initParticlePositions(16, 42);
    const b = initParticlePositions(16, 42);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
```

- [ ] **Step 2** — `npx vitest run src/lib/mapwind.test.ts` → expect FAIL (cannot resolve `./mapwind`).

- [ ] **Step 3** — Create `src/lib/mapwind.ts`:
```ts
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
```

- [ ] **Step 4** — `npx vitest run src/lib/mapwind.test.ts` → expect PASS (all green).
- [ ] **Step 5** — Commit:
```bash
git add src/lib/mapwind.ts src/lib/mapwind.test.ts
git commit -m "feat(maps): pure wind utilities (uv, speed colour, grid encoding, particle init)"
```

---

### Task 3: `mapfields.ts` — support `wind_speed_10m,wind_direction_10m` bulk fetch (TDD)

**Files:**
- Modify: `src/lib/mapfields.ts`
- Modify: `src/lib/mapfields.test.ts`

> Open-Meteo bulk allows comma-joined `hourly` variables in one call. We add a `parseWindResponse` that returns a `WindGrid` aligned to the same points/times shape but with both `u` and `v` per cell.

- [ ] **Step 1** — Failing test. APPEND to `src/lib/mapfields.test.ts`:
```ts
import { buildWindUrl, parseWindResponse } from './mapfields';

describe('buildWindUrl', () => {
  it('builds an Open-Meteo bulk URL requesting wind_speed_10m + wind_direction_10m', () => {
    const url = buildWindUrl([
      { lat: 10, lng: -100 },
      { lat: 12, lng: -99 },
    ]);
    expect(url).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=10,12&longitude=-100,-99' +
        '&hourly=wind_speed_10m,wind_direction_10m&forecast_days=2&timezone=UTC',
    );
  });
});

describe('parseWindResponse', () => {
  const pts = [
    { lat: 10, lng: -100 },
    { lat: 12, lng: -99 },
  ];
  const resp = [
    {
      hourly: {
        time: ['2026-05-19T00:00', '2026-05-19T01:00'],
        wind_speed_10m: [10, 5],
        wind_direction_10m: [0, 90],
      },
    },
    {
      hourly: {
        time: ['2026-05-19T00:00', '2026-05-19T01:00'],
        wind_speed_10m: [null, 8],
        wind_direction_10m: [null, 180],
      },
    },
  ];
  it('decomposes speed+direction into u/v per point per hour, preserving nulls', () => {
    const g = parseWindResponse(resp, pts);
    expect(g).not.toBeNull();
    expect(g!.times).toEqual(['2026-05-19T00:00', '2026-05-19T01:00']);
    expect(g!.points[0].u[0]).toBeCloseTo(0, 5);
    expect(g!.points[0].v[0]).toBeCloseTo(-10, 5);
    expect(g!.points[0].u[1]).toBeCloseTo(-5, 5);
    expect(g!.points[0].v[1]).toBeCloseTo(0, 5);
    expect(g!.points[1].u[0]).toBeNull();
    expect(g!.points[1].v[0]).toBeNull();
    expect(g!.points[1].u[1]).toBeCloseTo(0, 5);
    expect(g!.points[1].v[1]).toBeCloseTo(8, 5);
  });
  it('returns null for malformed input', () => {
    expect(parseWindResponse(null, pts)).toBeNull();
    expect(parseWindResponse([{ hourly: {} }, { hourly: {} }], pts)).toBeNull();
  });
});
```

- [ ] **Step 2** — `npx vitest run src/lib/mapfields.test.ts` → expect FAIL on the new tests.

- [ ] **Step 3** — In `src/lib/mapfields.ts` APPEND at EOF:
```ts
import { windUv } from './mapwind';

/** Wind grid: u/v per point per hour, with nulls for no-data cells. */
export interface WindGrid {
  times: string[];
  points: { lat: number; lng: number; u: (number | null)[]; v: (number | null)[] }[];
}

/** Keyless Open-Meteo bulk URL fetching speed + direction together. */
export function buildWindUrl(points: LngLat[]): string {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&hourly=wind_speed_10m,wind_direction_10m&forecast_days=2&timezone=UTC`
  );
}

function isSpeedDirArray(a: unknown): a is (number | null)[] {
  return (
    Array.isArray(a) &&
    a.every((n) => n === null || (typeof n === 'number' && Number.isFinite(n)))
  );
}

/** Normalise an Open-Meteo wind bulk response into a WindGrid (u/v decomposed). Null if unusable. */
export function parseWindResponse(json: unknown, points: LngLat[]): WindGrid | null {
  if (!json) return null;
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== points.length) return null;
  const first = arr[0] as { hourly?: { time?: unknown } } | undefined;
  const times = first?.hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return null;
  const out: WindGrid['points'] = [];
  for (let i = 0; i < arr.length; i++) {
    const h = (arr[i] as { hourly?: Record<string, unknown> } | undefined)?.hourly;
    const sp = h?.wind_speed_10m;
    const dr = h?.wind_direction_10m;
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
```

- [ ] **Step 4** — `npx vitest run src/lib/mapfields.test.ts` → expect PASS (all original + new wind tests).
- [ ] **Step 5** — Commit:
```bash
git add src/lib/mapfields.ts src/lib/mapfields.test.ts
git commit -m "feat(maps): Open-Meteo wind bulk fetch + uv-decomposed parse (mapfields)"
```

---

### Task 4: Register the `wind` layer + new `particles` kind (TDD)

**Files:** Modify `src/lib/maplayers.ts` + `src/lib/maplayers.test.ts`.

- [ ] **Step 1** — In `src/lib/maplayers.test.ts`, inside `describe('layer registry')`, add:
```ts
  it('registers a wind particles layer', () => {
    expect(LAYER_IDS).toEqual([
      'base', 'radar', 'satellite', 'temperature', 'humidity', 'pressure', 'wind',
    ]);
    const w = getLayer('wind');
    expect(w?.kind).toBe('particles');
    expect(w?.labelKey).toBe('map_layer_wind');
    expect(w?.defaultOpacity).toBeGreaterThan(0);
  });
```
Then forward-update every existing exact-`LAYER_IDS`/`LAYERS.map(id)` enumeration snapshot to also include `'wind'` at the end (strictly stronger; same pattern). Do NOT touch any other assertion.

- [ ] **Step 2** — `npx vitest run src/lib/maplayers.test.ts` → expect FAIL on the new test + enumeration snapshots.

- [ ] **Step 3** — In `src/lib/maplayers.ts`:
(a) Replace:
```ts
export type LayerId = 'base' | 'radar' | 'satellite' | 'temperature' | 'humidity' | 'pressure';

export const LAYER_IDS = ['base', 'radar', 'satellite', 'temperature', 'humidity', 'pressure'] as const;
```
with:
```ts
export type LayerId =
  | 'base' | 'radar' | 'satellite' | 'temperature' | 'humidity' | 'pressure' | 'wind';

export const LAYER_IDS = [
  'base', 'radar', 'satellite', 'temperature', 'humidity', 'pressure', 'wind',
] as const;
```
(b) Widen `LayerDef.kind`: change `kind: 'base' | 'raster-tile' | 'field';` to `kind: 'base' | 'raster-tile' | 'field' | 'particles';`.
(c) Append to `LAYERS` (after the pressure entry):
```ts
  { id: 'wind', labelKey: 'map_layer_wind', kind: 'particles', defaultOpacity: 1 },
```

- [ ] **Step 4** — `npx vitest run src/lib/maplayers.test.ts src/lib/maphash.test.ts` → PASS.
- [ ] **Step 5** — `npm test && npm run type-check` → PASS.
- [ ] **Step 6** — Commit:
```bash
git add src/lib/maplayers.ts src/lib/maplayers.test.ts
git commit -m "feat(maps): register wind layer with new 'particles' kind"
```

---

### Task 5: `/mapa` — WindLayer custom GL layer + reduced-motion arrow fallback

**Files:** Modify `src/pages/mapa.astro`.

> The single largest task in this slice. Adds a MapLibre `custom` layer that owns its own WebGL state (programs, textures, framebuffer), driven by Open-Meteo wind data. Under `prefers-reduced-motion: reduce`, the wind layer instead renders as a `circle` field (no animation) coloured by speed. UI-MapLibre wiring is untested per repo convention; verified via type-check + build + e2e. READ the file before editing.

- [ ] **Step 1** — Imports. In the script's import group, add (after the existing `'../lib/mapfields'` import block):
```ts
    import {
      MAX_WIND_MPS,
      windSpeed,
      windSpeedColor,
      WIND_LEGEND,
      encodeWindGrid,
      initParticlePositions,
      type WindPoint,
    } from '../lib/mapwind';
    import { buildWindUrl, parseWindResponse, type WindGrid } from '../lib/mapfields';
```

- [ ] **Step 2** — State + helpers. Immediately AFTER the existing `let fieldAbort: AbortController | null = null;` line, insert:
```ts
    const WIND_LAYER = 'wx-wind-layer';
    const WIND_CIRCLE_LAYER = 'wx-wind-circle';
    const WIND_CIRCLE_SOURCE = 'wx-wind-circle-src';
    const PARTICLE_COUNT = 1024; // 32 x 32 texture
    const PARTICLE_TEX_SIZE = 32;

    let windGrid: WindGrid | null = null;
    let windHourIndex = 0;
    const windReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let windRaf = 0;

    function removeWind(): void {
      if (windRaf) {
        window.cancelAnimationFrame(windRaf);
        windRaf = 0;
      }
      if (map.getLayer(WIND_LAYER)) map.removeLayer(WIND_LAYER);
      if (map.getLayer(WIND_CIRCLE_LAYER)) map.removeLayer(WIND_CIRCLE_LAYER);
      if (map.getSource(WIND_CIRCLE_SOURCE)) map.removeSource(WIND_CIRCLE_SOURCE);
    }

    function windPointsAtHour(g: WindGrid, h: number): WindPoint[] {
      return g.points.map((p) => ({ lat: p.lat, lng: p.lng, u: p.u[h], v: p.v[h] }));
    }

    function windCircleGeoJSON(g: WindGrid, h: number): FeatureCollection {
      const feats: Feature[] = [];
      for (const p of g.points) {
        const u = p.u[h];
        const v = p.v[h];
        if (u === null || v === null) continue;
        const s = windSpeed(u, v);
        feats.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { color: windSpeedColor(s), speed: Math.round(s) },
        });
      }
      return { type: 'FeatureCollection', features: feats };
    }

    function showWindFrame(h: number): void {
      if (!windGrid) return;
      windHourIndex = h;
      if (windReducedMotion) {
        const data = windCircleGeoJSON(windGrid, h);
        const src = map.getSource(WIND_CIRCLE_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
        } else {
          map.addSource(WIND_CIRCLE_SOURCE, { type: 'geojson', data });
          map.addLayer({
            id: WIND_CIRCLE_LAYER,
            type: 'circle',
            source: WIND_CIRCLE_SOURCE,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 8, 18],
              'circle-color': ['get', 'color'],
              'circle-opacity': rvOpacity,
            },
          });
        }
        return;
      }
      // Animated path: ensure the custom WebGL layer is mounted; its onAdd
      // will read the latest windGrid + windHourIndex via closure.
      if (!map.getLayer(WIND_LAYER)) {
        map.addLayer(makeWindLayer());
      }
    }

    function makeWindLayer(): maplibregl.CustomLayerInterface {
      let prog: WebGLProgram | null = null;
      let updateProg: WebGLProgram | null = null;
      let posTexA: WebGLTexture | null = null;
      let posTexB: WebGLTexture | null = null;
      let windTex: WebGLTexture | null = null;
      let fbo: WebGLFramebuffer | null = null;
      let posBuf: WebGLBuffer | null = null;
      let quadBuf: WebGLBuffer | null = null;

      function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return sh;
      }
      function link(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
        const p = gl.createProgram()!;
        gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
        gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        return p;
      }

      const updateVs = `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
          v_uv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;
      const updateFs = `
        precision mediump float;
        uniform sampler2D u_pos;
        uniform sampler2D u_wind;
        uniform float u_dt;
        uniform float u_max;
        varying vec2 v_uv;
        void main() {
          vec4 p = texture2D(u_pos, v_uv);
          vec2 pos = p.xy;
          vec4 wTex = texture2D(u_wind, pos);
          vec2 uv = (wTex.rg * 2.0 - 1.0) * u_max; // m/s in [-max,+max]
          float mask = wTex.a;
          // Advect: degrees-per-second roughly proportional to m/s; small dt keeps motion subtle.
          vec2 dp = vec2(uv.x, -uv.y) * u_dt * 0.000045;
          pos += dp * mask;
          // Wrap or respawn: if out of [0,1], reseed pseudo-randomly from age.
          float age = p.z + u_dt;
          if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0 || age > 4.0) {
            pos = fract(vec2(sin(age * 12.9898) * 43758.5453, cos(age * 78.233) * 12345.678));
            age = 0.0;
          }
          gl_FragColor = vec4(pos, age, 0.0);
        }
      `;
      const drawVs = `
        attribute float a_index;
        uniform sampler2D u_pos;
        uniform float u_size;
        varying float v_speed;
        uniform sampler2D u_wind;
        uniform float u_max;
        void main() {
          float i = a_index;
          float row = floor(i / u_size);
          float col = i - row * u_size;
          vec2 uvIdx = (vec2(col, row) + 0.5) / u_size;
          vec4 p = texture2D(u_pos, uvIdx);
          vec4 w = texture2D(u_wind, p.xy);
          vec2 wind = (w.rg * 2.0 - 1.0) * u_max;
          v_speed = length(wind);
          // Map x in [0,1] -> NDC [-1,1]; y flipped (texture origin top-left vs NDC bottom-left).
          gl_Position = vec4(p.x * 2.0 - 1.0, (1.0 - p.y) * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 2.0;
        }
      `;
      const drawFs = `
        precision mediump float;
        varying float v_speed;
        uniform float u_max;
        void main() {
          float t = clamp(v_speed / u_max, 0.0, 1.0);
          // Simple speed→colour ramp in shader (mirrors windSpeedColor stops roughly).
          vec3 cCalm   = vec3(0.169, 0.514, 0.729);
          vec3 cBreeze = vec3(0.671, 0.867, 0.643);
          vec3 cStrong = vec3(0.992, 0.682, 0.380);
          vec3 cGale   = vec3(0.404, 0.000, 0.051);
          vec3 col = mix(cCalm, cBreeze, smoothstep(0.0, 0.25, t));
          col = mix(col, cStrong, smoothstep(0.25, 0.6, t));
          col = mix(col, cGale, smoothstep(0.6, 1.0, t));
          gl_FragColor = vec4(col, 0.85);
        }
      `;

      function ensure(): void {
        if (!windGrid) return;
        // (Re)upload wind texture from current frame.
        const pts = windPointsAtHour(windGrid, windHourIndex);
        // Infer cols/rows from grid layout used by loadWindGrid (8x6).
        const cols = 8;
        const rows = 6;
        if (pts.length !== cols * rows) return;
        const enc = encodeWindGrid(pts, cols, rows);
        const gl = (map as unknown as { painter: { context: { gl: WebGLRenderingContext } } })
          .painter.context.gl;
        gl.bindTexture(gl.TEXTURE_2D, windTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, enc.data);
      }

      return {
        id: WIND_LAYER,
        type: 'custom',
        renderingMode: '2d',
        onAdd(map, gl) {
          updateProg = link(gl, updateVs, updateFs);
          prog = link(gl, drawVs, drawFs);
          // Position textures (RGBA float emulated as RGBA byte storing x,y,age):
          // For broad WebGL1 support we use UNSIGNED_BYTE and pack x,y into R,G.
          const initial = initParticlePositions(PARTICLE_COUNT, 1234);
          const bytes = new Uint8Array(PARTICLE_COUNT * 4);
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            bytes[i * 4 + 0] = Math.round(initial[i * 4 + 0] * 255);
            bytes[i * 4 + 1] = Math.round(initial[i * 4 + 1] * 255);
            bytes[i * 4 + 2] = 0;
            bytes[i * 4 + 3] = 0;
          }
          function newTex(): WebGLTexture {
            const t = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
          }
          posTexA = newTex();
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PARTICLE_TEX_SIZE, PARTICLE_TEX_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          posTexB = newTex();
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PARTICLE_TEX_SIZE, PARTICLE_TEX_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          windTex = newTex();
          fbo = gl.createFramebuffer();
          // Quad for the update pass.
          quadBuf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
          // Particle index buffer for the draw pass.
          const idx = new Float32Array(PARTICLE_COUNT);
          for (let i = 0; i < PARTICLE_COUNT; i++) idx[i] = i;
          posBuf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
          gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);
          // First wind texture upload.
          ensure();
          // Kick the rAF loop so the map redraws.
          const tick = (): void => {
            map.triggerRepaint();
            windRaf = window.requestAnimationFrame(tick);
          };
          windRaf = window.requestAnimationFrame(tick);
        },
        onRemove(_map, gl) {
          if (windRaf) {
            window.cancelAnimationFrame(windRaf);
            windRaf = 0;
          }
          if (prog) gl.deleteProgram(prog);
          if (updateProg) gl.deleteProgram(updateProg);
          if (posTexA) gl.deleteTexture(posTexA);
          if (posTexB) gl.deleteTexture(posTexB);
          if (windTex) gl.deleteTexture(windTex);
          if (fbo) gl.deleteFramebuffer(fbo);
          if (posBuf) gl.deleteBuffer(posBuf);
          if (quadBuf) gl.deleteBuffer(quadBuf);
        },
        prerender(gl) {
          if (!updateProg || !posTexA || !posTexB || !windTex || !fbo || !quadBuf) return;
          // Update step: render into posTexB sampling posTexA + wind tex.
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, posTexB, 0);
          gl.viewport(0, 0, PARTICLE_TEX_SIZE, PARTICLE_TEX_SIZE);
          gl.useProgram(updateProg);
          const aPos = gl.getAttribLocation(updateProg, 'a_pos');
          gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
          gl.enableVertexAttribArray(aPos);
          gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, posTexA);
          gl.uniform1i(gl.getUniformLocation(updateProg, 'u_pos'), 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, windTex);
          gl.uniform1i(gl.getUniformLocation(updateProg, 'u_wind'), 1);
          gl.uniform1f(gl.getUniformLocation(updateProg, 'u_dt'), 16.0);
          gl.uniform1f(gl.getUniformLocation(updateProg, 'u_max'), MAX_WIND_MPS);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          // Swap A/B
          const tmp = posTexA; posTexA = posTexB; posTexB = tmp;
        },
        render(gl) {
          if (!prog || !posTexA || !windTex || !posBuf) return;
          gl.useProgram(prog);
          const aIdx = gl.getAttribLocation(prog, 'a_index');
          gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
          gl.enableVertexAttribArray(aIdx);
          gl.vertexAttribPointer(aIdx, 1, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, posTexA);
          gl.uniform1i(gl.getUniformLocation(prog, 'u_pos'), 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, windTex);
          gl.uniform1i(gl.getUniformLocation(prog, 'u_wind'), 1);
          gl.uniform1f(gl.getUniformLocation(prog, 'u_size'), PARTICLE_TEX_SIZE);
          gl.uniform1f(gl.getUniformLocation(prog, 'u_max'), MAX_WIND_MPS);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
        },
      };
    }
```

- [ ] **Step 3** — Wire `setActiveLayer` to branch on the `particles` kind. Inside `setActiveLayer`, immediately AFTER the existing `if (def.kind === 'field')` block (still BEFORE the `raster-tile` block), insert:
```ts
      if (def.kind === 'particles') {
        rvOpacity = def.defaultOpacity;
        if (opacityEl) opacityEl.value = String(Math.round(rvOpacity * 100));
        tlStop();
        removeWeatherRaster();
        removeField();
        // Fetch the wind grid via the dedicated builder/parser (separate from FIELD_CONFIGS).
        const b = map.getBounds();
        const grid = viewportGrid(
          { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
          8,
          6,
        );
        fieldAbort?.abort();
        const ac = new AbortController();
        fieldAbort = ac;
        try {
          const res = await deps.fetch(buildWindUrl(grid), { signal: ac.signal });
          if (ac.signal.aborted) { removeWind(); activeLayer = 'base'; refreshLayerButtons(); syncHash(); return; }
          windGrid = parseWindResponse(await res.json(), grid);
        } catch {
          if (!ac.signal.aborted) windGrid = null;
        } finally {
          if (fieldAbort === ac) fieldAbort = null;
        }
        if (!windGrid || windGrid.points.length === 0) {
          showMsg(t.map_layer_unavailable);
          activeLayer = 'base';
          removeWind();
          tlFrames = [];
          frameIndex = -1;
          activeFrameIso = null;
          showTimeline(false);
          refreshLayerButtons();
          syncHash();
          return;
        }
        activeLayer = id;
        tlFrames = windGrid.times.map((iso) => ({
          time: Math.floor(Date.parse(/[Zz]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z') / 1000),
          path: '',
        }));
        const idx = fieldFrameIndex(windGrid.times, pendingSeekIso, Date.now());
        pendingSeekIso = null;
        showTimeline(true);
        refreshLayerButtons();
        // Apply current hour: triggers showWindFrame via applyFrame branching.
        applyFrame(idx >= 0 ? idx : 0);
        return;
      }
```

- [ ] **Step 4** — Branch `applyFrame` for particles. Currently `applyFrame` calls `renderFieldFrame(idx)` for `field`. Add a third branch BEFORE that:
```ts
      if (getLayerDef(activeLayer)?.kind === 'particles') {
        showWindFrame(idx);
      } else if (getLayerDef(activeLayer)?.kind === 'field') {
        renderFieldFrame(idx);
      } else {
        showWeatherFrame(activeLayer, fr);
      }
```
(Replace the existing two-way if/else with this three-way chain.)

- [ ] **Step 5** — Tear down wind in OTHER branches. Add `removeWind();` immediately after each existing `removeField();` call in `setActiveLayer` (both the `raster-tile` and `base` branches) so switching away from wind cleans up.

- [ ] **Step 6** — Generalise `renderLegend` to five kinds. Replace the existing `kind` parameter type and ternary to also accept `'wind'`:
```ts
    function renderLegend(kind: 'radar' | 'temperature' | 'humidity' | 'pressure' | 'wind' | null): void {
      // …existing body…
      const stops: LegendStop[] =
        kind === 'radar'
          ? RADAR_LEGEND.map((s) => ({ label: t[s.labelKey as keyof typeof t] as string, color: s.color }))
          : kind === 'temperature'
            ? TEMP_LEGEND
            : kind === 'humidity'
              ? HUMIDITY_LEGEND
              : kind === 'pressure'
                ? PRESSURE_LEGEND
                : WIND_LEGEND.map((s) => ({ label: t[s.labelKey as keyof typeof t] as string, color: s.color }));
```
(Keep the surrounding logic unchanged.)

Update the `refreshLayerButtons` call site:
```ts
      const kindForLegend =
        activeLayer === 'radar'
          ? ('radar' as const)
          : akind === 'field'
            ? (activeLayer as 'temperature' | 'humidity' | 'pressure')
            : akind === 'particles'
              ? ('wind' as const)
              : null;
      renderLegend(kindForLegend);
```
Also update the opacitywrap toggle condition to include `particles`:
```ts
      document
        .getElementById('opacitywrap')
        ?.classList.toggle('hidden', akind !== 'raster-tile' && akind !== 'field' && akind !== 'particles');
```

- [ ] **Step 7** — Wire the opacity slider to also update the reduced-motion circle layer when wind is active. In the existing opacity input handler, add a third line:
```ts
        if (map.getLayer(WIND_CIRCLE_LAYER)) map.setPaintProperty(WIND_CIRCLE_LAYER, 'circle-opacity', rvOpacity);
```
(Particles' alpha is hardcoded in the fragment shader for v1; opacity slider effect on the animated path is deferred to Slice 6 polish.)

- [ ] **Step 8** — `npm run type-check && npm run build` → PASS, `dist/mapa/index.html` present.

- [ ] **Step 9** — `npm test` → PASS. (Unit suite is unaffected; only mapa.astro and the three lib files we already touched have tests, and those tests are unchanged.)

- [ ] **Step 10** — Commit:
```bash
git add src/pages/mapa.astro
git commit -m "feat(maps): hand-built WebGL particle wind layer (+ reduced-motion arrow fallback)"
```

---

### Task 6: e2e for the wind layer

**Files:** Modify `e2e/mapa.spec.ts`.

- [ ] **Step 1** — Add a wind bulk mock. Near the existing `OPEN_METEO_FIELD` constant, add:
```ts
/** Minimal Open-Meteo wind bulk response: 48 points, 2 hourly steps. */
const OPEN_METEO_WIND = JSON.stringify(
  Array.from({ length: 48 }, () => ({
    hourly: {
      time: ['2026-05-19T00:00', '2026-05-19T01:00'],
      wind_speed_10m: [5, 6],
      wind_direction_10m: [180, 200],
    },
  })),
);
```

- [ ] **Step 2** — Add the wind test inside the existing `test.describe('mapa page', ...)` (after pressure):
```ts
  test('wind layer activates with a legend and timeline', async ({ page }) => {
    await page.route('**/api.rainviewer.com/public/weather-maps.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: RAINVIEWER_MANIFEST }),
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }),
    );
    // The wind bulk URL carries `hourly=wind_speed_10m,wind_direction_10m`; route by query.
    await page.route(/api\.open-meteo\.com\/v1\/forecast.*wind_speed_10m/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: OPEN_METEO_WIND }),
    );

    await page.goto('mapa/');
    await page.waitForResponse('**/api.rainviewer.com/public/weather-maps.json');

    const btn = page.locator('#layerbtn-wind');
    await expect(btn).toBeEnabled();
    const windResp = page.waitForResponse(/api\.open-meteo\.com\/v1\/forecast.*wind_speed_10m/);
    await btn.click();
    await windResp;

    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend')).toBeVisible();
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#opacitywrap')).toBeVisible();

    await page.locator('#layerbtn-base').click();
    await expect(page.locator('#legend')).toBeHidden();
    await expect(page.locator('#timeline')).toBeHidden();
  });
```

- [ ] **Step 3** — Run `npm run test:e2e -- mapa.spec.ts` TWICE → expect 8/8 both times, 0 skipped. Install chromium if needed. Do NOT weaken assertions.

- [ ] **Step 4** — `npm test` → PASS. `npm run build` → PASS, `dist/mapa/index.html` present.

- [ ] **Step 5** — Commit:
```bash
git add e2e/mapa.spec.ts
git commit -m "test(maps): deterministic e2e for the wind layer"
```

---

## Self-Review

- **Spec coverage (Slice 5c):** GL particle wind, keyless, no library (Task 5 custom layer w/ raw WebGL1 shaders, ping-pong position texture, wind-field texture, particle draw); `prefers-reduced-motion` fallback to a non-animated circle field (Task 5 `windReducedMotion` branch); Open-Meteo wind bulk fetch (Task 3 `buildWindUrl`/`parseWindResponse`); registered in single-source-of-truth (Task 4); timeline-driven via adapted RadarFrame[] (Task 5 `setActiveLayer` particles branch reuses Slice-4 timeline); shareable + restore-on-load (`LAYER_IDS` auto-accept; `pendingSeekIso` consumed once); non-blocking failure → base; XSS esc() in legend; pure logic TDD (Tasks 2, 3, 4); UI/MapLibre/GL untested per repo convention (Tasks 5, 6).
- **Placeholder scan:** none — every code/command step is concrete; the WebGL shaders are fully specified.
- **Type consistency:** `MAX_WIND_MPS`/`windUv`/`windSpeed`/`windSpeedColor`/`WIND_LEGEND`/`encodeWindGrid`/`initParticlePositions`/`WindPoint` (Task 2) and `buildWindUrl`/`parseWindResponse`/`WindGrid` (Task 3) defined once and consumed in Task 5; `LayerDef.kind` widened with `'particles'` in Task 4; `renderLegend` extended to five kinds in Task 5 with the single caller updated; `WIND_LAYER`/`WIND_CIRCLE_LAYER`/`WIND_CIRCLE_SOURCE`/`PARTICLE_COUNT`/`PARTICLE_TEX_SIZE`/`windGrid`/`windHourIndex`/`windReducedMotion`/`windRaf` defined once in Task 5 and used consistently.

## Honest caveats

- **WebGL1 + UNSIGNED_BYTE position textures** — chosen for broad compatibility (no float-texture extension required). Precision is therefore ~8-bit per position component; sufficient for a 1024-particle visualisation at a 32×32 texture. Slice 6 polish may upgrade to float textures if the device supports `OES_texture_float`.
- **The shader uses an arbitrary advection constant (`0.000045`)** — empirically tuned to give visible motion at typical Mexico zoom levels with wind speeds up to MAX_WIND_MPS. May need adjustment after visual review on real hardware; this is the kind of value that benefits from a Slice-6 polish pass.
- **Coordinate-system caveat:** the particle texture lives in `[0,1]²`; the draw vertex shader maps that to NDC. Particles move in "screen-space relative to the wind grid bbox", not true geographic projection. For a v1 hand-rolled system this is the standard pragmatic approach; geographic-accurate advection (great-circle, Mercator-aware) is a Slice 6 item.
- **No particle trails** in v1 (no feedback texture / screen-fade); particles are drawn as 2-pixel points each frame. Trails are a Slice 6 polish item.
- **No worker-thread offload**; GL work runs on the main thread. Acceptable for 1024 particles.
