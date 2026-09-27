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
 *  - the BUDGET test (≤ 8 desktop, ≤ 5 mobile) is `test.fixme` until the
 *    chrome diet lands; Story 22.5 flips it to a real `test()`.
 *
 * What is measured: every match of CHROME_SELECTOR outside the MapLibre
 * markers/popups/attribution (data and legal text, not controls we chose),
 * with a non-empty box and no `visibility: hidden`, whose box overlaps the
 * `#map-root` container and the viewport. The pure decision lives in
 * src/lib/map/chrome/chrome-budget.ts (unit-tested); this file only measures.
 *
 * State: first-visit welcome card pre-dismissed (a one-time dialog, not
 * chrome — the visual audit keeps it because it captures first impressions,
 * this test counts what stays). Base layer active, nothing clicked. Tiles are
 * mocked with the same 256×256 transparent PNG e2e/mapa.spec.ts uses so
 * MapLibre fires `load` on runners without Esri/GIBS access; the count is DOM
 * state, so tile pixels never matter.
 */

const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');

interface Variant {
  name: 'desktop' | 'mobile';
  viewport: { width: number; height: number };
  mobile: boolean;
  budget: number;
  /** Measured 2026-09-27 on this branch (Story 22.1); see the per-variant comment. */
  baseline: number;
}

const VARIANTS: Variant[] = [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 800 },
    mobile: false,
    budget: CHROME_BUDGET.desktop,
    // Back link, search, locate, 9 rail layers, opacity, overlays summary,
    // 7 timeline controls, 3 MapLibre nav buttons, 5 model segments,
    // 2 snapshot + 3 measure pills, ⚙, ℹ, SMN pill, feedback FAB.
    baseline: 38,
  },
  {
    name: 'mobile',
    viewport: { width: 360, height: 640 },
    mobile: true,
    budget: CHROME_BUDGET.mobile,
    // Same minus what `hidden sm:*` drops on a phone (opacity, overlays,
    // model toggle, snapshot, day-skip/now/range), plus the Controles
    // trigger. The measure/crosshair pills are still shown at 360 px: the
    // bootstrap swaps the wrap's `hidden` for `flex` on the map's first
    // `idle`, on every viewport (interactive-map.ts, tools wiring).
    baseline: 26,
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
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('mw:welcomed', '1');
    } catch {
      /* private mode: the card shows and is counted; log tells */
    }
  });

  await page.goto('mapa/?e2e=1');
  await expect(page.locator('#layerbtn-base')).toBeVisible();
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __map?: { loaded(): boolean } }).__map;
      return !!m && m.loaded();
    },
    undefined,
    { timeout: 20_000 }
  );
  await page.waitForLoadState('networkidle');
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
 * by the bootstrap and the SMN pill updates its label asynchronously, so a
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

    // Flips to test() once Stories 22.2 (compact rail), 22.3 (one tools
    // menu), 22.4 (SMN counter in the top bar) and 22.5 (`?` shortcuts
    // panel) have landed — 22.5 owns the flip (plan §2 E22).
    test.fixme(`/mapa ${variant.name}: interactive elements over the map fit the budget (≤ ${variant.budget})`, async ({
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
