import { test, expect, type Page } from '@playwright/test';
import { TRANSPARENT_PNG } from './chrome-budget-helpers';

/**
 * Story 24.1 — the field layers draw through a WebGL2 custom layer, with
 * the canvas raster kept as the fallback (`?field=canvas`). Both paths
 * must paint the same colours in the same places: the same view and frame
 * is rendered by each and the map canvas is sampled on a lattice.
 *
 * Basemap tiles are the transparent PNG (the field is the only colour);
 * the temperature grid is the pre-baked static snapshot, so no Open-Meteo
 * call is made.
 */

const VIEW = '23.6,-102.5,4.5z';

async function mocks(page: Page): Promise<void> {
  const png = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });
  await page.route('**/*.arcgisonline.com/**', png);
  await page.route('**/gibs.earthdata.nasa.gov/**', png);
  await page.route('**/tilecache.rainviewer.com/**', png);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('mw:welcomed', '1');
    } catch {
      /* private mode */
    }
  });
}

type MapHandle = {
  getLayer(id: string): { type: string } | undefined;
  getCanvas(): HTMLCanvasElement;
  once(ev: string, cb: () => void): void;
  triggerRepaint(): void;
};

/** Map canvas pixels (RGBA) on a cols × rows lattice inside the map. */
async function sample(page: Page): Promise<number[][]> {
  // Let the frame settle: one `idle` (or 3 s, whichever first).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const m = (window as unknown as { __map: MapHandle }).__map;
        const t = window.setTimeout(resolve, 3000);
        m.once('idle', () => {
          window.clearTimeout(t);
          resolve();
        });
        m.triggerRepaint();
      })
  );
  return page.evaluate(() => {
    const m = (window as unknown as { __map: MapHandle }).__map;
    const gl = m.getCanvas();
    const c = document.createElement('canvas');
    c.width = gl.width;
    c.height = gl.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(gl, 0, 0);
    const out: number[][] = [];
    // Keep clear of the floating chrome (rail, legend, timeline, buttons).
    for (let j = 1; j <= 5; j++) {
      for (let i = 1; i <= 7; i++) {
        const x = Math.round((c.width * (0.2 + (0.6 * i) / 8)) | 0);
        const y = Math.round((c.height * (0.15 + (0.55 * j) / 6)) | 0);
        out.push(Array.from(ctx.getImageData(x, y, 1, 1).data));
      }
    }
    return out;
  });
}

async function openField(page: Page, query: string, hash: string) {
  await page.goto(`mapa/?e2e=1${query}#${hash}`);
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __map?: MapHandle }).__map?.getLayer(
        'wx-field-layer'
      ),
    null,
    { timeout: 30_000 }
  );
  await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  return page.evaluate(() => {
    const m = (window as unknown as { __map: MapHandle }).__map;
    const e = performance.getEntriesByName('mw:field-frame').at(-1) as
      PerformanceMeasure | undefined;
    return {
      type: m.getLayer('wx-field-layer')?.type ?? null,
      renderer:
        (e?.detail as { renderer?: string } | undefined)?.renderer ?? null,
    };
  });
}

test.describe('Story 24.1 — WebGL field renderer', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('temperature draws through WebGL and matches the canvas fallback', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await mocks(page);

    const gl = await openField(page, '', `view=${VIEW}&layer=temperature`);
    expect(gl).toEqual({ type: 'custom', renderer: 'webgl' });
    // Pin the frame for the other runs (the URL carries it as `t=`).
    await expect(page).toHaveURL(/[#&]t=/);
    const hash = new URL(page.url()).hash.slice(1);
    const glPx = await sample(page);

    const cv = await openField(page, '&field=canvas', hash);
    expect(cv).toEqual({ type: 'raster', renderer: 'canvas' });
    const cvPx = await sample(page);

    // Pixel by pixel: the same colours in the same places. A lattice point
    // on a ramp step can land on either side (the canvas raster is
    // bilinearly stretched from 1000×700), so allow a few.
    const close = glPx.filter((p, i) =>
      p.every((v, ch) => Math.abs(v - cvPx[i][ch]) <= 8)
    ).length;
    expect(close).toBeGreaterThanOrEqual(Math.ceil(glPx.length * 0.85));

    // …and the field is really there: the same lattice without it differs.
    await page.goto(
      `mapa/?e2e=1#${hash.replace('layer=temperature', 'layer=base')}`
    );
    await expect(page.locator('#layerbtn-base')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const basePx = await sample(page);
    const changed = glPx.filter((p, i) =>
      p.some((v, ch) => Math.abs(v - basePx[i][ch]) > 24)
    ).length;
    expect(changed).toBeGreaterThanOrEqual(Math.ceil(glPx.length * 0.85));
  });

  test('opacity and layer switches reach the WebGL layer', async ({ page }) => {
    test.setTimeout(60_000);
    await mocks(page);
    await openField(page, '', `view=${VIEW}&layer=temperature`);
    const before = await sample(page);
    // Opacity slider (the rail's block for the active layer) → 20 %.
    await page.evaluate(() => {
      const el = document.getElementById('opacity') as HTMLInputElement | null;
      if (!el) throw new Error('#opacity missing');
      el.value = '20';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const faded = await sample(page);
    const moved = before.filter((p, i) =>
      p.some((v, ch) => Math.abs(v - faded[i][ch]) > 8)
    ).length;
    expect(moved).toBeGreaterThanOrEqual(Math.ceil(before.length * 0.85));

    // Switching to another field keeps the custom layer; Base removes it.
    await page.keyboard.press('h');
    await expect(page.locator('#layerbtn-humidity')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __map: MapHandle }).__map.getLayer(
              'wx-field-layer'
            )?.type ?? null
        )
      )
      .toBe('custom');
    await page.keyboard.press('m');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __map: MapHandle }).__map.getLayer(
              'wx-field-layer'
            )?.type ?? null
        )
      )
      .toBeNull();
  });
});
