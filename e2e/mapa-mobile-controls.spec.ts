import { test, expect } from '@playwright/test';

/**
 * Story 11.3 — opacity, overlays, the model toggle and the measure/snapshot
 * tools are all `hidden sm:*` on /mapa, so a phone user cannot reach them at
 * all. One "Controles" trigger reveals them in place.
 *
 * Reveal-in-place rather than a literal bottom sheet: every one of these
 * controls is wired by id from interactive-map.ts, and three of them are
 * absolutely-positioned siblings of the rail rather than children, so moving
 * DOM nodes would be the risky way to get the same outcome.
 *
 * Asserts UI state only, matching e2e/mapa.spec.ts's convention of never
 * depending on tile pixels.
 */

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

test('the Controles trigger reveals the hidden map chrome', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeVisible();

  const trigger = page.locator('#mw-controls-toggle');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await expect(page.locator('#opacitywrap')).toBeHidden();
  await expect(page.locator('#mw-model-toggle')).toBeHidden();
  await expect(page.locator('#mw-overlays')).toBeHidden();

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#opacitywrap')).toBeVisible();
  await expect(page.locator('#mw-model-toggle')).toBeVisible();
  await expect(page.locator('#mw-overlays')).toBeVisible();

  // The three acceptance actions: change opacity, toggle an overlay,
  // switch the model — all without resizing to desktop.
  await page.locator('#opacity').fill('40');
  await expect(page.locator('#opacity')).toHaveValue('40');

  await page.locator('#mw-overlays summary').click();
  const firstOverlay = page.locator('#layerbtns-overlays input[type="checkbox"]').first();
  await firstOverlay.check();
  await expect(firstOverlay).toBeChecked();

  const gfs = page.locator('.mw-model-btn[data-model="gfs_seamless"]');
  await gfs.click();
  await expect(gfs).toHaveAttribute('aria-pressed', 'true');
});

test('revealed controls meet the 44px touch target rule', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeVisible();
  await page.locator('#mw-controls-toggle').click();
  // The model segments are 24px on desktop by design (a 5-segment pill);
  // once revealed on a phone they are touch targets and must clear 44px
  // vertically. Width stays compact.
  const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.mw-model-btn')).map((el) =>
      Math.round(el.getBoundingClientRect().height),
    ),
  );
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
});

test('Escape closes the controls panel', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeVisible();
  await page.locator('#mw-controls-toggle').click();
  await expect(page.locator('#opacitywrap')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#opacitywrap')).toBeHidden();
  await expect(page.locator('#mw-controls-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('the timeline is still usable with the panel open', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeVisible();
  await page.locator('#mw-controls-toggle').click();
  await expect(page.locator('#tl-next')).toBeVisible();
  await page.locator('#tl-next').click();
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
});

test('the homepage embed does NOT get the controls trigger', async ({ page }) => {
  // features.layerRail is true on the homepage teaser too, so gating the
  // trigger on that flag would drop a control panel into a 400px box.
  await page.goto('');
  await expect(page.locator('#mw-controls-toggle')).toHaveCount(0);
  await expect(page.locator('[id$="-controls-toggle"]')).toHaveCount(0);
});
