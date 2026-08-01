# Roadmap — Clima México

Status: **living document** · Last reviewed: 2026-07-29

This is the single entry point for "what's done, what's next, and why."
It reconciles the two older planning docs against what actually shipped,
back-fills the epic/story structure that until now lived only in commit
messages, and breaks the remaining work into a prioritized
**epic → story → task** backlog (see "Backlog" below).

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

## Status at a glance

- **Shipped:** 9 epics (E1–E9), the interactive map (8 base layers, 17
  overlays), and full functional parity with zoom.earth.
- **Open backlog:** 5 epics (E10–E14), 19 stories. Next up: **E10** (map
  first paint, P0) gated on a foreground-repro check, then **E11** (mobile).
- **Health:** 448 unit tests (51 files) + 103 e2e (20 specs) green on `main`
  (re-verified at commit 411e336, 2026-07-29); Core Web Vitals baseline
  established (Story 8.2). All data-refresh workflows and CD green over the
  last 60 runs.
- **Staleness correction (2026-07-29):** parts of E11 shipped inside the audit
  PR #296 and were never reflected here; E10's remaining root cause has since
  been located. See E10 and E11 below — the story text was rewritten, not just
  re-dated.

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

## Backlog — epics → stories → tasks

The forward work, broken into the same scheme as the shipped epics.
Numbering continues from E9 / Story 9.x.

**Conventions**
- **Epic** = a theme spanning multiple PRs. **Story** = one user-facing
  increment, ~1 PR, tagged `Story N.M` (use the tag in the commit subject,
  as Sprints 2–5 did). **Task** = a concrete dev step, one checkbox.
- Status: `[ ]` todo · `[~]` in progress · `[x]` done. Priority: **P0**
  correctness → **P1** daily-driver UX → **P2** architecture → **P3**
  differentiation → **P4** icebox.
- A story is "done" when every task is checked **and** its acceptance
  criteria pass. Keep estimates honest; they're planning aids, not commitments.

---

### E10 · Map first paint & render reliability — **P0**

> Outcome: the map paints on load without any interaction, in every embed,
> including background/prerender contexts. Retires the longest-running bug
> class in the project (#124).

Context: [#124](https://github.com/ArtemioPadilla/mexico-weather/issues/124)
("cold-load blank canvas") absorbed 6 PRs (#111, #112, #117, #118, #122,
#123) of resize/rAF/jumpTo nudges and was closed with a *workaround*. The
signature — tiles loaded, WebGL context alive, canvas sized, blank until a
click forces `triggerRepaint` — is the classic **rAF-never-fires** symptom.
PR #289 fixed the `/mapa` boot scheduling (rAF→setTimeout); first paint of
the embeds is the remainder.

Root cause of the remaining embed case, located 2026-07-29:
`src/pages/forecast.astro:1075` wraps the whole `initInteractiveMap()` call in
a bare `requestAnimationFrame` — the same antipattern #289 removed from
`InteractiveMap.astro:716`. `/forecast` calls the factory directly rather than
through `InteractiveMap.astro`, so it never received that fix. In a hidden or
throttled tab the map therefore never *boots* (not merely never paints), which
is consistent with every prior "blank canvas in automation" report.

Measured on `main` at 411e336 (headless chromium, 64×64 luminance variance of
the map canvas, zero interaction): `/mapa` 270 at 1s settling to 114;
`/forecast` embed 0 at 1s, 45 at 3s, 45 steady (a 21-at-3s reading was also
observed on a slower run — the crossing point is network-dependent, somewhere
between 1s and 3s). **Both paint without interaction in a foreground context**
— so the ≤3s target below is a marginal performance gap on the `/forecast`
embed, not a blank-canvas bug.

**Story 10.1 — Confirm the failure reproduces in a foreground load** · est ½d
- [ ] Load `/forecast?lat=19.43&lng=-99.13&...` cold (cleared SW/cache) in a
      genuinely **foregrounded** window on a real device + desktop Chrome.
- [ ] Record `document.visibilityState` at boot and whether canvas paints
      pre-interaction.
- [ ] Decision gate: if it only fails when hidden/backgrounded, **demote
      this epic to P2** (background-tab correctness only) and note it here.
- Acceptance: a written repro (or "cannot reproduce in foreground") with the
  visibilityState evidence, recorded in #124.

**Story 10.2 — First paint without interaction** · est ½d · *blocked by 10.1*
- [ ] ~~In `src/lib/interactive-map.ts`, after `map.once('load')` call
      `map.triggerRepaint()` unconditionally~~ — **void (2026-07-29):**
      `triggerRepaint()` is itself rAF-scheduled
      (`triggerRepaint(){…!this._frameRequest && n.frame(…)}`, where `n.frame`
      is `requestAnimationFrame`) and no-ops while a frame is already pending.
      There is no synchronous repaint primitive in MapLibre; the fix is to
      never gate a *boot* on rAF, not to add repaint calls.
- [x] Replace the rAF-gated boot with `setTimeout(…, 0)` — done for
      `src/pages/forecast.astro:1075`, the last remaining site (`/mapa` got
      this in #289). Guarded by a source-text test at both call sites and by
      an rAF-starvation e2e test that fails on the pre-fix code.
- [ ] **BLOCKED (2026-07-31) — Remove the 6-step deferred-nudge stack (#122)**
      (`aggressiveNudge`'s 6 timers, `synthesizeMove`'s 4 synthetic pointer
      events, the 200 ms × 25 repaint interval).
      **Gate: a real-device foreground check, not the automated probe.** The
      probe cannot background a page (see Story 10.3), so
      "cannot reproduce in foreground" is its *only* possible verdict —
      treating that as sufficient would rubber-stamp deleting six PRs' worth
      of workaround. Someone must load, on a phone, foregrounded, with
      cache/SW cleared:
      `https://artemiop.com/mexico-weather/forecast/?lat=19.43&lng=-99.13&name=CDMX&tz=America/Mexico_City`
      and answer: does the map show imagery *before* the screen is touched?
      - **Yes** → E10 demotes to P2; remove the layers one commit at a time,
        each gated on `e2e/map-first-paint.spec.ts --repeat-each=10`.
      - **No** → the #124 signature is real in foreground; E10 stays P0 and
        the stack stays until the actual cause is found.
      Keep regardless: the `sourcedata` → `triggerRepaint` hook, the
      `ResizeObserver`, `once('idle')`, and the `osm` visibility flip (the
      one nudge with a mechanism rather than a timing guess).
- [ ] Evaluate forcing eager import of maplibre-gl on `/mapa` only (drop the
      dynamic-import latency variable; keep lazy for embeds).
- Acceptance: reload `#view=23.6,-102.5,5z&layer=temperature` 10× — field
  paints ≤3s each, zero clicks. Same for the `/forecast` embed.

**Story 10.3 — Lock the regression** · est ¼d
- [ ] Playwright test asserting the map canvas has non-zero painted pixels
      **without any interaction** (sample `getImageData`, assert variance).
- [ ] ~~If the harness can background the page, add a hidden-context
      variant.~~ It cannot: `bringToFront()` leaves
      `document.visibilityState === 'visible'` in Playwright 1.60, headless
      **and** headed (verified 2026-07-29), so any "hidden tab" test built on
      it is vacuous. Stub the mechanism instead —
      `page.addInitScript(() => { window.requestAnimationFrame = () => 0 })`
      — and assert the map still *mounts* (pixels are impossible with rAF
      starved, since MapLibre renders via rAF).
- [x] Document the visibilityState/rAF gotcha (done — "Process notes" below
      + memory `verify-foreground-before-render-bugs`).
- Acceptance: two tests. (a) An rAF-starvation test — stub
  `requestAnimationFrame` to never fire, assert the map still mounts — which
  fails on `main` pre-10.2 and passes after. (b) A pixel-variance test
  asserting a non-blank canvas with zero interaction, which **already passes on
  `main`** and exists to gate the nudge-stack removals in 10.2's third bullet.
- Known gap (2026-07-29): the `/forecast` embed's first paint lands between 1s
  and 3s depending on network, so it only marginally meets this epic's "≤3s"
  criterion and misses it on slow runs. Not caused by the rAF boot bug; treat
  as separate perf work.

---

### E11 · Mobile UX — **P1**

> Outcome: the site is fully navigable and operable on a 360–414px phone.
> All three findings below are real on foreground mobile (audit 2026-05-27).

**Story 11.1 — Mobile navigation** · est ½d (was 1d) · **partially shipped in #296**
- [x] Hamburger button visible `< sm` — `<details id="mobile-menu">` at
      `src/layouts/BaseLayout.astro:462`, 44×44 `<summary>`, 7 destinations
      (Inicio, Mapa, Ciudades, Playas, Estados, Volcanes, Pregunta). The
      desktop links stay `hidden sm:*`; the mobile menu is their fallback.
- [x] Esc-to-close + focus restore to the toggle (`BaseLayout.astro:556-565`).
- [ ] Close on focus leaving the menu (Tab-out currently leaves it open).
- [ ] Drop `role="menu"`/`role="menuitem"`: that role contract requires
      roving-tabindex arrow-key navigation which is not implemented, and
      `role="menuitem"` on an `<a href>` overrides the link role and removes
      the items from the AT link list. A nav disclosure should be a plain
      `<ul><li><a>` list. Same fix for `#catalog-dropdown`.
- [ ] Add the footer-only destinations (Comparar, Huracanes, Privacidad, Feed
      RSS). They are unreachable on `/mapa`, which passes `noFooter`.
- [ ] e2e: at 360px every top-level destination is reachable from any page
      including `/mapa`; Esc closes and restores focus; axe clean with the menu
      **open**. There is currently *no* e2e coverage of `#mobile-menu` at all.
- **Not doing:** a focus trap, and `aria-expanded`/`aria-controls` on the
  `<summary>`. This is a non-modal disclosure, so trapping focus is the wrong
  pattern; and HTML-AAM computes the expanded state from `details[open]` in all
  three engines, so a hand-managed `aria-expanded` would need a `toggle`-event
  sync and could desync. The acceptance test is "axe clean with the menu open",
  not the presence of a specific attribute.
- Theme + language toggles are already always-visible 44×44 buttons beside the
  hamburger (`ThemeToggle.astro:48`, `LanguageToggle.astro:21`), so they do not
  need to move inside the menu.
- Acceptance: no top-level route is unreachable below 640px, from any page
  including `/mapa`.

**Story 11.2 — Tap targets ≥44px** · est ½d

Correction (2026-07-29): the header nav links this story originally named are
`hidden sm:inline-block` — desktop-only, so their 28px height was never a
*mobile* tap-target defect. Sizes below were re-measured at 360px.

- [ ] Mobile-menu items — 36px (`block px-3 py-2`) → 44px.
- [ ] Footer links — 32px (`inline-block px-2 py-2` + `text-xs`) → 44px.
- [ ] Timeline `#tl-play` / `#tl-prev` / `#tl-next` — **24px each**
      (`text-base leading-none` + `py-1`), all visible on mobile → 44px
      **vertical** hit area. Width stays natural: at `gap-1`, 44px-wide hit
      areas on adjacent buttons would overlap and mis-route taps.
- [ ] `#mw-search-toggle`, `#maploc`, `#mw-settings`, the info `<summary>` —
      `h-9 w-9` (36px) → `h-11 w-11`. Re-check the right-edge stack offsets
      (`top-3` / `top-14` / `top-[6.25rem]`) afterwards: they were tuned for
      36px and go exactly flush at 44px.
- [ ] `e2e/mobile-audit.spec.ts:106` uses `w < 44 && h < 44`, i.e. it passes
      anything ≥44px in *either* axis — which is why 36px-tall full-width links
      never failed. Add a strict `min(w,h) >= 44` rule, measured on the element
      itself (no parent-container escape hatch), for a named selector set:
      header controls, mobile-menu items, footer links, timeline buttons. Keep
      the lenient rule as the global floor. `/mapa` is absent from that spec's
      `PAGES` and needs its own test rather than being added wholesale.
- **Documented deviation:** `.mw-model-btn` (5 segments in a corner pill,
  currently ~19px) goes to ≥24px per WCAG 2.5.8 AA, not 44px — five 44px
  segments would be a ~220px-wide pill over the map. If Story 11.3 reveals the
  model toggle on mobile, lift the segments to a 44px *vertical* target there
  while keeping the width compact.
- Acceptance: the strict-set assertions pass; the global rule's only exemptions
  remain the documented `sr-only`, zero-size, in-map and parent-container cases.

**Story 11.3 — `/mapa` chrome on mobile** · est 1d
- [ ] Surface opacity slider (`#opacitywrap`), overlay menu (Superposiciones),
      model toggle, and measure/snapshot tools on mobile — all currently
      `hidden sm:*` in `src/components/InteractiveMap.astro`.
- [ ] Pattern: a single bottom-sheet "Controles" trigger that expands the
      rail contents, rather than unhiding everything (screen real estate).
- Acceptance: a mobile user can change opacity, toggle an overlay, and switch
  model without resizing to desktop.

---

### E12 · Map plugin-registry migration (#136) — **P2**

> Outcome: retire the ~2,200-LOC `interactive-map.ts` monolith; one file per
> feature. Incremental and revertible — each story is one PR.
> Note: the F9 "new features" (isobars, tropical, fires, GIBS) already exist
> as overlays; only the *refactor* remains. Sequence after E10/E11 so the map
> surface is stable. Done so far: F1 registry, F2 utils, F4 sun plugin (#285).

**Story 12.1 — F3 data-source extraction** · est 1d
- [ ] Move Open-Meteo / RainViewer / RV-manifest fetchers into
      `src/lib/map/sources/` behind the `DataSource` interface (open-meteo +
      rainviewer files already exist — finish wiring callers through them).
- Acceptance: `interactive-map.ts` imports no raw fetch URLs; sources are
  unit-tested.

**Story 12.2 — F5 base-layer migration (a–f)** · est 3–4d
- [ ] F5a basemap · [ ] F5b temperature (+ sub-options) · [ ] F5c humidity ·
      [ ] F5d pressure · [ ] F5e wind (WebGL) · [ ] F5f radar + satellite —
      each migrated to the `BaseLayer` plugin interface, flag-gated, behind
      the registry (mirror the F4 sun-plugin pattern).
- Acceptance: each layer renders identically pre/post migration; e2e green.

**Story 12.3 — F6 overlay migration** · est 2d
- [ ] Register the 17 existing overlays through the registry; drop their
      bespoke wiring in the monolith.
- Acceptance: overlay toggles + keyboard shortcuts read from the registry.

**Story 12.4 — F7 state-driven UI** · est 2d
- [ ] Replace imperative DOM mutation with subscriptions to the map store;
      rail/timeline/shortcuts/hash all enumerate the registry.
- Acceptance: adding a layer/overlay requires no edits to UI wiring — it
  appears in the rail/menu/shortcuts purely by registering.

**Story 12.5 — F8 retire the monolith** · est ½d
- [ ] Delete legacy `interactive-map.ts`; keep `index.ts` façade.
- Acceptance: bundle size drops; `rg 'interactive-map'` shows only the façade.

---

### E13 · Differentiators — **P3**

> Outcome: move from parity to lead. Highest-ROI un-shipped ideas from
> `PLAN_SUPERIORITY`.

**Story 13.1 — Multi-metric hover tooltip** · est 1wk
- [ ] Extend the existing `#mapTooltip` to show temp + humidity + wind at the
      cursor in one read (currently single-metric).
- [ ] Directional wind arrow (rotate a glyph by bearing) in the tooltip.
- [ ] Sticky-on-touch: tap-to-pin on mobile, since there's no hover.
- Acceptance: hovering anywhere on the field shows all three metrics for that
  point; touch devices can pin/unpin; no extra network calls (reuse the
  already-loaded grids).

**Story 13.2 — Combined "Precipitación" mode** · est 1wk
- [ ] Add a single mode toggle that activates GIBS GeoColor satellite +
      clouds overlay + radar together (GeoColor already in `nasa-gibs.ts`).
- [ ] Tune z-order + opacity so all three read at once.
- [ ] Hash/URL state so the combined mode is shareable.
- Acceptance: one click yields the zoom.earth-equivalent "precipitation"
  picture; deep-link restores it.

**Story 13.3 — Multi-model disagreement view** · est 1wk
- [ ] Surface per-model fields (ICON/GFS/ECMWF/GEM) via Open-Meteo `models=`
      — the model toggle data path already exists.
- [ ] Compute + render a spread/disagreement field (e.g. inter-model stdev)
      as a confidence overlay.
- [ ] Legend explaining "low confidence = models diverge here".
- Acceptance: a user can see where the forecast is uncertain, not just the
  best-match value.

**Story 13.4 — WebGL field renderer** · est 1wk
- [ ] Replace the canvas bilinear raster with a fragment shader sampling the
      grid as a texture (target the existing `weather-raster` path).
- [ ] Match current color ramps exactly (regression-test against snapshots).
- [ ] Verify on Safari + Firefox iOS before shipping; feature-flag fallback
      to canvas if WebGL2 unavailable.
- Acceptance: field quality ≥ current at all zooms; render time drops;
  no visual regression in the field-grid snapshots.

**Story 13.5 — Temporal before/after compare** · est 1wk
- [ ] Split-screen / swipe slider rendering the same view at two timestamps
      ("hace 24h vs ahora").
- [ ] Drive both panes from one timeline + view state.
- Acceptance: a user can swipe between two times of the same layer/region.

**Story 13.6 — Full-field climate anomaly ramp** · est 2wk
- [ ] Preprocess an ERA5/baseline grid (reuse the `climate-baseline`
      workflow output) into a field the map can sample.
- [ ] Anomaly color ramp over the field (the per-location badge shipped as
      Story 3.2; this is the spatial version).
- [ ] Toggle + legend ("+5°C vs mayo histórico").
- Acceptance: anomaly layer renders over MX; values reconcile with the
  per-location badge at sampled points.

---

### E14 · Icebox — **P4** (validation-gated or out of scope)

- **Story 14.1 — Personal web-push alerts.** Needs a no-backend design; SW
  periodic background sync is unreliable. Spike feasibility before committing.
- **Story 14.2 — Native app wrappers** (Capacitor / RN). Validate demand
  first; App/Play accounts cost money + ongoing maintenance.
- **PRO tier / accounts** — ⛔ won't do; privacy-first is the competitive angle.

---

## Execution order

1. **E10** map first paint (P0) — start with the 10.1 foreground-repro gate.
2. **E11** mobile nav + tap targets (P1) — real daily-driver impact.
3. **E13.1–13.3** the three high-ROI differentiators.
4. **E12** plugin-registry sweep (P2) once the map surface is stable.
5. **E13.4–13.6** depth; **E14** only after validation.

---

## Success metrics

How we'll know the open work paid off (folds in `PLAN_SUPERIORITY`'s metrics):

- **E10 (first paint):** field paints ≤3s on cold load with **zero clicks**,
  10/10 reloads, on a real foreground device. The Playwright pixel-variance
  test (10.3) stays green.
- **E11 (mobile):** every top-level route reachable < 640px; `mobile-audit`
  tap-target assertions pass with no per-element exemptions; `/mapa` opacity +
  overlay + model controls operable on a phone.
- **E13 (differentiate):** in a blind side-by-side vs zoom.earth, ≥60% prefer
  our UX after E13.1–13.3; cold-load first paint < 500ms once 13.4 lands.
- **Always-on guardrails:** unit + e2e suites green; no regression in the
  field-grid snapshots; the five hard product constraints intact.

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
