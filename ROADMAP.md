# Roadmap — Clima México

Forward-looking roadmap with epics, user stories and tasks. The
historical "Done" log lives at the bottom.

## Status snapshot (May 2026)

- **92 statically generated pages** across `/clima/<slug>/` (30 cities),
  `/playa/<slug>/` (14 beaches), `/estado/<slug>/` (32 states),
  `/volcan/<slug>/` (7 volcanoes), plus 4 category indexes and the
  legacy `/forecast`, `/mapa`, `/pregunta`, `/privacidad` routes.
- **9 hourly / 15-min / monthly GitHub Action snapshots** powering
  every live data source statically: AQI, marine, fires, hurricanes
  (IBTrACS), MX cities geocoding, climate baselines, quakes + storms,
  per-city forecasts, OG images, SMN avisos + per-state index,
  field-grids for the map.
- **SMN avisos** surfaced on every detail page + `/forecast` + `/mapa`
  via the static reverse-geocode (`mx-states.geojson` + ray-casting
  point-in-polygon).
- **Reciprocal SEO cross-link graph**: ciudad ↔ estado ↔ playa, estado
  ↔ volcán. Every landing reachable from any other in ≤2 hops.
- **Per-page Open Graph PNGs** (83 unique 1200×630 images, regenerated
  by `og-images.yml` on TS list changes).
- **JSON-LD structured data** on all landings (City / Beach /
  AdministrativeArea / Mountain + BreadcrumbList).
- **410 unit tests + 36 e2e tests** passing, all green.

## North-star principles

Non-negotiable. Every roadmap item is evaluated against these.

1. **Alerts first** — severe weather is the most important content.
2. **Two-tap forecast** — landing on `/` to seeing local weather must
   never exceed two interactions.
3. **Privacy is the feature** — no accounts, no cookies, no tracking,
   no API keys, no backend. Ever.
4. **Mobile-native** — assume cellular, assume one hand, target <2 s
   LCP.
5. **Spanish-native, English-friendly** — es-MX is canonical; en-US is
   a serious second-class citizen, not an afterthought.
6. **Static-first, live as fallback** — every data source has a static
   cache path. Live calls only when cache is unavailable.

## Anti-features (will not build)

| Anti-feature | Why not |
|---|---|
| User accounts / login | Privacy principle. Favorites stay in localStorage. |
| Cookie consent banners | No cookies → no consent → no banner. |
| Server-side analytics | Privacy + no-backend principles. |
| Ads | Hostile to the user. |
| Auto-playing media | Hostile to bandwidth + battery. |
| Push notifications without per-event opt-in | Spam vector. |
| Email signups / newsletter prompts | Out of scope. |
| Modal overlays on first visit | User-hostile interruption. |
| Carousel heroes | Objectively poor UX. |
| Server-rendered API proxies | Defeats the no-backend constraint. |

## Roadmap structure

The roadmap is organized into **epics** (strategic groupings) →
**stories** (user-facing slices) → **tasks** (engineering work). Each
epic has a **goal**, a **success metric**, and **dependencies**.

Priority tiers:

- **P0** — ship next, real gaps with high impact
- **P1** — strong improvements, well-bounded
- **P2** — bigger or more opinionated, ships after P0/P1
- **P3** — nice-to-have / longer horizon

---

## Epic 1 — Alerts First (P0)

**Why.** During severe weather (hurricane, frente frío, heat wave) the
SMN avisos are the single most important content on the site. They're
surfaced *within* detail pages but never above-the-fold on `/`. A user
landing on the homepage during an active hurricane sees no indication
anything is wrong until they scroll to their favorite card.

**Goal.** Make active severe alerts impossible to miss. From any page,
within one viewport without scrolling, the user knows whether something
serious is happening in their part of the country.

**Success metric.** When `smn-by-state.json.global` contains a
`severity=critical` aviso, every page renders an alert ribbon above
the fold. Manually verifiable.

**Dependencies.** None — builds on existing `smn-by-state.json` index
and `<SmnAvisos>` component.

### Story 1.1 — National alert ribbon on every page (P0)

> As a user landing on Clima México during severe weather, I want to
> see an immediate banner indicating there's an active national alert,
> so I can act on it without hunting for information.

**Acceptance criteria**

- When `smn-by-state.json.global` contains an aviso with
  `severity=critical`, a slim red bar renders at the very top of
  `<BaseLayout>` (above the sticky nav).
- The bar shows the aviso title (truncated to ~80 chars) + a "Ver
  detalles" link to `/rss.xml`.
- Dismissible per-session (sessionStorage, NOT localStorage — re-shows
  on next visit).
- When no critical global aviso is active, the bar doesn't render at
  all (no empty box, no skeleton).
- Renders above the fold on mobile portrait at 360×640.

**Tasks**

- [ ] `src/layouts/BaseLayout.astro` — fetch SMN doc on every page
  (already browser-cached after first load), render conditional ribbon
  above nav. Defer fetch behind `requestIdleCallback`.
- [ ] Dismiss handler writes to `sessionStorage['mw:smn-dismiss']`.
- [ ] Style: solid red background (`bg-red-600`), white text, X close
  button on the right.
- [ ] E2e test: fixture with critical aviso → ribbon visible. Without
  one → no ribbon element in DOM.

**Implementation notes.** The ribbon must use `position: relative` (not
fixed) so it doesn't cover content on `/mapa` which uses `100dvh`. The
sticky nav already accounts for nav height; the ribbon stacks above so
the calc may need adjustment.

### Story 1.2 — Per-state critical-alert highlight on `/mapa` (P1)

> As a /mapa user, I want to instantly see which Mexican states have
> active critical alerts, without clicking individual markers.

**Acceptance criteria**

- Faint red overlay tint on each MX state polygon with a
  `severity=critical` aviso.
- Toggleable via a new entry in the map's layer rail ("Alertas SMN").
- Updates without page reload.
- Opacity tunable via the existing opacity slider.

**Tasks**

- [ ] Reuse `public/data/mx-states.geojson` already shipped for the
  SMN widget.
- [ ] Add a MapLibre fill layer keyed off a feature property: extend
  the GeoJSON with `severity` at build time, OR resolve client-side
  on layer activation.
- [ ] Layer-rail entry in `interactive-map.ts` under a new "Alertas"
  section.
- [ ] Smooth 200 ms transition on layer add/remove.

### Story 1.3 — `/huracanes/` active-systems index (P2)

> As a storm watcher during hurricane season, I want a single page
> listing every active named system with its forecast track, so I can
> monitor without zooming around the map.

**Acceptance criteria**

- New route `/huracanes/` listing current Atlantic + East Pacific
  systems from `storms-snapshot.json`.
- Each system: name, classification (TD/TS/HU), max wind, central
  pressure, latest advisory time.
- Embedded mini-map per system showing latest position + forecast cone
  (if available in NHC data).
- Auto-redirect to `/` when zero active systems.
- Indexed in sitemap only when active.

**Tasks**

- [ ] Extend `scripts/build-storms-snapshot.py` to emit forecast cone
  polygons when NHC provides them.
- [ ] `src/pages/huracanes/index.astro` reading the snapshot.
- [ ] Sitemap.xml.ts: emit `/huracanes/` only when storms-snapshot has
  features.
- [ ] Cross-link from the catalog dropdown.

---

## Epic 2 — Local-Aware Home (P0)

**Why.** A first-time visitor without favorites sees 5 generic preset
cities, none of them their city. They have to know how to search. The
geolocation feature exists only inside `/mapa`.

**Goal.** A first-time visitor sees their local forecast in two taps:
land on `/` → tap "Mi clima" → grant permission → see forecast.

**Success metric.** Time-to-local-forecast for a fresh user ≤5 s on
4G, ≤10 s on Slow 3G.

**Dependencies.** Existing `state-by-coords.ts` polygon lookup.

### Story 2.1 — "Mostrar mi clima" button on `/` (P0)

> As a first-time visitor, I want a clear way to see weather for my
> current location without typing.

**Acceptance criteria**

- Prominent button above the search bar labeled "📍 Mostrar mi clima".
- Click → `navigator.geolocation.getCurrentPosition` with timeout=8 s.
- Permission granted + coords resolved:
  - Coords map to a TOP_CITIES entry within 5 km → redirect to
    `/clima/<slug>/`.
  - Otherwise → redirect to
    `/forecast/?lat=&lng=&tz=America/Mexico_City`.
- Permission denied → toast: "Necesitamos tu permiso para mostrar el
  clima local. Usa la búsqueda."
- Geolocation unavailable (older browsers) → button hidden.
- Coords outside MX → toast: "Parece que estás fuera de México.
  ¿Buscar otro lugar?"

**Tasks**

- [ ] New button in `src/pages/index.astro` above the existing
  combobox.
- [ ] JS handler:
  `getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 })`.
- [ ] Reuse `findSlugByCoords` from `src/lib/city-snapshot.ts`.
- [ ] Reuse `resolveStateByCoords` from `src/lib/state-by-coords.ts`
  for the outside-MX check.
- [ ] A11y: button has `aria-label`, focus ring, keyboard-activatable.
- [ ] Loading state during geolocation request.

### Story 2.2 — Reverse-geocode hint after manual coord entry (P1)

> When a user navigates to `/forecast/?lat=X&lng=Y` and coords map to a
> known metro within 10 km, suggest the curated page.

**Acceptance criteria**

- On `/forecast/`, after the initial render, check if (lat, lng) is
  within 10 km of any TOP_CITIES entry.
- If yes, render a non-blocking banner: "📍 ¿Buscabas Guadalajara?
  Ver la página dedicada."
- Banner dismissible per-session.
- No banner when reached via the curated `/clima/<slug>/` route.

**Tasks**

- [ ] On forecast.astro post-mount: if URL params have lat/lng and
  `findSlugByCoords` resolves, render the banner.
- [ ] Track dismissals via sessionStorage.

### Story 2.3 — Highlight most-checked favorite (P2)

> As a returning user with 3+ favorites, I want the one I check most
> often to be visually emphasized.

**Acceptance criteria**

- localStorage tracks per-favorite `lastViewedAt` updated when the user
  clicks a card's "Pronóstico completo".
- On `/`, the favorite with the most-recent `lastViewedAt` renders in
  a wider card (or with a "★ Favorito frecuente" subtle tag).
- No tracking outside localStorage.
- Falls back gracefully when no view history exists.

**Tasks**

- [ ] `src/lib/favorites.ts`: extend Favorite type with optional
  `lastViewedAt`.
- [ ] Click handler on `.js-full` link writes the timestamp.
- [ ] `renderFavorites()` sorts by `lastViewedAt` desc and applies
  emphasis class to index 0.

---

## Epic 3 — Forecast Depth (P1)

**Why.** `/forecast/` has all the data (current + 48-h hourly + 7-day
+ sunrise/sunset + UV + wind + climate baseline) but treats every field
equally. Critical numbers compete with low-stakes details. And
`/clima/<slug>/` is even thinner — missing AQI, marine, climate-anomaly
context.

**Goal.** Every forecast view shows the right data prominently for that
location: AQI when polluted, marine when coastal, climate-anomaly when
unusual, sunrise/sunset visually rather than text.

**Success metric.** A user can answer these in <3 s glancing at the
page: "Should I bring an umbrella?" "Is the air OK to exercise
outside?" "Is the water warm enough at the beach?" "Is this normal for
this date?"

**Dependencies.** Existing AQI, marine, climate-baseline snapshots
(all static).

### Story 3.1 — AQI panel (P1)

> As a user with asthma planning a run, I want to see the current air
> quality prominently, not buried in a detail panel.

**Acceptance criteria**

- New "Calidad del aire" panel below the current-conditions row on
  both `/forecast/` and `/clima/<slug>/`.
- Shows PM2.5 (μg/m³) + EPA color band (Buena / Moderada / Mala / Muy
  mala / Peligrosa) + brief recommendation.
- Sourced from `public/data/aqi-snapshot.json`. When no nearby station
  (within 50 km), panel hidden.

**Tasks**

- [ ] New component `src/components/AqiPanel.astro` accepting `coords`.
- [ ] Client-side find-nearest in the AQI snapshot features
  (Haversine, ~32 stations).
- [ ] Port the EPA color map from
  `scripts/build-aqi-snapshot.py` to TS.
- [ ] Embed in `/forecast/` (always) and `/clima/[slug].astro`
  (build-time coords).
- [ ] Unit tests for nearest-station resolution.

### Story 3.2 — Climate-anomaly badge (P1)

> When today's expected high is unusually hot or cold for this date, I
> want a clear visual signal so I dress accordingly.

**Acceptance criteria**

- On `/forecast/`, next to today's high: badge like "+3° encima del
  promedio histórico" (red for above, blue for below, gray within
  ±1°).
- Sourced via `getClimateAnomaly` from `src/lib/forecast.ts`.
- Hidden when no nearby (100 km) baseline city.

**Tasks**

- [ ] Wire `getClimateAnomaly` result into the existing forecast.astro
  render path. The function already exists; nothing currently
  displays its output prominently.
- [ ] Color thresholds: ≥+3°/red, ≥+1°/orange, ≤-3°/blue, ≤-1°/light
  blue, otherwise hidden.
- [ ] Same badge on `/clima/<slug>/` "Ahora" panel.

### Story 3.3 — Marine panel on coastal `/forecast/` (P1)

> When the location is on the coast, show wave height + SST without
> going to a separate page.

**Acceptance criteria**

- On `/forecast/`, if (lat, lng) is within 10 km of MX coast, render a
  "Mar" panel with wave height + SST + qualifier.
- Coast detected via TOP_BEACHES list — if any beach is within 10 km,
  use its data.
- Hidden inland.

**Tasks**

- [ ] Write `loadMarineSnapshot()` client (similar to
  `loadSmnAvisos`).
- [ ] Haversine find-nearest TOP_BEACHES entry; if ≤10 km, look up
  snapshot features by name.
- [ ] Component `src/components/MarinePanel.astro` (port from inline
  render in `playa/[slug].astro`).

### Story 3.4 — Visual daylight curve (P1)

> Replace "Salida 06:12 / Puesta 19:34" text with a small SVG showing
> the sun's arc and current position.

**Acceptance criteria**

- 60-px-tall inline SVG arc: curve from sunrise to sunset, filled
  "day" region, current-time marker dot on the arc.
- Numerical labels for sunrise/sunset below the arc.
- Renders inside "Detalle del cielo" panel on `/forecast/`.
- Recomputes on next render if user keeps the tab open across a day
  boundary.

**Tasks**

- [ ] Pure-Astro SVG component, no extra deps.
- [ ] Math: arc parameterized by (sunrise → sunset) time;
  current position = `(now - sunrise) / (sunset - sunrise)` clamped.
- [ ] Dark-mode color variants.

### Story 3.5 — Wind direction visualization (P1)

> Show wind direction as an arrow, not just a degree number.

**Acceptance criteria**

- Next to the wind speed value, render a small arrow rotated to match
  direction (e.g., NE = top-right).
- Tooltip on hover: full direction name + degrees ("Noreste · 67°").
- A11y: `aria-label="Viento del Noreste, 15 km/h"`.

**Tasks**

- [ ] SVG arrow inline; CSS `transform: rotate(Xdeg)` from a data
  attribute.
- [ ] Reuse `windDir()` from `src/lib/forecast.ts`.

### Story 3.6 — Forecast freshness indicator (P1)

> When my `/forecast/` tab has been open for hours, tell me the data
> is stale + how to refresh.

**Acceptance criteria**

- Small line at top of forecast: "Última actualización hace 4 h ·
  [Actualizar]".
- Threshold: data older than 1 h (Open-Meteo refresh cadence).
- Click "Actualizar" triggers a re-fetch.
- Hidden on fresh load.

**Tasks**

- [ ] Track fetch timestamp in module state.
- [ ] `setInterval(checkStaleness, 60_000)` toggles indicator
  visibility.
- [ ] Pattern mirrors the SMN staleness indicator in `<SmnAvisos>`.

---

## Epic 4 — Discoverability (P1)

**Why.** We shipped 88 landing pages across 4 categories, but the
top-level nav still only shows Inicio / Mapa / Pregunta. Users have no
way to discover the catalog except via the sitemap.

**Goal.** Catalog visible without cluttering the nav.

**Success metric.** A user can find any of the 88 landings via in-page
navigation in ≤3 clicks from `/`.

### Story 4.1 — Catalog dropdown in top nav (P1)

> As a returning user, I want a "Catálogo" menu that lets me jump to
> any city/beach/state/volcano index.

**Acceptance criteria**

- New "Catálogo ▾" entry in the top nav, between "Inicio" and "Mapa".
- Click/hover opens a dropdown with: Ciudades, Playas, Estados,
  Volcanes — each linking to the corresponding index.
- Keyboard accessible (Enter/Space opens, arrow keys navigate, Escape
  closes).
- Closes on click-outside.
- Mobile: turns into a 4-row vertical list in the existing nav.

**Tasks**

- [ ] Dropdown in `src/layouts/BaseLayout.astro`.
- [ ] Vanilla JS for hover/click/keyboard handling (no library).
- [ ] Test in `e2e/cross.spec.ts`: open dropdown, navigate to each
  entry.

### Story 4.2 — Search box on index pages (P2)

> On `/clima/` (30 entries) and `/estado/` (32 entries), a search
> filter beats scrolling.

**Acceptance criteria**

- Above the grid: a text input that filters the list as you type.
- Diacritic-insensitive, case-insensitive substring match on name +
  admin.
- Empty input shows all; debounced 100 ms.
- "Sin resultados" state when no entries match.

**Tasks**

- [ ] Vanilla JS in each index page; ~30 lines.
- [ ] No new module needed.

---

## Epic 5 — Comparison & Sharing (P2)

**Why.** A trip planner comparing destinations currently opens
multiple tabs. A user wanting to text "look at this storm" copies the
URL manually. Web Share API would close the loop.

**Goal.** First-class flows for comparing and sharing.

### Story 5.1 — Compare view at `/compara/?slugs=` (P2)

> As a trip planner, I want to view 2-4 city forecasts side by side
> with synchronized day columns.

**Acceptance criteria**

- New route `/compara/?slugs=cdmx,guadalajara,monterrey` (1-4 slugs).
- One column per slug with: current temp + condition, today's
  high/low/rain, next 3 days.
- Synchronized vertical alignment so day rows match across columns.
- Mobile: stacks vertically.
- "+ Agregar ciudad" button below the columns when <4 selected.

**Tasks**

- [ ] `src/pages/compara/index.astro` with URL param parsing.
- [ ] Reuse `loadCitySnapshot` per slug.
- [ ] Layout: CSS grid with one column per slug, responsive collapse
  at sm.

### Story 5.2 — Web Share API integration (P2)

> One-tap share to WhatsApp/iMessage/Twitter/Telegram from any landing
> or forecast page.

**Acceptance criteria**

- Share button on `/clima/<slug>/`, `/playa/<slug>/`,
  `/estado/<slug>/`, `/volcan/<slug>/`, `/forecast/`.
- Uses `navigator.share({ title, text, url })` when available.
- Fallback (desktop, older browsers): copies URL to clipboard + brief
  toast.
- Title/text pre-filled with location + current conditions when
  snapshot data is available.

**Tasks**

- [ ] `src/components/ShareButton.astro` accepting `title`,
  `description` props.
- [ ] Feature detection: `if ('share' in navigator)`.
- [ ] Embed in all detail pages.

### Story 5.3 — Shareable favorites URL (P2)

> As a power user, I want to share my "dashboard" of favorite cities
> via a URL (no account).

**Acceptance criteria**

- New route `/favoritos/?slugs=cdmx,monterrey,merida` rendering the
  same compare view but marking the slugs as favorites.
- "Importar como favoritos" button writes them to localStorage.
- "Copiar enlace de mis favoritos" button on `/` generates the URL
  from current localStorage state.

**Tasks**

- [ ] Reuse the compare view template.
- [ ] localStorage write handler with the existing cap check (max 12
  favorites).
- [ ] Encode favorites in URL fragment.

---

## Epic 6 — Internationalization (P2)

**Why.** Currently es-only. `src/i18n/ui.ts` has both `es` and `en`
maps but English is never selected. Tourists, expats, and business
travelers would benefit. Doubles addressable audience.

**Goal.** Every page renders in English with a one-tap language toggle
that persists per-session.

**Success metric.** A monolingual English speaker can complete the
core journey (land → see local forecast → see alerts) entirely in
English.

### Story 6.1 — Language toggle in nav (P2)

> As an English-only user, I want to switch the entire site to English
> in one tap.

**Acceptance criteria**

- "ES / EN" toggle in the nav next to the theme switcher.
- Click swaps the language; stored in sessionStorage.
- Persists across navigation within the same session.
- Initial language inferred from `navigator.language` on first visit.

**Tasks**

- [ ] BaseLayout: read sessionStorage `lang` on first paint (inline
  script, like the theme one).
- [ ] All pages: pass `lang` prop to BaseLayout, read from
  sessionStorage at runtime.
- [ ] Toggle handler updates sessionStorage + reloads (simplest) or
  hot-swaps strings (better but more work).

### Story 6.2 — Wire all `t.foo` strings into both locales (P2)

> Audit + fill every translation string.

**Acceptance criteria**

- `src/i18n/ui.ts` has matching keys + values in both `es` and `en`.
- No hardcoded Spanish in any `.astro` or component.
- E2e test: set lang=en, navigate, assert key strings render in
  English.

**Tasks**

- [ ] Grep for hardcoded Spanish strings in templates; move to `ui`
  map.
- [ ] Fill missing `en` translations.
- [ ] Add `lang` prop wiring through every page.

### Story 6.3 — Per-page hreflang meta (P3)

> When a user shares a URL in English, the receiver in Spanish should
> see Spanish.

**Acceptance criteria**

- Each page emits `<link rel="alternate" hreflang="es" href="..."/>`
  and `<link rel="alternate" hreflang="en" href="..."/>`.
- URLs use a path prefix `/en/...` for English.
- Google's hreflang discovery works (verifiable via Search Console).

**Tasks**

- [ ] Decide URL strategy: path prefix vs. query param. Path prefix is
  more conventional for SEO.
- [ ] Generate parallel pages for both languages via Astro
  `getStaticPaths`.
- [ ] Update sitemap to include both language variants.

---

## Epic 7 — Mobile + Install (P0 audit + P3 polish)

**Why.** Median visitor is on mobile. We've never run a focused mobile
audit since the early phases. New widgets (`<SmnAvisos>`, alert badges,
`/mapa` floating pill) need mobile-specific scrutiny.

**Goal.** Touch-friendly, viewport-respecting, install-promotable.

### Story 7.1 — Mobile UX audit (P0)

> A focused pass through every page on a 360×640 viewport with thumb
> reachability in mind.

**Acceptance criteria**

- Each page surveyed: `/`, `/mapa`, `/forecast`, `/clima/cdmx`,
  `/playa/cancun`, `/estado/jalisco`, `/volcan/popocatepetl`.
- For each: tap-target size ≥44 px, no horizontal overflow, primary
  action thumb-reachable.
- Identified issues filed as discrete fix tasks.

**Tasks**

- [ ] Run Chrome DevTools mobile emulation; capture screenshots per
  route.
- [ ] Score against WCAG 2.1 mobile guidelines.
- [ ] Known concerns to validate: `<SmnAvisos>` pile-up on `/clima` at
  narrow viewports, `/mapa` SMN pill vs iOS home indicator, preset
  grid density.

### Story 7.2 — iOS PWA install hint (P3)

> iOS Safari doesn't auto-trigger the install banner. Help users find
> Share → Add to Home Screen.

**Acceptance criteria**

- On iOS Safari (UA detect), after the second visit (sessionStorage
  counter), show a subtle bottom-sheet: "📱 Añadir a inicio: tap
  Compartir → Añadir a pantalla de inicio".
- Dismissible.
- Hidden when standalone mode is detected (already installed).
- Not shown on Android (native handling).

**Tasks**

- [ ] iOS UA detection.
- [ ] sessionStorage visit counter.
- [ ] Bottom-sheet component, dismissible.

### Story 7.3 — Print stylesheet (P3)

> A user wanting to print a 7-day forecast for an outdoor event should
> get a clean, ink-economical page.

**Acceptance criteria**

- `@media print` rules in `global.css`:
  - Hide nav, footer, SMN ribbon, floating elements.
  - Render forecast as a single-column flow.
  - High-contrast text on white background regardless of theme.
  - Show full URL in headers.

**Tasks**

- [ ] CSS additions only; no JS.
- [ ] Manually verify in Chrome's print preview for each detail page.

---

## Epic 8 — Quality (P0)

**Why.** We've shipped 16+ PRs without recent perf/a11y audits. New
widgets all introduce a11y surface area.

**Goal.** Maintain "0 critical / 0 serious" axe baseline and meet
Core Web Vitals across the site.

**Success metric**

- Lighthouse Performance ≥90 on `/`, `/forecast/?lat=&lng=`,
  `/clima/cdmx/`.
- Lighthouse Accessibility ≥95 across the board.
- 0 critical / 0 serious axe findings on every page family.

### Story 8.1 — a11y audit refresh (P0)

> Re-run axe on every page family with the new widgets in place.

**Acceptance criteria**

- Run `@axe-core/playwright` against `/`,
  `/forecast/?lat=19.43&lng=-99.13`, `/clima/cdmx/`, `/playa/cancun/`,
  `/estado/jalisco/`, `/volcan/popocatepetl/`, `/mapa/`.
- All criticals + serious findings fixed.
- Findings documented in PR description.

**Tasks**

- [ ] Add `@axe-core/playwright` to e2e suite if not already.
- [ ] One test per page family asserting 0 critical / 0 serious
  violations.
- [ ] Likely fixes: `<SmnAvisos>` `<details>` needs proper
  `aria-expanded` semantics, `/mapa` floating pill needs focus
  management, alert ribbon needs `role="alert"`.

### Story 8.2 — Core Web Vitals baseline (P0)

> Establish a perf baseline and identify regressions early.

**Acceptance criteria**

- Lighthouse CI runs in PR builds
  (`.github/workflows/lighthouse.yml`).
- Targets: LCP <2.5 s, INP <200 ms, CLS <0.1.
- Regressions >5% block merge.

**Tasks**

- [ ] Verify Lighthouse workflow runs on every PR + captures scores.
- [ ] Set perf budgets in `lighthouse.config.js`.
- [ ] Investigate the maplibre-gl bundle (~800 KB) — code-split or
  alternative?

### Story 8.3 — Bundle audit (P1)

> Identify the heaviest deps and decide if any can be lazy-loaded or
> replaced.

**Acceptance criteria**

- `vite-bundle-visualizer` output committed to docs/ for reference.
- Each chunk >50 KB has a written justification.

**Tasks**

- [ ] Run `npx vite-bundle-visualizer` on `dist/`.
- [ ] Specifically investigate: maplibre-gl (~800 KB),
  interactive-map.js (~95 KB).
- [ ] Document findings; ship any lazy-load opportunities as separate
  PRs.

---

## Epic 9 — Outdoor Mode (P3)

**Why.** Pollen sufferers, sun-sensitive folks, and outdoor planners
want a different lens on the data.

**Goal.** A "Modo aire libre" view that emphasizes UV, AQ, wind chill,
gusts.

### Story 9.1 — Outdoor planner mode (P3)

> As a parent planning a weekend activity, I want a "Modo aire libre"
> view that highlights today's risks.

**Acceptance criteria**

- New toggle on `/forecast/`: "Modo aire libre".
- When active: hides irrelevant fields (humidity, pressure),
  emphasizes UV / AQI / wind gusts.
- Adds a risk-color overlay on each day of the 7-day forecast.

**Tasks**

- [ ] Toggle in forecast.astro; reflows detail panels.
- [ ] Risk scoring (UV ≥8 = red, AQI >100 = red, gusts ≥40 = red).
- [ ] Per-day risk badges.

### Story 9.2 — Pollen panel (P3, blocked)

> Pollen counts for major MX cities.

**Acceptance criteria** — Pending. MX doesn't have a free public
pollen API. Could integrate Open-Meteo's experimental pollen endpoint
if it covers MX; otherwise this story stays blocked.

---

## Cross-cutting concerns

These apply to every PR, not just specific epics:

- **No regression**: any new feature must pass the existing 410 unit +
  36 e2e suite.
- **No new live API calls**: anything new must have a static cache
  path.
- **No new opaque deps**: every added npm package must be justified in
  the PR description.
- **No new cookies**: ever.
- **Test the failure modes**: every fetch path must handle 404,
  network error, and slow responses gracefully.
- **Document why, not what**: comments explain non-obvious decisions
  ("why this tolerance?"), not what the code does.

## Implementation order (recommended)

If shipping end-to-end:

### Sprint 1 — P0 bundle (3 PRs)

- Story 1.1 (national alert ribbon)
- Story 2.1 (Mostrar mi clima)
- Story 8.1 (a11y refresh) + Story 8.2 (perf baseline)

### Sprint 2 — P0 → P1 transition (4 PRs)

- Story 7.1 (mobile audit) + fixes
- Story 3.1 (AQI panel)
- Story 3.2 (climate anomaly badge)
- Story 4.1 (catalog dropdown nav)

### Sprint 3 — P1 finishing (4-5 PRs)

- Story 3.3 (marine panel on forecast)
- Story 3.4 + 3.5 (daylight curve + wind direction)
- Story 3.6 (freshness indicator)
- Story 4.2 (index page search)
- Story 1.2 (per-state /mapa alert tint)

### Sprint 4 — P2 open-ended (depends on adoption)

- Story 5.1 (compare view) — only if usage data suggests demand
- Story 6.1 + 6.2 (English localization) — high value, high cost
- Story 5.2 (Web Share) — quick win
- Story 2.2 (reverse-geocode hint)
- Story 2.3 (highlight most-checked favorite)

### Sprint 5 — P3 opportunistic

- Story 1.3 (huracanes page) when hurricane season arrives
- Story 7.3 (print stylesheet) when a user requests it
- Story 9.1 (outdoor mode) experimental

## Glossary — relevant code paths

| What | Where |
|---|---|
| Page templates | `src/pages/**/*.astro` |
| Layout | `src/layouts/BaseLayout.astro` |
| Interactive map | `src/lib/interactive-map.ts` (~2700 lines) + `src/components/InteractiveMap.astro` |
| Forecast renderer | `src/pages/forecast.astro` (~970 lines) |
| SMN avisos widget | `src/components/SmnAvisos.astro` |
| SMN client | `src/lib/smn-avisos.ts` |
| Polygon lookup | `src/lib/state-by-coords.ts` |
| Curated lists | `src/lib/top-cities.ts`, `top-beaches.ts`, `mx-states.ts`, `mx-volcanoes.ts` |
| i18n strings | `src/i18n/ui.ts` |
| Favorites | `src/lib/favorites.ts` |
| City snapshot client | `src/lib/city-snapshot.ts` |
| Static geocode | `src/lib/static-geocode.ts` |
| Static data | `public/data/*.json` (snapshots from GH Actions) |
| GH Action workflows | `.github/workflows/*.yml` |
| Build scripts | `scripts/build-*.py`, `scripts/smn-rss/` |
| Theme switcher | `src/lib/theme.ts` |
| Unit tests | `src/**/*.test.ts` |
| E2e tests | `e2e/*.spec.ts` |
| Tailwind config | `tailwind.config.cjs`, `src/styles/global.css` |
| Astro config | `astro.config.mjs` |

---

## Done — historical log

Preserved verbatim from the prior version of this file so that
newcomers can see what's already been built. The full PR history
lives in `git log` and on GitHub.

### Foundation (pre-2026)

- Real weather data from Open-Meteo on city cards, with retry/backoff
  and graceful error/stale handling.
- Build-time RSS feed of real SMN avisos, fetched over TLS via a
  committed intermediate CA, with an informational fallback when SMN
  is unreachable.
- Rich location forecast: typed forecast SDK, a shareable `/forecast`
  detail page, plus search, geolocation and inline forecast peek.
- SEO and discoverability: sitemap, Open Graph meta, robots, and a
  Lighthouse CI check (informational, non-blocking).
- Privacy/legal page (`/privacidad`).
- Light / dark / system theme with a toggle.
- Tooling: ESLint, Prettier, Husky pre-commit, Dependabot.
- Custom domain (`artemiop.com`) with corrected canonical, sitemap,
  RSS and robots URLs.
- Migration to Tailwind 4 and Astro 6.
- Playwright end-to-end tests (smoke, layer activation, timeline
  scrubber, field layers — all deterministic via mocked network).

### Interactive weather map (`/mapa`)

The maps epic ([#56](https://github.com/ArtemioPadilla/mexico-weather/issues/56)):

- **Slice 1** ([#57](https://github.com/ArtemioPadilla/mexico-weather/pull/57)) — `/mapa` page foundation: MapLibre GL JS basemap, preset/search/geolocated pins, popups → `/forecast` deep link, shareable URL hash, home teaser, nav link.
- **Slice 2** ([#58](https://github.com/ArtemioPadilla/mexico-weather/pull/58)) — layer engine + RainViewer radar/precipitation layer with rain-vs-snow palette, per-layer opacity slider, legend.
- **Slice 3** ([#59](https://github.com/ArtemioPadilla/mexico-weather/pull/59)) — RainViewer satellite/clouds layer (infrared).
- **Slice 4** ([#60](https://github.com/ArtemioPadilla/mexico-weather/pull/60)) — timeline scrubber + playback (past → now → forecast), shareable selected frame via `t=` URL hash, `prefers-reduced-motion`-gated autoplay.
- **Slice 5a** ([#61](https://github.com/ArtemioPadilla/mexico-weather/pull/61)) — Open-Meteo gridded-field infrastructure + temperature heat overlay (viewport-resampled).
- **Slice 5b** ([#62](https://github.com/ArtemioPadilla/mexico-weather/pull/62)) — humidity + pressure field overlays; AbortController for rapid-pan resamples; per-point null tolerance.
- **Slice 5c** — GL particle wind layer driven by Open-Meteo wind grid, with `prefers-reduced-motion` static-arrow fallback.
- **Slice 6** — sunlight terminator + performance polish.

### Static-first expansion (2026)

A 16-PR run converting every live data source to a hourly /
15-min / monthly static GitHub Action snapshot, then building 88
SEO landing pages on top of the static catalog. See PR numbers
~#190–#256 on GitHub.

- USGS earthquakes + NHC tropical storms 15-min snapshots.
- 30 per-city landing pages at `/clima/<slug>/` + hourly per-city
  forecast snapshots.
- 14 per-beach landing pages at `/playa/<slug>/` reusing the marine
  snapshot.
- 32 per-state landing pages at `/estado/<slug>/` aggregating cities,
  beaches and volcanoes.
- 7 per-volcano landing pages at `/volcan/<slug>/` linking out to
  CENAPRED.
- 4 category indexes (`/clima/`, `/playa/`, `/estado/`, `/volcan/`).
- JSON-LD structured data (City / Beach / AdministrativeArea /
  Mountain + BreadcrumbList) on every landing.
- Per-page Open Graph PNGs (83 unique 1200×630 images, Pillow build).
- Homepage city cards consume the per-city snapshot first, fall back
  to live.
- Search bar reads the `mx-cities.json` dict before the live
  geocoder.
- Hourly snapshots for the four default `/mapa` field layers
  (temperature, humidity, pressure, cloud cover).
- Reciprocal SEO cross-linking: ciudad ↔ estado ↔ playa, estado ↔
  volcán.
- SMN avisos widget on every detail page + `/forecast` + `/mapa`,
  driven by a static Natural-Earth state-polygon lookup and a
  per-state aviso index.
- SMN widget gap-audit fixes: multi-state volcanoes, parity guard
  between Python aliases and TS state list, empty-state visuals,
  staleness indicator, overflow ("+N más"), homepage favorite-card
  badges, floating panel on `/mapa`.

## Deferred / blocked

- Wind grid static-cache for `/mapa` — viewport-dependent, requires a
  behavior decision (fix-bounds particles vs viewport-tracking).
- Pollen panel — no free public MX data source.
- Sentry error monitoring — needs a DSN; defer until there's a real
  incident worth tracking.
- Own hosted API with edge caching — defeats the no-backend principle.
- Live multi-source CONAGUA merge — infeasible client-side.
