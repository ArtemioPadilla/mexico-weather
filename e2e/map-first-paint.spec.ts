import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Story 10.3 — the map must paint with zero interaction, and must mount
 * even when requestAnimationFrame never fires.
 *
 * Issue #124's signature was: tiles loaded, GL context alive, canvas
 * sized, blank until a click. Every other map spec asserts DOM state
 * only, which is why that bug class survived six PRs — so the paint
 * assertion here looks at pixels.
 *
 * Readback works because src/lib/interactive-map.ts sets
 * canvasContextAttributes.preserveDrawingBuffer = true.
 */

// Measured on main at 411e336 (headless chromium, 64x64 sample, zero
// interaction):
//   /mapa            0 @1s -> 98 @3s -> 114 steady
//   /forecast embed  0 @1s -> 45 @3s -> 45 steady
// A blank or solid-fill canvas is ~0. Floors are per-target because the
// forecast embed (temperature field, z9 over CDMX) is nearly uniform and
// sits ~3x above its floor — one global constant would make the weakest
// target the flakiest.
const PAINT_VARIANCE_FLOOR: Record<string, number> = {
  '/mapa': 40,
  '/forecast embed': 15,
};

async function sampleCanvas(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.maplibregl-canvas');
    if (!c) return { found: false, variance: 0, mean: 0 };
    const off = document.createElement('canvas');
    off.width = 64;
    off.height = 64;
    const ctx = off.getContext('2d');
    if (!ctx) return { found: false, variance: 0, mean: 0 };
    ctx.drawImage(c, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let n = 0;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      n += 1;
      sum += l;
      sumSq += l * l;
    }
    const mean = sum / n;
    return { found: true, variance: sumSq / n - mean * mean, mean };
  });
}

const TARGETS = [
  { name: '/mapa', url: 'mapa#view=23.6,-102.5,5z&layer=temperature' },
  {
    name: '/forecast embed',
    url: 'forecast/?lat=19.43&lng=-99.13&name=CDMX&tz=America/Mexico_City',
  },
];

for (const target of TARGETS) {
  test(`${target.name} paints without any interaction`, async ({ page }) => {
    await page.goto(target.url);
    // No click, no hover, no keypress anywhere in this test.
    await expect
      .poll(async () => (await sampleCanvas(page)).variance, {
        message: `${target.name} canvas stayed blank pre-interaction`,
        timeout: 15_000,
        intervals: [500, 500, 1000, 1000, 2000],
      })
      .toBeGreaterThan(PAINT_VARIANCE_FLOOR[target.name]);
  });
}

// The behavioural regression guard for #124 — the tests here that fail on
// main before the forecast.astro fix and pass after.
//
// Do not try to background the page instead: bringToFront() does not change
// document.visibilityState in Playwright 1.60 (verified, headless AND headed),
// so a "hidden tab" test is vacuous. Starving rAF reproduces the mechanism
// directly: a boot gated on rAF never runs, so the map never mounts.
for (const target of TARGETS) {
  test(`${target.name} still mounts when requestAnimationFrame never fires`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    // Pixels are impossible here — MapLibre renders via rAF — so assert the
    // map *mounted*, which is exactly what the rAF-gated boot broke.
    await expect
      .poll(
        () =>
          page.evaluate(() => !!document.querySelector('canvas.maplibregl-canvas')),
        {
          message: `${target.name} never mounted with rAF starved`,
          timeout: 15_000,
        },
      )
      .toBe(true);
  });
}
