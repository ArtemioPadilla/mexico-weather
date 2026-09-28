import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bootMap } from './chrome-budget-helpers';
import { openLayerRail } from './helpers';

/**
 * Story 23.3 — "Saltar a fecha" (plan PARIDAD_VISUAL E23).
 *
 * A click on the timeline's date label, or Enter on the timeline range,
 * opens a native `datetime-local` input bounded to the active layer's
 * range; picking an instant lands on the nearest frame and writes it to
 * the hash `t=`. /mapa boots on the 24 h GeoColor axis (144 ten-minute
 * frames) with every tile mocked by the shared chrome-budget boot; the
 * forecast test mocks Open-Meteo on today's UTC grid like mapa.spec does.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Epoch ms of a `datetime-local` value, read like the page reads it
 *  (settings default: the local zone). */
async function wallToMs(page: Page, value: string): Promise<number> {
  return page.evaluate((v) => new Date(v).getTime(), value);
}

/** The same, the other way round (`YYYY-MM-DDTHH:MM`, local zone). */
async function msToWall(page: Page, ms: number): Promise<string> {
  return page.evaluate((t) => {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
      d.getHours()
    )}:${p(d.getMinutes())}`;
  }, ms);
}

/** The frame instant in the hash (`t=`), epoch ms. */
async function hashT(page: Page): Promise<number> {
  const t = await page.evaluate(
    () => new URLSearchParams(window.location.hash.slice(1)).get('t') ?? ''
  );
  return Date.parse(t);
}

test.describe('timeline jump to date', () => {
  // The shared boot waits up to 20 s for the satellite loop.
  test.describe.configure({ timeout: 60_000 });

  test('satellite: the label opens a bounded picker; a pick lands on the nearest frame and t=', async ({
    page,
  }) => {
    await bootMap(page);
    const range = page.locator('#tl-range');
    await expect(range).toHaveAttribute('max', '143');

    await page.locator('#tl-time').click();
    const dialog = page.getByRole('dialog', { name: 'Saltar a fecha' });
    await expect(dialog).toBeVisible();
    // Opening freezes the loop on the frame on screen.
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'paused'
    );
    const input = dialog.getByLabel('Saltar a fecha');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('type', 'datetime-local');
    await expect(input).toHaveAttribute('step', '600');
    // Bounded to the satellite's 10 days (the extended axis), ending at
    // the newest frame.
    const minMs = await wallToMs(page, (await input.getAttribute('min'))!);
    const maxMs = await wallToMs(page, (await input.getAttribute('max'))!);
    expect(maxMs - minMs).toBe(10 * DAY - 10 * MIN);
    await expect(dialog.locator('#tl-jump-hint')).toHaveText(/ – /);

    // 2 h 3 min before the newest frame: the nearest is 2 h before.
    const label = await page.locator('#tl-time').textContent();
    await input.fill(await msToWall(page, maxMs - 2 * HOUR - 3 * MIN));
    await expect.poll(() => hashT(page)).toBe(maxMs - 2 * HOUR);
    await expect(range).toHaveValue(String(143 - 12));
    await expect(page.locator('#tl-time')).not.toHaveText(label ?? '');
    // A press elsewhere closes it; the frame stays. (The label also asks
    // for the browser's own picker, which would take a first Enter.)
    await page.mouse.click(640, 300);
    await expect(dialog).toBeHidden();
    expect(await hashT(page)).toBe(maxMs - 2 * HOUR);
    // The label toggles: open, then closed by a second click.
    await page.locator('#tl-time').click();
    await expect(dialog).toBeVisible();
    await page.locator('#tl-time').click();
    await expect(dialog).toBeHidden();

    // Three days back pulls the 10-day axis (216 hourly + 144 ten-minute
    // frames) and lands on its nearest (hourly) frame.
    await page.locator('#tl-time').click();
    await expect(dialog).toBeVisible();
    const back = maxMs - 3 * DAY - 25 * MIN;
    await input.fill(await msToWall(page, back));
    await expect(range).toHaveAttribute('max', '359');
    await expect
      .poll(async () => Math.abs((await hashT(page)) - back))
      .toBeLessThanOrEqual(30 * MIN);
    const kept = await hashT(page);
    await page.mouse.click(640, 300);
    await expect(dialog).toBeHidden();
    expect(await hashT(page)).toBe(kept);
  });

  test('Enter on the range opens it; Escape cancels back to the frame it opened on, Enter confirms', async ({
    page,
  }) => {
    await bootMap(page);
    const range = page.locator('#tl-range');
    // Pause on a known frame first.
    await range.focus();
    await page.keyboard.press('End');
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'paused'
    );
    await expect(range).toHaveValue('143');
    await expect(range).toHaveAttribute('aria-keyshortcuts', 'Enter');
    const before = await hashT(page);

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Saltar a fecha' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByLabel('Saltar a fecha');
    await expect(input).toBeFocused();
    await input.fill(await msToWall(page, before - 5 * HOUR));
    await expect(range).toHaveValue(String(143 - 30));

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(range).toHaveValue('143');
    await expect(range).toBeFocused();
    await expect.poll(() => hashT(page)).toBe(before);

    // Enter in the input confirms, closes and hands the focus back.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await input.fill(await msToWall(page, before - 5 * HOUR));
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(range).toBeFocused();
    await expect(range).toHaveValue(String(143 - 30));
    await expect.poll(() => hashT(page)).toBe(before - 5 * HOUR);
  });

  test('temperature: +5 d on the 2-day grid pulls the 10-day forecast and seeks there', async ({
    page,
  }) => {
    await page.route('**/data/field-grids/**', (route) =>
      route.fulfill({ status: 404 })
    );
    await page.route('**/api.open-meteo.com/v1/forecast**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: fieldResponseForUrl(route.request().url()),
      })
    );
    await bootMap(page);
    await openLayerRail(page);
    await page.locator('#layerbtn-temperature').click();
    const range = page.locator('#tl-range');
    // −24 h … +48 h, hourly.
    await expect(range).toHaveAttribute('max', '71');

    await page.locator('#tl-time').click();
    const dialog = page.getByRole('dialog', { name: 'Saltar a fecha' });
    const input = dialog.getByLabel('Saltar a fecha');
    await expect(input).toHaveAttribute('step', '3600');
    // −1 d … +10 d: up to the last 3-hourly step of day 10 (UTC).
    const now = Date.now();
    const today = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate()
    );
    const maxMs = await wallToMs(page, (await input.getAttribute('max'))!);
    expect(maxMs).toBe(today + 10 * DAY - 3 * HOUR);
    const minMs = await wallToMs(page, (await input.getAttribute('min'))!);
    expect(minMs).toBe(today - DAY);

    const ext = page.waitForResponse(
      (r) =>
        r.url().includes('api.open-meteo.com') &&
        r.url().includes('forecast_days=10')
    );
    const target = today + 5 * DAY + 12 * HOUR;
    await input.fill(await msToWall(page, target));
    await ext;
    // 72 hourly + 64 three-hourly frames.
    await expect(range).toHaveAttribute('max', '135');
    await expect.poll(() => hashT(page)).toBe(target);
    await expect(page.locator('#tl-time')).toHaveText(/\+\d+(\.\d)? d$/);
  });

  test('temperature: a second pick while the 10-day forecast loads wins', async ({
    page,
  }) => {
    await page.route('**/data/field-grids/**', (route) =>
      route.fulfill({ status: 404 })
    );
    // Hold the 10-day fetch until both picks are in, so the second one
    // lands while the extension started by the first is still in flight.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let held = 0;
    await page.route('**/api.open-meteo.com/v1/forecast**', async (route) => {
      const url = route.request().url();
      if (url.includes('forecast_days=10')) {
        held += 1;
        await gate;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: fieldResponseForUrl(url),
      });
    });
    await bootMap(page);
    await openLayerRail(page);
    await page.locator('#layerbtn-temperature').click();
    const range = page.locator('#tl-range');
    await expect(range).toHaveAttribute('max', '71');

    await page.locator('#tl-time').click();
    const dialog = page.getByRole('dialog', { name: 'Saltar a fecha' });
    const input = dialog.getByLabel('Saltar a fecha');
    const now = Date.now();
    const today = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate()
    );
    const first = today + 5 * DAY + 12 * HOUR;
    const second = today + 7 * DAY + 12 * HOUR;
    await input.fill(await msToWall(page, first));
    await expect.poll(() => held).toBeGreaterThan(0);
    // Corrected before the forecast arrives: still past the 2-day axis.
    await input.fill(await msToWall(page, second));
    release();
    await expect(range).toHaveAttribute('max', '135');
    await expect.poll(() => hashT(page)).toBe(second);
  });
});

/** Open-Meteo bulk response sized from the URL (points, window, step),
 *  on today's UTC grid — the same shape mapa.spec serves. */
function fieldResponseForUrl(url: string): string {
  const m = /[?&]latitude=([^&]+)/.exec(url);
  const n = m ? m[1]!.split(',').length : 32 * 24;
  const days = Number(/[?&]forecast_days=(\d+)/.exec(url)?.[1] ?? 2);
  const past = Number(/[?&]past_days=(\d+)/.exec(url)?.[1] ?? 0);
  const stepH = /temporal_resolution=hourly_3/.test(url) ? 3 : 1;
  const now = new Date();
  const t0 = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const time: string[] = [];
  for (let h = -past * 24; h < days * 24; h += stepH) {
    time.push(new Date(t0 + h * 3_600_000).toISOString().slice(0, 16));
  }
  const series = (base: number) => time.map((_, i) => base + (i % 3));
  const point = {
    hourly: {
      time,
      temperature_2m: series(22),
      apparent_temperature: series(22),
      wet_bulb_temperature_2m: series(18),
    },
  };
  return JSON.stringify(Array.from({ length: n }, () => point));
}
