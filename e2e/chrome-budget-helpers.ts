import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import {
  TRANSPARENT_PNG_BASE64,
  rainviewerManifest,
} from '../scripts/visual-audit-lib.mjs';
import {
  CHROME_EXCLUDE_SELECTOR,
  CHROME_SELECTOR,
  chromeOverMap,
  type ChromeCandidate,
  type Rect,
} from '../src/lib/map/chrome/chrome-budget';

/**
 * Story 22.1 / 26.2 — the cold /mapa boot and the chrome count shared by
 * e2e/chrome-budget.spec.ts (asserts the baseline and the budget) and
 * e2e/ux-metrics.spec.ts (reports the count in the PR comment). Not a spec:
 * importing a spec file would register its tests twice.
 */

export const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');

/** What measureStable() needs to label its report. */
export interface ChromeVariantLabel {
  name: string;
  viewport: { width: number; height: number };
  budget: number;
  baseline?: number;
}

export async function bootMap(page: Page): Promise<void> {
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

export interface Measurement {
  map: Rect;
  viewport: Rect;
  candidates: ChromeCandidate[];
}

export async function measure(page: Page): Promise<Measurement> {
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
export async function measureStable(
  page: Page,
  variant: ChromeVariantLabel,
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
    `${over.length} interactive elements over the map (budget ≤ ${variant.budget}` +
    (variant.baseline !== undefined ? `, baseline ${variant.baseline}` : '') +
    ')\n' +
    lines.map((l) => `  - ${l}`).join('\n');
  console.log(report);
  await testInfo.attach(`chrome-budget-${variant.name}.txt`, {
    body: report,
    contentType: 'text/plain',
  });
  return over;
}
