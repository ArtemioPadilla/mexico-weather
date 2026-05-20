# Weather Maps — Slice 5a: Field Infrastructure + Temperature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the keyless Open-Meteo gridded-field infrastructure and a timeline-driven, viewport-resampled **temperature** heat overlay to `/mapa`, establishing the pattern that Slice 5b (humidity/pressure) and Slice 5c (GL particle wind) build on.

**Architecture:** A new pure, DOM-free `src/lib/mapfields.ts` (viewport grid generation, Open-Meteo bulk-forecast URL building, response parsing into a time×point grid, hourly-frame selection, temperature colour ramp + legend) with colocated Vitest. `src/lib/maplayers.ts` gains a `field` layer kind + `temperature` layer. `src/pages/mapa.astro` branches by layer kind: `raster-tile` keeps the Slice-2/3/4 RainViewer path; `field` fetches an Open-Meteo grid over the current viewport, renders it as a MapLibre GeoJSON circle/heat layer coloured by value, drives the existing Slice-4 timeline from the Open-Meteo hourly steps (reusing the scrubber by adapting hourly times into the existing frame model), and re-samples (debounced) on map move. UI/MapLibre wiring stays untested per repo convention; all numeric/parse logic is TDD.

**Tech Stack:** Astro 6, TypeScript, Tailwind 4, Vitest, MapLibre GL JS, Open-Meteo Forecast API (keyless, CORS, bulk multi-coordinate: comma-joined `latitude`/`longitude`, `hourly=temperature_2m`).

Spec: `docs/superpowers/specs/2026-05-18-weather-maps-design.md` (Slice 5 — field layers). Umbrella: Slice 5 = 5a (this) → 5b (humidity/pressure) → 5c (GL particle wind). Builds on Slices 1–4 (merged to `main`).

---

### Task 1: i18n strings for the temperature field layer

**Files:**
- Modify: `src/i18n/ui.ts`

- [ ] **Step 1: Extend the `UiStrings` interface**

In `src/i18n/ui.ts`, add this field to the `UiStrings` interface immediately after the existing `timeline_now: string;` line:

```ts
  map_layer_temperature: string;
```

- [ ] **Step 2: Add the Spanish value**

In the `es:` object, immediately after its `timeline_now:` value line, add:

```ts
    map_layer_temperature: 'Temperatura',
```

- [ ] **Step 3: Add the English value**

In the `en:` object, immediately after its `timeline_now:` value line, add:

```ts
    map_layer_temperature: 'Temperature',
```

- [ ] **Step 4: Verify types compile**

Run: `npm run type-check`
Expected: PASS (exit 0).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/ui.ts
git commit -m "feat(maps): i18n string for the temperature field layer"
```

---

### Task 2: `mapfields.ts` — pure Open-Meteo grid + temperature scale (TDD)

**Files:**
- Create: `src/lib/mapfields.ts`
- Test: `src/lib/mapfields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mapfields.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  viewportGrid,
  buildFieldUrl,
  parseFieldResponse,
  fieldFrameIndex,
  tempColor,
  TEMP_LEGEND,
} from './mapfields';

describe('viewportGrid', () => {
  it('returns cols*rows points spanning the bbox inclusively', () => {
    const pts = viewportGrid({ west: -100, south: 10, east: -98, north: 14 }, 3, 2);
    expect(pts).toHaveLength(6);
    expect(pts[0]).toEqual({ lng: -100, lat: 10 });
    expect(pts[pts.length - 1]).toEqual({ lng: -98, lat: 14 });
  });
  it('clamps degenerate sizes to at least 2x2', () => {
    expect(viewportGrid({ west: 0, south: 0, east: 1, north: 1 }, 1, 1)).toHaveLength(4);
  });
});

describe('buildFieldUrl', () => {
  it('builds a keyless Open-Meteo bulk URL with comma-joined coords', () => {
    const url = buildFieldUrl(
      [
        { lat: 10, lng: -100 },
        { lat: 12, lng: -99 },
      ],
      'temperature_2m',
    );
    expect(url).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=10,12&longitude=-100,-99' +
        '&hourly=temperature_2m&forecast_days=2&timezone=UTC',
    );
  });
});

describe('parseFieldResponse', () => {
  const pts = [
    { lat: 10, lng: -100 },
    { lat: 12, lng: -99 },
  ];
  const resp = [
    { hourly: { time: ['2026-05-19T00:00', '2026-05-19T01:00'], temperature_2m: [20, 21] } },
    { hourly: { time: ['2026-05-19T00:00', '2026-05-19T01:00'], temperature_2m: [18, 19] } },
  ];
  it('aligns each result to its input point by index', () => {
    const g = parseFieldResponse(resp, pts, 'temperature_2m');
    expect(g).not.toBeNull();
    expect(g!.times).toEqual(['2026-05-19T00:00', '2026-05-19T01:00']);
    expect(g!.points).toEqual([
      { lat: 10, lng: -100, values: [20, 21] },
      { lat: 12, lng: -99, values: [18, 19] },
    ]);
  });
  it('accepts a single-object response (Open-Meteo returns an object for one point)', () => {
    const g = parseFieldResponse(resp[0], [pts[0]], 'temperature_2m');
    expect(g!.points).toEqual([{ lat: 10, lng: -100, values: [20, 21] }]);
  });
  it('returns null for malformed input', () => {
    expect(parseFieldResponse(null, pts, 'temperature_2m')).toBeNull();
    expect(parseFieldResponse([{ hourly: {} }], [pts[0]], 'temperature_2m')).toBeNull();
  });
});

describe('fieldFrameIndex', () => {
  const times = ['2026-05-19T00:00', '2026-05-19T01:00', '2026-05-19T02:00'];
  it('picks the hourly step closest to the ISO', () => {
    expect(fieldFrameIndex(times, '2026-05-19T01:10:00Z', 0)).toBe(1);
  });
  it('falls back to the step nearest now when ISO is null/invalid', () => {
    const now = Date.parse('2026-05-19T02:00:00Z');
    expect(fieldFrameIndex(times, null, now)).toBe(2);
    expect(fieldFrameIndex(times, 'nope', now)).toBe(2);
  });
  it('returns -1 for an empty list', () => {
    expect(fieldFrameIndex([], null, 0)).toBe(-1);
  });
});

describe('tempColor', () => {
  it('maps cold→warm to distinct hex colors and clamps the ends', () => {
    expect(tempColor(-50)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tempColor(60)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tempColor(-50)).toBe(tempColor(-10)); // clamped at the cold end
    expect(tempColor(60)).toBe(tempColor(45)); // clamped at the warm end
    expect(tempColor(0)).not.toBe(tempColor(30)); // distinct across the ramp
  });
});

describe('TEMP_LEGEND', () => {
  it('is an ordered list of {label,color} stops with hex colors', () => {
    expect(TEMP_LEGEND.length).toBeGreaterThanOrEqual(4);
    for (const s of TEMP_LEGEND) {
      expect(typeof s.label).toBe('string');
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mapfields.test.ts`
Expected: FAIL — cannot resolve `./mapfields`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/mapfields.ts`:

```ts
// Pure, DOM-free Open-Meteo gridded-field helpers for /mapa field layers.

export interface LngLat {
  lat: number;
  lng: number;
}

export interface FieldGrid {
  /** ISO hourly timestamps (canonical, from the first result). */
  times: string[];
  /** One entry per input point, aligned by index; `values[h]` is the value at hour h. */
  points: { lat: number; lng: number; values: number[] }[];
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

/** Keyless Open-Meteo bulk forecast URL for the given points + hourly variable. */
export function buildFieldUrl(points: LngLat[], hourlyVar: string): string {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&hourly=${hourlyVar}&forecast_days=2&timezone=UTC`
  );
}

function isFiniteArray(a: unknown): a is number[] {
  return Array.isArray(a) && a.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Normalise an Open-Meteo response (array for many points, object for one) into a FieldGrid. */
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
  const out: FieldGrid['points'] = [];
  for (let i = 0; i < arr.length; i++) {
    const h = (arr[i] as { hourly?: Record<string, unknown> } | undefined)?.hourly;
    const values = h?.[hourlyVar];
    if (!isFiniteArray(values)) return null;
    out.push({ lat: points[i].lat, lng: points[i].lng, values });
  }
  return { times: times as string[], points: out };
}

/** Hourly index closest to `iso`; nearest to `nowMs` if iso null/invalid; -1 if empty. */
export function fieldFrameIndex(times: string[], iso: string | null, nowMs: number): number {
  if (times.length === 0) return -1;
  const ms = iso ? Date.parse(iso) : NaN;
  const target = Number.isFinite(ms) ? ms : nowMs;
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(Date.parse(times[i]) - target);
    if (d < bestDelta) {
      best = i;
      bestDelta = d;
    }
  }
  return best;
}

/** Temperature (°C) → hex colour on a clamped cold→warm ramp. */
export function tempColor(c: number): string {
  const stops: [number, string][] = [
    [-10, '#3b4cc0'],
    [0, '#5b8ff9'],
    [10, '#7dd1c8'],
    [18, '#7ad151'],
    [25, '#f9d423'],
    [32, '#f08a24'],
    [45, '#d7191c'],
  ];
  if (c <= stops[0][0]) return stops[0][1];
  if (c >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (c >= stops[i][0] && c < stops[i + 1][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

export const TEMP_LEGEND: LegendStop[] = [
  { label: '≤0°', color: '#5b8ff9' },
  { label: '10°', color: '#7dd1c8' },
  { label: '18°', color: '#7ad151' },
  { label: '25°', color: '#f9d423' },
  { label: '32°', color: '#f08a24' },
  { label: '≥45°', color: '#d7191c' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mapfields.test.ts`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mapfields.ts src/lib/mapfields.test.ts
git commit -m "feat(maps): pure Open-Meteo grid + temperature scale module with tests"
```

---

### Task 3: Register the `field` layer kind + `temperature` layer (TDD)

**Files:**
- Modify: `src/lib/maplayers.ts`
- Modify: `src/lib/maplayers.test.ts`

- [ ] **Step 1: Add the failing tests**

In `src/lib/maplayers.test.ts`, inside the existing `describe('layer registry', ...)` block (after its existing tests), add:

```ts
  it('registers a temperature field layer', () => {
    expect(LAYER_IDS).toEqual(['base', 'radar', 'satellite', 'temperature']);
    const temp = getLayer('temperature');
    expect(temp?.kind).toBe('field');
    expect(temp?.labelKey).toBe('map_layer_temperature');
    expect(temp?.defaultOpacity).toBeGreaterThan(0);
    expect(temp?.defaultOpacity).toBeLessThanOrEqual(1);
  });
```

Also update the existing Slice-3 enumeration test that asserts `LAYER_IDS`/`LAYERS` ids: change its expected arrays from `['base', 'radar', 'satellite']` to `['base', 'radar', 'satellite', 'temperature']` (this is a forced forward-update of an exact-enumeration snapshot, the same pattern used when radar/satellite were added — it is strictly stronger, not weakened). Do not weaken or delete any other assertion.

- [ ] **Step 2: Run tests to verify the new/updated ones fail**

Run: `npx vitest run src/lib/maplayers.test.ts`
Expected: FAIL — `temperature` not in `LAYER_IDS`/registry.

- [ ] **Step 3: Extend the registry**

In `src/lib/maplayers.ts`:

(a) Replace:
```ts
export type LayerId = 'base' | 'radar' | 'satellite';

export const LAYER_IDS = ['base', 'radar', 'satellite'] as const;
```
with:
```ts
export type LayerId = 'base' | 'radar' | 'satellite' | 'temperature';

export const LAYER_IDS = ['base', 'radar', 'satellite', 'temperature'] as const;
```

(b) In the `LayerDef` interface, replace:
```ts
  kind: 'base' | 'raster-tile';
```
with:
```ts
  kind: 'base' | 'raster-tile' | 'field';
```

(c) Replace the `LAYERS` array:
```ts
export const LAYERS: LayerDef[] = [
  { id: 'base', labelKey: 'map_layer_base', kind: 'base', defaultOpacity: 1 },
  { id: 'radar', labelKey: 'map_layer_radar', kind: 'raster-tile', defaultOpacity: 0.8 },
  { id: 'satellite', labelKey: 'map_layer_satellite', kind: 'raster-tile', defaultOpacity: 1 },
];
```
with:
```ts
export const LAYERS: LayerDef[] = [
  { id: 'base', labelKey: 'map_layer_base', kind: 'base', defaultOpacity: 1 },
  { id: 'radar', labelKey: 'map_layer_radar', kind: 'raster-tile', defaultOpacity: 0.8 },
  { id: 'satellite', labelKey: 'map_layer_satellite', kind: 'raster-tile', defaultOpacity: 1 },
  { id: 'temperature', labelKey: 'map_layer_temperature', kind: 'field', defaultOpacity: 0.75 },
];
```

- [ ] **Step 4: Run maplayers + maphash suites**

Run: `npx vitest run src/lib/maplayers.test.ts src/lib/maphash.test.ts`
Expected: PASS — new temperature test + updated enumeration pass; all other Slice-2/3/4 tests still pass; `maphash` auto-accepts `temperature` (validated against `LAYER_IDS`, no maphash change).

- [ ] **Step 5: Full suite + type-check**

Run: `npm test && npm run type-check`
Expected: PASS. The `LayerDef.kind` widening compiles everywhere; `mapa.astro`'s `getLayerDef(activeLayer)?.kind !== 'raster-tile'` opacity-wrap check still type-checks (it stays correct: `field` !== `raster-tile`, so the existing opacity wrapper hides for field until Task 4 wires field opacity).

- [ ] **Step 6: Commit**

```bash
git add src/lib/maplayers.ts src/lib/maplayers.test.ts
git commit -m "feat(maps): add 'field' layer kind and temperature layer to the registry"
```

---

### Task 4: `/mapa` — field rendering path (temperature heat overlay, timeline-driven, viewport-resampled)

**Files:**
- Modify: `src/pages/mapa.astro`

> UI/MapLibre wiring — untested by unit tests per repo convention; verified via `npm run type-check` + `npm run build`. READ the current `src/pages/mapa.astro` fully first; match anchors by content. This task adds a parallel `field` branch alongside the existing `raster-tile` path without changing radar/satellite behaviour. It reuses the Slice-4 timeline by treating the field's Open-Meteo hourly steps as the timeline frames.

- [ ] **Step 1: Imports**

In the `<script>`, immediately AFTER the existing `import { framesForLayer, defaultFrameIndex, clampIndex, frameOffsetMinutes, seekIndexForIso } from '../lib/maptimeline';` block, add:

```ts
    import {
      viewportGrid,
      buildFieldUrl,
      parseFieldResponse,
      fieldFrameIndex,
      tempColor,
      TEMP_LEGEND,
      type FieldGrid,
    } from '../lib/mapfields';
```

- [ ] **Step 2: Field state + GeoJSON source/layer ids**

Immediately AFTER the existing timeline-state block (the lines declaring `tlFrames`/`frameIndex`/`activeFrameIso`/`pendingSeekIso`), add:

```ts
    const FIELD_SOURCE = 'wx-field';
    const FIELD_LAYER = 'wx-field-layer';
    let fieldGrid: FieldGrid | null = null;
    let fieldResampleTimer = 0;

    function removeField(): void {
      if (map.getLayer(FIELD_LAYER)) map.removeLayer(FIELD_LAYER);
      if (map.getSource(FIELD_SOURCE)) map.removeSource(FIELD_SOURCE);
    }

    function fieldGeoJSON(hourIndex: number): GeoJSON.FeatureCollection {
      const feats: GeoJSON.Feature[] = [];
      if (fieldGrid) {
        for (const p of fieldGrid.points) {
          const v = p.values[hourIndex];
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          feats.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: { color: tempColor(v) },
          });
        }
      }
      return { type: 'FeatureCollection', features: feats };
    }

    function renderFieldFrame(hourIndex: number): void {
      const data = fieldGeoJSON(hourIndex);
      const existing = map.getSource(FIELD_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }
      map.addSource(FIELD_SOURCE, { type: 'geojson', data });
      map.addLayer({
        id: FIELD_LAYER,
        type: 'circle',
        source: FIELD_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 8, 40],
          'circle-color': ['get', 'color'],
          'circle-blur': 1,
          'circle-opacity': rvOpacity,
        },
      });
    }

    async function loadFieldGrid(layerId: string): Promise<boolean> {
      const b = map.getBounds();
      const grid = viewportGrid(
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        8,
        6,
      );
      try {
        const res = await deps.fetch(buildFieldUrl(grid, 'temperature_2m'));
        fieldGrid = parseFieldResponse(await res.json(), grid, 'temperature_2m');
      } catch {
        fieldGrid = null;
      }
      return !!fieldGrid && fieldGrid.points.length > 0;
    }
```

- [ ] **Step 3: A field-aware legend**

Replace the existing `renderLegend` function:

```ts
    function renderLegend(show: boolean): void {
      const el = document.getElementById('legend');
      if (!el) return;
      if (!show) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      el.innerHTML = RADAR_LEGEND.map(
        (s) =>
          `<li class="flex items-center gap-2"><span class="inline-block h-3 w-3 rounded-sm" style="background:${esc(
            s.color,
          )}"></span>${esc(t[s.labelKey as keyof typeof t])}</li>`,
      ).join('');
      el.classList.remove('hidden');
    }
```

with:

```ts
    function renderLegend(kind: 'radar' | 'temperature' | null): void {
      const el = document.getElementById('legend');
      if (!el) return;
      if (!kind) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      const rows =
        kind === 'radar'
          ? RADAR_LEGEND.map(
              (s) =>
                `<li class="flex items-center gap-2"><span class="inline-block h-3 w-3 rounded-sm" style="background:${esc(
                  s.color,
                )}"></span>${esc(t[s.labelKey as keyof typeof t])}</li>`,
            )
          : TEMP_LEGEND.map(
              (s) =>
                `<li class="flex items-center gap-2"><span class="inline-block h-3 w-3 rounded-sm" style="background:${esc(
                  s.color,
                )}"></span>${esc(s.label)}</li>`,
            );
      el.innerHTML = rows.join('');
      el.classList.remove('hidden');
    }
```

- [ ] **Step 4: Update `refreshLayerButtons` for the new legend signature + field opacity wrap**

Replace the existing `refreshLayerButtons` function body's last two statements:

```ts
      document
        .getElementById('opacitywrap')
        ?.classList.toggle('hidden', getLayerDef(activeLayer)?.kind !== 'raster-tile');
      renderLegend(activeLayer === 'radar');
```

with:

```ts
      const akind = getLayerDef(activeLayer)?.kind;
      document
        .getElementById('opacitywrap')
        ?.classList.toggle('hidden', akind !== 'raster-tile' && akind !== 'field');
      renderLegend(activeLayer === 'radar' ? 'radar' : akind === 'field' ? 'temperature' : null);
```

- [ ] **Step 5: Branch `applyFrame` for field layers**

Replace the existing `applyFrame` function:

```ts
    function applyFrame(i: number): void {
      const idx = clampIndex(i, tlFrames.length);
      if (idx < 0) return;
      frameIndex = idx;
      const fr = tlFrames[idx];
      showWeatherFrame(activeLayer, fr);
      activeFrameIso = new Date(fr.time * 1000).toISOString();
      if (tlRange) {
        tlRange.max = String(tlFrames.length - 1);
        tlRange.value = String(idx);
      }
      if (tlTime) tlTime.textContent = frameLabel(fr);
      syncHash();
    }
```

with:

```ts
    function applyFrame(i: number): void {
      const idx = clampIndex(i, tlFrames.length);
      if (idx < 0) return;
      frameIndex = idx;
      const fr = tlFrames[idx];
      if (getLayerDef(activeLayer)?.kind === 'field') {
        renderFieldFrame(idx);
      } else {
        showWeatherFrame(activeLayer, fr);
      }
      activeFrameIso = new Date(fr.time * 1000).toISOString();
      if (tlRange) {
        tlRange.max = String(tlFrames.length - 1);
        tlRange.value = String(idx);
      }
      if (tlTime) tlTime.textContent = frameLabel(fr);
      syncHash();
    }
```

- [ ] **Step 6: Branch `setActiveLayer` for `field` kind**

In `setActiveLayer`, find the raster-tile branch condition `if (def.kind === 'raster-tile') {`. Immediately BEFORE that `if`, insert a `field` branch:

```ts
      if (def.kind === 'field') {
        rvOpacity = def.defaultOpacity;
        if (opacityEl) opacityEl.value = String(Math.round(rvOpacity * 100));
        removeWeatherRaster();
        const ok = await loadFieldGrid(id);
        if (!ok || !fieldGrid) {
          showMsg(t.map_layer_unavailable);
          activeLayer = 'base';
          tlStop();
          removeField();
          tlFrames = [];
          frameIndex = -1;
          activeFrameIso = null;
          showTimeline(false);
          refreshLayerButtons();
          syncHash();
          return;
        }
        activeLayer = id;
        tlFrames = fieldGrid.times.map((iso) => ({ time: Math.floor(Date.parse(iso) / 1000), path: '' }));
        const now = Math.floor(Date.now() / 1000);
        const idx = seekIndexForIso(tlFrames, pendingSeekIso, now);
        pendingSeekIso = null;
        showTimeline(true);
        refreshLayerButtons();
        applyFrame(idx >= 0 ? idx : defaultFrameIndex(tlFrames, now));
        return;
      }
```

Then change the function signature from `function setActiveLayer(id: string): void {` to `async function setActiveLayer(id: string): Promise<void> {` (it now awaits `loadFieldGrid`). Find every call site of `setActiveLayer(` and prefix with `void ` if the result is unused (the existing callers — layer button click handler, the `map.on('load')` restore, and any failure-path recursion — must compile; wrap bare calls as `void setActiveLayer(...)`). Also, in the `field` failure branch above, `removeWeatherRaster()` is already called before the early return; ensure `removeField()` is also called (it is, in the block above).

Additionally, in the existing non-raster/base branch of `setActiveLayer` (the branch that runs for `base`), add `removeField();` immediately after the existing `removeWeatherRaster();` so switching to Base also tears down a field layer. And in the existing `raster-tile` branch's success path and failure path, add `removeField();` immediately after each existing `removeWeatherRaster();` call so switching radar/satellite tears down any field layer.

- [ ] **Step 7: Debounced viewport re-sample for the active field layer**

Find the existing `map.on('moveend', ...)` handler (the Slice-1 hash-sync debounce). Immediately AFTER that existing `map.on('moveend', ...)` block, add a second handler:

```ts
    map.on('moveend', () => {
      if (getLayerDef(activeLayer)?.kind !== 'field') return;
      window.clearTimeout(fieldResampleTimer);
      fieldResampleTimer = window.setTimeout(() => {
        void (async () => {
          const ok = await loadFieldGrid(activeLayer);
          if (ok) applyFrame(frameIndex >= 0 ? frameIndex : 0);
        })();
      }, 500);
    });
```

- [ ] **Step 8: Verify no broken references**

Run: `grep -n "setActiveLayer(" src/pages/mapa.astro`
Expected: every call is either `void setActiveLayer(` or `await setActiveLayer(` (no bare unawaited promise used as a value). Confirm the layer-button click handler uses `void setActiveLayer(def.id)` and the `map.on('load')` restore uses `void setActiveLayer(wanted)` (or `await`).

- [ ] **Step 9: Verify types compile**

Run: `npm run type-check`
Expected: PASS (exit 0). If `GeoJSON` namespace types are unresolved, import the type via `import type { FeatureCollection, Feature } from 'geojson';` at the top of the script and use `FeatureCollection`/`Feature` instead of the `GeoJSON.*` qualifiers (the `geojson` types ship transitively with `maplibre-gl`). Report if you make this adjustment.

- [ ] **Step 10: Verify the static build succeeds**

Run: `npm run build`
Expected: PASS — `dist/mapa/index.html` produced (pre-existing MapLibre chunk-size warning expected).

- [ ] **Step 11: Commit**

```bash
git add src/pages/mapa.astro
git commit -m "feat(maps): temperature field overlay — Open-Meteo grid, timeline-driven, viewport-resampled"
```

---

### Task 5: e2e for the temperature field layer

**Files:**
- Modify: `e2e/mapa.spec.ts`

- [ ] **Step 1: Add a mocked Open-Meteo bulk response + test**

In `e2e/mapa.spec.ts`, add this constant near the existing `RAINVIEWER_MANIFEST` const (top of file, after it):

```ts
/** Minimal Open-Meteo bulk response: 48 points (8x6 grid), 2 hourly steps. */
const OPEN_METEO_FIELD = JSON.stringify(
  Array.from({ length: 48 }, () => ({
    hourly: { time: ['2026-05-19T00:00', '2026-05-19T01:00'], temperature_2m: [22, 23] },
  })),
);
```

Inside the existing `test.describe('mapa page', ...)` block, after the timeline test, add:

```ts
  test('temperature field layer activates with a legend and timeline', async ({ page }) => {
    await page.route('**/api.rainviewer.com/public/weather-maps.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: RAINVIEWER_MANIFEST }),
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }),
    );
    await page.route('**/api.open-meteo.com/v1/forecast**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: OPEN_METEO_FIELD }),
    );

    await page.goto('mapa/');
    await page.waitForResponse('**/api.rainviewer.com/public/weather-maps.json');

    await page.locator('#layerbtn-temperature').click();
    await page.waitForResponse('**/api.open-meteo.com/v1/forecast**');

    // Field layer is active, legend + timeline + opacity are shown.
    await expect(page.locator('#layerbtn-temperature')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend')).toBeVisible();
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#opacitywrap')).toBeVisible();

    // Switching back to Base tears it down.
    await page.locator('#layerbtn-base').click();
    await expect(page.locator('#legend')).toBeHidden();
    await expect(page.locator('#timeline')).toBeHidden();
  });
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e -- mapa.spec.ts`
Expected: PASS — all tests (Slice-1 smoke, Slice-2 radar, Slice-3 satellite, Slice-4 timeline, new temperature), 0 skipped. If Playwright browsers are missing, run `npx playwright install chromium` first. Everything (RainViewer + tiles + Open-Meteo) is mocked, so this must pass deterministically; do NOT weaken assertions or skip without pasted evidence of a genuine environment block.

- [ ] **Step 3: Commit**

```bash
git add e2e/mapa.spec.ts
git commit -m "test(maps): deterministic e2e for the temperature field layer"
```

---

## Self-Review

- **Spec coverage (Slice 5a):** keyless Open-Meteo bulk grid sampling (Task 2 `viewportGrid`/`buildFieldUrl`/`parseFieldResponse`) ✓; temperature heat overlay coloured by value (Task 2 `tempColor`/`TEMP_LEGEND`; Task 4 GeoJSON circle layer) ✓; timeline-driven over Open-Meteo hourly steps (Task 4 adapts `fieldGrid.times` into the existing Slice-4 frame model, reusing scrubber/playback/seek) ✓; per-viewport re-sample on debounced move (Task 4 Step 7) ✓; one primary layer at a time, mutual teardown with radar/satellite/base (Task 4 Step 6 adds `removeField()` to every other branch and `removeWeatherRaster()` to the field branch) ✓; per-layer opacity (Task 3 `defaultOpacity` 0.75; Task 4 `circle-opacity`) ✓; field legend (Task 3 + Task 4 generalised `renderLegend`) ✓; shareable via hash (`LAYER_IDS` includes `temperature`; the field branch sets `activeFrameIso` and consumes `pendingSeekIso` once) ✓; non-blocking failure → `map_layer_unavailable` → base (Task 4 field failure branch) ✓; keyless, no secret ✓; Spanish-first i18n (Task 1) ✓; pure logic TDD, UI untested per convention (Task 2/3 vs 4) ✓; XSS-safe legend via `esc()` (Task 3) ✓. Slice 5b (humidity/pressure) and 5c (GL particle wind) are explicitly out of this sub-plan.
- **Placeholder scan:** none — all code/command steps are concrete; the only conditional (Task 4 Step 9 `geojson` type import; Task 5 Step 2 evidence-gated) is explicit and bounded.
- **Type consistency:** `viewportGrid`/`buildFieldUrl`/`parseFieldResponse`/`fieldFrameIndex`/`tempColor`/`TEMP_LEGEND`/`FieldGrid`/`LngLat`/`Bounds`/`LegendStop` defined in Task 2 and consumed with identical names in Tasks 3–4; `LayerId`/`LAYER_IDS`/`LayerDef.kind`/`LAYERS` widened consistently in Task 3 and read in Task 4 via the existing `getLayerDef` alias; `renderLegend` signature change (Task 3→`'radar'|'temperature'|null`) updated at its only caller `refreshLayerButtons` (Task 4 Step 4); `setActiveLayer` becomes `async`/`Promise<void>` (Task 4 Step 6) with all call sites `void`/`await`-adjusted (Task 4 Step 8 grep); `tlFrames` stays `RadarFrame[]` and the field branch adapts hourly ISO → `{time, path:''}` so Slice-4 `applyFrame`/`seekIndexForIso`/`frameLabel` are reused unchanged for the time axis (only the render branch differs); `FIELD_SOURCE`/`FIELD_LAYER`/`fieldGrid`/`fieldResampleTimer`/`removeField`/`renderFieldFrame`/`loadFieldGrid`/`fieldGeoJSON` defined once (Task 4) and used consistently.
- **Scope note:** This sub-plan is independently shippable (a working temperature field layer end-to-end). 5b reuses Tasks 2–4 infra (add humidity/pressure variables + scales + registry entries + a per-layer Open-Meteo variable map). 5c replaces only the field render branch for `wind` with a MapLibre `custom` WebGL particle layer reading the same grid — isolated from this sub-plan's circle renderer.
