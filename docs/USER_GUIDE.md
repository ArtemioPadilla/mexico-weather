# User Guide

A walkthrough of what users can do on the site, the public URL schemas (for sharing/bookmarking), accessibility behaviors, and data-source attributions.

## Routes overview

| Route | What it is |
|---|---|
| `/` | **Home** — map-first: the interactive map fills the viewport below the nav (radar on by default, trimmed 5-layer rail + timeline + preset pins) with the "Mostrar mi clima" CTA and the search box floating on top; preset city cards, favorites and SMN alerts follow below the fold. |
| `/forecast` | **Forecast detail** — shareable, client-rendered detail page driven by URL query params. |
| `/mapa` | **Interactive weather map** — opens on the GeoColor satellite layer with the last 3 h already animating (Story 21.2), MapLibre GL basemap, location pins, compact layer rail (layers + overlays tabs, opacity inside the active layer), legend, timeline scrubber + playback, shareable view state. |
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

1. The map opens centred on Mexico **on the GeoColor satellite layer, already animating**: once the first satellite frame has its tiles, the timeline plays the **last 3 h** on its own (Story 21.2). Any interaction with the timeline (‹ / ›, the range, ▶) pauses it, exactly like pausing a manual loop; after that the loop window is the one in ⋯ → Ajustes (24 h by default — the boot loop never changes the setting; if you already chose a window there, it is used from the start). It does not autoplay when your system prefers reduced motion (the ▶ button is disabled), when the browser reports a data-saver connection (`navigator.connection.saveData`), or when you open a shared link with a `t=` instant. The satellite boot needs a moment (it checks NASA GIBS, reads the RainViewer manifest and waits for the map to settle); **if you pick a layer before it lands — a rail button, a shortcut key, a sub-option — your layer wins**: the map never switches to satellite behind your back, no autoplay starts and no fallback message is shown. The same holds for a shared `#layer=` link whose layer is still loading when you pick another one. If NASA GIBS is unreachable the map opens on **radar** instead (or on **Base** if RainViewer is down too) and shows the usual "Capa no disponible" message; `/` (home) keeps opening on radar and each `/mapa/<capa>/` page on its own layer, without autoplay. The map also shows **pins** for preset cities and (after a search/geolocate) a single user pin. Until the first tiles land, the map area shows a dark gradient with a subtle shimmer instead of a flat gray box (Story 21.4; every embed — home, `/mapa`, layer pages, `/forecast` — shares it, and it fades within ~0.5 s of the first loaded tiles, or after 8 s at most if tiles never arrive). Click a pin → popup → "Ver pronóstico completo →" deep-link to `/forecast`.
2. Use the **layer rail** (top-left) to switch the active weather layer. Only one weather layer is active at a time; **Base** turns them all off. The rail is compact (Story 22.2): on desktop it is a 3-column grid of tiles with an icon and a short label (Mapa, Radar, Satélite, Temp., Humedad, Presión, Precip., Viento, Sol); the full name is each button's accessible name and tooltip, and the tooltip also shows the layer's keyboard letter (e.g. "Radar (R)") — the letter chips that used to sit in every row are gone; press **`?`** for the full list (Story 22.5, item 11). **On `/mapa` the rail starts folded** to its two tabs (Story 22.5, the chrome budget): the **Capas** tab names the active layer ("Capas · Satélite"); one click on it unfolds the tiles and the active layer's block, a second click on the open tab folds it again, and **Escape** inside the open rail folds it and leaves the focus on its tab. A click on **Superposiciones** opens the rail straight on the overlays, so every layer and every overlay is still two clicks away. The home embed and the `/mapa/<capa>/` pages keep the rail open as before. The **active layer's block** opens right under the grid row of the layer you picked: its variants (e.g. GeoColor / Infrarrojo / Color real, Actual / Aparente / Bulbo húmedo) as chips, and the **Opacidad** control; the block is not shown on Base. The rail has two tabs: **Capas** and **Superposiciones**. The overlays tab (formerly a collapsible "Superposiciones" section under the layers) lists every overlay as a checkbox, the four most used pinned first under "Más usadas" (Sistemas tropicales, Nubes, Modo precipitación, Animación de viento) and the rest under "Todas"; a **filter** box narrows the list as you type (case and accents ignored, every word must match; Escape clears it), and the tab shows a badge with how many overlays are on. Every overlay is two clicks away — the tab, then its checkbox — and the letter shortcuts still work (the letter is in the row's tooltip). On a phone the rail is a column of icons; on `/mapa` the whole rail — icons, tab bar and the active layer's block (variants included, as 44 px chips) — appears when you open **Capas y controles** (the layers button above the timeline, Story 22.5; "Controles", with a sliders icon, before), and closing it folds the rail away and leaves it on the Capas tab for next time. While **satellite** or **radar** is on screen the basemap switches to the dark gray canvas even in the light theme, and place labels / boundaries are drawn *above* the imagery at 80 % so they stay readable over cloud tops (Story 21.1); switching back to Base returns to the theme's own canvas. The rail, the timeline pill and the legend bar are dark translucent panels in both themes — content pages keep the regular light/dark look.
3. When a weather layer is active, the **opacity slider** appears inside that layer's block in the rail and changes the layer's transparency live. Each layer has a sensible default opacity (radar 80%, satellite 100%, temperature/humidity/pressure 65–75%).
4. The **legend** (left rail) reflects the active layer:
   - Radar: Ligera / Moderada / Intensa / Nieve.
   - Satellite: no intensity legend (it's imagery).
   - Temperature / Humidity / Pressure: colour ramp with stop labels.
5. The **timeline scrubber** (bottom-centre) appears whenever a weather layer with a time axis is active. Use ‹ / › to step a frame, drag the bar, or press ▶ to play (loops with wrap). **From 640 px up the timeline is a date-scale bar** (Story 23.1), on its own row above the buttons: day labels ("mié 30" — plus the day the bar opens on, at its left edge) and hour labels ("15:00", or "3 p.m." with the 12 h format) whose density adapts to the span — every 30 min on the ~2 h radar axis, every 3–6 h on the 24 h satellite axis, one day label every other day on the 10-day axis — all in the zone and hour format chosen in ⋯ → Ajustes and in the page language. The past is a grey track, the future (forecast layers) is blue, an amber line marks **now** (when the data stops just short of now, as with GeoColor's ~30 min lag, the bar runs on to it so you see the gap) and a white thumb marks the frame on screen. **Press and drag** anywhere on the bar: the frame follows the pointer while you drag (no need to release), and the loop pauses. The **mouse wheel** over the bar steps one frame per notch (at either end the wheel scrolls the page again). After a click on the bar, **← / →** step a frame, **Home / End** jump to the first / last frame, and → past the last frame pulls the 10-day axis. **"Ver 10 días"** is drawn as the **dotted tail** at the right end of the bar: click it, or keep dragging past the end of the bar onto it, and the axis grows to 10 days in place. Below 640 px the pill keeps its single row (▶ ‹ time ›, "Ver 10 días" as a button) — the full-width phone bar comes with Story 23.4. **Jump to a date** (Story 23.3): click (or tap) the **time label** in the pill and a small "Saltar a fecha" box opens above it with the browser's own date-and-time picker, limited to what the active layer can show — the last **10 days** on satellite, **yesterday to +10 days** on the forecast layers (temperature, humidity, pressure, precipitation, wind), and the radar's own ~2 h window. The loop pauses; the map lands on the **frame nearest** the date and time you pick and the link's `t=` follows, so the jump can be shared. Picking a day beyond what is loaded (say five days back on satellite, or +5 d on temperature) pulls the 10-day axis first, exactly like "Ver 10 días", and then lands there. The box shows the allowed range under the input, in the zone and hour format of ⋯ → Ajustes. **Enter** closes it keeping the frame, **Escape** closes it and goes back to the frame you had, and a click anywhere else closes it. From the keyboard: with the timeline focused (click the bar, or Tab to it), press **Enter** to open the same box. On `/mapa` (Story 22.5) the pill shows ▶, the time, "Ver 10 días" and the bar at rest; the step buttons (« ‹ › » and **Ahora**) fade in where they always were when the pointer is over the pill or the keyboard focus is inside it (nothing moves under the cursor), and on a phone they — and "Ver 10 días" — come with the **Capas y controles** panel. On touch screens from 640 px up they always show. Pause with ⏸ or by interacting with prev/next/range. Forecast layers (temperature, humidity, pressure, precipitation, wind) boot on an hourly window from **24 h ago to +48 h** (yesterday comes from the same Open-Meteo call via `past_days=1`, so "hace 24 h" is free — the ‹ day-skip button or a `t=` in the past lands there); the **"Ver 10 días"** chip (or stepping past the last frame) pulls a **10-day, 3-hourly** extension on demand and the axis grows in place — labels switch to "mié 15:00 · +3 d" past 24 h and the day-skip buttons move by 24 h regardless of frame stride. A shared link whose `t=` lies past +48 h pulls the extension automatically. **Satellite and radar play without blank frames** (Story 21.3): the next frame is drawn in a second layer that fades in over the one on screen instead of replacing it. While the loop plays **radar** on `/mapa` or a `/mapa/<capa>/` page, the tiles the current view needs for the next frames (up to 6, capped at ~4 MB ahead) are fetched in the background; panning or zooming, or switching layer, drops what was being fetched and starts over for the new view, and on a second pass the frames come from the browser's HTTP cache (RainViewer allows caching for two days), so it asks for no new tiles. **Satellite is not fetched ahead**: NASA GIBS marks every tile `no-store`, so a tile fetched early would be downloaded again when the frame is drawn — the satellite loop instead waits until the frame it just asked for is on screen before moving on (each tile is downloaded once, and replays re-download, as GIBS requires). Either way, if the next frame is not in yet the loop holds the current one and ▶ shows a spinning **buffering** icon (`aria-busy`) until it is — at most ~3 s, then it moves on anyway. **The loop runs in step with the screen** (Story 23.2): each frame change happens right before the browser paints, the speed setting is kept on average (a frame drawn a few ms late does not push the rest back), a background tab pauses the loop instead of letting it race ahead, and coming back resumes it without a burst of skipped frames. With the **smooth** style, radar and satellite also hold each frame until its cross-fade has finished, so a step never cuts a fade short (before, when tiles loaded slower than the speed setting, every step could flash the base map through a half-faded frame); on a slow connection or device that makes the smooth loop a little slower than the speed setting — pick the **fast** style for the old pace. A fade interrupted by a scrub now cuts cleanly to the new frame. Nothing is prefetched on the home map, on `/forecast`, or when the browser reports a data-saver connection (`navigator.connection.saveData`) — there the loop plays on the plain cadence as before. The **Ajustes** tab of the ⋯ menu (the old ⚙ panel) holds the animation controls (Story 16.4): **loop** (frames within ±3/6/12/24 h of now; the whole axis when fewer than two frames qualify), **speed** (slow / medium / fast = 1200 / 700 / 350 ms per frame), **style** (smooth cross-fades radar and satellite tiles between frames; fast swaps instantly) and the **time label** mode (both / clock / relative) — set it here: since Story 23.3 a tap on the timeline's time label opens the date picker instead of cycling the mode (on the home map, which has no ⋯ menu, the mode chosen on `/mapa` applies). All persist in localStorage and apply live, mid-loop. **Hace 24 h** (next to Capturar, in the ⋯ menu) freezes the current frame as an overlay and moves the timeline a day back, so Mostrar/Ocultar flips between then and now (Story 13.5). The **Incertidumbre** overlay repaints the active field (temperature, humidity, pressure or precipitation) as the spread between ICON, GFS and ECMWF — green where they agree, purple where they diverge — with a "± n entre modelos" line in the tooltip; it fetches the three models on demand and keeps them per layer (Story 13.3). The **Mira** button (next to Distancia / Área, in the ⋯ menu) pins a crosshair to the map centre and prints the active layer's value under it, refreshed as you pan and as the timeline plays — the phone-friendly counterpart of the hover tooltip (Story 18.3); pressure isobars carry their value along the line. The same panel sets the **display units** (Story 19.3: °C/°F, km/h · mph · kt · m/s, hPa/inHg, km/mi); data stays metric underneath and the tooltip, city pills, legend scale, place card, measure tool and `/forecast` re-render on the spot.
6. **Tap anywhere** on the map to open the **place card**: 10 daily rows (Diario) or 48 hourly rows (Horario) for that point, the active layer's reading there, a favourite star and a link to the full forecast. Bottom sheet on phones, floating panel on desktop; Escape or × closes it.
7. **First visit**: `/mapa` and the layer pages show a one-time, non-modal welcome card offering to centre the map on you (same locate flow as the 📍 button; remembered in localStorage, nothing leaves the browser), and each weather layer shows a one-line intro the first time it is activated (Story 19.2).
8. **Sharing / bookmarking**: the URL hash updates as you pan, zoom, change layer, and scrub. Copy-paste the URL to share the exact view + frame; reloading restores it.
9. **Tools menu (⋯)** (Story 22.3): one round **⋯** button under the search row (every viewport, where the ℹ button used to be) opens a popover with three tabs — **Herramientas** (Distancia, Área, Mira, Capturar, Hace 24 h; Limpiar once a snapshot exists), **Ajustes** (the old ⚙ panel: time zone, hour format, loop, speed, style, time label, units) and **Info** (the old ℹ panel: data sources and the active layer's own page, headed by the **Volver al inicio** link that used to float in the map's top-left corner). ←/→ move between tabs; **Escape** closes it and puts the focus back on ⋯; a click outside closes it; picking a tool closes it so your next click lands on the map. While a tool is on — measuring, the crosshair, or a snapshot comparison — **one pill** at the top of the map (under the search row on a phone) names it ("Distancia", "Distancia · Mira", "Comparación"…), shows the running measurement, carries the comparison's **Ocultar / Mostrar** switch and a **Salir** button that turns every active tool off (Escape still ends measuring; with the menu open the first Escape only closes the menu). While measuring, a click on the map adds a point and does not open the place card. The **model toggle** (Auto / ICON / GFS / ECMWF / JMA, bottom-right) only shows while a forecast layer is on — temperature, humidity, pressure, precipitation or wind — since the model changes nothing on satellite, radar, sun or the base map; on a phone it still sits behind **Controles**, which no longer reveals the measure/snapshot tools (they are in ⋯). `/mapa` and the `/mapa/<capa>/` pages have **no +/− zoom or compass buttons** any more: zoom with the mouse wheel, a pinch, a double-click, or the keyboard (+ / − and the arrow keys with the map focused); the home and `/forecast` embeds keep the buttons.
10. **SMN avisos counter** (Story 22.4): when the SMN feed has at least one aviso, a round **⚠ N** counter sits in the top bar, just left of search (dark with an amber ⚠; red when one of them is critical). N counts every aviso once — each state's plus the national ones. Clicking it opens the same SMN alerts widget as before ("Avisos vigentes en el país:", the first 5 rows, "+N más en el feed RSS" beyond that) in a popover under the search row; **Escape** closes it and returns the focus to the counter, a click outside closes it. With no avisos (or no feed) there is **no counter at all** — the old amber "⚠️ Avisos SMN" pill in the bottom-right corner, which showed even with "Sin alertas SMN", is gone.
11. **Keyboard shortcuts panel** (Story 22.5): press **`?`** anywhere on the map page (not while typing in a field), or open ⋯ → **Info** → **Atajos de teclado**, to see every shortcut in a dialog: the general keys (`?`, Esc, + / −, arrows, and **Intro** / Enter on the timeline to jump to a date), one letter per layer (M Mapa base, R Radar, A Satélite, T Temperatura, H Humedad, P Presión, V Viento, L Sol — Precipitación has none) and one per overlay that has one. The list is generated from the layer and overlay definitions, so it cannot drift from what the keys do, and it follows the page language (`?lang=en` shows it in English). Two overlays share a letter with a layer and the layer wins (**T** is Temperatura, not Sistemas tropicales; **A** is Satélite, not Alertas SMN por estado), so the panel — and those overlays' tooltips — list them without a key; switch them from the Superposiciones tab. **Esc**, `?` again, the × button or a click outside closes it and puts the focus back where it was (on ⋯ when you came from the menu). While it is open, letters do not act on the map behind it.
12. **Feedback button on `/mapa`** (Story 22.5): the round report button sits in the top nav bar, next to the language and theme toggles, instead of floating over the bottom-right corner of the full-screen map; it opens the same pre-filled issue dialog.

## Public URL schemas

### `/mapa#view=<lat>,<lng>,<zoom>z&layer=<id>&t=<ISO>`

| Param | Format | Meaning |
|---|---|---|
| `view` | `<lat>,<lng>,<zoom>z` (e.g. `19.43,-99.13,6.5z`) | Map centre + zoom. Validated; out-of-range values fall back to the default Mexico view. |
| `mode` | `precip` | Combined precipitation mode (Story 13.2): GeoColor satellite + cloud overlay + the radar frame nearest the satellite instant, radar legend. Set from the Superposiciones tab of the layer rail; absent = off. |
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

- **Layer rail buttons** are real `<button aria-pressed>` elements with visible `focus-visible` rings. Keyboard users can Tab through them. Each carries the layer's full name as its accessible name even though the tile shows a short label.
- **Capas / Superposiciones** follow the WAI-ARIA tabs pattern (Story 22.2): `role="tablist"`, `aria-selected`, one tab stop with ←/→ (wrapping), Home and End to switch. The overlay filter is a labelled search input; Escape clears it. On `/mapa` the tabs also fold the rail (Story 22.5): the selected tab carries `aria-expanded`, ←/→ move the selection without unfolding, and Escape inside the open rail folds it and focuses its tab.
- **Keyboard shortcuts** (Story 22.5): `?` opens a modal `<dialog>` (labelled "Atajos de teclado"; focus starts on its close button, the page behind is inert, Esc closes and restores the focus). Each section is a headed definition list (`<kbd>` → action).
- **Timeline step buttons on `/mapa`** stay in the tab order and the accessibility tree while transparent at rest; focusing any control in the pill shows them all.
- **Map** has `role="application"` + an `aria-label`; MapLibre's keyboard handler pans (arrow keys) and zooms (+ / −) once the map has focus. The embeds also show MapLibre's `NavigationControl` buttons; `/mapa` and its layer pages do not (Story 22.3).
- **Status messages** (`#mapmsg`) use `aria-live="polite"` so transient errors ("Capa no disponible", "No se pudo obtener tu ubicación", etc.) are announced without interrupting reading flow.
- **Timeline timestamp** (`#tl-time`) uses `aria-live="polite"` + `aria-atomic="true"` so scrubbing announces the new frame time.
- **Timeline bar** (Story 23.1): the drawn bar is `aria-hidden`; the accessible control behind it is still the native range `#tl-range` (labelled "Línea de tiempo"), visually hidden but in the tab order and the accessibility tree, and kept in sync with the bar both ways. Its `aria-valuetext` is the full date and time plus the offset ("miércoles, 30 de septiembre, 15:00 · −3 h"), not a frame number. Pressing the bar moves the focus to it; when it has keyboard focus the bar (the whole pill below 640 px, where the bar is not drawn) shows the focus ring. ← → Home End step it (→ past the end extends to 10 days); ↑ ↓ PageUp PageDown keep their native range behaviour. On a phone with `/mapa`'s compact chrome it comes with the **Capas y controles** panel, like ‹ ›.
- **`prefers-reduced-motion: reduce`** disables timeline autoplay — the ▶ button is disabled (`data-state="paused"`) and labelled accordingly, and `/mapa` opens on a still satellite frame instead of the 3 h loop (Story 21.2); manual prev / next / range scrubbing still works. A data-saver connection (`navigator.connection.saveData`) also skips the boot loop. MapLibre's `flyTo` animations are also suppressed under reduced motion.
- **Spanish-first**: every UI string is Spanish by default; English strings exist in the i18n table for future routing.
- **XSS-safe**: all dynamic strings injected into popups, legends, and labels pass through an HTML-escape helper.

## Responsive behavior

The site is mobile-first and tested at four representative breakpoints. There are no hard `min-width` media queries to "switch into" desktop — layout adapts continuously via Tailwind's responsive utilities and CSS grid.

| Breakpoint | Width | Reference device | Layout traits |
|---|---|---|---|
| **mobile** | 375–640 px | iPhone SE, modern Android phones in portrait | 1-column card grid; search input + "Mi ubicación" stack vertically on the narrowest widths; hero typography scales down (`text-5xl → text-4xl`); a slim 48 px sticky topbar (`aria-label="Principal"`) holds the brand, `Inicio` / `Mapa` nav and the theme toggle; feedback FAB floats bottom-right (on the home it lives in the footer instead, and on `/mapa` in the nav bar, so it never covers the map). |
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
  - Layer rail: a single column of icons on phones, a 3-column grid of icon + short-label tiles from `sm` (640 px) up (Story 22.2); mobile users tap, desktop users hover-then-click. No collapse-to-burger. With a layer active the desktop rail takes at most 9 visual rows (7 with satellite: tabs, 3 tile rows, 2 rows of variant chips, opacity).
  - Timeline scrubber stays bottom-center at all widths: one row below 640 px, two rows from 640 px (date-scale bar on top, buttons and time under it; the bar is 22 rem wide, 28 rem from 1024 px — Story 23.1).
  - The opacity control lives inside the active layer's block in the rail, and the legend sits on the left under it, so neither fights the timeline for the bottom of the screen.
- **`/privacidad`**
  - Long-prose layout with a single readable column (`max-w-prose` style); identical at every breakpoint apart from the global `max-w` cap.

### Things that intentionally don't change

- **Spanish-first**: all viewports show the same Spanish strings; no locale-by-viewport switch.
- **Dark mode**: same colour palette at every breakpoint; theme toggle visible at every breakpoint.
- **Map controls** (zoom +/−): on the embeds MapLibre's `NavigationControl` placement is fixed and never collapses, even on mobile; `/mapa` has no zoom buttons (pinch / wheel / keys, Story 22.3).

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
- **Time label** in the timeline is formatted in `es-MX` locale. Multi-locale time formatting is a non-goal for v1. (The date-scale bar of Story 23.1 and the range's spoken value do follow the page language — `?lang=en` gives "Wed 30" / "3 PM".)
- **Field-layer playback animation** uses simple frame swaps without preloading; preloading/caching is a polish item. (Radar is prefetched since Story 21.3 and satellite waits on its A/B swap — GIBS tiles are `no-store`, so prefetching them would only double the download; the radar companion of the combined precipitation mode is not prefetched.)
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
  are counted; **43 / 27** with the Story 22.2 rail tabs; **28 / 19** since
  Story 22.3 moved the tools, ⚙, ℹ and the back link into the ⋯ menu,
  dropped the MapLibre zoom/compass buttons on `/mapa` and shows the model
  toggle only with a forecast layer; **27 / 18** since Story 22.4 turned
  the SMN pill into a top-bar counter that only shows with avisos — the
  spec serves a quiet SMN feed, so the number never depends on the week's
  weather; with avisos it is one more). It fails when a PR adds a control
  over the map *and* when one is removed: the story that removes it records
  the new number in `VARIANTS[].baseline` and in the "Hoy" column of
  [`PLAN_PARIDAD_VISUAL.md`](PLAN_PARIDAD_VISUAL.md) §5.
  **8 / 5** since Story 22.5: the `/mapa` rail starts folded to its two
  tabs, the timeline's « ‹ › » Ahora show on hover/focus (on a phone
  with the Capas y controles panel, as do "Ver 10 días" and the layer
  icons) and the feedback button moved to the nav bar.
- **budget** (≤ 8 desktop, ≤ 5 mobile, plan §1.2) — a real test since
  Story 22.5 (it was `test.fixme` while Stories 22.2–22.4 lowered the count).

The state measured is the one a returning visitor sees: satellite layer
with its loop running (the Story 21.2 boot), nothing clicked, welcome card
already dismissed; the spec mocks GIBS too and waits for the pressed
satellite button + the playing ▶ rather than `map.loaded()`, which never
settles while frames animate. MapLibre markers/popups and the
attribution link are not counted (data and legal text, not chrome); the
SMN counter is when it shows (so were the MapLibre zoom/compass buttons
and the back link until Story 22.3 took them off the map, the always-on
SMN pill until Story 22.4, and the feedback FAB until Story 22.5 moved it
to the nav bar). A control made transparent (`opacity: 0`, the timeline's
step buttons at rest) is not visible chrome and does not count. The pure decision (rects → count) is
`src/lib/map/chrome/chrome-budget.ts`, unit-tested in
`chrome-budget.test.ts`; the spec only measures. Tiles are mocked, so the
spec runs on any machine:

```sh
npx playwright test e2e/chrome-budget.spec.ts
```

The boot and the count live in `e2e/chrome-budget-helpers.ts`, shared with
the UX metrics spec below.

### UX metrics on every PR (Story 26.2)

`e2e/ux-metrics.spec.ts` measures the four numbers of
[`PLAN_PARIDAD_VISUAL.md`](PLAN_PARIDAD_VISUAL.md) §5 on a cold `/mapa` load
(the same mocked boot as the chrome budget, so they never depend on the
network or the week's weather):

| Number | How |
|---|---|
| Time to first satellite frame | `startTime` of the `mw:first-satellite-frame` User Timing mark, which the app sets once, when every tile of the first satellite frame is on the canvas (`src/lib/map/chrome/first-frame-mark.ts`) |
| Loop fps | `requestAnimationFrame` callbacks per second over the first 10 s of the boot loop, plus as context: the longest gap between two, the loop's step cadence (median and longest time between frames) and a **long-task sample** — a `PerformanceObserver` started on the loop's first frame and stopped after that window, reported as count, total, longest and the 5 longest with their offset into the loop (Story 23.2) |
| Visible controls | the chrome-budget count at 1280×800 and 360×640 |
| Tiles per frame, 2nd loop | GIBS tile requests between the start of the loop's second pass and its third, and how many ask for a URL never requested before ("new tiles", the §5 metric). Request interception turns off Chromium's HTTP cache, so the raw count includes MapLibre re-fetching tiles it already had |

It writes `test-results/ux-metrics.json`. The **UX metrics** workflow
(`.github/workflows/ux-metrics.yml`) runs it on every pull request to
`main`, uploads the JSON as the `ux-metrics` artifact and keeps **one** PR
comment up to date with the four numbers, the change since the previous run
of that PR, the targets and a status. Targets are soft for now (a missed one
is a warning annotation on the run, never a failure); the job fails only
when a number cannot be measured. The main E2E job skips this spec
(`--grep-invert @ux-metrics`). The numbers come from headless Chromium
without a GPU, so the fps and the first-frame time are pessimistic next to a
real phone; compare them run to run, not against a device.

```sh
npx playwright test e2e/ux-metrics.spec.ts   # → test-results/ux-metrics.json
```

The pure helpers (fps window, loop passes, new tiles, long-task sample,
step cadence, warnings, comment rendering) are in `scripts/ux-metrics-lib.mjs` and the comment upsert in
`scripts/ux-metrics-comment.mjs`, unit-tested in
`src/lib/ux-metrics-lib.test.ts` and `src/lib/ux-metrics-comment.test.ts`.

## Related docs

- **E2E user-journey reference** (selectors, journey-by-journey Playwright drives, network mocks, coverage matrix): [`USER_JOURNEYS.md`](USER_JOURNEYS.md)
- **Design spec** (engineering): `docs/superpowers/specs/2026-05-18-weather-maps-design.md`
- **Implementation plans** (one per slice): `docs/superpowers/plans/2026-05-1[68-9]-weather-maps-slice-*.md`
- **Rich location forecast spec**: `docs/superpowers/specs/2026-05-16-rich-location-forecast-design.md`
- **Roadmap**: [`ROADMAP.md`](../ROADMAP.md)
- **Setup**: [`SETUP.md`](../SETUP.md)
