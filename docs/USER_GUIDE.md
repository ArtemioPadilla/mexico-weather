# User Guide

A walkthrough of what users can do on the site, the public URL schemas (for sharing/bookmarking), accessibility behaviors, and data-source attributions.

## Routes overview

| Route | What it is |
|---|---|
| `/` | **Home** — map-first: the interactive map fills the viewport below the nav (radar on by default, trimmed 5-layer rail + timeline + preset pins) with the "Mostrar mi clima" CTA and the search box floating on top; preset city cards, favorites and SMN alerts follow below the fold. |
| `/forecast` | **Forecast detail** — shareable, client-rendered detail page driven by URL query params. |
| `/mapa` | **Interactive weather map** — opens on the GeoColor satellite layer with the last 3 h already animating (Story 21.2), MapLibre GL basemap, location pins, layer rail, opacity slider, legend, timeline scrubber + playback, shareable view state. |
| `/privacidad` | **Privacy/legal**. |
| `/alertas` | **Alerts on your phone** — ntfy.sh public topics (`climamx-huracanes`, `climamx-smn`, `climamx-smn-<estado>`) fed by the snapshot workflows, plus per-state RSS at `/rss/<estado>.xml` (and `/rss/nacional.xml`). No account, nothing stored. |
| `/rss.xml` | **RSS 2.0 feed** of SMN weather alerts (regenerated hourly). |
| `/sitemap.xml` | Sitemap. |

## User journeys

### Browse the city forecasts (home → forecast detail)

1. Open `/` — preset Mexico cities are listed with current temperature, condition, hi/lo, rain probability, and wind.
2. Click a card → expanded inline "quick peek" with the extra variables (UV, humidity, pressure, sunrise/sunset, etc.) plus a "Ver pronóstico completo →" link.
3. The full-page detail is `/forecast?lat=<n>&lng=<n>&name=<text>&tz=<TZ>` — bookmarkable, shareable, and crawlable.
4. If you've already starred a preset city, it appears once under **"Tus lugares"** and is automatically hidden from the **"Pronóstico por Ciudad"** preset grid below — no duplicate cards. Removing the favorite restores the preset tile. The "+ Más ciudades próximamente" placeholder always remains at the end of the preset grid.

### Find any place (search or "use my location")

1. From the home page or `/mapa`, type a place name into the search box. Debounced Open-Meteo geocoding returns candidate matches.
2. Press Enter (or click the first result) to navigate to `/forecast` for that location.
3. Click **"📍 Mi ubicación"** to use the browser's Geolocation API. Permission denials are non-blocking and show a small status message; search stays available.

### Explore the interactive map (`/mapa`)

1. The map opens centred on Mexico **on the GeoColor satellite layer, already animating**: once the first satellite frame has its tiles, the timeline plays the **last 3 h** on its own (Story 21.2). Any interaction with the timeline (‹ / ›, the range, ▶) pauses it, exactly like pausing a manual loop; after that the loop window is the one in ⚙ (24 h by default — the boot loop never changes the setting; if you already chose a window there, it is used from the start). It does not autoplay when your system prefers reduced motion (the ▶ button is disabled), when the browser reports a data-saver connection (`navigator.connection.saveData`), or when you open a shared link with a `t=` instant. If NASA GIBS is unreachable the map opens on **radar** instead (or on **Base** if RainViewer is down too) and shows the usual "Capa no disponible" message; `/` (home) keeps opening on radar and each `/mapa/<capa>/` page on its own layer, without autoplay. The map also shows **pins** for preset cities and (after a search/geolocate) a single user pin. Until the first tiles land, the map area shows a dark gradient with a subtle shimmer instead of a flat gray box (Story 21.4; every embed — home, `/mapa`, layer pages, `/forecast` — shares it, and it fades within ~0.5 s of the first loaded tiles, or after 8 s at most if tiles never arrive). Click a pin → popup → "Ver pronóstico completo →" deep-link to `/forecast`.
2. Use the **layer rail** (top-left) to switch the active weather layer. Only one weather layer is active at a time; **Base** turns them all off. While **satellite** or **radar** is on screen the basemap switches to the dark gray canvas even in the light theme, and place labels / boundaries are drawn *above* the imagery at 80 % so they stay readable over cloud tops (Story 21.1); switching back to Base returns to the theme's own canvas. The rail, the timeline pill and the legend bar are dark translucent panels in both themes — content pages keep the regular light/dark look.
3. When a weather layer is active, the **opacity slider** appears and changes the layer's transparency live. Each layer has a sensible default opacity (radar 80%, satellite 100%, temperature/humidity/pressure 65–75%).
4. The **legend** (left rail) reflects the active layer:
   - Radar: Ligera / Moderada / Intensa / Nieve.
   - Satellite: no intensity legend (it's imagery).
   - Temperature / Humidity / Pressure: colour ramp with stop labels.
5. The **timeline scrubber** (bottom-centre) appears whenever a weather layer with a time axis is active. Use ‹ / › to step a frame, drag the range, or press ▶ to play (loops with wrap). Pause with ⏸ or by interacting with prev/next/range. Forecast layers (temperature, humidity, pressure, precipitation, wind) boot on an hourly window from **24 h ago to +48 h** (yesterday comes from the same Open-Meteo call via `past_days=1`, so "hace 24 h" is free — the ‹ day-skip button or a `t=` in the past lands there); the **"Ver 10 días"** chip (or stepping past the last frame) pulls a **10-day, 3-hourly** extension on demand and the axis grows in place — labels switch to "mié 15:00 · +3 d" past 24 h and the day-skip buttons move by 24 h regardless of frame stride. A shared link whose `t=` lies past +48 h pulls the extension automatically. The ⚙ panel holds the animation controls (Story 16.4): **loop** (frames within ±3/6/12/24 h of now; the whole axis when fewer than two frames qualify), **speed** (slow / medium / fast = 1200 / 700 / 350 ms per frame), **style** (smooth cross-fades radar and satellite tiles between frames; fast swaps instantly) and the **time label** mode (both / clock / relative), which a tap on the timeline's time pill also cycles (no letter is free for a shortcut: `J` is the volcanoes overlay). All persist in localStorage and apply live, mid-loop. **Hace 24 h** (next to Capturar) freezes the current frame as an overlay and moves the timeline a day back, so Mostrar/Ocultar flips between then and now (Story 13.5). The **Incertidumbre** overlay repaints the active field (temperature, humidity, pressure or precipitation) as the spread between ICON, GFS and ECMWF — green where they agree, purple where they diverge — with a "± n entre modelos" line in the tooltip; it fetches the three models on demand and keeps them per layer (Story 13.3). The **Mira** button (next to Distancia / Área) pins a crosshair to the map centre and prints the active layer's value under it, refreshed as you pan and as the timeline plays — the phone-friendly counterpart of the hover tooltip (Story 18.3); pressure isobars carry their value along the line. The same panel sets the **display units** (Story 19.3: °C/°F, km/h · mph · kt · m/s, hPa/inHg, km/mi); data stays metric underneath and the tooltip, city pills, legend scale, place card, measure tool and `/forecast` re-render on the spot.
6. **Tap anywhere** on the map to open the **place card**: 10 daily rows (Diario) or 48 hourly rows (Horario) for that point, the active layer's reading there, a favourite star and a link to the full forecast. Bottom sheet on phones, floating panel on desktop; Escape or × closes it.
7. **First visit**: `/mapa` and the layer pages show a one-time, non-modal welcome card offering to centre the map on you (same locate flow as the 📍 button; remembered in localStorage, nothing leaves the browser), and each weather layer shows a one-line intro the first time it is activated (Story 19.2).
8. **Sharing / bookmarking**: the URL hash updates as you pan, zoom, change layer, and scrub. Copy-paste the URL to share the exact view + frame; reloading restores it.

## Public URL schemas

### `/mapa#view=<lat>,<lng>,<zoom>z&layer=<id>&t=<ISO>`

| Param | Format | Meaning |
|---|---|---|
| `view` | `<lat>,<lng>,<zoom>z` (e.g. `19.43,-99.13,6.5z`) | Map centre + zoom. Validated; out-of-range values fall back to the default Mexico view. |
| `mode` | `precip` | Combined precipitation mode (Story 13.2): GeoColor satellite + cloud overlay + the radar frame nearest the satellite instant, radar legend. Set from the Superposiciones panel; absent = off. |
| `layer` | one of `base`, `radar`, `satellite`, `temperature`, `humidity`, `pressure`, `precipitation`, `wind`, `sunlight` (each weather layer also has its own landing page, `/mapa/radar/`, `/mapa/satelite/`, `/mapa/temperatura/`, `/mapa/humedad/`, `/mapa/presion/`, `/mapa/precipitacion/`, `/mapa/viento/`, `/mapa/sol/`, that opens the map on that layer — Story 19.1) | Active weather layer; unknown ids fall back to `base`. **Absent** (e.g. `#view=19.43,-99.13,6.5z` alone) → the page's default layer applies: `satellite` on `/mapa`, `radar` on the home embed, each layer page its own (Story 21.2); the map then writes the layer back into the hash. |
| `t` | ISO timestamp (e.g. `2026-05-19T13:00:00.000Z`) | Selected timeline frame; the nearest frame is restored on load. Omitted when `layer=base`. |

Example: `https://artemiop.com/mexico-weather/mapa#view=19.43,-99.13,6.5z&layer=radar&t=2026-05-19T13:00:00.000Z`.

### `/forecast?lat=&lng=&name=&tz=`

| Param | Format | Meaning |
|---|---|---|
| `lat` | number in [-90, 90] | Latitude. |
| `lng` | number in [-180, 180] | Longitude. |
| `name` | URL-encoded text | Display name (UTF-8). |
| `tz` | IANA TZ id (e.g. `America/Mexico_City`); optional | Falls back to Open-Meteo's `auto` if absent or invalid. |

## Accessibility

- **Layer rail buttons** are real `<button aria-pressed>` elements with visible `focus-visible` rings. Keyboard users can Tab through them.
- **Map** has `role="application"` + an `aria-label`; MapLibre's `NavigationControl` provides keyboard pan/zoom.
- **Status messages** (`#mapmsg`) use `aria-live="polite"` so transient errors ("Capa no disponible", "No se pudo obtener tu ubicación", etc.) are announced without interrupting reading flow.
- **Timeline timestamp** (`#tl-time`) uses `aria-live="polite"` + `aria-atomic="true"` so scrubbing announces the new frame time.
- **`prefers-reduced-motion: reduce`** disables timeline autoplay — the ▶ button is disabled (`data-state="paused"`) and labelled accordingly, and `/mapa` opens on a still satellite frame instead of the 3 h loop (Story 21.2); manual prev / next / range scrubbing still works. A data-saver connection (`navigator.connection.saveData`) also skips the boot loop. MapLibre's `flyTo` animations are also suppressed under reduced motion.
- **Spanish-first**: every UI string is Spanish by default; English strings exist in the i18n table for future routing.
- **XSS-safe**: all dynamic strings injected into popups, legends, and labels pass through an HTML-escape helper.

## Responsive behavior

The site is mobile-first and tested at four representative breakpoints. There are no hard `min-width` media queries to "switch into" desktop — layout adapts continuously via Tailwind's responsive utilities and CSS grid.

| Breakpoint | Width | Reference device | Layout traits |
|---|---|---|---|
| **mobile** | 375–640 px | iPhone SE, modern Android phones in portrait | 1-column card grid; search input + "Mi ubicación" stack vertically on the narrowest widths; hero typography scales down (`text-5xl → text-4xl`); a slim 48 px sticky topbar (`aria-label="Principal"`) holds the brand, `Inicio` / `Mapa` nav and the theme toggle; feedback FAB floats bottom-right (on the home it lives in the footer instead, so it never covers the map). |
| **tablet** | 641–1023 px | iPad portrait, Surface Go | 2-column card grid; search + "Mi ubicación" share a single row; the `/mapa` layer rail remains a vertical sidebar but takes less horizontal share of the viewport; hourly cards on `/forecast` scroll horizontally with a visible scrollbar. |
| **laptop** | 1024–1535 px | most laptops | 3-column card grid; map page uses the full viewport for the canvas with sidebar rail; forecast detail panels (Viento / Índice UV / Cielo y aire) align side-by-side. |
| **desktop** | ≥ 1536 px | external monitors | Same as laptop with a wider content `max-width` cap on `/` and `/forecast` (centered with side gutters); `/mapa` continues to occupy the full width because the map IS the page. |

### Per-page responsive notes

- **`/` (home)**
  - Card grid: `grid-cols-1` (mobile) → `grid-cols-2` (≥ `sm`) → `grid-cols-3` (≥ `lg`).
  - The 6th tile is always the "Más ciudades próximamente / Sugerir ciudad →" placeholder; it stays in flow at every breakpoint.
  - "Tus lugares" only renders when the user has favorites; on mobile it sits between the SMN alerts banner and the preset grid.
  - The home is **map-first**: the interactive map fills `100dvh` minus the nav and a 2.5 rem "peek" strip (the next section's heading shows at the bottom edge), radar layer on by default, with a trimmed 5-layer rail (base, radar, temperature, wind, sun), the timeline scrubber and the preset city pins. The power-user chrome of `/mapa` (measure, snapshot, settings, info, model toggle, coords, legend bar) is off here. The "Mostrar mi clima" CTA and the search combobox float over the top of the map (same ids and behaviour as before — story 2.1 still navigates to `/clima/<slug>/` or `/forecast/`); a "Ver mapa interactivo →" chip deep-links to `/mapa`. The map is not lazy any more (it is the LCP element), so `e2e/map-first-paint.spec.ts` has a home target.
- **`/forecast`**
  - 48-h hourly row is always `overflow-x: auto`; the row keeps a fixed card height and never wraps. The temperature sparkline lives **inside** the same scroll container as the cards, sized to the cards' total width — so hour N on a card and x position N on the sparkline scroll together (no more visual drift).
  - Daily rows (10 by default, 16 via "Ver 16 días"; days 11–16 dimmed with a confidence caveat) are full-width; the gradient temperature bar reflows to the full container width so it always reads at a glance. An axis row above the days shows `<minWeek>° / <midWeek>° / <maxWeek>°` with 25/50/75 % tick marks, and the "Hoy" row carries a small vertical "current temperature" marker positioned within the week's min/max range.
  - "Detalle" panels: stack vertically on mobile, then `grid-cols-3` from `md:` upward.
  - An **embedded interactive map** (~320 px tall on mobile, ~360 px on desktop) sits in the hero between the sunrise/sunset line and the hourly cards. Same MapLibre stack as `/mapa`, configured here for a single location: full pan/zoom, a blue marker at the URL's `lat,lng` with a popup that links back to the canonical forecast URL, and theme-synced Esri Light/Dark Gray basemap. Layer rail, search, and timeline are off — users who want layers/timeline tap "Abrir mapa a pantalla completa →" below the embed, which deep-links to `/mapa#view=<lat>,<lng>,9z`. MapLibre is shared with the home map via the `src/lib/interactive-map.ts` factory; height is reserved before init to prevent CLS.
- **`/mapa`**
  - The MapLibre canvas always fills 100 % of the viewport behind the absolute-positioned controls.
  - Layer rail keeps the same vertical layout from mobile to desktop; mobile users tap, desktop users hover-then-click. No collapse-to-burger.
  - Timeline scrubber stays bottom-center at all widths.
  - Opacity slider and legend sit on the left, just under the layer rail, so they don't fight the timeline for the bottom of the screen.
- **`/privacidad`**
  - Long-prose layout with a single readable column (`max-w-prose` style); identical at every breakpoint apart from the global `max-w` cap.

### Things that intentionally don't change

- **Spanish-first**: all viewports show the same Spanish strings; no locale-by-viewport switch.
- **Dark mode**: same colour palette at every breakpoint; theme toggle visible at every breakpoint.
- **Map controls** (zoom +/−): MapLibre's `NavigationControl` placement is fixed and never collapses, even on mobile.

### Known responsive gaps (not yet bugs but worth noting)

- Below 480 px the search input's placeholder text (`Buscar cualquier ciudad o lugar…`) gets truncated with an ellipsis; functional but tight.

## Failure modes (non-blocking by design)

- **Geolocation denied / unavailable** → a small message ("No se pudo obtener tu ubicación."); search remains usable.
- **Geocoding network failure** → in-place "Sin resultados para «…»" or generic load-error message; nothing crashes.
- **Weather layer source unreachable** (RainViewer manifest, Open-Meteo grid, or tile fetch) → "Capa no disponible" message, layer reverts to **Base**, the rest of the map keeps working.
- **NASA GIBS unreachable when `/mapa` opens** (Story 21.2) → one GeoColor tile is probed alongside the RainViewer manifest; on a network or HTTP failure the boot falls back to **radar**, or to **Base** when RainViewer is down too, with the same "Capa no disponible" message. A slow answer keeps satellite (late tiles beat a fallback flicker). Only the boot probes; picking satellite from the rail later behaves as before.
- **Invalid URL hash** → silently falls back to the default view (no crash); with no usable `layer=` the page's default layer applies.
- **Rapid pan with an active field layer** → in-flight requests are cancelled via `AbortController`; only the latest viewport's result lands.

## Data sources & attributions

- **Esri World Light Gray Canvas** — basemap raster tiles (base + reference/labels services) when the UI is in the light theme. No API key. Esri, HERE, Garmin, © OpenStreetMap contributors.
- **Esri World Dark Gray Canvas** — basemap raster tiles when the UI is in the dark theme (resolved from explicit "Oscuro" or "Sistema → dark"). The map swaps both tile sources live; the MapLibre instance is not recreated. Labels (the reference service) are hidden below zoom 5. Esri, HERE, Garmin, © OpenStreetMap contributors.
- **RainViewer** — radar + satellite-IR frames and tiles. © RainViewer.
- **Open-Meteo** — keyless gridded forecast (temperature, humidity, pressure, precipitation / snowfall / probability, wind). © Open-Meteo.
- **SMN / CONAGUA** — weather advisory RSS used for the build-time alert feed at `/rss.xml`.
- **Budget & canaries** — the scheduled workflows are the only predictable Open-Meteo consumer; `scripts/quota-audit.py` projects their daily calls from the scripts' constants and the workflow crons (no network), fails CI above 70 % of the 10 000/day allowance and, run daily by `quota-audit.yml`, opens a `quota-alert` issue. `basemap-canary.yml` probes Esri, GIBS, RainViewer and Open-Meteo every night (Story 20.2).
- **NOAA NHC GIS** — per active system, the forecast cone, the 72 h / 120 h track with one point per forecast hour and the coastal watches/warnings, plus the Tropical Weather Outlook areas (2-day / 7-day formation chance) for both basins. NHC's KMZ files are not CORS-readable, so `scripts/build-storms-snapshot.py` converts them every 15 min into `public/data/storms-gis.json` (Stories 18.1 / 18.2); the **Sistemas tropicales** overlay draws cone + track + watches and **Posible desarrollo (2 / 7 d)** draws the outlook; `/huracanes/<id>/` is prerendered per active system with the track table. © NOAA NHC.
- **NASA GIBS** — satellite imagery (GOES-East GeoColor at matrix level 7, Band 13 IR at level 6, MODIS Terra true colour daily) and the VIIRS NOAA-20 day/night band for the night-lights overlay. Keyless, CORS-enabled, © NASA EOSDIS GIBS. The satellite timeline is a synthetic axis of 10-minute frames (24 h by default, "Ver 10 días" for 10 days; GIBS keeps ≈ 45 days) that GIBS serves by TIME; the newest frame lags real time by ~30 min.

All sources are public, keyless, and CORS-enabled. The site ships zero secrets and runs as a static GitHub Pages deployment.

## Known limitations / deferrals

These are intentional scope boundaries, not bugs:

- **Wind layer under `prefers-reduced-motion: reduce`** falls back to static circle markers (no animated particles).
- **Field layers (temperature/humidity/pressure)** use a coarse 8×6 viewport-aligned grid. Adequate for country-level views; finer resolution is a polish item.
- **Time label** in the timeline is formatted in `es-MX` locale. Multi-locale time formatting is a non-goal for v1.
- **Field-layer playback animation** uses simple frame swaps without preloading; preloading/caching is a polish item.
- **Particle trails / geographic-accurate advection** are a polish item — the v1 wind particle system does not yet render trails.

## Developer notes

### Visual audit against zoom.earth (Story 26.1)

`scripts/visual-audit.mjs` captures `/mapa` next to zoom.earth in the same
state so the §0 checklist of [`PLAN_PARIDAD_VISUAL.md`](PLAN_PARIDAD_VISUAL.md)
can be marked against real pixels. It serves `dist/` with `astro preview`
(port 4399 by default), opens the map on **satellite, radar and temperature**
at **1280×800, 768×1024 and 360×640** (`#view=23.6,-102.5,5z&layer=<id>`),
opens `https://zoom.earth/maps/<satellite|radar|temperature>/` on the same
view, and writes to `audit-out/` (git-ignored):

- `<layer>-<width>w-mexico-weather.png` / `<layer>-<width>w-zoom-earth.png` — the pairs
- `UX_AUDIT_<date>.md` — sheet from `scripts/visual-audit-template.md`: the pairs table, the §0 checklist and the dark-basemap legibility checks to fill **by hand**, then copy to `docs/UX_AUDIT_<date>.md`
- `manifest.json` — URLs, timings, paint check and notes per capture

Captures are the cold-load state a first-time visitor sees (welcome card
included). A zoom.earth state that does not finish loading is captured as is
and noted in §4 of the sheet; only a missing capture on our side fails the run.

```sh
npm run build
node scripts/visual-audit.mjs                 # real network → audit-out/
node scripts/visual-audit.mjs --mock          # offline smoke test (stubbed tiles, placeholder zoom.earth)
node scripts/visual-audit.mjs --help          # --base, --port, --out, --date, --skip-zoom, --settle-ms, --chromium, --proxy
```

The real audit runs on CI: **Actions → "Visual audit (zoom.earth side by
side)" → Run workflow** (`.github/workflows/visual-audit.yml`, manual only).
It builds, runs the script with the real network and uploads `audit-out/` as
the `visual-audit-<run>` artifact (7-day retention). Repeat it when closing
each of E21–E26. In sandboxes that cannot reach Esri/GIBS use `--mock`; pass
`--chromium <path>` / `--proxy <server>` when Playwright's own Chromium or a
direct network are unavailable.

Unit tests for the pure helpers (plan, URLs, mock routing, sheet rendering)
live in `src/lib/visual-audit-lib.test.ts`.

### Chrome budget on `/mapa` (Story 22.1)

`e2e/chrome-budget.spec.ts` counts the interactive elements (`button`,
`a[href]`, `input`, `select`, `[role=button]`, `summary`) that are visible and
overlap the map container on a cold `/mapa` load, at **1280×800** and
**360×640**, and prints the list with positions in the test output (also
attached to the HTML report). Two tests per viewport:

- **baseline** — asserts the exact number measured when the story shipped
  (**38 desktop / 26 mobile** on the base layer, 2026-09-27; **42 / 27**
  since Story 21.2 boots on satellite, whose sub-options and "Ver 10 días"
  are counted). It fails when a PR adds a control
  over the map *and* when one is removed: the story that removes it records
  the new number in `VARIANTS[].baseline` and in the "Hoy" column of
  [`PLAN_PARIDAD_VISUAL.md`](PLAN_PARIDAD_VISUAL.md) §5.
- **budget** (≤ 8 desktop, ≤ 5 mobile, plan §1.2) — `test.fixme` until
  Stories 22.2–22.5 land; 22.5 flips it to a real test.

The state measured is the one a returning visitor sees: satellite layer
with its loop running (the Story 21.2 boot), nothing clicked, welcome card
already dismissed; the spec mocks GIBS too and waits for the pressed
satellite button + the playing ▶ rather than `map.loaded()`, which never
settles while frames animate. MapLibre markers/popups and the
attribution link are not counted (data and legal text, not chrome); the
MapLibre zoom/compass buttons, the feedback FAB, the back link and the SMN
pill are. The pure decision (rects → count) is
`src/lib/map/chrome/chrome-budget.ts`, unit-tested in
`chrome-budget.test.ts`; the spec only measures. Tiles are mocked, so the
spec runs on any machine:

```sh
npx playwright test e2e/chrome-budget.spec.ts
```

## Related docs

- **E2E user-journey reference** (selectors, journey-by-journey Playwright drives, network mocks, coverage matrix): [`USER_JOURNEYS.md`](USER_JOURNEYS.md)
- **Design spec** (engineering): `docs/superpowers/specs/2026-05-18-weather-maps-design.md`
- **Implementation plans** (one per slice): `docs/superpowers/plans/2026-05-1[68-9]-weather-maps-slice-*.md`
- **Rich location forecast spec**: `docs/superpowers/specs/2026-05-16-rich-location-forecast-design.md`
- **Roadmap**: [`ROADMAP.md`](../ROADMAP.md)
- **Setup**: [`SETUP.md`](../SETUP.md)
