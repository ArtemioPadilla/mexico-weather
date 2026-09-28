import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { TRANSPARENT_PNG_BASE64 } from '../scripts/visual-audit-lib.mjs';

/**
 * Story 11.3 — opacity, overlays, the model toggle and the measure/snapshot
 * tools are all `hidden sm:*` on /mapa, so a phone user cannot reach them at
 * all. One "Controles" trigger reveals them in place. Since Story 22.2 the
 * panel reveals the rail's Capas / Superposiciones tab bar and the active
 * layer's block (sub-options + opacity) instead of a permanent slider and
 * the overlays accordion. Since Story 22.3 the measure/snapshot tools live
 * in the ⋯ menu on every viewport, and the model toggle shows only with a
 * forecast layer active (panel open on a phone).
 *
 * Reveal-in-place rather than a literal bottom sheet: every one of these
 * controls is wired by id from interactive-map.ts, and three of them are
 * absolutely-positioned siblings of the rail rather than children, so moving
 * DOM nodes would be the risky way to get the same outcome.
 *
 * Asserts UI state only, matching e2e/mapa.spec.ts's convention of never
 * depending on tile pixels.
 */

test.use({
  viewport: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
});

const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');

/**
 * Story 22.2 — the opacity control now lives in the active layer's block,
 * which exists only for a weather layer. /mapa boots on GeoColor (Story
 * 21.2); serve the basemap and GIBS tiles (the 256×256 PNG every map spec
 * uses) so that boot lands on satellite on any runner, and wait for it
 * before opening the panel.
 */
async function openMapaOnSatellite(page: Page): Promise<void> {
  const png = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });
  await page.route('**/*.arcgisonline.com/**', png);
  await page.route('**/gibs.earthdata.nasa.gov/**', png);
  // The first-visit welcome card (Story 19.2) sits over the top of the map
  // at 360 px — over the rail's tab bar too — until dismissed; start as a
  // returning visitor, as e2e/chrome-budget.spec.ts does.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('mw:welcomed', '1');
    } catch {
      /* private mode: the card shows */
    }
  });
  await page.goto('mapa');
  // Story 22.5 — below sm the rail shows with the panel only: built is
  // enough here.
  await expect(page.locator('#layerbtn-base')).toBeAttached();
  await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 20_000 }
  );
}

/** Story 22.3 — switch to temperature (hydrates from the pre-baked
 *  best_match field grid, no API call) so the model toggle applies. */
async function showForecastLayer(page: Page): Promise<void> {
  await page.locator('#layerbtn-temperature').click();
  await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 20_000 }
  );
}

test('the Controles trigger reveals the hidden map chrome', async ({
  page,
}) => {
  await openMapaOnSatellite(page);

  const trigger = page.locator('#mw-controls-toggle');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await expect(page.locator('#opacitywrap')).toBeHidden();
  await expect(page.locator('#mw-model-toggle')).toBeHidden();
  await expect(page.locator('#mw-overlays-tab')).toBeHidden();
  await expect(page.locator('#mw-overlays')).toBeHidden();

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  // Story 22.2 — the active layer's block (sub-options + opacity) and the
  // Capas / Superposiciones tab bar come with the panel.
  await expect(page.locator('#opacitywrap')).toBeVisible();
  await expect(page.locator('#satellite-sub-options')).toBeVisible();
  await expect(page.locator('#mw-overlays-tab')).toBeVisible();
  // Story 22.3 — no model to pick on satellite, panel open or not.
  await expect(page.locator('#mw-model-toggle')).toBeHidden();

  // The three acceptance actions: change opacity, toggle an overlay,
  // switch the model — all without resizing to desktop.
  await page.locator('#opacity').fill('40');
  await expect(page.locator('#opacity')).toHaveValue('40');

  // The overlays accordion became the second tab (Story 22.2): same
  // #mw-overlays panel, one tap on its tab instead of on the summary.
  await page.locator('#mw-overlays-tab').click();
  await expect(page.locator('#mw-overlays')).toBeVisible();
  const firstOverlay = page
    .locator('#layerbtns-overlays input[type="checkbox"]')
    .first();
  await firstOverlay.check();
  await expect(firstOverlay).toBeChecked();

  // The model toggle comes with a forecast layer (Story 22.3). The rail
  // is back on its layers tab for the tap on temperature.
  await page.locator('#mw-layers-tab').click();
  await showForecastLayer(page);
  await expect(page.locator('#mw-model-toggle')).toBeVisible();
  const gfs = page.locator('.mw-model-btn[data-model="gfs_seamless"]');
  await gfs.click();
  await expect(gfs).toHaveAttribute('aria-pressed', 'true');
});

test('revealed controls meet the 44px touch target rule', async ({ page }) => {
  await openMapaOnSatellite(page);
  await page.locator('#mw-controls-toggle').click();
  // Story 22.2 adds the rail's tab bar, the active layer's sub-option
  // chips, the overlay filter and rows.
  const railHeights = async (sel: string): Promise<number[]> =>
    page.evaluate(
      (s) =>
        Array.from(document.querySelectorAll<HTMLElement>(s))
          .filter((el) => el.checkVisibility())
          .map((el) => Math.round(el.getBoundingClientRect().height)),
      sel
    );
  const tabsAndChips = await railHeights(
    '.im-rail [role="tab"], #satellite-sub-options button'
  );
  expect(tabsAndChips.length).toBe(5);
  for (const h of tabsAndChips) expect(h).toBeGreaterThanOrEqual(44);

  await page.locator('#mw-overlays-tab').click();
  const overlayTargets = await railHeights(
    '#mw-overlays-filter, #layerbtns-overlays [data-overlay-row]'
  );
  expect(overlayTargets.length).toBeGreaterThan(10);
  for (const h of overlayTargets) expect(h).toBeGreaterThanOrEqual(44);

  // The model segments are 24px on desktop by design (a 5-segment pill);
  // once revealed on a phone they are touch targets and must clear 44px
  // vertically. Width stays compact. Since Story 22.3 they exist only
  // with a forecast layer active.
  await page.locator('#mw-layers-tab').click();
  await showForecastLayer(page);
  await expect(page.locator('#mw-model-toggle')).toBeVisible();
  const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.mw-model-btn')).map(
      (el) => Math.round(el.getBoundingClientRect().height)
    )
  );
  expect(heights.length).toBe(5);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
});

test('Escape closes the controls panel', async ({ page }) => {
  await openMapaOnSatellite(page);
  await page.locator('#mw-controls-toggle').click();
  await expect(page.locator('#opacitywrap')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#opacitywrap')).toBeHidden();
  await expect(page.locator('#mw-controls-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

test('closing the panel on the overlays tab brings the layer icons back', async ({
  page,
}) => {
  // Story 22.2 — the tab bar hides with the panel below sm; a rail left on
  // the overlays tab would hide every layer icon with no way back.
  // Story 22.5 — on /mapa the whole rail now folds away with the panel
  // (chrome budget): closing it on the overlays tab leaves the rail on
  // its layers tab, so the next open shows the layer icons again.
  await openMapaOnSatellite(page);
  const trigger = page.locator('#mw-controls-toggle');
  await trigger.click();
  await page.locator('#mw-overlays-tab').click();
  await expect(page.locator('#layerbtn-radar')).toBeHidden();
  await trigger.click();
  await expect(page.locator('#mw-overlays')).toBeHidden();
  await expect(page.locator('.im-rail')).toBeHidden();
  await expect(page.locator('#mw-layers-tab')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await trigger.click();
  await expect(page.locator('#layerbtn-radar')).toBeVisible();
  await expect(page.locator('#mw-overlays')).toBeHidden();
});

test('the timeline is still usable with the panel open', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeAttached();
  // Story 22.5 — ‹ › show with the panel on a phone (chrome budget).
  await expect(page.locator('#tl-next')).toBeHidden();
  await page.locator('#mw-controls-toggle').click();
  await expect(page.locator('#tl-next')).toBeVisible();
  await page.locator('#tl-next').click();
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
});

test('the homepage embed does NOT get the controls trigger', async ({
  page,
}) => {
  // features.layerRail is true on the homepage teaser too, so gating the
  // trigger on that flag would drop a control panel into a 400px box.
  await page.goto('');
  await expect(page.locator('#mw-controls-toggle')).toHaveCount(0);
  await expect(page.locator('[id$="-controls-toggle"]')).toHaveCount(0);
});
