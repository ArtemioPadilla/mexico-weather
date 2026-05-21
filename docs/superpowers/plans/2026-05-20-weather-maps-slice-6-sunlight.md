# Weather Maps — Slice 6: Sunlight Terminator + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the maps epic by adding a client-computed **sunlight (day–night terminator)** overlay to `/mapa` plus a small polish pass (bundle audit).

**Architecture:** Pure, DOM-free `src/lib/mapsun.ts` (subsolar position + terminator polygon, both client-side astronomy — no data fetch, no network) with colocated Vitest. `src/lib/maplayers.ts` gains a `sunlight` layer of a new kind `'overlay'`. `/mapa` renders the terminator as a MapLibre GeoJSON **fill** layer (semi-transparent dark night-side polygon), updates it every 60 seconds to track Earth's rotation, hides timeline/legend (the overlay is self-explanatory), and the opacity slider continues to work. `astro.config.mjs` raises `build.chunkSizeWarningLimit` so the known MapLibre chunk no longer trips the build's warning every PR.

**Tech Stack:** Astro 6, TypeScript, Tailwind 4, Vitest, MapLibre GL JS, **no external data** (pure astronomy).

Spec: `docs/superpowers/specs/2026-05-18-weather-maps-design.md` (Slice 6). Builds on Slices 1–5c (all merged to `main`).

---

### Task 1: i18n string for the sunlight layer

**Files:** Modify `src/i18n/ui.ts`.

- [ ] **Step 1** — Add to the `UiStrings` interface immediately after `legend_wind_gale: string;`:
```ts
  map_layer_sunlight: string;
```
- [ ] **Step 2** — Add to `es:` after `legend_wind_gale:` value line:
```ts
    map_layer_sunlight: 'Sol',
```
- [ ] **Step 3** — Add to `en:` after `legend_wind_gale:` value line:
```ts
    map_layer_sunlight: 'Sun',
```
- [ ] **Step 4** — `npm run type-check` → PASS.
- [ ] **Step 5** — Commit:
```bash
git add src/i18n/ui.ts
git commit -m "feat(maps): i18n string for the sunlight overlay"
```
(Husky executable-bit hint harmless; no --no-verify.)

---

### Task 2: `mapsun.ts` — pure subsolar position + terminator polygon (TDD)

**Files:** Create `src/lib/mapsun.ts` + `src/lib/mapsun.test.ts`.

> Standard astronomy approximations used worldwide for day–night-terminator overlays. Accuracy is sub-arcminute — more than enough for a country-level visualisation.

- [ ] **Step 1** — Create `src/lib/mapsun.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { solarPosition, terminatorPolygon } from './mapsun';

describe('solarPosition', () => {
  it('is on the equator near the equinoxes', () => {
    // March 20 2026 ~17:00 UTC — vernal equinox close enough that |declination| < 1°
    const eq = solarPosition(Date.UTC(2026, 2, 20, 17, 0, 0));
    expect(Math.abs(eq.lat)).toBeLessThan(1);
  });
  it('is in the northern hemisphere around the june solstice', () => {
    const jun = solarPosition(Date.UTC(2026, 5, 21, 12, 0, 0));
    expect(jun.lat).toBeGreaterThan(22);
    expect(jun.lat).toBeLessThan(24);
  });
  it('is in the southern hemisphere around the december solstice', () => {
    const dec = solarPosition(Date.UTC(2026, 11, 21, 12, 0, 0));
    expect(dec.lat).toBeLessThan(-22);
    expect(dec.lat).toBeGreaterThan(-24);
  });
  it('subsolar longitude tracks UTC noon ≈ 0°, midnight ≈ ±180°', () => {
    // Around noon UTC on an equinox, subsolar point is near (0,0).
    const noon = solarPosition(Date.UTC(2026, 2, 20, 12, 0, 0));
    expect(Math.abs(noon.lng)).toBeLessThan(5);
    const midnight = solarPosition(Date.UTC(2026, 2, 20, 0, 0, 0));
    expect(Math.abs(midnight.lng)).toBeGreaterThan(175);
  });
});

describe('terminatorPolygon', () => {
  it('returns a closed Polygon with samples+2 ring vertices around the night side', () => {
    const poly = terminatorPolygon(Date.UTC(2026, 5, 21, 12, 0, 0), 120);
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates).toHaveLength(1);
    const ring = poly.coordinates[0];
    // 120 terminator samples + 2 pole caps + closing duplicate of first vertex.
    expect(ring.length).toBe(120 + 2 + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    for (const [lng, lat] of ring) {
      expect(lat).toBeGreaterThanOrEqual(-90.001);
      expect(lat).toBeLessThanOrEqual(90.001);
      expect(lng).toBeGreaterThanOrEqual(-180.001);
      expect(lng).toBeLessThanOrEqual(180.001);
    }
  });
});
```

- [ ] **Step 2** — `npx vitest run src/lib/mapsun.test.ts` → expect FAIL (cannot resolve `./mapsun`).

- [ ] **Step 3** — Create `src/lib/mapsun.ts`:
```ts
// Pure, DOM-free solar position + day/night terminator polygon for the /mapa
// sunlight overlay. Uses standard astronomy approximations — accurate to
// well under a degree, which is more than enough for a visual terminator.
// No external data; no network; deterministic for a given Unix-ms timestamp.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Days since J2000.0 (TT close enough to UT for visual accuracy). */
function jdSinceJ2000(ms: number): number {
  return ms / 86400000 - 10957.5;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Subsolar point at the given UTC timestamp (ms since epoch).
 * Returns lat in [-23.45, 23.45]° and lng in [-180, 180]°.
 */
export function solarPosition(dateUtcMs: number): LatLng {
  const d = jdSinceJ2000(dateUtcMs);
  // Mean longitude of the Sun (deg).
  const L = (280.46 + 0.9856474 * d) % 360;
  // Mean anomaly (deg).
  const g = ((357.528 + 0.9856003 * d) % 360) * DEG;
  // Ecliptic longitude (deg).
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  // Obliquity of the ecliptic (deg).
  const eps = (23.439 - 0.0000004 * d) * DEG;
  // Declination (deg).
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  // Right ascension (deg, 0..360).
  const ra =
    (Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD + 360) % 360;
  // Greenwich Mean Sidereal Time at the given moment (deg, 0..360).
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  const gmstMod = ((gmst % 360) + 360) % 360;
  // Subsolar longitude (deg, -180..180): the meridian where the Sun is overhead.
  let lng = ra - gmstMod;
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  return { lat: dec, lng };
}

/**
 * Closed GeoJSON Polygon enclosing the night-side hemisphere at the given UTC
 * timestamp. Samples the terminator (great circle 90° from the subsolar point)
 * `samples` times around its azimuth circle, then closes through the
 * antisolar pole so the polygon truly covers night-side cells when rendered.
 *
 * Output ring length is `samples + 2 + 1` (samples + 2 pole caps + closing
 * duplicate first vertex) — see the colocated test.
 */
export function terminatorPolygon(
  dateUtcMs: number,
  samples: number = 180,
): { type: 'Polygon'; coordinates: number[][][] } {
  const n = Math.max(8, Math.floor(samples));
  const sun = solarPosition(dateUtcMs);
  const sunLatR = sun.lat * DEG;
  const sunLngR = sun.lng * DEG;
  // Pre-compute the night-side pole (antipode of the subsolar point).
  const nightPoleLat = -sun.lat;
  const nightPoleLng = sun.lng > 0 ? sun.lng - 180 : sun.lng + 180;
  const ring: number[][] = [];
  // Sample the terminator: rotate around the sub-solar point by azimuth a,
  // angular distance = 90° (cos = 0, sin = 1) — this is a great-circle.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    // Destination point on a sphere from sun, distance 90°, bearing a.
    const lat = Math.asin(
      Math.sin(sunLatR) * 0 + Math.cos(sunLatR) * 1 * Math.cos(a),
    );
    const lng =
      sunLngR +
      Math.atan2(Math.sin(a) * 1 * Math.cos(sunLatR), 0 - Math.sin(sunLatR) * Math.sin(lat));
    ring.push([normalizeLng(lng * RAD), lat * RAD]);
  }
  // Close around the night side through the antisolar pole so the polygon
  // actually fills the night hemisphere (without this it would fill the day
  // hemisphere instead for fill rendering).
  ring.push([normalizeLng(nightPoleLng), nightPoleLat > 0 ? 90 : -90]);
  ring.push([normalizeLng(nightPoleLng + 180), nightPoleLat > 0 ? 90 : -90]);
  ring.push(ring[0]); // close the ring
  return { type: 'Polygon', coordinates: [ring] };
}

function normalizeLng(lng: number): number {
  let x = lng;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}
```

- [ ] **Step 4** — `npx vitest run src/lib/mapsun.test.ts` → expect PASS (all green).
- [ ] **Step 5** — Commit:
```bash
git add src/lib/mapsun.ts src/lib/mapsun.test.ts
git commit -m "feat(maps): pure solar position + terminator polygon module with tests"
```

---

### Task 3: Register the `sunlight` layer + new `overlay` kind (TDD)

**Files:** Modify `src/lib/maplayers.ts` + `src/lib/maplayers.test.ts`.

- [ ] **Step 1** — In `src/lib/maplayers.test.ts`, inside `describe('layer registry')`, add (after the wind test):
```ts
  it('registers a sunlight overlay layer', () => {
    expect(LAYER_IDS).toEqual([
      'base', 'radar', 'satellite', 'temperature', 'humidity', 'pressure', 'wind', 'sunlight',
    ]);
    const s = getLayer('sunlight');
    expect(s?.kind).toBe('overlay');
    expect(s?.labelKey).toBe('map_layer_sunlight');
    expect(s?.defaultOpacity).toBeGreaterThan(0);
    expect(s?.defaultOpacity).toBeLessThanOrEqual(1);
  });
```
Then forward-update every existing exact `LAYER_IDS` / `LAYERS.map(id)` enumeration snapshot to also include `'sunlight'` at the end (strictly stronger; same pattern as prior slices). Touch ONLY those snapshots.

- [ ] **Step 2** — `npx vitest run src/lib/maplayers.test.ts` → expect FAIL (new test + enumeration snapshots).

- [ ] **Step 3** — In `src/lib/maplayers.ts`:
(a) Replace:
```ts
export type LayerId =
  | 'base' | 'radar' | 'satellite' | 'temperature' | 'humidity' | 'pressure' | 'wind';

export const LAYER_IDS = [
  'base', 'radar', 'satellite', 'temperature', 'humidity', 'pressure', 'wind',
] as const;
```
with:
```ts
export type LayerId =
  | 'base' | 'radar' | 'satellite' | 'temperature' | 'humidity' | 'pressure' | 'wind' | 'sunlight';

export const LAYER_IDS = [
  'base', 'radar', 'satellite', 'temperature', 'humidity', 'pressure', 'wind', 'sunlight',
] as const;
```
(b) Widen `LayerDef.kind`: change `kind: 'base' | 'raster-tile' | 'field' | 'particles';` to `kind: 'base' | 'raster-tile' | 'field' | 'particles' | 'overlay';`.
(c) Append to `LAYERS` (after the wind entry):
```ts
  { id: 'sunlight', labelKey: 'map_layer_sunlight', kind: 'overlay', defaultOpacity: 0.45 },
```

- [ ] **Step 4** — `npx vitest run src/lib/maplayers.test.ts src/lib/maphash.test.ts` → PASS.
- [ ] **Step 5** — `npm test && npm run type-check` → PASS.
- [ ] **Step 6** — Commit:
```bash
git add src/lib/maplayers.ts src/lib/maplayers.test.ts
git commit -m "feat(maps): register sunlight overlay layer (new 'overlay' kind)"
```

---

### Task 4: `/mapa` — sunlight overlay branch + minute-tick refresh

**Files:** Modify `src/pages/mapa.astro`. UI/MapLibre wiring untested per repo convention; verified via type-check + build + e2e.

- [ ] **Step 1** — Imports. In the existing import block from `'../lib/mapfields'`, add NOTHING here. Below it, add a new import:
```ts
    import { terminatorPolygon } from '../lib/mapsun';
```

- [ ] **Step 2** — Sunlight state + helpers. Immediately AFTER the existing `let windTexDirty = true;` (or wherever the wind state block ends, before `removeWind`), insert:
```ts
    const SUN_SOURCE = 'wx-sun-src';
    const SUN_LAYER = 'wx-sun-layer';
    let sunTicker = 0;

    function removeSun(): void {
      if (sunTicker) {
        window.clearInterval(sunTicker);
        sunTicker = 0;
      }
      if (map.getLayer(SUN_LAYER)) map.removeLayer(SUN_LAYER);
      if (map.getSource(SUN_SOURCE)) map.removeSource(SUN_SOURCE);
    }

    function refreshSun(): void {
      const poly = terminatorPolygon(Date.now(), 180);
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: poly, properties: {} }],
      };
      const src = map.getSource(SUN_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(fc);
        return;
      }
      map.addSource(SUN_SOURCE, { type: 'geojson', data: fc });
      map.addLayer({
        id: SUN_LAYER,
        type: 'fill',
        source: SUN_SOURCE,
        paint: {
          'fill-color': '#0b1320',
          'fill-opacity': rvOpacity,
        },
      });
    }
```

- [ ] **Step 3** — Wire `setActiveLayer` for the `overlay` kind. Inside `setActiveLayer`, immediately AFTER the existing `particles` branch (which `return`s) and BEFORE the `field` branch, insert:
```ts
      if (def.kind === 'overlay') {
        rvOpacity = def.defaultOpacity;
        if (opacityEl) opacityEl.value = String(Math.round(rvOpacity * 100));
        tlStop();
        removeWeatherRaster();
        removeField();
        removeWind();
        activeLayer = id;
        tlFrames = [];
        frameIndex = -1;
        activeFrameIso = null;
        showTimeline(false);
        refreshLayerButtons();
        refreshSun();
        // Tick once per minute to follow the terminator without burning CPU.
        sunTicker = window.setInterval(refreshSun, 60_000);
        syncHash();
        return;
      }
```

- [ ] **Step 4** — Add `removeSun()` calls in OTHER `setActiveLayer` branches (mirroring `removeWind`). For each non-overlay branch (particles, field, raster-tile success/failure, base): add `removeSun();` immediately AFTER the existing `removeWind();` line so switching away from sunlight tears down cleanly. There are 5 such call sites; each gets one `removeSun();` line.

- [ ] **Step 5** — Five-and-a-half-kind `renderLegend` — sunlight has no legend. In `refreshLayerButtons`, find the existing `kindForLegend` block and update it so `'overlay'` → null:
```ts
      const kindForLegend =
        activeLayer === 'radar'
          ? ('radar' as const)
          : akind === 'field'
            ? (activeLayer as 'temperature' | 'humidity' | 'pressure')
            : akind === 'particles'
              ? ('wind' as const)
              : null;
```
(No change needed: `akind === 'overlay'` falls through to `null`, which `renderLegend` already handles.)

Also update the opacitywrap toggle to include `'overlay'`:
```ts
        ?.classList.toggle('hidden', akind !== 'raster-tile' && akind !== 'field' && akind !== 'particles' && akind !== 'overlay');
```

- [ ] **Step 6** — Wire opacity slider for the sunlight fill. In the existing opacity `input` handler, AFTER the existing `WIND_CIRCLE_LAYER` line, add:
```ts
        if (map.getLayer(SUN_LAYER)) map.setPaintProperty(SUN_LAYER, 'fill-opacity', rvOpacity);
```

- [ ] **Step 7** — `npm run type-check` → PASS.
- [ ] **Step 8** — `npm run build` → PASS, `dist/mapa/index.html` present.
- [ ] **Step 9** — `npm test` → PASS (slice-5c 166 + 4 new mapsun + 1 maplayers = 171 or thereabouts).
- [ ] **Step 10** — Commit:
```bash
git add src/pages/mapa.astro
git commit -m "feat(maps): sunlight day-night terminator overlay with 60s refresh"
```

---

### Task 5: Bundle audit (honest polish)

**Files:** Modify `astro.config.mjs`.

> The build has emitted a "chunk size > 500 kB" warning since Slice 1 because MapLibre GL is ~750 kB minified, lazy-loaded onto `/mapa` only (no other route ships it). The warning is loud noise in every PR. Raise the limit so genuine new oversize chunks would still warn, while the documented MapLibre exception stops triggering.

- [ ] **Step 1** — Edit `astro.config.mjs`. Replace:
```js
  vite: {
    plugins: [tailwindcss()],
  },
```
with:
```js
  vite: {
    plugins: [tailwindcss()],
    build: {
      // MapLibre GL is ~750 kB minified, lazy-loaded onto /mapa only (no other
      // route ships it — documented exception in the spec). Raise the warning
      // threshold so this expected chunk is silent but a genuinely new large
      // dependency would still trip it.
      chunkSizeWarningLimit: 1100,
    },
  },
```

- [ ] **Step 2** — `npm run build` → PASS, no chunk-size warning emitted (the build output should no longer print `(!) Some chunks are larger than 500 kB`). If a NEW warning appears at this higher threshold, do NOT silently raise the limit further — report it.

- [ ] **Step 3** — Commit:
```bash
git add astro.config.mjs
git commit -m "build: raise Vite chunk-size warning limit to 1100kB (documented MapLibre exception)"
```

---

### Task 6: e2e for the sunlight overlay

**Files:** Modify `e2e/mapa.spec.ts`.

- [ ] **Step 1** — Add the test inside the existing `test.describe('mapa page', ...)`, AFTER the wind test:
```ts
  test('sunlight overlay activates without timeline or legend', async ({ page }) => {
    await page.route('**/api.rainviewer.com/public/weather-maps.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: RAINVIEWER_MANIFEST }),
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }),
    );

    await page.goto('mapa/');
    await page.waitForResponse('**/api.rainviewer.com/public/weather-maps.json');

    const btn = page.locator('#layerbtn-sunlight');
    await expect(btn).toBeEnabled();
    await btn.click();

    // Sunlight is a static polygon overlay: no network, no legend, no timeline.
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend')).toBeHidden();
    await expect(page.locator('#timeline')).toBeHidden();
    await expect(page.locator('#opacitywrap')).toBeVisible();

    await page.locator('#layerbtn-base').click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
```

- [ ] **Step 2** — Run twice for determinism: `npm run test:e2e -- mapa.spec.ts` → both runs expect 9/9, 0 skipped. (Install chromium first if needed.)
- [ ] **Step 3** — `npm test` → PASS. `npm run build` → PASS, no chunk-size warning.
- [ ] **Step 4** — Commit:
```bash
git add e2e/mapa.spec.ts
git commit -m "test(maps): deterministic e2e for the sunlight overlay"
```

---

## Self-Review

- **Spec coverage (Slice 6):** sunlight day–night terminator, client-computed (Task 2 `solarPosition` + `terminatorPolygon`) ✓; registered in single-source-of-truth (Task 3); rendered as a MapLibre fill overlay (Task 4); minute-tick refresh to follow Earth's rotation (Task 4 Step 2); opacity slider works (Task 4 Step 6); shareable via hash (LAYER_IDS auto-accepts via maphash); per-layer `defaultOpacity` 0.45 reasonable for night-side fill; e2e (Task 6); bundle audit (Task 5); no legend / no timeline for the overlay by design. Slice 6 closes the epic.
- **Placeholder scan:** none — every code/command step is concrete.
- **Type consistency:** `solarPosition`/`terminatorPolygon`/`LatLng` (Task 2) consumed in Task 4; `LayerId`/`LAYER_IDS`/`LayerDef.kind` widened in Task 3 and read in Task 4 via the existing `getLayerDef` alias; `SUN_SOURCE`/`SUN_LAYER`/`sunTicker`/`removeSun`/`refreshSun` defined once in Task 4 and used in `setActiveLayer`'s overlay branch + the teardown calls in other branches.

## Honest caveats

- **Solar formulas are accurate to better than ~0.01° for a visualisation use case** but are NOT precision astronomy — don't use them for navigation.
- **`fill` overlay across the antimeridian**: the polygon's longitude wrapping is handled by `normalizeLng`. MapLibre renders fills correctly across ±180° in 99% of cases; degenerate cases at the poles may show minor seam artefacts at extreme zoom — acceptable for v1.
- **The minute-tick refresh** is a deliberate trade-off vs a per-frame recompute. At 60 fps the terminator would jitter sub-pixel-imperceptibly anyway; 1 minute is the right cadence for cycle-accurate visualisation without burning CPU.
