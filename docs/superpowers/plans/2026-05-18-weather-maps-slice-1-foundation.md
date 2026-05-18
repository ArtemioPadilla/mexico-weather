# Weather Maps — Slice 1: Map Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated `/mapa` page with a MapLibre GL basemap, location pins (preset cities + searched/geolocated point), pin popups deep-linking to `/forecast`, a shareable URL hash, a home-page teaser, and a nav link.

**Architecture:** New Astro page `src/pages/mapa.astro` whose bundled `<script>` statically imports MapLibre GL (page-scoped by Astro, so no other route ships it). Two pure, unit-tested modules — `src/lib/maphash.ts` (URL-hash encode/decode/validate) and `src/lib/mappins.ts` (pin-list assembly) — hold all testable logic; MapLibre DOM wiring is untested per repo convention. Reuses the existing `geocode()` SDK and `City` data.

**Tech Stack:** Astro 6, TypeScript, Tailwind 4, Vitest, MapLibre GL JS (new, page-scoped runtime dep), browser Geolocation, Open-Meteo geocoding (existing SDK).

Spec: `docs/superpowers/specs/2026-05-18-weather-maps-design.md`

---

### Task 1: Add MapLibre dependency and i18n strings

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/i18n/ui.ts`

- [ ] **Step 1: Add the runtime dependency**

Run:
```bash
npm install maplibre-gl@^4.7.1
```
Expected: `package.json` `dependencies` gains `"maplibre-gl": "^4.7.1"`, `package-lock.json` updated, exit 0.

- [ ] **Step 2: Extend the i18n string interface**

In `src/i18n/ui.ts`, add these fields to the `UiStrings` interface (after `load_error: string;`):

```ts
  map_title: string;
  map_nav: string;
  map_teaser_heading: string;
  map_teaser_cta: string;
  map_layer_base: string;
  map_search_placeholder: string;
  map_locate: string;
  map_popup_full_forecast: string;
  map_layer_unavailable: string;
```

- [ ] **Step 3: Add the Spanish strings**

In `src/i18n/ui.ts`, inside the `es:` object, add after its `load_error` value:

```ts
    map_title: 'Mapa del tiempo',
    map_nav: 'Mapa',
    map_teaser_heading: 'Mapa interactivo del tiempo',
    map_teaser_cta: 'Ver mapa interactivo',
    map_layer_base: 'Mapa base',
    map_search_placeholder: 'Buscar un lugar en el mapa…',
    map_locate: 'Mi ubicación',
    map_popup_full_forecast: 'Ver pronóstico completo',
    map_layer_unavailable: 'Capa no disponible',
```

- [ ] **Step 4: Add the English strings**

In `src/i18n/ui.ts`, inside the `en:` object, add the parallel entries after its `load_error` value:

```ts
    map_title: 'Weather map',
    map_nav: 'Map',
    map_teaser_heading: 'Interactive weather map',
    map_teaser_cta: 'Open interactive map',
    map_layer_base: 'Base map',
    map_search_placeholder: 'Search a place on the map…',
    map_locate: 'My location',
    map_popup_full_forecast: 'See full forecast',
    map_layer_unavailable: 'Layer unavailable',
```

- [ ] **Step 5: Verify types still compile**

Run: `npm run type-check`
Expected: PASS (exit 0, no errors).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/i18n/ui.ts
git commit -m "feat(maps): add maplibre-gl dep and map i18n strings"
```

---

### Task 2: `maphash.ts` — shareable URL-hash state (TDD)

**Files:**
- Create: `src/lib/maphash.ts`
- Test: `src/lib/maphash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maphash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMapHash, buildMapHash, DEFAULT_VIEW } from './maphash';

describe('parseMapHash', () => {
  it('returns DEFAULT_VIEW for empty/garbage input', () => {
    expect(parseMapHash('')).toEqual(DEFAULT_VIEW);
    expect(parseMapHash('#nonsense')).toEqual(DEFAULT_VIEW);
  });

  it('parses a full valid hash', () => {
    const s = parseMapHash('#view=19.43,-99.13,6.5z&layer=base&t=2026-05-18T00:00:00Z');
    expect(s).toEqual({
      lat: 19.43,
      lng: -99.13,
      zoom: 6.5,
      layer: 'base',
      t: '2026-05-18T00:00:00Z',
    });
  });

  it('tolerates a missing leading # and missing t', () => {
    expect(parseMapHash('view=0,0,3z&layer=base')).toEqual({
      lat: 0,
      lng: 0,
      zoom: 3,
      layer: 'base',
      t: null,
    });
  });

  it('falls back to default view on out-of-range coords or zoom', () => {
    expect(parseMapHash('#view=200,0,3z&layer=base')).toEqual(DEFAULT_VIEW);
    expect(parseMapHash('#view=0,0,99z&layer=base')).toEqual(DEFAULT_VIEW);
  });

  it('falls back to base for an unknown layer id', () => {
    expect(parseMapHash('#view=0,0,3z&layer=bogus').layer).toBe('base');
  });
});

describe('buildMapHash', () => {
  it('round-trips through parseMapHash', () => {
    const state = { lat: 25.67, lng: -100.31, zoom: 7.25, layer: 'base', t: null };
    expect(parseMapHash(buildMapHash(state))).toEqual(state);
  });

  it('rounds coordinates to 4 dp and zoom to 2 dp', () => {
    expect(buildMapHash({ lat: 1.234567, lng: -2.345678, zoom: 3.14159, layer: 'base', t: null }))
      .toBe('#view=1.2346,-2.3457,3.14z&layer=base');
  });

  it('includes t when present', () => {
    expect(
      buildMapHash({ lat: 0, lng: 0, zoom: 3, layer: 'base', t: '2026-05-18T00:00:00Z' }),
    ).toBe('#view=0,0,3z&layer=base&t=2026-05-18T00:00:00Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/maphash.test.ts`
Expected: FAIL — cannot resolve `./maphash`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/maphash.ts`:

```ts
// Pure, DOM-free encode/decode + validation for the /mapa shareable URL hash.
// Format: #view=<lat>,<lng>,<zoom>z&layer=<id>[&t=<ISO>]

export interface MapHashState {
  lat: number;
  lng: number;
  zoom: number;
  layer: string;
  t: string | null;
}

/** Layer ids valid in Slice 1. Extended in later slices. */
export const KNOWN_LAYERS = ['base'] as const;

/** Default view: centred on Mexico, country-level zoom. */
export const DEFAULT_VIEW: MapHashState = {
  lat: 23.6,
  lng: -102.5,
  zoom: 4.5,
  layer: 'base',
  t: null,
};

function inRange(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

export function parseMapHash(hash: string): MapHashState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const view = params.get('view');
  if (!view) return { ...DEFAULT_VIEW };

  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)z$/.exec(view);
  if (!m) return { ...DEFAULT_VIEW };

  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const zoom = Number(m[3]);
  if (!inRange(lat, -90, 90) || !inRange(lng, -180, 180) || !inRange(zoom, 0, 22)) {
    return { ...DEFAULT_VIEW };
  }

  const rawLayer = params.get('layer') ?? 'base';
  const layer = (KNOWN_LAYERS as readonly string[]).includes(rawLayer) ? rawLayer : 'base';

  const t = params.get('t');
  return { lat, lng, zoom, layer, t: t && t.length > 0 ? t : null };
}

export function buildMapHash(state: MapHashState): string {
  const lat = Number(state.lat.toFixed(4));
  const lng = Number(state.lng.toFixed(4));
  const zoom = Number(state.zoom.toFixed(2));
  let s = `#view=${lat},${lng},${zoom}z&layer=${state.layer}`;
  if (state.t) s += `&t=${state.t}`;
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/maphash.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/maphash.ts src/lib/maphash.test.ts
git commit -m "feat(maps): shareable URL-hash state module with tests"
```

---

### Task 3: `mappins.ts` — pin-list assembly (TDD)

**Files:**
- Create: `src/lib/mappins.ts`
- Test: `src/lib/mappins.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mappins.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { presetPins, withUserPin } from './mappins';
import type { City } from '../data/cities';

const sample: City[] = [
  { name: 'Ciudad de México', emoji: '🌆', lat: 19.43, lng: -99.13, tz: 'America/Mexico_City' },
  { name: 'Monterrey', emoji: '🏙️', lat: 25.67, lng: -100.31, tz: 'America/Mexico_City' },
];

describe('presetPins', () => {
  it('maps cities to preset pins with stable ids', () => {
    const pins = presetPins(sample);
    expect(pins).toEqual([
      { id: 'preset-0', name: 'Ciudad de México', lat: 19.43, lng: -99.13, kind: 'preset', emoji: '🌆' },
      { id: 'preset-1', name: 'Monterrey', lat: 25.67, lng: -100.31, kind: 'preset', emoji: '🏙️' },
    ]);
  });
});

describe('withUserPin', () => {
  it('returns presets unchanged when user is null', () => {
    const presets = presetPins(sample);
    expect(withUserPin(presets, null)).toEqual(presets);
  });

  it('appends a single user pin', () => {
    const presets = presetPins(sample);
    const out = withUserPin(presets, { name: 'Oaxaca', lat: 17.07, lng: -96.72, kind: 'search' });
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ id: 'user', name: 'Oaxaca', lat: 17.07, lng: -96.72, kind: 'search' });
  });

  it('replaces a previous user pin (only one at a time)', () => {
    const presets = presetPins(sample);
    const once = withUserPin(presets, { name: 'A', lat: 1, lng: 2, kind: 'search' });
    const twice = withUserPin(once, { name: 'B', lat: 3, lng: 4, kind: 'geo' });
    expect(twice).toHaveLength(3);
    expect(twice[2]).toEqual({ id: 'user', name: 'B', lat: 3, lng: 4, kind: 'geo' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mappins.test.ts`
Expected: FAIL — cannot resolve `./mappins`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/mappins.ts`:

```ts
// Pure, DOM-free assembly of the /mapa pin list:
// preset cities + at most one user (search/geo) pin.
import type { City } from '../data/cities';

export type PinKind = 'preset' | 'search' | 'geo';

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: PinKind;
  emoji?: string;
}

export function presetPins(cities: City[]): MapPin[] {
  return cities.map((c, i) => ({
    id: `preset-${i}`,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    kind: 'preset' as const,
    emoji: c.emoji,
  }));
}

export function withUserPin(
  pins: MapPin[],
  user: { name: string; lat: number; lng: number; kind: 'search' | 'geo' } | null,
): MapPin[] {
  const presets = pins.filter((p) => p.kind === 'preset');
  if (!user) return presets;
  return [...presets, { id: 'user', name: user.name, lat: user.lat, lng: user.lng, kind: user.kind }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mappins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mappins.ts src/lib/mappins.test.ts
git commit -m "feat(maps): pin-list assembly module with tests"
```

---

### Task 4: `/mapa` page — MapLibre basemap, pins, popups, search, geolocation, hash sync

**Files:**
- Create: `src/pages/mapa.astro`

> UI/DOM wiring — untested by unit tests per repo convention; verified via `npm run build` + `npm run type-check`.

- [ ] **Step 1: Create the page**

Create `src/pages/mapa.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { ui } from '../i18n/ui';

const lang = 'es' as const;
const t = ui[lang];
---

<BaseLayout title={`${t.map_title} — Clima México 🇲🇽`} description={t.map_teaser_heading} lang={lang}>
  <main class="relative h-[100dvh] w-full bg-gray-100 dark:bg-gray-950">
    <a
      href={import.meta.env.BASE_URL}
      class="absolute left-3 top-3 z-10 rounded-lg bg-white/90 px-3 py-1.5 text-sm text-blue-600 shadow hover:underline dark:bg-gray-900/90 dark:text-blue-400"
      >← {t.back_home}</a
    >
    <div class="absolute right-3 top-3 z-10 flex gap-2">
      <input
        id="mapq"
        type="text"
        autocomplete="off"
        aria-label={t.map_search_placeholder}
        placeholder={t.map_search_placeholder}
        class="w-56 rounded-lg border border-gray-300 bg-white/95 px-3 py-1.5 text-sm text-gray-900 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-100"
      />
      <button
        id="maploc"
        type="button"
        class="rounded-lg border border-gray-300 bg-white/95 px-3 py-1.5 text-sm text-blue-700 shadow hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/95 dark:text-blue-300"
        ><span aria-hidden="true">📍</span> {t.map_locate}</button
      >
    </div>
    <p
      id="mapmsg"
      aria-live="polite"
      class="absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-white/95 px-3 py-1.5 text-xs text-gray-700 shadow dark:bg-gray-900/95 dark:text-gray-300"
    >
    </p>
    <div id="map" class="h-full w-full" role="application" aria-label={t.map_title}></div>
  </main>

  <script>
    import maplibregl from 'maplibre-gl';
    import 'maplibre-gl/dist/maplibre-gl.css';
    import { parseMapHash, buildMapHash, type MapHashState } from '../lib/maphash';
    import { presetPins, withUserPin, type MapPin } from '../lib/mappins';
    import { cities } from '../data/cities';
    import { geocode } from '../lib/geocode';
    import { ui } from '../i18n/ui';
    import { siteBase } from '../utils/paths';

    const t = ui.es;
    const base = siteBase();

    function esc(s: string): string {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showMsg(text: string): void {
      const el = document.getElementById('mapmsg');
      if (!el) return;
      el.textContent = text;
      el.classList.remove('hidden');
      window.setTimeout(() => el.classList.add('hidden'), 4000);
    }

    const initial = parseMapHash(location.hash);

    const map = new maplibregl.Map({
      container: 'map',
      center: [initial.lng, initial.lat],
      zoom: initial.zoom,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
    });
    map.addControl(new maplibregl.NavigationControl({}), 'bottom-right');

    let pins: MapPin[] = presetPins(cities);
    const markers: maplibregl.Marker[] = [];

    function popupHtml(p: MapPin): string {
      const fc = `${base}forecast?lat=${p.lat}&lng=${p.lng}&name=${encodeURIComponent(p.name)}`;
      return (
        `<div class="text-sm"><strong>${esc(p.name)}</strong><br>` +
        `<a href="${esc(fc)}" class="text-blue-600 underline">${esc(t.map_popup_full_forecast)} →</a></div>`
      );
    }

    function renderPins(): void {
      while (markers.length) markers.pop()!.remove();
      for (const p of pins) {
        const popup = new maplibregl.Popup({ offset: 24 }).setHTML(popupHtml(p));
        const marker = new maplibregl.Marker({ color: p.kind === 'preset' ? '#2563eb' : '#dc2626' })
          .setLngLat([p.lng, p.lat])
          .setPopup(popup)
          .addTo(map);
        markers.push(marker);
      }
    }

    function syncHash(): void {
      const c = map.getCenter();
      const state: MapHashState = {
        lat: c.lat,
        lng: c.lng,
        zoom: map.getZoom(),
        layer: 'base',
        t: null,
      };
      history.replaceState(null, '', buildMapHash(state));
    }

    let hashTimer = 0;
    map.on('moveend', () => {
      window.clearTimeout(hashTimer);
      hashTimer = window.setTimeout(syncHash, 250);
    });

    map.on('load', () => {
      renderPins();
    });

    function setUserPin(name: string, lat: number, lng: number, kind: 'search' | 'geo'): void {
      pins = withUserPin(pins, { name, lat, lng, kind });
      renderPins();
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 9) });
    }

    // --- search (reuses the existing geocode SDK) -----------------------
    const q = document.getElementById('mapq') as HTMLInputElement | null;
    let qTimer = 0;
    q?.addEventListener('input', () => {
      window.clearTimeout(qTimer);
      const query = q.value.trim();
      if (query.length < 2) return;
      qTimer = window.setTimeout(async () => {
        try {
          const results = await geocode(query);
          if (!results.length) {
            showMsg(`${t.no_results} «${query}»`);
            return;
          }
          const r = results[0];
          setUserPin(r.name, r.lat, r.lng, 'search');
        } catch {
          showMsg(t.load_error);
        }
      }, 350);
    });

    // --- geolocation ----------------------------------------------------
    document.getElementById('maploc')?.addEventListener('click', () => {
      if (!('geolocation' in navigator)) {
        showMsg(t.geo_denied);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserPin(t.map_locate, pos.coords.latitude, pos.coords.longitude, 'geo'),
        () => showMsg(t.geo_denied),
      );
    });
  </script>
</BaseLayout>
```

- [ ] **Step 2: Verify types compile**

Run: `npm run type-check`
Expected: PASS (exit 0). If MapLibre types are missing, confirm `maplibre-gl` is installed (Task 1) — it ships its own types.

- [ ] **Step 3: Verify the static build succeeds**

Run: `npm run build`
Expected: PASS — `dist/mapa/index.html` produced, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/pages/mapa.astro
git commit -m "feat(maps): /mapa page with MapLibre basemap, pins, search, geolocation, shareable hash"
```

---

### Task 5: Home-page teaser and nav link

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/layouts/BaseLayout.astro`

- [ ] **Step 1: Add the nav link to BaseLayout**

In `src/layouts/BaseLayout.astro`, find the opening `<body ...>` tag (the element wrapping `<slot />`). Immediately after it, add:

```astro
    <nav class="border-b border-gray-200 bg-white px-4 py-2 text-sm dark:border-gray-800 dark:bg-gray-950">
      <a href={base} class="text-blue-600 hover:underline dark:text-blue-400">Inicio</a>
      <span class="mx-2 text-gray-400">·</span>
      <a href={`${base}mapa`} class="text-blue-600 hover:underline dark:text-blue-400">Mapa</a>
    </nav>
```

> `base` is already defined in the BaseLayout frontmatter (used for favicon/canonical). If it is not in scope at the body, add `const base = import.meta.env.BASE_URL;` to the component frontmatter and reuse it.

- [ ] **Step 2: Add the teaser block to the home page**

In `src/pages/index.astro`, locate the `<!-- Alertas activas -->` block inside `<main>`. Immediately **before** that block, insert:

```astro
      <!-- Mapa teaser -->
      <a
        href={`${base}mapa`}
        class="block rounded-xl border border-blue-500/40 bg-blue-500/5 p-6 text-center transition hover:bg-blue-500/10 motion-reduce:transition-none dark:border-blue-500/30"
      >
        <div class="text-3xl">🗺️</div>
        <h2 class="mt-2 text-xl font-semibold">{t.map_teaser_heading}</h2>
        <p class="mt-2 inline-block text-sm font-medium text-blue-600 dark:text-blue-400">
          {t.map_teaser_cta} →
        </p>
      </a>
```

> `base` and `t` are already defined in `index.astro` frontmatter (`const base = siteBase();`, `const t = ui.es;`).

- [ ] **Step 3: Verify types and build**

Run: `npm run type-check && npm run build`
Expected: PASS (exit 0); `dist/index.html` contains the teaser link to `mapa`.

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS — all prior tests plus the new `maphash` and `mappins` suites green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro src/layouts/BaseLayout.astro
git commit -m "feat(maps): home teaser and nav link to /mapa"
```

---

### Task 6: Playwright smoke test (optional but recommended)

**Files:**
- Create: `e2e/mapa.spec.ts`

- [ ] **Step 1: Write the smoke test**

Create `e2e/mapa.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('mapa page loads with map container and search', async ({ page }) => {
  // Relative path: playwright baseURL already includes the site base path.
  await page.goto('mapa/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.getByPlaceholder(/Buscar un lugar/)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e -- mapa.spec.ts`
Expected: PASS. If the local Playwright browsers are missing, run `npx playwright install` first. If the e2e harness needs network mocking for tiles and the smoke proves flaky, keep the test but mark it `test.skip` with a comment referencing the timeline slice — do not block the slice on it.

- [ ] **Step 3: Commit**

```bash
git add e2e/mapa.spec.ts
git commit -m "test(maps): e2e smoke for /mapa"
```

---

## Self-Review

- **Spec coverage (Slice 1 only):** `/mapa` page + dynamic MapLibre core (Task 4) ✓; keyless OSM basemap (Task 4) ✓; preset + search + geo pins (Tasks 3, 4) ✓; popups → `/forecast` deep link (Task 4) ✓; shareable URL hash (Tasks 2, 4) ✓; home teaser + nav link (Task 5) ✓; i18n Spanish-first (Task 1) ✓; XSS-safe rendering via `esc()` + validated hash (Tasks 2, 4) ✓; Vitest on pure modules only (Tasks 2, 3) ✓. Slices 2–6 (layer engine, radar, satellite, timeline, field layers, sunlight) are intentionally out of this plan.
- **Placeholders:** none — every code/command step has concrete content; the only conditional is the documented optional-skip for the flaky-tile e2e case.
- **Type consistency:** `MapHashState`, `MapPin`, `presetPins`, `withUserPin`, `parseMapHash`, `buildMapHash` names/signatures match between definition (Tasks 2–3) and use (Task 4); `City` import path `../data/cities` matches the repo.
```
