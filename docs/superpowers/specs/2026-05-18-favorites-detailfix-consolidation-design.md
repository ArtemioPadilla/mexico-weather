# Favorites + detail-page fixes + repo consolidation/rename — design

Date: 2026-05-18
Status: Approved (pending written-spec review)

Three independent sub-projects, sequenced A → B → C (C is highest-risk, last).

---

## A. Detail-page bug fixes

### A1. Hourly strip starts at midnight + idx 0 mislabeled "Ahora"
**Root cause:** `src/lib/forecast.ts` `getForecast` requests `forecast_days=7` and does
`hourly.time.slice(0, HOURLY_LIMIT=48)`. Open-Meteo's `hourly.time` (in `loc.tz`)
starts at **00:00 of today**, so the strip shows 00:00→47:00; `forecast.astro`
`hourLabel` labels idx 0 as `t.current` ("Ahora") — which is actually midnight.

**Fix (SDK, unit-testable):** in `getForecast`, after building the hourly array,
compute the start index as the first hourly entry whose timestamp is ≥ the
current location-local time. Anchor on `data.current.time` (Open-Meteo returns
the location-local current ISO, same tz as `hourly.time`); pick
`startIdx = first i where hourly[i].time >= current.time` (string compare is
valid for same-tz ISO `YYYY-MM-DDTHH:MM`; if none, startIdx=0). Return
`hourly.slice(startIdx, startIdx + HOURLY_LIMIT)`. After this, idx 0 is
genuinely the current hour, so `hourLabel(idx 0)='Ahora'` is correct and the
rest are the right local clock hours (`iso.slice(11,13)+'h'`).
Edge cases: if `current.time` missing/unparseable → fall back to startIdx=0
(current behavior); never throw; preserve `HOURLY_LIMIT`.

### A2. 7-day temperature range bar renders nothing
**Root cause:** the per-day row in `forecast.astro` renders a static empty
gray track; no min–max fill is computed.

**Fix:** before rendering the 7-day list compute
`weekMin = min(dw.tmin over days with non-null tmin)` and
`weekMax = max(dw.tmax over days with non-null tmax)`. For each day with
non-null tmin & tmax, the filled segment spans
`leftPct = (tmin − weekMin)/(weekMax − weekMin) * 100` to
`rightPct = 100 − (tmax − weekMin)/(weekMax − weekMin) * 100`, rendered as an
absolutely-positioned `<i>` (cool→warm gradient, e.g. blue→amber→orange) inside
the existing track. Guard `weekMax === weekMin` (→ full-width bar) and null
tmin/tmax (→ no fill / show "—" as today). Theme-aware classes consistent with
the page.

### A3. "Many empty things"
Resolved by A2 (the empty bars). No other null/"—" fields found on the
reviewed page; verify during implementation that nothing else renders empty.

**Tests:** extend `forecast.test.ts` — hourly start-at-now slicing (given a
sample with `current.time` mid-day, the returned hourly[0].time === current
hour; count == HOURLY_LIMIT; fallback when current.time absent). 7-day bar math
is presentational in `.astro` (covered by an E2E assertion that bars have a
non-zero-width fill).

---

## B. Favorites

### Data & logic — `src/lib/favorites.ts` (pure, DOM-free, Vitest-tested)
- Type: `Favorite = { lat: number; lng: number; name: string; admin?: string; tz?: string; addedAt: number }`.
- Storage key: `secid-mwx-favorites` (JSON array) in `localStorage`.
- API (operates on an injectable `Storage`-like dependency for tests):
  `load(storage): Favorite[]` (corrupt/invalid JSON → `[]`, never throws),
  `save(storage, favs)`, `list(storage)`, `keyOf(lat,lng)` (lat/lng rounded to
  3 dp), `has(storage,lat,lng)`, `add(storage,fav)` (dedupe by `keyOf`, cap
  **12** — adding when full is a no-op or drops oldest? **Decision: reject with
  no-op + return false when full**, so the user explicitly removes one),
  `remove(storage,lat,lng)`, `toggle(storage,fav)` (add if absent & not full,
  else remove; returns the new state).
- Pure & deterministic; no DOM; all browser wiring lives in the Astro scripts.

### UI
- **`index.astro` — "⭐ Tus lugares" section** injected at the top of the page,
  **rendered entirely client-side and shown only when ≥1 favorite exists**
  (hidden/empty in SSR; populated on load from localStorage). Each favorite is
  rendered with the **same card structure and the same `getForecast` live-data
  path as the preset cards** (current temp/condition, quick-peek,
  "Ver pronóstico completo" → `/forecast?lat=&lng=&name=&admin=&tz=`), plus a
  **remove ✕**. Preset "Pronóstico por Ciudad" section stays unchanged below.
  Re-render this section live whenever favorites change.
- **Star toggle (⭐ filled / ☆ empty)** on **every city card** (presets,
  favorite cards, and the quick-peek block) **and on the `/forecast` detail
  header**. Click → `favorites.toggle` → update localStorage → live re-render
  "Tus lugares" and sync all visible stars for that location. Accessible:
  real `<button>`, `aria-pressed`, Spanish label
  "Agregar a favoritos" / "Quitar de favoritos", focus-visible,
  `motion-reduce` for any transition. The detail-page star builds the
  `Favorite` from the URL params (lat/lng/name/admin/tz). If "add" is rejected
  because the cap is reached, show a brief inline message
  ("Máximo 12 lugares — quita uno").
- **`/privacidad`**: add one line — favorites are stored only in your browser
  (localStorage), never sent anywhere; clearing site data removes them.

### Tests
- `favorites.test.ts` (Vitest, injected fake storage): add/remove/toggle,
  dedupe by 3-dp key, cap-12 rejection, corrupt-JSON load → [], round-trip
  save/load.
- One Playwright E2E: from a forecast page, star a location → "Tus lugares"
  shows it on the homepage → reload persists → remove ✕ clears it; star state
  reflects correctly on a preset card.

---

## C. Consolidation + rename migration (sequenced last; highest risk)

### C1. Port the SMN scraper into the site repo
- Copy `smn_rss.py` (+ `requirements.txt`, Playwright usage) from the old
  `mexico-weather` repo into `scripts/smn-rss/` of the site repo. Keep
  attribution/source comments.
- New workflow `.github/workflows/smn-rss.yml`: triggers = `schedule` (cron
  hourly) + `workflow_dispatch`. Steps: checkout, setup Python, install
  requirements + `playwright install --with-deps chromium`, run the scraper,
  write the resulting feed to a committed repo artifact
  `src/data/smn-feed.xml` (only commit if changed), which triggers the
  existing CD deploy.
- **Single source of truth for `/rss.xml`:** `src/pages/rss.xml.ts` reads
  `src/data/smn-feed.xml` when it exists and its `lastBuildDate`/mtime is
  fresh (≤ ~3 h); otherwise falls back to the existing build-time CA-based
  Open-Meteo-derived feed (PR #43 logic). The endpoint remains the only thing
  serving `/rss.xml` (no `public/rss.xml` collision). Both code paths emit a
  valid RSS 2.0 document; build never fails (existing robust fallback intact).
- Concurrency guard on the workflow so overlapping hourly runs don't race the
  commit.

### C2. Free the name, then rename
1. After C1 (everything valuable ported), in the **old `mexico-weather` repo**:
   replace its README with a deprecation pointer to the consolidated repo,
   then **rename it `mexico-weather` → `mexico-weather-legacy`** and **archive
   it**. (Archiving alone does not free the name — the rename is required so
   the name becomes available.)
2. **Rename `mexico-weather-site` → `mexico-weather`** on GitHub. GitHub keeps
   an automatic redirect for the old repo slug and existing git remotes; still
   update local remotes.

### C3. Re-path everything for the new URL `…/mexico-weather/`
- `astro.config.mjs`: `base: '/mexico-weather'`. canonical/OG/sitemap/RSS all
  derive from `siteBase()` → no per-URL edits needed; verify in `dist`.
- Own service worker: served at `/mexico-weather/sw.js`,
  register `{ scope: '/mexico-weather/' }`. The BaseLayout migration script
  must additionally treat a controller whose scriptURL is the **old**
  `/mexico-weather-site/sw.js` (or the parent `/sw.js`) as "controlled by
  other" → one loop-guarded reload (reuse the existing `secid-sw-migrated`
  guard; it still guarantees ≤1 reload/session).
- Remove `public/CNAME` (non-standard for a project page; the apex belongs to
  the `ArtemioPadilla.github.io` user site and the project auto-inherits it).
- **Parent repo `ArtemioPadilla.github.io`** (separate PR, its conventions):
  in the PWA `workbox` config add `/mexico-weather/` to `globIgnores`,
  `navigateFallbackDenylist`, and the two `NetworkOnly` `runtimeCaching`
  entries (mirroring the existing `/mexico-weather-site/` block; **keep the
  old `/mexico-weather-site/` entries too** for the redirect window). Update
  the `Navigation.astro` `links` entry
  `https://artemiop.com/mexico-weather-site/` → `…/mexico-weather/`.

### C4. Redirects for old links / SEO
After rename, `/mexico-weather-site/*` 404s (its repo no longer serves there).
The parent user site (owns the apex `artemiop.com`) hosts redirect stubs in
`ArtemioPadilla.github.io`'s `public/`:
- `public/mexico-weather-site/index.html`,
  `public/mexico-weather-site/forecast/index.html`,
  `public/mexico-weather-site/privacidad/index.html` — each with
  `<link rel="canonical">` to the matching `/mexico-weather/…` URL and a
  JS+meta redirect that **preserves `location.search`** (so shared
  `/forecast?lat=…` links land correctly) and `location.hash`.
- These redirect stubs live behind the parent SW's existing
  `/mexico-weather-site/` carve-out (kept per C3) so they are served from the
  network.

### C5. Order & live verification
- Ship **A** then **B** as independent PRs (worktree + two-stage review, as
  established). Each merged + deployed + browser-verified before C.
- Execute **C** last as a coordinated, ordered migration (C1 → C2 → C3 → C4),
  across the two repos. After rename + deploys, **live-verify in a browser**:
  - `https://artemiop.com/mexico-weather/` serves the site;
  - `https://artemiop.com/mexico-weather-site/` (and a `/forecast?lat=…`
    deep link) redirect to the `/mexico-weather/` equivalent with query
    preserved;
  - the own SW at the new scope controls the pages, no stale-fetch blip
    (incl. the old-scope migration path);
  - canonical/OG/sitemap/`/rss.xml` all use `/mexico-weather/`;
  - parent-site nav "Clima México" points to the new URL;
  - the scheduled SMN workflow runs (or `workflow_dispatch` it once) and
    `/rss.xml` shows fresh scraped data, with the build-time CA path proven
    as fallback.

## Constraints (all sub-projects)
- No new runtime npm deps (Playwright/Python are CI-only for the scraper).
- TypeScript strict-clean; ESLint 0 errors; existing unit (77) + E2E (12)
  green, extended with the new favorites/forecast tests.
- Spanish-first; theme-aware (light/dark) consistent with current components;
  a11y not regressed (combobox, stars).
- Each PR: worktree isolation, spec + code-quality two-stage review, CI + E2E
  green, deployed, and live browser-verified (especially C).

## Non-goals (YAGNI)
- No favorites sync/account/back-end (localStorage only).
- No drag-reorder of favorites (insertion order; v1).
- No change to the preset city list.
- The `#1` server-side caching/edge-proxy issue remains out of scope (needs a
  hosting decision).
