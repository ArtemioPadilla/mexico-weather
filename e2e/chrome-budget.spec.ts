import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import {
  TRANSPARENT_PNG_BASE64,
  rainviewerManifest,
} from '../scripts/visual-audit-lib.mjs';
import {
  CHROME_BUDGET,
  CHROME_EXCLUDE_SELECTOR,
  CHROME_SELECTOR,
  chromeOverMap,
  type ChromeCandidate,
  type Rect,
} from '../src/lib/map/chrome/chrome-budget';

/**
 * Story 22.1 — the chrome budget as a test (plan PARIDAD_VISUAL §1.2, §5).
 *
 * Counts the interactive elements (button, a[href], input, select,
 * [role=button], summary) that are visible and overlap the map container on
 * a cold /mapa load, at desktop 1280×800 and phone 360×640. Two tests per
 * viewport:
 *
 *  - the BASELINE test asserts the exact number measured when the story
 *    shipped. It fails when a PR adds a control, and it fails when a story
 *    removes one — on purpose: each of Stories 22.2–22.5 lowers the number
 *    here and in the "Hoy" column of PLAN_PARIDAD_VISUAL §5, so the plan
 *    and the test never drift apart.
 *  - the BUDGET test (≤ 8 desktop, ≤ 5 mobile), a real `test()` since
 *    Story 22.5 closed the chrome diet (it was `test.fixme` until then).
 *
 * What is measured: every match of CHROME_SELECTOR outside the MapLibre
 * markers/popups/attribution (data and legal text, not controls we chose),
 * with a non-empty box and no `visibility: hidden`, whose box overlaps the
 * `#map-root` container and the viewport. The pure decision lives in
 * src/lib/map/chrome/chrome-budget.ts (unit-tested); this file only measures.
 *
 * State: first-visit welcome card pre-dismissed (a one-time dialog, not
 * chrome — the visual audit keeps it because it captures first impressions,
 * this test counts what stays). Satellite active and its loop running (the
 * Story 21.2 boot), nothing clicked. Tiles are mocked with the same 256×256
 * transparent PNG e2e/mapa.spec.ts uses so MapLibre fires `load` on runners
 * without Esri/GIBS access; the count is DOM state, so tile pixels never
 * matter.
 */

const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');

interface Variant {
  name: 'desktop' | 'mobile';
  viewport: { width: number; height: number };
  mobile: boolean;
  budget: number;
  /** Measured 2026-09-27 on this branch (Story 22.1, re-measured after the
   *  Story 21.2 satellite boot and on 2026-09-28 after the Story 22.2
   *  compact rail and the Story 22.3 tools menu, after the Story 22.4
   *  SMN counter and after the Story 22.5 chrome budget); see the
   *  per-variant comment. */
  baseline: number;
}

const VARIANTS: Variant[] = [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 800 },
    mobile: false,
    budget: CHROME_BUDGET.desktop,
    // Search, locate, the rail's 2 tabs (Capas /
    // Superposiciones — Story 22.2, in place of the overlays summary), 9
    // layer tiles, 3 satellite sub-options (GeoColor / Infrarrojo / Color
    // real) and the opacity range in the active layer's block, 8 timeline
    // controls (the 7 of the base layer + "Ver 10 días"), the ⋯ tools
    // menu, feedback FAB (the SMN counter only with avisos, Story 22.4).
    // 38 on the base layer (Story 22.1) → 42 since /mapa boots on
    // satellite (21.2) → 43 with the compact rail (22.2): the tab bar
    // costs one control more than the summary it replaced, while the rail
    // itself went from 15 visible rows to 7 → 32 with the one tools menu
    // (22.3): 2 snapshot + 3 measure pills, ⚙ and ℹ became one ⋯ button
    // (−4), and the 5 model segments show only with a forecast layer, not
    // on satellite (−5) → 28 with the back link moved into the ⋯ menu's
    // Info tab and no MapLibre +/−/compass buttons on /mapa (zoom by
    // scroll, pinch and keys; −4) → 27 with the always-on SMN pill
    // turned into a top-bar counter that hides on a quiet feed (22.4,
    // −1; +1 again while there are avisos) → 8 with the chrome budget
    // (22.5): the rail starts folded to its 2 tabs (−9 tiles, −3
    // sub-options, −opacity), the timeline's « ‹ › » Ahora fade in only on
    // hover/focus (−5) and the feedback button moved to the nav bar (−1).
    // Left: search, locate, ⋯, the 2 rail tabs, ▶, "Ver 10 días", scrubber.
    baseline: 8,
  },
  {
    name: 'mobile',
    viewport: { width: 360, height: 640 },
    mobile: true,
    budget: CHROME_BUDGET.mobile,
    // Same minus what `hidden sm:*` drops on a phone (the rail's tab bar
    // and active-layer block, day-skip/now/range), plus the Controles
    // trigger and "Ver 10 días" (satellite, Story 21.2). 26 on the base
    // layer (Story 22.1) → 27 since /mapa boots on satellite; unchanged by
    // the compact rail (Story 22.2) → 23 with the one tools menu (22.3):
    // the Distancia/Área/Mira pills (which leaked onto the phone map on
    // the first `idle`), ⚙ and ℹ became one ⋯ button (−4) → 19 with the
    // back link inside the ⋯ menu and no MapLibre nav buttons (−4) → 18
    // with the SMN pill turned into a counter hidden on a quiet feed (22.4)
    // → 5 with the chrome budget (22.5): the 9 layer icons, ‹ › and "Ver
    // 10 días" show with the Controles panel (now "Capas y controles"),
    // the feedback button sits in the nav bar. Left: search, locate, ⋯,
    // Controles, ▶.
    baseline: 5,
  },
];

async function bootMap(page: Page): Promise<void> {
  const png = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });
  // Deterministic basemap: a decodable tile so MapLibre fires `load`
  // regardless of the runner's network (a 1×1 PNG does not decode in
  // Chromium and the map never boots).
  await page.route('**/*.arcgisonline.com/**', png);
  await page.route('**/tilecache.rainviewer.com/**', png);
  // Story 21.2 — /mapa boots on GeoColor: the probe and the satellite
  // tiles must succeed here too, or the boot falls back to radar and the
  // count would differ between a runner with and without GIBS access.
  await page.route('**/gibs.earthdata.nasa.gov/**', png);
  await page.route('**/api.rainviewer.com/public/weather-maps.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rainviewerManifest()),
    })
  );
  // No live storms: the tropical overlay is GL, not DOM, but keep the
  // boot network-free so the count never depends on the season.
  await page.route('**/www.nhc.noaa.gov/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ activeStorms: [] }),
    })
  );
  // Story 22.4 — the SMN counter in the top bar shows only when the feed
  // has avisos. Serve a quiet feed so the count never depends on the
  // week's weather: with avisos the counter adds one control (+1 on both
  // viewports), which is what the always-on SMN pill used to cost.
  await page.route('**/data/smn-by-state.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ metadata: {}, byState: {}, global: [] }),
    })
  );
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('mw:welcomed', '1');
    } catch {
      /* private mode: the card shows and is counted; log tells */
    }
  });

  await page.goto('mapa/?e2e=1');
  // The rail is built (its tiles stay folded away since Story 22.5: the
  // rail starts collapsed to its tab bar, below sm behind Controles).
  await expect(page.locator('#layerbtn-base')).toBeAttached();
  // Story 21.2 — /mapa boots on GeoColor and keeps animating, so neither
  // `map.loaded()` nor `networkidle` marks the end of the boot any more
  // (tiles are in flight on every frame). The cold-load state is complete
  // once the satellite layer is pressed, its loop runs (the first frame
  // has tiles), and the tools wrap has surfaced once the map loaded
  // (inside the closed ⋯ menu since Story 22.3, so: un-[hidden], not
  // visible).
  const boot = { timeout: 20_000 };
  await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
    'aria-pressed',
    'true',
    boot
  );
  await expect(page.locator('#tl-play')).toHaveAttribute(
    'data-state',
    'playing',
    boot
  );
  await expect(page.locator('#mw-measure-wrap')).not.toHaveAttribute(
    'hidden',
    boot
  );
  // "Ver 10 días" has surfaced (un-[hidden]; on a phone it shows with the
  // Controles panel since Story 22.5, so: not visible there).
  await expect(page.locator('#tl-extend')).not.toHaveAttribute('hidden');
  // The SMN feed has loaded (the counter decided whether to show): the
  // widget inside its closed popover settles on the calm state.
  await expect(
    page.locator('#mapa-smn-panel [data-smn-avisos]')
  ).toHaveAttribute('data-smn-state', 'calm', boot);
  // One tick of the wide-control surfacing interval (1.5 s) for margin.
  await page.waitForTimeout(1600);
}

interface Measurement {
  map: Rect;
  viewport: Rect;
  candidates: ChromeCandidate[];
}

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(
    ([selector, exclude]) => {
      const toRect = (b: DOMRect): Rect => ({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      });
      const root = document.getElementById('map-root');
      if (!root) throw new Error('#map-root missing');
      const els = Array.from(
        document.querySelectorAll<HTMLElement>(selector)
      ).filter((el) => !el.closest(exclude));
      const candidates = els.map((el): ChromeCandidate => {
        const box = el.getBoundingClientRect();
        // checkVisibility() is what Playwright's toBeVisible() leans on:
        // it sees display:none, visibility:hidden and — unlike a bare
        // getBoundingClientRect(), which still reports a box — the
        // `content-visibility: hidden` Chromium ≥ 131 gives the content of
        // a closed <details> (the nav's catalog dropdown and mobile menu).
        const visible =
          box.width > 0 &&
          box.height > 0 &&
          el.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
          });
        let id = el.id ? `#${el.id}` : el.tagName.toLowerCase();
        if (!el.id) {
          const parentId = el.closest('[id]')?.id;
          if (parentId) id = `#${parentId} ${id}`;
          const name = el.getAttribute('aria-label') ?? el.textContent?.trim();
          if (name) id += `[${name.slice(0, 24)}]`;
        }
        return { id, rect: toRect(box), visible };
      });
      return {
        map: toRect(root.getBoundingClientRect()),
        viewport: {
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        },
        candidates,
      };
    },
    [CHROME_SELECTOR, CHROME_EXCLUDE_SELECTOR] as const
  );
}

/**
 * Measure until two consecutive readings agree — the rail buttons are built
 * by the bootstrap and the SMN counter shows asynchronously, so a
 * single read right after `load` could catch the chrome mid-flight.
 */
async function measureStable(
  page: Page,
  variant: Variant,
  testInfo: TestInfo
): Promise<ChromeCandidate[]> {
  let previous: ChromeCandidate[] | null = null;
  let over: ChromeCandidate[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const m = await measure(page);
    over = chromeOverMap(m.map, m.candidates, m.viewport);
    const same =
      previous !== null &&
      previous.length === over.length &&
      previous.every((c, i) => c.id === over[i].id);
    if (same) break;
    previous = over;
    await page.waitForTimeout(500);
  }
  const lines = over.map(
    (c) =>
      `${c.id} @ ${Math.round(c.rect.x)},${Math.round(c.rect.y)} ${Math.round(c.rect.width)}×${Math.round(c.rect.height)}`
  );
  const report =
    `[chrome-budget] ${variant.name} ${variant.viewport.width}×${variant.viewport.height}: ` +
    `${over.length} interactive elements over the map (budget ≤ ${variant.budget}, baseline ${variant.baseline})\n` +
    lines.map((l) => `  - ${l}`).join('\n');
  console.log(report);
  await testInfo.attach(`chrome-budget-${variant.name}.txt`, {
    body: report,
    contentType: 'text/plain',
  });
  return over;
}

for (const variant of VARIANTS) {
  test.describe(`chrome budget · ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      ...(variant.mobile
        ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
        : {}),
    });

    test(`/mapa ${variant.name}: interactive elements over the map match the recorded baseline (${variant.baseline})`, async ({
      page,
    }, testInfo) => {
      await bootMap(page);
      const over = await measureStable(page, variant, testInfo);
      expect(
        over.length,
        `${variant.name} chrome count changed (baseline ${variant.baseline}, now ${over.length}). ` +
          `Went up: a control was added over the map — move it behind ⋯ / ⚙ or drop it. ` +
          `Went down: good, record the new number in VARIANTS[].baseline here and in the "Hoy" column of docs/PLAN_PARIDAD_VISUAL.md §5. ` +
          `Elements: ${over.map((c) => c.id).join(', ')}`
      ).toBe(variant.baseline);
    });

    // Plan §1.2 / §2 E22 — real since Story 22.5 (compact rail 22.2, one
    // tools menu 22.3, SMN counter 22.4, `?` panel + chrome budget 22.5).
    test(`/mapa ${variant.name}: interactive elements over the map fit the budget (≤ ${variant.budget})`, async ({
      page,
    }, testInfo) => {
      await bootMap(page);
      const over = await measureStable(page, variant, testInfo);
      expect(
        over.length,
        `${variant.name} chrome over the map exceeds the plan §1.2 budget: ${over
          .map((c) => c.id)
          .join(', ')}`
      ).toBeLessThanOrEqual(variant.budget);
    });
  });
}
