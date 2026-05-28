# Roadmap — Clima México

Status: **living document** · Last reviewed: 2026-05-28

This is the single entry point for "what's done, what's next, and why."
It reconciles the two older planning docs against what actually shipped,
back-fills the epic/story structure that until now lived only in commit
messages, and re-prioritizes the remaining work.

## How to read this

| Doc | Role |
|-----|------|
| **ROADMAP.md** (this file) | Source of truth for status + priorities. Start here. |
| [PLAN_SUPERIORITY.md](./PLAN_SUPERIORITY.md) | Detailed feature ideas vs zoom.earth (2026-05-24). **~65% shipped** — see reconciliation below. Treat as an idea backlog, not current status. |
| [PLAN_UX_PARITY.md](./PLAN_UX_PARITY.md) | 14 map-polish gaps vs zoom.earth (2026-05-24). **P0–P2 mostly shipped** as the P-series PRs. The P0.1 root-cause analysis is superseded — see "Map first paint" below. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Map plugin-registry design. Tracks as issue [#136](https://github.com/ArtemioPadilla/mexico-weather/issues/136). |

Hard product constraints (do not regress): **no tracking, no cookies, no
accounts, no API keys, no backend.** The service worker has **no fetch
handler** by design (`public/sw.js` is a scope-claimer only). These are the
competitive angle, not limitations.

---

## Shipped epics (the "sprint" work)

Nine epics shipped across Sprints 2–5. The `Story X.Y` tags below are the
key to the numbering used in commit subjects (it had no index before).

| Epic | Stories shipped |
|------|-----------------|
| **E1 · Alerts & severe weather** | 1.1 national alert ribbon · 1.2 per-state SMN tint overlay · 1.3 `/huracanes` active-systems index |
| **E2 · Home & personalization** | 2.1 "Mostrar mi clima" geolocation CTA · 2.2 reverse-geocode hint to curated landing · 2.3 highlight most-checked favorite |
| **E3 · Forecast richness** | 3.1 AQI panel · 3.2 climate-anomaly badge · 3.3 marine panel · 3.4 daylight curve · 3.5 wind-direction arrow · 3.6 freshness indicator |
| **E4 · Navigation & discovery** | 4.1 catalog dropdown nav · 4.2 client-side search filter on category indexes |
| **E5 · Sharing & comparison** | 5.1 side-by-side city compare (`/compara`) · 5.2 Web Share button on every landing |
| **E6 · Internationalization** | 6.1 + 6.2 English/Spanish toggle · 6.3 per-page hreflang |
| **E7 · PWA, mobile & print** | 7.1 mobile UX audit + tap-target fixes · 7.2 iOS install bottom-sheet · 7.3 clean print stylesheet |
| **E8 · Quality & performance** | 8.1 a11y audit refresh · 8.2 Core Web Vitals baseline |
| **E9 · Activity-aware forecast** | 9.1 outdoor-planner mode toggle |

Plus the interactive map itself (zoom.earth-parity layers, overlays,
timeline, model toggle, measurement tools) shipped via the weather-maps
slice plans and the P-series UX PRs.

### Map capability inventory (in `src/lib/map/`)

- **Base layers**: basemap (CARTO Dark/OSM), radar, satellite (GIBS),
  temperature, humidity, pressure, wind (WebGL particles), sunlight.
- **Overlays** (17): aqi, borders, city-values, clouds, fires, graticule,
  hist-storms, lakes, marine, night-lights, night-line, quakes,
  radar-coverage, smn-state-tint, tropical-storms, volcanoes, webcams.
- **Sources**: open-meteo, rainviewer, nasa-gibs, nhc.

This already exceeds zoom.earth's overlay count. The gap is **polish and
correctness**, not feature count.

---

## Reconciliation: what the old plans still have open

`PLAN_SUPERIORITY.md` was written before most of it shipped. Honest status:

| Plan item | Real status |
|-----------|-------------|
| 1.1 Field resolution → 768 pts | ✅ Shipped (32×24 grid, chunked fetch in #281) |
| 1.1 C WebGL field renderer | ❌ Not done — still canvas bilinear raster |
| 1.2 Cold-load basemap | ⚠️ Worked around, not fixed — see "Map first paint" |
| 1.3 GeoColor satellite + cloud overlay | ◑ Partial — GIBS + separate clouds overlay exist; combined "Precipitación" mode not built |
| 1.4 A PWA install | ✅ Shipped (7.2) |
| 1.5 PRO tier | ⛔ Won't do (privacy-first angle) |
| 2.1 Multi-metric hover tooltip | ❌ Not done |
| 2.2 Sub-options on radar/sun/satellite | ◑ Partial — model toggle shipped; per-layer sub-options uneven |
| 2.3 Dynamic theme + color-blind palettes | ◑ Color-blind mode exists; auto-by-hour not done |
| 2.4 Unique MX overlays (SMN, sismos, AQ, marine) | ✅ Shipped (smn-state-tint, quakes, aqi, marine) |
| 3.1 AI natural queries | ✅ Shipped (`/pregunta` NL router) |
| 3.2 Storm tracker w/ history | ✅ Shipped (hist-storms + `/huracanes`) |
| 3.3 Temporal before/after compare | ❌ Not done |
| 3.4 Multi-model disagreement view | ◑ Model toggle shipped; disagreement view not built |
| 3.5 Personal alerts (web push) | ❌ Not done (needs care re: no-backend constraint) |
| 3.6 Climate anomaly viz | ◑ Per-location badge shipped; full-field anomaly ramp not built |
| 3.7 Webcam integration | ✅ Shipped (webcams overlay) |
| 3.8 Beach + lake conditions | ✅ Shipped (`/playa` + lakes overlay) |

---

## Open work (prioritized)

### P0 — Map first paint (reframes #124 + PLAN_UX_PARITY P0.1)

**The single most-investigated bug in the project, never actually root-caused.**
Issue [#124](https://github.com/ArtemioPadilla/mexico-weather/issues/124)
("forecast embed cold-load blank canvas") absorbed 6+ PRs (#111, #112,
#117, #118, #122, #123) of resize/rAF/jumpTo/nudge attempts and was
closed with a *workaround* ("renders on first interaction"), not a fix.
`PLAN_UX_PARITY` P0.1 hypothesized a MapLibre style-load race.

**New evidence (2026-05-28):** the recurring signature — "tiles downloaded,
WebGL context alive, canvas correctly sized, blank until a single click
triggers a paint" — is the classic symptom of **a requested animation
frame that never fires**. `requestAnimationFrame` is throttled or paused
entirely when a tab is not visible/focused (background tab, prerender,
automation, window unfocused). A user click forces `triggerRepaint`, which
is why interaction "fixes" it.

PR #289 already switched the **boot scheduling** from `requestAnimationFrame`
to `setTimeout` for `/mapa`. The remaining work is to apply the same
reasoning to **first paint** of every embed:

- Replace any rAF-gated first-paint/resize nudge with a `setTimeout`-based
  path (fires in background tabs; rAF does not).
- After `map.once('load')`, call `map.triggerRepaint()` once unconditionally
  rather than relying on a frame the browser may never schedule.
- Drop the 6-step deferred-nudge stack (#122) once the above lands — it was
  compensating for the wrong primitive.
- Add a Playwright test that asserts a canvas with non-zero painted pixels
  **without any interaction**, run in a backgrounded context if the harness
  allows, to lock the regression.

**Caveat / unknown:** real foreground users may never have been affected —
much of the prior "blank canvas" evidence (including production checks) was
gathered through automation tabs that run `document.hidden === true`. Before
investing, confirm the failure reproduces in a genuine **foreground** load
(real device or a focused browser window). If it only reproduces in
hidden/background contexts, this drops from P0 to P2 (correctness for
background-opened tabs / prerender only).

### P1 — Mobile UX gaps (from the 2026-05-27 audit, still open)

These round-1 audit findings were never addressed and are real on
foreground mobile:

- **No mobile navigation.** Catalog dropdown + "Pregunta" are `hidden sm:block`
  with no hamburger. Below 640px, Ciudades/Playas/Estados/Volcanes/Pregunta
  are unreachable unless the user knows the URL. **Highest user impact.**
- **Tap targets below 44px** across header nav (28px tall), map timeline
  controls (19–20px), and model toggle (19px). WCAG 2.5.5.
- **`/mapa` loses all chrome on mobile.** Opacity slider, overlay menu,
  model toggle, snapshot + measure tools are all `hidden sm:*`. Mobile
  users get layer buttons only.

### P2 — Map plugin-registry migration (#136)

Architecture refactor, incremental and revertible. Status:

- ✅ F1 types + registry, F2 utils extraction, F4 sun BaseLayer plugin (#285)
- ❌ F3 data-source extraction, F5a–f base-layer migration, F6 overlay
  migration, F7 state-driven UI, F8 delete legacy `interactive-map.ts`
- Note: F9a–d ("new features": isobars, tropical, fires, GIBS) already
  **exist as overlays** — they shipped outside the registry. The remaining
  value of #136 is the *refactor* (one-file-per-feature, ~2,200-LOC monolith
  retired), not new capability. Sequence the migration only when the map
  surface is otherwise stable, to avoid churn.

### P3 — Differentiators worth pulling forward

Highest ROI of the un-shipped `PLAN_SUPERIORITY` ideas:

- **Multi-metric hover tooltip** (temp + humidity + wind at cursor) — 1wk,
  genuinely beyond zoom.earth.
- **Combined "Precipitación" mode** (GeoColor satellite + clouds + radar in
  one toggle) — 1wk, closes the last visible parity gap.
- **Multi-model disagreement view** — exposes forecast confidence; the data
  (Open-Meteo `models=`) is already wired for the model toggle.
- **WebGL field renderer** — replaces canvas bilinear with a fragment
  shader; quality + perf win, no extra data.

---

## Forward roadmap (re-sequenced)

The original quarterly plan assumed everything was greenfield; most of Q3
already shipped. Revised:

**Now → next** (correctness before expansion)
1. P0 map first-paint — confirm foreground repro, then fix properly.
2. P1 mobile nav + tap targets — real, daily-driver impact.

**Then** (differentiate)
3. Multi-metric hover tooltip.
4. Combined Precipitación mode.
5. Multi-model disagreement view.

**Later** (architecture + depth)
6. #136 plugin-registry migration (F3 → F8) as a focused sweep.
7. WebGL field renderer.
8. Temporal before/after compare; full-field climate anomaly.

**Deliberately deferred** (need validation or violate constraints)
- Personal web-push alerts — needs a no-backend design (SW periodic sync is
  unreliable; verify feasibility before committing).
- Native app wrappers (Capacitor / RN) — validate demand first.
- PRO tier / accounts — out of scope by design.

---

## Process notes (learned this cycle)

- **Verify foreground vs background before diagnosing render bugs.** Several
  "broken in production" map findings were artifacts of automation tabs
  running `document.hidden === true`, where `requestAnimationFrame` never
  fires. Check `document.visibilityState` in the inspecting browser first.
- **Snapshot workflows must `git add` before `git diff`.** Six data-snapshot
  Actions silently never committed their output because `git diff --quiet`
  treats untracked files as "no change" (fixed #288). Any new snapshot
  workflow must stage first, then `git diff --staged --quiet`.
- **`textContent`-based audits over-report.** Hidden (`display:none`) sibling
  states get captured, producing false "two states shown at once" findings.
  Check computed `display` before filing.
