import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { bootMap } from './chrome-budget-helpers';

/**
 * Story 23.1 — the timeline's date-scale bar (plan PARIDAD_VISUAL E23).
 *
 * /mapa boots on the 24 h GeoColor axis (144 ten-minute frames, Story
 * 16.1/21.2) with every tile mocked by the shared chrome-budget boot, so
 * the bar has a known axis on any runner. Asserts UI state only — the
 * frame index lives in `#tl-range`, which stays the accessible control
 * behind the bar; the bar mirrors it in `data-index`.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const index = async (range: Locator): Promise<number> =>
  Number(await range.inputValue());

async function barBox(page: Page) {
  const bar = page.locator('#tl-bar');
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  if (!box) throw new Error('#tl-bar has no box');
  return { bar, box, y: box.y + box.height / 2 };
}

test.describe('timeline bar', () => {
  // The shared boot waits up to 20 s for the satellite loop; give each
  // test the same 60 s budget as the Story 22.3 tools-menu tests.
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await bootMap(page);
    await expect(page.locator('#tl-range')).toHaveAttribute('max', '143');
  });

  test('draws a date scale with day and hour labels, "now" and the frame', async ({
    page,
  }) => {
    const { bar } = await barBox(page);
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
    await expect(bar.locator('[data-part="label-day"]').first()).toHaveText(
      /^\S+ \d{1,2}$/
    );
    expect(
      await bar.locator('[data-part="label-hour"]').count()
    ).toBeGreaterThan(2);
    await expect(bar.locator('[data-part="now"]')).toHaveAttribute(
      'visibility',
      'visible'
    );
    await expect(bar.locator('[data-part="thumb"]')).toHaveAttribute(
      'visibility',
      'visible'
    );
    // The bar mirrors the range while the boot loop plays.
    const range = page.locator('#tl-range');
    await expect
      .poll(async () =>
        Number(await bar.getAttribute('data-index')) === (await index(range))
          ? 'synced'
          : 'drift'
      )
      .toBe('synced');
  });

  test('dragging on the bar changes frames without releasing', async ({
    page,
  }) => {
    const range = page.locator('#tl-range');
    const play = page.locator('#tl-play');
    const label = page.locator('#tl-time');
    const { bar, box, y } = await barBox(page);

    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    // Pressing pauses the loop and jumps to the frame under the pointer
    // (~20 % of a 24 h axis).
    await expect(play).toHaveAttribute('data-state', 'paused');
    await expect(bar).toHaveAttribute('data-dragging', 'true');
    const atPress = await index(range);
    expect(atPress).toBeGreaterThan(18);
    expect(atPress).toBeLessThan(36);
    const labelAtPress = await label.textContent();

    // Still pressed: moving right walks forward …
    await page.mouse.move(box.x + box.width * 0.7, y, { steps: 6 });
    await expect.poll(() => index(range)).toBeGreaterThan(atPress + 50);
    await expect(label).not.toHaveText(labelAtPress ?? '');
    const atRight = await index(range);
    await expect(bar).toHaveAttribute('data-index', String(atRight));
    // … and moving left walks back, before any release.
    await page.mouse.move(box.x + box.width * 0.4, y, { steps: 4 });
    await expect.poll(() => index(range)).toBeLessThan(atRight - 30);
    await expect(bar).toHaveAttribute('data-dragging', 'true');

    await page.mouse.up();
    await expect(bar).not.toHaveAttribute('data-dragging', 'true');
    // The loop stays paused and the hash follows the frame.
    await expect(play).toHaveAttribute('data-state', 'paused');
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/t=/);
  });

  test('keyboard on the bar steps frames (← → Home End)', async ({ page }) => {
    const range = page.locator('#tl-range');
    const { bar, box, y } = await barBox(page);
    await page.mouse.click(box.x + box.width * 0.5, y);
    // Pressing the bar hands the keyboard focus to the accessible range.
    await expect(range).toBeFocused();
    const start = await index(range);

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => index(range)).toBe(start + 1);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => index(range)).toBe(start - 1);
    await expect(bar).toHaveAttribute('data-index', String(start - 1));
    await page.keyboard.press('Home');
    await expect.poll(() => index(range)).toBe(0);
    await page.keyboard.press('End');
    await expect.poll(() => index(range)).toBe(143);
    // A screen reader hears the date, not "143".
    await expect(range).toHaveAttribute('aria-valuetext', /\d{1,2}:\d{2}/);
    // → past the last frame pulls the 10-day axis, like ›.
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => Number(await range.getAttribute('max')))
      .toBeGreaterThan(143);
    await expect(page.locator('#tl-extend')).toBeHidden();
  });

  test('the letter shortcuts and ? still work after pressing the bar', async ({
    page,
  }) => {
    const range = page.locator('#tl-range');
    const { box, y } = await barBox(page);
    await page.mouse.click(box.x + box.width * 0.5, y);
    await expect(range).toBeFocused();

    // A range input does nothing with letters, so the focus it takes from
    // the bar must not swallow the map's single-key shortcuts.
    await page.keyboard.press('?');
    await expect(page.locator('#mw-shortcuts')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mw-shortcuts')).toBeHidden();

    await page.mouse.click(box.x + box.width * 0.5, y);
    await expect(range).toBeFocused();
    await page.keyboard.press('r');
    await expect(page.locator('#layerbtn-radar')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('the wheel over the bar steps one frame per notch', async ({ page }) => {
    const range = page.locator('#tl-range');
    const { box, y } = await barBox(page);
    await page.mouse.click(box.x + box.width * 0.5, y);
    const start = await index(range);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => index(range)).toBe(start + 1);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => index(range)).toBe(start - 1);
  });

  test('#tl-range still drives the frames and the bar follows', async ({
    page,
  }) => {
    const range = page.locator('#tl-range');
    const bar = page.locator('#tl-bar');
    const thumb = bar.locator('[data-part="thumb"]');
    await range.fill('10');
    await expect(bar).toHaveAttribute('data-index', '10');
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'paused'
    );
    const at10 = await thumb.getAttribute('transform');
    await range.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => index(range)).toBe(11);
    await expect(bar).toHaveAttribute('data-index', '11');
    expect(await thumb.getAttribute('transform')).not.toBe(at10);
    // Native keys the bar leaves alone still step the range.
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => index(range)).toBe(12);
    await expect(bar).toHaveAttribute('data-index', '12');
  });

  test('dragging onto the dotted "Ver 10 días" tail extends the axis', async ({
    page,
  }) => {
    const range = page.locator('#tl-range');
    const tail = page.locator('#tl-extend');
    await expect(tail).toBeVisible();
    const tailBox = (await tail.boundingBox())!;
    const { box, y } = await barBox(page);
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(tailBox.x + tailBox.width / 2, y, { steps: 8 });
    await expect
      .poll(async () => Number(await range.getAttribute('max')))
      .toBeGreaterThan(143);
    await expect(tail).toBeHidden();
    // Back on the (now 10-day) bar the drag keeps seeking.
    const before = await index(range);
    await page.mouse.move(box.x + box.width * 0.1, y, { steps: 4 });
    await expect.poll(() => index(range)).toBeLessThan(before);
    await page.mouse.up();
  });
});
