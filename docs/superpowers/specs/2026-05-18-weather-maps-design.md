# Interactive weather maps (zoom.earth-class) — design

Date: 2026-05-18
Status: Approved (pending written-spec review)

## Summary

Add an interactive, zoom.earth-class weather map to the Mexico weather site:
location **pins** plus a full **layer system** (radar/precipitation,
satellite/clouds, wind, temperature, humidity, pressure, sunlight) with a
**full timeline** (past → now → forecast) and the full zoom range
(world → street).

The site stays a **100% static GitHub Pages deployment with no backend and no
build-time secrets**. The only new runtime dependency is the map engine
(**MapLibre GL JS**), introduced as a deliberate, scoped exception:
lazy-loaded and confined to a single route so the rest of the site is
unaffected.

This is an **epic**: it documents the complete vision and an explicit
build sequence so it ships in independently reviewable slices, following the
repo's slice-per-PR + two-stage review convention. All listed layers and the
full timeline are in the committed scope (not deferred).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Map engine | MapLibre GL JS, documented scoped exception to no-deps rule |
| Data sources | Keyless only (RainViewer, Open-Meteo, OSM, NASA GIBS, client math) |
| Issue scope | Epic + explicit phased build sequence (slices), full scope committed |
| Pins | Preset MX cities + user's searched / geolocated point |
| Placement | Dedicated `/mapa` page **and** a lightweight teaser on home |
| Timeline | Full past → now → forecast in scope |
| Layers | Radar+precip, satellite+clouds, wind/temp/humidity/pressure, sunlight |

## Non-goals (YAGNI)

- No hosted backend / edge proxy and no build-time API keys/secrets.
- No paid/keyed tile providers (OpenWeatherMap, Tomorrow.io, Windy, etc.).
- No island UI framework; vanilla TS + the repo's bundled-`<script>` pattern.
- No unit toggle / favorites / multi-language routing (consistent with the
  rich-location-forecast spec).
- No charting library; overlays are MapLibre GL layers / canvas.

## Architecture

### Placement & bundle strategy

- **New page** `src/pages/mapa.astro` — full-screen map. Route
  `/mexico-weather-site/mapa` (custom domain `/mapa`).
- MapLibre GL JS and the layer engine are **dynamically `import()`ed only on
  this page**, so `index.astro` and every other route ship none of it.
- `index.astro` gains a **teaser**: a non-interactive preview (a cached
  snapshot image or a minimal static canvas — no MapLibre) with a
  "Ver mapa interactivo →" link to `/mapa`.
- `BaseLayout.astro` gains a nav link to `/mapa`.
- The MapLibre dependency is recorded in the README/ROADMAP as a deliberate,
  lazy-loaded, single-route exception to the "no new runtime dependencies"
  rule.

### Map core & pins

- **MapLibre GL JS** with a **keyless** basemap: OpenStreetMap raster source
  plus a satellite raster source (NASA GIBS / public imagery). Default
  viewport: Mexico bounds; full zoom range world → street.
- **Pin layer**:
  - The 5 presets from `src/data/cities.ts`.
  - The user's **searched** point — reuses the existing `geocode()` SDK in
    `src/lib/weather.ts` with a search box on the map.
  - The user's **geolocated** point — browser Geolocation, non-blocking.
  - Click a pin → popup with current conditions (via the existing
    `weather.ts` forecast/SDK path) + "Ver pronóstico completo →" that
    deep-links the existing `/forecast?lat=&lng=&name=&tz=` page (no
    duplicate forecast UI).
- **Shareable view state**: zoom.earth-style URL hash
  `/mapa#view=<lat>,<lng>,<zoom>z&layer=<id>&t=<frameISO>`. Bookmarkable;
  parsed and validated on load; updated (debounced) as the user pans / zooms /
  switches layer / scrubs time.

### Layer system

A typed, pure, DOM-free, testable registry in **`src/lib/maplayers.ts`**.
Each layer is described declaratively:

```
LayerDef = {
  id: string;
  labelKey: string;          // i18n key, Spanish-first
  kind: 'raster-tile' | 'gl-particle' | 'computed';
  source: LayerSource;       // tile URL template / data fetcher / compute fn
  legend: LegendStop[];      // colour stops + Spanish labels
  defaultOpacity: number;
  hasTimeAxis: boolean;
}
```

Layers (all keyless):

1. **Radar + Precipitation** — RainViewer free tile API. Rain vs. snow
   distinguished via RainViewer's snow-coded palette. Legend mirrors
   zoom.earth: Ligera / Moderada / Intensa / Nieve.
2. **Satellite + Clouds** — NASA GIBS imagery (e.g. GOES / VIIRS) and/or
   RainViewer satellite IR tiles for the cloud layer.
3. **Wind** — Open-Meteo gridded `wind_speed`/`wind_direction` sampled over
   the current viewport, rendered as an animated **GL particle field**.
4. **Temperature / Humidity / Pressure** — Open-Meteo gridded data sampled
   over the viewport, rendered as interpolated heat / contour overlays.
5. **Sunlight** — client-computed **day–night terminator** + subsolar point.
   Pure astronomy math; no external source.

Interaction model (zoom.earth-style left rail):

- Exactly **one primary weather layer** active at a time
  (radar / precip / satellite / clouds / wind / temp / humidity / pressure).
- **Sunlight terminator** is an independent toggle (can overlay any primary
  layer).
- Per-active-layer **opacity slider**.
- **Legend panel** reflects the active layer's stops.

### Timeline (full, in scope)

- Bottom scrubber + play/pause + step buttons + frame timestamp, matching the
  reference screenshot.
- Range: **past frames → now → forecast frames**.
  - Radar/precip: RainViewer historical frames + nowcast.
  - Field layers (wind/temp/humidity/pressure): Open-Meteo hourly forecast
    steps.
  - Satellite/clouds: available historical IR frames.
- Playback preloads/caches upcoming frames; current frame in the URL hash.
- Respects `prefers-reduced-motion`: no autoplay when set; manual scrub only.

## Data flow

1. `/mapa` loads → dynamic-import MapLibre + layer engine → init map at hash
   view (or Mexico default).
2. Pins rendered from `cities.ts`; search box → `geocode()`; geolocation
   button → coords → pin.
3. Active layer's source resolved from the registry:
   - raster-tile → MapLibre source with the (keyless) tile URL template.
   - gl-particle / computed-overlay → gridded data fetched via the existing
     **retry/backoff/429 JSON requester** in `weather.ts`, sampled to the
     viewport, fed to the GL/canvas renderer.
4. Timeline change → swap frame URL / re-fetch the relevant step (cached).
5. Pin click → current conditions popup → optional navigate to `/forecast`.
6. All requests are client-side, keyless, CORS-friendly; no backend, no
   secrets; GitHub Pages stays fully static.

## Error handling

- A layer source failing (network/CORS/quota) → that layer shows a
  non-blocking "capa no disponible" state; the map and all other layers keep
  working. Reuses the SDK retry/backoff/429 path for data-driven layers.
- Geolocation denied/unavailable → non-blocking message; search + pins stay
  usable.
- Invalid/missing URL hash → fall back to the Mexico default view (valid
  page, no crash).
- **XSS**: all geocode/location-derived strings rendered via
  `textContent`/escaped, never `innerHTML`. Hash params (lat/lng/zoom/frame)
  validated (numeric, in range, known layer id) before use.

## Accessibility

- Layer rail and timeline controls are focusable and keyboard-operable
  (Tab/Arrows/Enter/Space; Esc closes popups).
- Map supports keyboard pan/zoom.
- Legend has text equivalents (not colour-only).
- Respect `prefers-reduced-motion` for timeline autoplay and particle
  animation.
- `/mapa` has a sensible `<title>`/`<h1>`; the page is valid HTML for
  crawlers even before JS runs.
- Spanish-first copy via the existing `src/i18n/` pattern.

## Testing

Vitest on **pure modules only** (repo convention; UI/MapLibre wiring
untested), deterministic with injected `fetch`/`sleep`, no network:

- `maplayers.ts`: registry shape, legend stop generation, active-layer
  selection rules.
- RainViewer frame-list parsing (past/nowcast → timeline frames).
- Day–night terminator / subsolar math (known dates/locations).
- URL-hash encode/decode + validation (round-trip, out-of-range rejection).
- Open-Meteo viewport grid sampling (deterministic given a fixed response).

Optional Playwright smoke (matches existing e2e harness): `/mapa` loads, a
layer toggles, a pin popup opens. CI (`ci.yml`) keeps running `check` +
`build`; `npm test` runs the unit suite.

## Dependencies & sequencing

- New runtime dep: **MapLibre GL JS** (lazy-loaded, `/mapa` only).
- Builds on the existing `src/lib/weather.ts` SDK (`geocode`, forecast,
  retry/backoff/429) and `src/data/cities.ts`.
- Reuses the existing `/forecast` page for full forecasts (no duplication).
- Independent of theme, SEO, tooling work; compatible with the service-worker
  scoping already in place.

## Build sequence (epic slices — each an independent PR, two-stage review)

1. **Map foundation**: `/mapa` page + dynamic MapLibre core + keyless
   basemap + preset/search/geo pins + popups → `/forecast` deep link +
   shareable URL hash + home teaser + nav link.
2. **Layer engine + Radar/Precipitation**: `maplayers.ts` registry +
   RainViewer radar/precip (rain vs snow) + legend + opacity slider + Vitest.
3. **Satellite + Clouds** layer (NASA GIBS / RainViewer IR).
4. **Timeline**: past → now → forecast scrubber + playback, wired to
   radar/precip first.
5. **Field layers**: wind (GL particle field) + temperature / humidity /
   pressure overlays, timeline-driven, via Open-Meteo grid sampling.
6. **Sunlight terminator** layer + performance/polish pass (frame caching,
   reduced-motion, bundle audit).

Each slice independently shippable and reviewable; the epic issue tracks them
as a checklist.
