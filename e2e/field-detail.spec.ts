import { test, expect, type Page, type Route } from '@playwright/test';
import { TRANSPARENT_PNG } from './chrome-budget-helpers';
import { openLayerRail } from './helpers';

/**
 * Story 24.2 — local detail on demand. From zoom 6 the map fetches a
 * 768-point grid of the viewport for the active field (same chunked
 * Open-Meteo call as the national grid: 4 requests of ≤ 200 points),
 * debounced on moveend and cached per rounded view + variable + model.
 *
 * Open-Meteo, the snapshot (404 ⇒ live national grid), RainViewer and the
 * imagery tiles are mocked, so every field request is counted here.
 */

const MANIFEST = JSON.stringify({
  version: '2.0',
  generated: 1779138033,
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [{ time: 1779130200, path: '/v2/radar/p1' }],
    nowcast: [],
  },
  satellite: { infrared: [] },
});

/** One Open-Meteo response per requested point, over the asked window;
 *  the temperature depends on the point so the local grid has structure. */
function fieldBody(url: string): string {
  const q = new URL(url).searchParams;
  const lats = (q.get('latitude') ?? '').split(',').map(Number);
  const lngs = (q.get('longitude') ?? '').split(',').map(Number);
  const days = Number(q.get('forecast_days') ?? 2);
  const past = Number(q.get('past_days') ?? 0);
  const now = new Date();
  const t0 = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const time: string[] = [];
  for (let h = -past * 24; h < days * 24; h++)
    time.push(new Date(t0 + h * 3_600_000).toISOString().slice(0, 16));
  return JSON.stringify(
    lats.map((lat, i) => {
      const v = 20 + 8 * Math.sin(lngs[i] * 2) * Math.cos(lat * 2);
      return {
        hourly: { time, temperature_2m: time.map((_, h) => v + (h % 3)) },
      };
    })
  );
}

interface FieldReq {
  url: string;
  lats: number[];
}

async function mocks(page: Page): Promise<FieldReq[]> {
  const png = (r: Route) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG });
  await page.route('**/*.arcgisonline.com/**', png);
  await page.route('**/gibs.earthdata.nasa.gov/**', png);
  await page.route('**/tilecache.rainviewer.com/**', png);
  await page.route('**/api.rainviewer.com/public/weather-maps.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: MANIFEST })
  );
  await page.route('**/data/field-grids/**', (r) => r.fulfill({ status: 404 }));
  const seen: FieldReq[] = [];
  await page.route('**/api.open-meteo.com/v1/forecast**', (r) => {
    const url = r.request().url();
    if (url.includes('hourly=temperature_2m')) {
      const lats = (new URL(url).searchParams.get('latitude') ?? '')
        .split(',')
        .map(Number);
      seen.push({ url, lats });
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: fieldBody(url),
    });
  });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('mw:welcomed', '1');
    } catch {
      /* private mode */
    }
  });
  return seen;
}

type MapLike = {
  getLayer(id: string): unknown;
  getZoom(): number;
  jumpTo(o: { zoom?: number; center?: [number, number] }): void;
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
};
type DetailHook = {
  active(): {
    level: number;
    bounds: { west: number; south: number; east: number; north: number };
  } | null;
  fetches(): number;
};

async function openTemperature(page: Page, view: string): Promise<void> {
  await page.goto(`mapa/?e2e=1#view=${view}&layer=temperature`);
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __map?: MapLike }).__map?.getLayer(
        'wx-field-layer'
      ),
    null,
    { timeout: 30_000 }
  );
  await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // The boot's first-paint nudges re-apply the initial view during the
  // first 2.5 s and on the first `idle`: move the camera only after both.
  await page.waitForFunction(() => performance.now() > 3000, null, {
    timeout: 20_000,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const m = (
          window as unknown as {
            __map: {
              once(e: string, cb: () => void): void;
              triggerRepaint(): void;
            };
          }
        ).__map;
        m.once('idle', () => resolve());
        m.triggerRepaint();
      })
  );
}

async function zoomTo(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    (window as unknown as { __map: MapLike }).__map.jumpTo({ zoom: z });
  }, zoom);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __map: MapLike }).__map.getZoom()
    )
  ).toBeCloseTo(zoom, 3);
}

const detail = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __fieldDetail: DetailHook })
      .__fieldDetail;
    return { active: d.active(), fetches: d.fetches() };
  });

test.describe('Story 24.2 — local detail on demand', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('zooming to 7 triggers exactly one extra field request set', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const seen = await mocks(page);
    await openTemperature(page, '19.43,-99.13,5z');

    // The national grid: 768 points over the fixed MX box, 4 chunks.
    await expect.poll(() => seen.length).toBe(4);
    expect(seen.flatMap((r) => r.lats)).toHaveLength(768);
    expect(Math.min(...seen.flatMap((r) => r.lats))).toBe(-5);
    // Zoom 5: nothing more.
    await page.waitForTimeout(1200);
    expect(seen).toHaveLength(4);
    expect((await detail(page)).fetches).toBe(0);

    await zoomTo(page, 7);
    await expect.poll(() => seen.length, { timeout: 15_000 }).toBe(8);
    // Exactly one set: 768 points in 4 chunks, all around the view.
    const extra = seen.slice(4);
    expect(extra.flatMap((r) => r.lats)).toHaveLength(768);
    for (const r of extra) {
      expect(r.url).toContain('past_days=1');
      for (const lat of r.lats) {
        expect(lat).toBeGreaterThan(10);
        expect(lat).toBeLessThan(29);
      }
    }
    await expect
      .poll(async () => (await detail(page)).active?.level ?? null)
      .toBe(7);
    // The local box covers what is on screen.
    const cover = await page.evaluate(() => {
      const m = (window as unknown as { __map: MapLike }).__map;
      const b = m.getBounds();
      const a = (
        window as unknown as { __fieldDetail: DetailHook }
      ).__fieldDetail.active()!.bounds;
      return (
        a.west <= b.getWest() &&
        a.south <= b.getSouth() &&
        a.east >= b.getEast() &&
        a.north >= b.getNorth()
      );
    });
    expect(cover).toBe(true);
    // The field is still drawn, and settles: no second set.
    expect(
      await page.evaluate(
        () =>
          !!(window as unknown as { __map: MapLike }).__map.getLayer(
            'wx-field-layer'
          )
      )
    ).toBe(true);
    // …through the WebGL layer (the merge shader compiled: no fallback).
    const drawn = await page.evaluate(() => {
      const m = (
        window as unknown as {
          __map: { getLayer(id: string): { type: string } | undefined };
        }
      ).__map;
      const e = performance.getEntriesByName('mw:field-frame').at(-1) as
        PerformanceMeasure | undefined;
      return {
        type: m.getLayer('wx-field-layer')?.type ?? null,
        renderer:
          (e?.detail as { renderer?: string } | undefined)?.renderer ?? null,
      };
    });
    expect(drawn).toEqual({ type: 'custom', renderer: 'webgl' });
    await page.waitForTimeout(1500);
    expect(seen).toHaveLength(8);

    // Out to 5: national only; back to 7: from the cache, no request.
    await zoomTo(page, 5);
    await expect.poll(async () => (await detail(page)).active).toBeNull();
    await zoomTo(page, 7);
    await expect
      .poll(async () => (await detail(page)).active?.level ?? null)
      .toBe(7);
    await page.waitForTimeout(1200);
    expect(seen).toHaveLength(8);
    expect((await detail(page)).fetches).toBe(1);
    expect(errors).toEqual([]);
  });

  test('a layer change aborts the local grid in flight', async ({ page }) => {
    test.setTimeout(90_000);
    const seen = await mocks(page);
    // Hold every local-grid chunk (every national chunk has points on
    // the box's west edge, −130°; a local one never does).
    const held: Route[] = [];
    await page.route('**/api.open-meteo.com/v1/forecast**', (r) => {
      const lng = new URL(r.request().url()).searchParams.get('longitude');
      if (lng && !lng.split(',').map(Number).includes(-130)) {
        held.push(r);
        return;
      }
      return r.fallback();
    });
    const failed: string[] = [];
    page.on('requestfailed', (r) => {
      if (r.url().includes('api.open-meteo.com')) failed.push(r.url());
    });
    await openTemperature(page, '19.43,-99.13,5z');
    await expect.poll(() => seen.length).toBe(4);
    await openLayerRail(page);
    await zoomTo(page, 7);
    await expect.poll(() => held.length, { timeout: 15_000 }).toBe(4);
    await page.locator('#layerbtn-base').click();
    await expect(page.locator('#layerbtn-base')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect.poll(() => failed.length).toBe(4);
    expect((await detail(page)).active).toBeNull();
  });

  test('data saver: no local grid', async ({ page }) => {
    test.setTimeout(60_000);
    const seen = await mocks(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      });
    });
    await openTemperature(page, '19.43,-99.13,7z');
    await expect.poll(() => seen.length).toBe(4);
    await page.waitForTimeout(1500);
    expect(seen).toHaveLength(4);
    expect((await detail(page)).fetches).toBe(0);
  });
});
