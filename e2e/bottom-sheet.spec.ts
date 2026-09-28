import { test, expect } from '@playwright/test';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { bootMap } from './chrome-budget-helpers';

/**
 * Story 25.1 — bottom sheets on a phone (plan PARIDAD_VISUAL E25, closes
 * ROADMAP 11.3).
 *
 * Below `sm` the layers rail ("Capas y controles"), the ⋯ tools menu and
 * the place card rise from the top of the timeline dock as a sheet with
 * three heights — peek, half, full — that a thumb drags on its handle,
 * the keyboard resizes (↑ ↓ Inicio Fin, Enter cycles) and Escape closes,
 * returning the focus to the control that opened it. Acceptance: at
 * 360×640 every panel fits without covering the timeline, and what
 * floats above the dock (the Controles trigger) floats above the sheet.
 *
 * Drags go through CDP `Input.dispatchTouchEvent`, i.e. Chromium's real
 * touch pipeline (pointer events, capture, touch-action), like the phone
 * timeline spec. Every tile and feed is mocked by the shared chrome-budget
 * boot; the place card's forecast is mocked below.
 */

test.use({
  viewport: { width: 360, height: 640 },
  hasTouch: true,
  isMobile: true,
});

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

/** Drags the sheet's handle by `dy` px (negative: up) in `steps` moves,
 *  one frame apart — slow enough never to count as a fling — and holds
 *  still before lifting the finger. */
async function dragHandle(
  page: Page,
  cdp: CDPSession,
  handle: Locator,
  dy: number,
  steps = 8
): Promise<void> {
  const b = await boxOf(handle);
  const x = b.x + b.width / 2;
  const y0 = b.y + b.height / 2;
  await touch(cdp, 'touchStart', x, y0);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', x, y0 + (dy * i) / steps);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(200);
  await touch(cdp, 'touchEnd');
}

const expectFitsAboveDock = async (page: Page, sheet: Locator) => {
  const root = await boxOf(page.locator('#map-root'));
  const dock = await boxOf(page.locator('#timeline'));
  // Wait out the 200 ms height transition before measuring.
  await page.waitForTimeout(300);
  const s = await boxOf(sheet);
  // Edge to edge, resting on the dock, never over it.
  expect(Math.abs(s.x - root.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.width - root.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.y + s.height - dock.y)).toBeLessThanOrEqual(1);
  // Clear of the search row and the ⋯ button at every height.
  const tools = await boxOf(page.locator('#mw-tools-btn'));
  expect(s.y).toBeGreaterThanOrEqual(tools.y + tools.height);
  const search = await boxOf(page.locator('#mw-search-toggle'));
  expect(s.y).toBeGreaterThanOrEqual(search.y + search.height);
  return s;
};

const detentOf = (sheet: Locator) => sheet.getAttribute('data-sheet-detent');

test.describe('phone bottom sheets', () => {
  // The shared boot waits up to 20 s for the satellite loop.
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await bootMap(page);
  });

  test('layers: the trigger opens a half sheet over the dock; drag to full, peek and closed', async ({
    page,
  }) => {
    const trigger = page.locator('#mw-controls-toggle');
    const rail = page.locator('.im-rail');
    const handle = rail.locator('[data-sheet-handle]');
    await trigger.tap();
    await expect(rail).toHaveAttribute('data-sheet-detent', 'half');
    await expect(page.locator('#map-root')).toHaveAttribute(
      'data-sheet',
      'layers'
    );
    const half = await expectFitsAboveDock(page, rail);
    // The layer tiles are a 3-column grid of icon + name on the sheet.
    const tiles = await Promise.all(
      ['#layerbtn-base', '#layerbtn-satellite', '#layerbtn-radar'].map((s) =>
        boxOf(page.locator(s))
      )
    );
    expect(new Set(tiles.map((t) => Math.round(t.y))).size).toBe(1);
    for (const t of tiles) expect(t.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#layerbtn-radar')).toContainText(/\S/);
    // The trigger floats above the sheet, still one tap from closing it.
    const tr = await boxOf(trigger);
    expect(tr.y + tr.height).toBeLessThanOrEqual(half.y);
    // The handle is a 44 px row naming the height.
    const hb = await boxOf(handle);
    expect(hb.height).toBeGreaterThanOrEqual(44);
    await expect(handle).toHaveAttribute(
      'aria-label',
      'Tamaño del panel: medio'
    );

    const cdp = await page.context().newCDPSession(page);
    await dragHandle(page, cdp, handle, -200);
    await expect(rail).toHaveAttribute('data-sheet-detent', 'full');
    const full = await expectFitsAboveDock(page, rail);
    expect(full.height).toBeGreaterThan(half.height + 60);
    const trFull = await boxOf(trigger);
    expect(trFull.y + trFull.height).toBeLessThanOrEqual(full.y);

    await dragHandle(page, cdp, handle, full.height - 130);
    await expect(rail).toHaveAttribute('data-sheet-detent', 'peek');
    const peek = await expectFitsAboveDock(page, rail);
    expect(peek.height).toBeLessThan(half.height);
    // At peek the tab bar still shows under the handle.
    await expect(page.locator('#mw-overlays-tab')).toBeVisible();

    await dragHandle(page, cdp, handle, peek.height);
    await expect(rail).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#map-root')).not.toHaveAttribute(
      'data-sheet',
      /./
    );
    // Closed like the trigger closes it: the timeline's ‹ › go too.
    await expect(page.locator('#tl-next')).toBeHidden();
    // And it opens again at half.
    await trigger.tap();
    await expect(rail).toHaveAttribute('data-sheet-detent', 'half');
  });

  test('layers: keyboard resizes from the handle; Escape closes and refocuses the trigger', async ({
    page,
  }) => {
    const trigger = page.locator('#mw-controls-toggle');
    const rail = page.locator('.im-rail');
    const handle = rail.locator('[data-sheet-handle]');
    await trigger.click();
    // The focus moves into the sheet, on its selected tab.
    await expect(page.locator('#mw-layers-tab')).toBeFocused();
    await handle.focus();
    await page.keyboard.press('ArrowDown');
    await expect(rail).toHaveAttribute('data-sheet-detent', 'peek');
    await expect(handle).toHaveAttribute(
      'aria-label',
      'Tamaño del panel: reducido'
    );
    await page.keyboard.press('ArrowUp');
    await expect(rail).toHaveAttribute('data-sheet-detent', 'half');
    await page.keyboard.press('Home');
    await expect(rail).toHaveAttribute('data-sheet-detent', 'full');
    await page.keyboard.press('End');
    await expect(rail).toHaveAttribute('data-sheet-detent', 'peek');
    await page.keyboard.press('Enter');
    await expect(rail).toHaveAttribute('data-sheet-detent', 'half');
    // Escape from a tab inside the sheet closes the whole panel (not just
    // the rail's tab panel) and hands the focus back to the trigger.
    await page.locator('#mw-overlays-tab').focus();
    await page.keyboard.press('Escape');
    await expect(rail).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('⋯ tools: a sheet over the dock; one sheet at a time; Escape returns to ⋯', async ({
    page,
  }) => {
    const btn = page.locator('#mw-tools-btn');
    const panel = page.locator('#mw-tools-panel');
    await btn.tap();
    await expect(panel).toHaveAttribute('data-sheet-detent', 'half');
    await expect(page.locator('#map-root')).toHaveAttribute(
      'data-sheet',
      'tools'
    );
    await expectFitsAboveDock(page, panel);
    // The ⋯ button kept its place over the map.
    const b = await boxOf(btn);
    expect(b.x + b.width).toBeLessThanOrEqual(360 - 11);
    expect(b.y).toBeLessThan(120);
    // Every tab and tool is reachable in the sheet.
    await expect(page.locator('#mw-tools-panel [role="tab"]')).toHaveCount(3);
    await expect(page.locator('#mw-crosshair-btn')).toBeVisible();

    const cdp = await page.context().newCDPSession(page);
    await dragHandle(page, cdp, panel.locator('[data-sheet-handle]'), -200);
    await expect(panel).toHaveAttribute('data-sheet-detent', 'full');
    await expectFitsAboveDock(page, panel);
    // The settings tab scrolls inside the sheet, not the page.
    await page.locator('#mw-tools-tab-settings').tap();
    await expect(page.locator('#mw-settings')).toBeVisible();
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      sy: document.scrollingElement?.scrollTop ?? 0,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
    expect(overflow.sy).toBe(0);

    // Opening the layers sheet closes the tools one.
    await page.locator('#mw-controls-toggle').tap();
    await expect(panel).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.im-rail')).toHaveAttribute(
      'data-sheet-detent',
      'half'
    );
    await expect(page.locator('#map-root')).toHaveAttribute(
      'data-sheet',
      'layers'
    );

    // Keyboard: Escape inside the tools sheet returns to ⋯.
    await btn.click();
    await expect(page.locator('.im-rail')).toBeHidden();
    await expect(page.locator('#mw-tools-tab-settings')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('place card: a sheet over the dock, drag to its header, drag away to close', async ({
    page,
  }) => {
    await page.route('**/api.open-meteo.com/v1/forecast**', async (route) => {
      const url = route.request().url();
      if (!url.includes('daily=')) return route.fallback();
      const t0 = Date.UTC(2026, 8, 28);
      const dates = Array.from({ length: 10 }, (_, i) =>
        new Date(t0 + i * 86_400_000).toISOString().slice(0, 10)
      );
      const hours = Array.from({ length: 240 }, (_, i) =>
        new Date(t0 + i * 3_600_000).toISOString().slice(0, 16)
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          current: { time: hours[0], temperature_2m: 21, weather_code: 2 },
          hourly: {
            time: hours,
            temperature_2m: hours.map(() => 20),
            weather_code: hours.map(() => 2),
            precipitation_probability: hours.map(() => 10),
          },
          daily: {
            time: dates,
            weather_code: dates.map(() => 2),
            temperature_2m_max: dates.map(() => 26),
            temperature_2m_min: dates.map(() => 12),
            precipitation_probability_max: dates.map(() => 20),
          },
        }),
      });
    });
    const card = page.locator('#mw-place-card');
    await expect(card).toBeHidden();
    // Open the layers sheet first: the card replaces it.
    await page.locator('#mw-controls-toggle').tap();
    await expect(page.locator('.im-rail')).toBeVisible();
    // Preset pins are markers too: the card adds one of its own.
    const markers = page.locator('.maplibregl-marker');
    const pins = await markers.count();
    await page.locator('#map').tap({ position: { x: 180, y: 90 } });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-sheet-detent', 'half');
    await expect(page.locator('.im-rail')).toBeHidden();
    await expect(page.locator('#mw-controls-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(card.locator('[data-pc-day]')).toHaveCount(10);
    await expect(markers).toHaveCount(pins + 1);
    await expectFitsAboveDock(page, card);
    // What floats above the dock floats above the card.
    const tr = await boxOf(page.locator('#mw-controls-toggle'));
    const c = await boxOf(card);
    expect(tr.y + tr.height).toBeLessThanOrEqual(c.y);

    const cdp = await page.context().newCDPSession(page);
    const handle = card.locator('[data-sheet-handle]');
    await dragHandle(page, cdp, handle, 110);
    await expect(card).toHaveAttribute('data-sheet-detent', 'peek');
    await expectFitsAboveDock(page, card);
    // At peek the card still names the point and can be closed.
    await expect(card.locator('[data-pc-close]')).toBeVisible();
    await expect(card.locator('[data-pc-fav]')).toBeVisible();

    await dragHandle(page, cdp, handle, 110);
    await expect(card).toBeHidden();
    await expect(markers).toHaveCount(pins);
    await expect(page.locator('#map-root')).not.toHaveAttribute(
      'data-sheet',
      /./
    );
  });

  test('closed sheets add nothing to the phone chrome and the handles stay off desktop', async ({
    page,
  }) => {
    // Closed: no handle is rendered (the chrome budget counts 5).
    const visibleHandles = () =>
      page.evaluate(
        () =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[data-sheet-handle]')
          ).filter((h) => h.checkVisibility()).length
      );
    expect(await visibleHandles()).toBe(0);
    // From sm up the panels are the desktop popovers again, no handle.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#mw-tools-btn').click();
    const panel = page.locator('#mw-tools-panel');
    await expect(panel).toBeVisible();
    expect(await visibleHandles()).toBe(0);
    await expect(panel).not.toHaveAttribute('data-sheet-detent', /./);
    const b = await boxOf(panel);
    expect(b.width).toBeLessThanOrEqual(288 + 1);
  });
});
