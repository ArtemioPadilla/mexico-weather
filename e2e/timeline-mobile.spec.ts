import { test, expect } from '@playwright/test';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { rainviewerManifest } from '../scripts/visual-audit-lib.mjs';
import { TRANSPARENT_PNG, bootMap } from './chrome-budget-helpers';

/**
 * Story 23.4 — the phone timeline (plan PARIDAD_VISUAL E23).
 *
 * Below `sm` the timeline is a full-width dock glued to the bottom of the
 * map: a row of buttons (▶ ‹ label › Ahora) over the 56 px date-scale bar,
 * which the thumb scrubs. The bar is not part of the MapLibre canvas and
 * takes every touch gesture itself (`touch-action: none`), so a scrub
 * never pans the map and never scrolls the page.
 *
 * /mapa boots on the 24 h GeoColor axis (144 frames) with every tile
 * mocked by the shared chrome-budget boot. The touch drag goes through
 * CDP `Input.dispatchTouchEvent`, i.e. Chromium's real touch pipeline
 * (gesture detection and touch-action included), not synthetic DOM
 * events.
 */

test.use({
  viewport: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
});

const index = async (range: Locator): Promise<number> =>
  Number(await range.inputValue());

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(loc: Locator): Promise<Box> {
  await expect(loc).toBeVisible();
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  x?: number,
  y?: number
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints:
      type === 'touchEnd' || x === undefined || y === undefined
        ? []
        : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
  });
}

/** Moves the touch point in `steps` increments, one frame apart. */
async function touchMoveTo(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number
): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await touch(cdp, 'touchMove', x, y);
    await page.waitForTimeout(20);
  }
}

const mapView = (page: Page) =>
  page.evaluate(() => {
    const m = (
      window as unknown as {
        __map: {
          getCenter: () => { lng: number; lat: number };
          getZoom: () => number;
        };
      }
    ).__map;
    const c = m.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
  });

test.describe('phone timeline dock', () => {
  // The shared boot waits up to 20 s for the satellite loop.
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await bootMap(page);
    await expect(page.locator('#tl-range')).toHaveAttribute('max', '143');
  });

  test('spans the bottom edge: full width, a 56 px bar, pan gestures kept', async ({
    page,
  }) => {
    const root = await boxOf(page.locator('#map-root'));
    const dock = await boxOf(page.locator('#timeline'));
    const bar = await boxOf(page.locator('#tl-bar'));

    // Glued to the bottom edge, edge to edge.
    expect(
      Math.abs(dock.y + dock.height - (root.y + root.height))
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(dock.x - root.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(dock.width - root.width)).toBeLessThanOrEqual(1);
    // The bar is the dock's bottom row, 56 px tall, (nearly) full width:
    // the Controles panel is closed, so no "Ver 10 días" tail beside it.
    expect(Math.round(bar.height)).toBe(56);
    expect(
      Math.abs(bar.y + bar.height - (root.y + root.height))
    ).toBeLessThanOrEqual(1);
    expect(bar.width).toBeGreaterThanOrEqual(root.width - 16);
    await expect(page.locator('#tl-extend')).toBeHidden();
    // The date scale is drawn on the phone too.
    await expect(
      page.locator('#tl-bar [data-part="label-day"]').first()
    ).toBeVisible();

    // The bar owns every touch gesture that starts on it.
    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById('tl-bar')!).touchAction
      )
    ).toBe('none');

    // What floats above the dock clears it.
    const trigger = await boxOf(page.locator('#mw-controls-toggle'));
    expect(trigger.y + trigger.height).toBeLessThanOrEqual(dock.y);
  });

  test('a thumb drag on the bar scrubs frames and never pans the map', async ({
    page,
  }) => {
    const range = page.locator('#tl-range');
    const play = page.locator('#tl-play');
    const barEl = page.locator('#tl-bar');
    const bar = await boxOf(barEl);
    const y = bar.y + bar.height / 2;
    const before = await mapView(page);
    const cdp = await page.context().newCDPSession(page);

    const start = { x: bar.x + bar.width * 0.2, y };
    await touch(cdp, 'touchStart', start.x, start.y);
    // The press pauses the loop and lands on the frame under the thumb
    // (~20 % of the 24 h axis).
    await expect(play).toHaveAttribute('data-state', 'paused');
    await expect(barEl).toHaveAttribute('data-dragging', 'true');
    const atPress = await index(range);
    expect(atPress).toBeGreaterThan(15);
    expect(atPress).toBeLessThan(40);

    // Still down: to the right walks forward, with a bit of vertical
    // wobble as a real thumb has.
    const right = { x: bar.x + bar.width * 0.75, y: y - 6 };
    await touchMoveTo(page, cdp, start, right, 10);
    await expect.poll(() => index(range)).toBeGreaterThan(atPress + 60);
    const atRight = await index(range);
    await expect(barEl).toHaveAttribute('data-index', String(atRight));
    // … and back to the left, before lifting the thumb.
    const left = { x: bar.x + bar.width * 0.45, y: y + 4 };
    await touchMoveTo(page, cdp, right, left, 6);
    await expect.poll(() => index(range)).toBeLessThan(atRight - 30);
    await expect(barEl).toHaveAttribute('data-dragging', 'true');
    await touch(cdp, 'touchEnd');
    await expect(barEl).not.toHaveAttribute('data-dragging', 'true');

    // The loop stays paused, the hash follows the frame, and the map has
    // not moved an inch.
    await expect(play).toHaveAttribute('data-state', 'paused');
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/t=/);
    const after = await mapView(page);
    expect(after.lng).toBeCloseTo(before.lng, 6);
    expect(after.lat).toBeCloseTo(before.lat, 6);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    // Nor the page.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('with Controles open: ‹ › Ahora in the row, "Ver 10 días" as the tail', async ({
    page,
  }) => {
    const range = page.locator('#tl-range');
    await page.locator('#mw-controls-toggle').tap();
    const dock = await boxOf(page.locator('#timeline'));
    const bar = await boxOf(page.locator('#tl-bar'));
    const now = page.locator('#tl-now');
    for (const sel of ['#tl-prev', '#tl-next', '#tl-now']) {
      const b = await boxOf(page.locator(sel));
      expect(b.width, sel).toBeGreaterThanOrEqual(44);
      expect(b.height, sel).toBeGreaterThanOrEqual(44);
      // In the button row, above the bar.
      expect(b.y + b.height, sel).toBeLessThanOrEqual(bar.y + 1);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(dock.x + dock.width);
    }
    // « » stay desktop steps.
    await expect(page.locator('#tl-day-prev')).toBeHidden();
    await expect(page.locator('#tl-day-next')).toBeHidden();
    const tail = await boxOf(page.locator('#tl-extend'));
    expect(Math.round(tail.height)).toBe(56);
    expect(Math.abs(tail.y - bar.y)).toBeLessThanOrEqual(1);
    expect(tail.x).toBeGreaterThanOrEqual(bar.x + bar.width - 1);
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);

    // Ahora brings back the frame closest to now.
    await range.fill('10');
    await expect.poll(() => index(range)).toBe(10);
    await now.tap();
    await expect.poll(() => index(range)).toBeGreaterThan(130);
  });
});

test('home embed: the dock keeps Ahora and the bar outside compact /mapa', async ({
  page,
}) => {
  const png = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });
  await page.route('**/*.arcgisonline.com/**', png);
  await page.route('**/tilecache.rainviewer.com/**', png);
  await page.route('**/api.rainviewer.com/public/weather-maps.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rainviewerManifest()),
    })
  );
  await page.goto('');
  const root = await boxOf(page.locator('#home-map-root'));
  const dock = await boxOf(page.locator('#home-map-timeline'));
  expect(Math.abs(dock.width - root.width)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(dock.y + dock.height - (root.y + root.height))
  ).toBeLessThanOrEqual(1);
  const bar = await boxOf(page.locator('#home-map-tl-bar'));
  expect(Math.round(bar.height)).toBe(56);
  // No Controles panel here: ‹ › and Ahora are always on the row.
  await expect(page.locator('#home-map-tl-next')).toBeVisible();
  const now = await boxOf(page.locator('#tl-now'));
  expect(now.width).toBeGreaterThanOrEqual(44);
  expect(now.height).toBeGreaterThanOrEqual(44);
  expect(now.y + now.height).toBeLessThanOrEqual(bar.y + 1);
});
