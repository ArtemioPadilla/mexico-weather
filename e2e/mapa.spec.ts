import { test, expect } from '@playwright/test';
import { mockOpenMeteo, openLayerRail } from './helpers';
import { railRowCount } from '../src/lib/map/chrome/layer-rail';

/** 256×256 transparent PNG (base64) — a decodable tile for MapLibre.
 *  A 1×1 PNG is rejected by Chromium's createImageBitmap ("source image
 *  could not be decoded"), every tile errors, and the map never fires
 *  `load` (no pins, no overlays, no deep-link activation). */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAABPO1TCQAAAABJRU5ErkJggg==',
  'base64'
);

/** Minimal valid RainViewer manifest accepted by parseRainviewerManifest. */
const RAINVIEWER_MANIFEST = JSON.stringify({
  version: '2.0',
  generated: 1779138033,
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1779130200, path: '/v2/radar/p1' },
      { time: 1779130500, path: '/v2/radar/p2' },
      { time: 1779130800, path: '/v2/radar/p3' },
    ],
    nowcast: [{ time: 1779131100, path: '/v2/radar/f1' }],
  },
  satellite: { infrared: [{ time: 1779130800, path: '/v2/satellite/test' }] },
});

/** One per-point response slot. The mock route builds the array
 *  dynamically based on how many lat/lng pairs the chunked request
 *  asked for (Open-Meteo enforces an ~8 KB GET URL limit; see
 *  fetchFieldChunks in src/lib/mapfields.ts which splits 768-point
 *  requests into 4 chunks of ≤200 points). */
const OPEN_METEO_FIELD_POINT = {
  hourly: {
    time: ['2026-05-19T00:00', '2026-05-19T01:00'],
    temperature_2m: [22, 23],
    relative_humidity_2m: [60, 65],
    pressure_msl: [1013, 1012],
    surface_pressure: [1010, 1009],
    apparent_temperature: [22, 23],
    dew_point_2m: [15, 16],
    wet_bulb_temperature_2m: [18, 19],
  },
};

function fieldResponseForUrl(url: string): string {
  // Count commas in the latitude= param to figure out how many
  // points the chunk requested. n = #commas + 1.
  const m = /[?&]latitude=([^&]+)/.exec(url);
  const n = m ? m[1]!.split(',').length : 32 * 24;
  // Story 15.1 — honour the requested window so the extended 10-day /
  // 3-hourly fetch yields a longer frame axis than the 2-day default.
  const days = Number(/[?&]forecast_days=(\d+)/.exec(url)?.[1] ?? 2);
  const past = Number(/[?&]past_days=(\d+)/.exec(url)?.[1] ?? 0);
  const stepH = /temporal_resolution=hourly_3/.test(url) ? 3 : 1;
  // Day 0 is today at 00:00 UTC, like Open-Meteo, so relative labels
  // ("+3 d", "−1 d") mean what they say; past_days (Story 15.2) prepends
  // whole days before it.
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
      relative_humidity_2m: series(60),
      pressure_msl: series(1013),
      surface_pressure: series(1010),
      apparent_temperature: series(22),
      dew_point_2m: series(15),
      wet_bulb_temperature_2m: series(18),
      // Story 15.5 — precipitation field (mm/h); mostly dry with showers.
      precipitation: time.map((_, i) => (i % 4 === 0 ? 2.5 : 0)),
      snowfall: time.map(() => 0),
      precipitation_probability: series(20),
    },
  };
  return JSON.stringify(Array.from({ length: n }, () => point));
}

/** Rich forecast response (current + hourly + daily) for the place card
 *  (Story 15.4); sized from the URL's forecast_days. */
function richForecastForUrl(url: string): string {
  const days = Number(/[?&]forecast_days=(\d+)/.exec(url)?.[1] ?? 10);
  const t0 = Date.UTC(2026, 4, 19);
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(t0 + i * 86_400_000).toISOString().slice(0, 10)
  );
  const hours = Array.from({ length: days * 24 }, (_, i) =>
    new Date(t0 + i * 3_600_000).toISOString().slice(0, 16)
  );
  return JSON.stringify({
    current: {
      time: hours[0],
      temperature_2m: 21,
      apparent_temperature: 21,
      weather_code: 2,
      precipitation_probability: 10,
      wind_speed_10m: 12,
      wind_direction_10m: 90,
      wind_gusts_10m: 20,
      relative_humidity_2m: 55,
      cloud_cover: 30,
      uv_index: 6,
      visibility: 20000,
      is_day: 1,
      pressure_msl: 1015,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 15 + (i % 24) / 2),
      weather_code: hours.map(() => 2),
      precipitation_probability: hours.map(() => 10),
      wind_speed_10m: hours.map(() => 10),
    },
    daily: {
      time: dates,
      weather_code: dates.map(() => 2),
      temperature_2m_max: dates.map((_, i) => 26 + i),
      temperature_2m_min: dates.map((_, i) => 12 + i),
      precipitation_probability_max: dates.map(() => 20),
      uv_index_max: dates.map(() => 7),
      wind_speed_10m_max: dates.map(() => 15),
      sunrise: dates.map((d) => `${d}T06:30`),
      sunset: dates.map((d) => `${d}T18:45`),
    },
  });
}

/** Minimal Open-Meteo wind bulk response: 48 points (8x6 grid), 2 hourly steps. */
const OPEN_METEO_WIND = JSON.stringify(
  Array.from({ length: 48 }, () => ({
    hourly: {
      time: ['2026-05-19T00:00', '2026-05-19T01:00'],
      wind_speed_10m: [5, 6],
      wind_direction_10m: [180, 200],
      wind_gusts_10m: [8, 9],
    },
  }))
);

test.describe('mapa page', () => {
  test('mapa page loads with map container and search', async ({ page }) => {
    const res = await page.goto('mapa/');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#map')).toBeVisible();
    // P1.7 — Search is icon-only until clicked. Wait for the toggle
    // AND verify the layer rail finished init (a known sentinel that
    // the JS handlers have wired up) before clicking.
    await expect(page.locator('#mw-search-toggle')).toBeVisible();
    // Story 22.5 — the rail is folded to its tab bar: built is enough.
    await expect(page.locator('#layerbtn-base')).toBeAttached();
    await page.locator('#mw-search-toggle').click();
    await expect(page.getByPlaceholder(/Buscar un lugar/)).toBeVisible();
  });

  test('radar layer button activates and shows legend', async ({ page }) => {
    // Intercept the RainViewer manifest — no live network needed.
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );

    // Intercept all RainViewer tile requests so MapLibre doesn't hit the network.
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );

    await page.goto('mapa/');

    // Story 22.5 — the rail starts folded to its tab bar on /mapa.
    await openLayerRail(page);
    const radarBtn = page.locator('#layerbtn-radar');
    await expect(radarBtn).toBeVisible();
    await expect(page.locator('#legend')).toBeHidden();

    // Wait for the mocked manifest response to be received, then ensure the
    // button is interactive before clicking — eliminates any race with rvData.
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );
    await expect(radarBtn).toBeEnabled();

    await radarBtn.click();

    // Asserts UI state only — no dependency on external tile pixels.
    await expect(radarBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend')).toBeVisible();
    await expect(page.locator('#legend li')).toHaveCount(4);
  });

  test('satellite layer button activates without an intensity legend', async ({
    page,
  }) => {
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );

    // Story 21.2 — /mapa now boots on satellite (and autoplays); this
    // test is about switching TO satellite, so start on base explicitly.
    await page.goto('mapa/#view=23.6,-102.5,4.5z&layer=base');

    await openLayerRail(page);
    const satBtn = page.locator('#layerbtn-satellite');
    await expect(satBtn).toBeVisible();
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );
    await expect(satBtn).toBeEnabled();

    // Story 16.1 — GIBS tiles carry the frame's TIME; capture the URLs.
    const gibsUrls: string[] = [];
    await page.route('**/gibs.earthdata.nasa.gov/**', (route) => {
      gibsUrls.push(route.request().url());
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      });
    });

    await satBtn.click();

    await expect(satBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#layerbtn-radar')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    // Satellite is imagery, not intensity-coded: the radar legend stays hidden.
    await expect(page.locator('#legend')).toBeHidden();

    // A synthetic 24 h axis of 10-minute frames (not the RainViewer IR
    // manifest), newest ≈ now − 30 min, so the scrub actually changes
    // imagery: stepping back requests a tile with an earlier TIME and the
    // matrix set is the Level7 one GIBS publishes for GeoColor.
    await expect(page.locator('#tl-range')).toHaveAttribute('max', '143');
    await expect(page.locator('#tl-extend')).toBeVisible();
    await expect.poll(() => gibsUrls.length).toBeGreaterThan(0);
    const timeOf = (u: string) =>
      /\/default\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\//.exec(u)?.[1];
    const first = timeOf(gibsUrls[gibsUrls.length - 1]!);
    expect(first).toBeTruthy();
    expect(gibsUrls[gibsUrls.length - 1]).toContain(
      'GoogleMapsCompatible_Level7'
    );
    const before = gibsUrls.length;
    await page.locator('#tl-prev').click();
    // Story 21.3 — the frame on screen stays (slot A, possibly still
    // finishing its tiles) while the previous one loads into slot B, so
    // the earlier TIME is looked for among every request made after the
    // click rather than in the very last one.
    await expect
      .poll(() =>
        gibsUrls
          .slice(before)
          .some(
            (u) => Date.parse(timeOf(u) ?? '') === Date.parse(first!) - 600_000
          )
      )
      .toBe(true);
  });

  // Story 21.1 — imagery forces the dark canvas even in the light theme,
  // and the basemap labels ride ABOVE the weather raster at 0.8.
  test('satellite in the light theme swaps the basemap to World_Dark_Gray_Base under the labels', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme', 'light');
      } catch {
        /* storage blocked — the media emulation still yields light */
      }
    });
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    // Record which Esri canvas each basemap request hits; every tile is
    // answered with the decodable transparent PNG so `load` fires.
    const esriServices: string[] = [];
    await page.route('**/*.arcgisonline.com/**', (route) => {
      const m = /Canvas\/([A-Za-z_]+)\/MapServer/.exec(route.request().url());
      if (m) esriServices.push(m[1]!);
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      });
    });
    await page.route('**/gibs.earthdata.nasa.gov/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );

    // Story 21.2 — /mapa boots on satellite (dark canvas from the first
    // tile); the light → dark transition under test starts from base.
    await page.goto('mapa/?e2e=1#view=23.6,-102.5,4.5z&layer=base');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );
    await openLayerRail(page);
    const satBtn = page.locator('#layerbtn-satellite');
    await expect(satBtn).toBeEnabled();

    type StyleProbe = {
      base: string[];
      reference: string[];
      order: string[];
      refOpacity: unknown;
    };
    const probe = (): Promise<StyleProbe> =>
      page.evaluate(() => {
        const m = (
          window as unknown as {
            __map?: {
              getSource(id: string): { tiles?: string[] } | undefined;
              getStyle(): { layers: Array<{ id: string }> };
              getPaintProperty(id: string, p: string): unknown;
            };
          }
        ).__map!;
        return {
          base: m.getSource('osm')?.tiles ?? [],
          reference: m.getSource('osm-reference')?.tiles ?? [],
          order: m.getStyle().layers.map((l) => l.id),
          refOpacity: m.getPaintProperty('osm-reference', 'raster-opacity'),
        };
      });

    // Light theme, base layer: the light canvas, labels fully opaque.
    await expect
      .poll(async () => (await probe()).base.join(' '))
      .toContain('World_Light_Gray_Base');
    expect(esriServices).toContain('World_Light_Gray_Base');

    await satBtn.click();
    await expect(satBtn).toHaveAttribute('aria-pressed', 'true');

    // Imagery on → dark canvas + dark reference (labels), and the tile
    // fetches actually go to the dark service (not just the style URL).
    await expect
      .poll(async () => (await probe()).base.join(' '))
      .toContain('World_Dark_Gray_Base');
    const after = await probe();
    expect(after.base.join(' ')).not.toContain('World_Light_Gray_Base');
    await expect.poll(() => esriServices).toContain('World_Dark_Gray_Base');
    // The reference source follows (its layer is hidden below
    // LABEL_ZOOM_THRESHOLD at the default z4.5, so no fetch to observe).
    expect(after.reference.join(' ')).toContain('World_Dark_Gray_Reference');
    // Labels ABOVE the weather raster, dimmed to 0.8.
    expect(after.order.indexOf('osm-reference')).toBeGreaterThan(
      after.order.indexOf('wx-raster-layer')
    );
    expect(after.order.indexOf('wx-raster-layer')).toBeGreaterThan(
      after.order.indexOf('osm')
    );
    expect(after.refOpacity).toBe(0.8);

    // Back to base → the theme's light canvas returns, labels at 1.
    await page.locator('#layerbtn-base').click();
    await expect
      .poll(async () => (await probe()).base.join(' '))
      .toContain('World_Light_Gray_Base');
    expect((await probe()).refOpacity).toBe(1);
  });

  // Story 21.4 — the CSS-only skeleton on `.im-root::before` is painted
  // from the first byte and fades once the first source has loaded.
  test('map root drops the loading skeleton once the first tiles land', async ({
    page,
  }) => {
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    // Hold the basemap tiles until we have looked at the skeleton, then
    // release them: the fade must follow the FIRST loaded source, not
    // the page load.
    let releaseTiles!: () => void;
    const gate = new Promise<void>((r) => {
      releaseTiles = r;
    });
    await page.route('**/*.arcgisonline.com/**', async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      });
    });

    await page.goto('mapa/');
    const root = page.locator('#map-root');
    await expect(root).toBeVisible();
    const before = await root.evaluate((el) => {
      const cs = getComputedStyle(el, '::before');
      return {
        content: cs.content,
        position: cs.position,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        ready: el.classList.contains('im-ready'),
      };
    });
    // Skeleton present (a real box, not `none`), fully opaque, letting
    // pointer events through, under the floating chrome (z ≥ 10).
    expect(before.content).not.toBe('none');
    expect(before.position).toBe('absolute');
    expect(before.opacity).toBe('1');
    expect(before.pointerEvents).toBe('none');
    expect(Number(before.zIndex)).toBeLessThan(10);
    expect(before.ready).toBe(false);

    releaseTiles();
    await expect(root).toHaveClass(/\bim-ready\b/);
    await expect
      .poll(() =>
        root.evaluate((el) => getComputedStyle(el, '::before').opacity)
      )
      .toBe('0');
    // Every embed shares the rule: the pseudo-element is keyed on the
    // `.im-root` class the Astro component gives every map root.
    expect(await root.evaluate((el) => el.classList.contains('im-root'))).toBe(
      true
    );
  });

  test('timeline appears for radar and the range scrubs frames', async ({
    page,
  }) => {
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );

    // Story 21.2 — /mapa boots on satellite and autoplays; the manual
    // scrub under test starts from base so no loop moves the frame.
    await page.goto('mapa/#view=23.6,-102.5,4.5z&layer=base');
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );

    // P0.3 — Timeline pill is always visible now (was conditionally
    // 'hidden' before). On the base layer it shows the dash placeholder.
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#tl-time')).toHaveText('—');

    await openLayerRail(page);
    await page.locator('#layerbtn-radar').click();
    await expect(page.locator('#timeline')).toBeVisible();

    const range = page.locator('#tl-range');
    // 4 radar frames (3 past + 1 nowcast) → max index 3.
    await expect(range).toHaveAttribute('max', '3');

    const label = page.locator('#tl-time');
    const v0 = Number(await range.inputValue());
    const l0 = await label.textContent();

    // Prev steps back exactly one frame (clamped, no wrap) and updates the label.
    await page.locator('#tl-prev').click();
    const v1 = Number(await range.inputValue());
    expect(v1).toBe(Math.max(0, v0 - 1));
    expect(v1).toBeLessThan(v0);
    await expect(label).not.toHaveText(l0 ?? '');

    // Next steps forward exactly one frame.
    await page.locator('#tl-next').click();
    expect(Number(await range.inputValue())).toBe(v1 + 1);

    // Switching back to Base resets the timeline label to the placeholder.
    // (Pill itself stays visible — see P0.3.)
    await page.locator('#layerbtn-base').click();
    await expect(page.locator('#tl-time')).toHaveText('—');
  });

  test('temperature field layer activates with a legend and timeline', async ({
    page,
  }) => {
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );
    // Force live path by 404-ing the pre-baked field-grid snapshot —
    // otherwise loadFieldGrid hydrates from the static JSON and the
    // Open-Meteo waitForResponse below never fires.
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

    // Deterministic basemap: a decodable tile so MapLibre fires `load`
    // and `idle` regardless of the runner's network.
    await page.route('**/*.arcgisonline.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );
    await page.goto('mapa/');
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );

    await openLayerRail(page);
    const tempBtn = page.locator('#layerbtn-temperature');
    await expect(tempBtn).toBeEnabled();
    const fieldResp = page.waitForResponse(
      '**/api.open-meteo.com/v1/forecast**'
    );
    await tempBtn.click();
    await fieldResp;

    await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // P0.2 — legend moved into a floating bar; check the parent
    // wrapper which controls visibility.
    await expect(page.locator('#legend-bar')).toBeVisible();
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#opacitywrap')).toBeVisible();

    // Story 15.1/15.2 — the −24 h … +48 h window boots first (72 hourly
    // frames), then "Ver 10 días" pulls the 3-hourly extension on demand
    // and the frame axis grows: 72 hourly + 64 three-hourly (days 3–10)
    // = 136 frames.
    await expect(page.locator('#tl-range')).toHaveAttribute('max', '71');
    const extendBtn = page.locator('#tl-extend');
    await expect(extendBtn).toBeVisible();
    const extResp = page.waitForResponse(
      (r) =>
        r.url().includes('api.open-meteo.com') &&
        r.url().includes('forecast_days=10')
    );
    await extendBtn.click();
    await extResp;
    await expect(page.locator('#tl-range')).toHaveAttribute('max', '135');
    await expect(extendBtn).toBeHidden();
    // Day-skip is time-based now: four skips from the anchor land ~4 d
    // ahead and the label switches to the "+N d" wording.
    for (let i = 0; i < 4; i++) await page.locator('#tl-day-next').click();
    await expect(page.locator('#tl-time')).toHaveText(/\+\d+(\.\d)? d$/);

    await page.locator('#layerbtn-base').click();
    await expect(page.locator('#legend-bar')).toBeHidden();
    // P0.3 — timeline pill stays visible, only its label resets.
    await expect(page.locator('#tl-time')).toHaveText('—');
  });

  for (const layer of ['humidity', 'pressure', 'precipitation'] as const) {
    test(`${layer} field layer activates with a legend and timeline`, async ({
      page,
    }) => {
      await page.route(
        '**/api.rainviewer.com/public/weather-maps.json',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: RAINVIEWER_MANIFEST,
          })
      );
      await page.route('**/tilecache.rainviewer.com/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: TRANSPARENT_PNG,
        })
      );
      // See temperature test above — bypass the pre-baked snapshot
      // so the Open-Meteo waitForResponse below fires.
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

      await page.goto('mapa/');
      await page.waitForResponse(
        '**/api.rainviewer.com/public/weather-maps.json'
      );

      await openLayerRail(page);
      const btn = page.locator(`#layerbtn-${layer}`);
      await expect(btn).toBeEnabled();
      const fieldResp = page.waitForResponse(
        '**/api.open-meteo.com/v1/forecast**'
      );
      await btn.click();
      await fieldResp;

      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#legend-bar')).toBeVisible();
      await expect(page.locator('#timeline')).toBeVisible();
      await expect(page.locator('#opacitywrap')).toBeVisible();

      await page.locator('#layerbtn-base').click();
      await expect(page.locator('#legend-bar')).toBeHidden();
      await expect(page.locator('#tl-time')).toHaveText('—');
    });
  }

  test('wind layer activates with a legend and timeline', async ({ page }) => {
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );
    // Wind bulk URL carries `hourly=wind_speed_10m,wind_direction_10m`; route by query.
    await page.route(
      /api\.open-meteo\.com\/v1\/forecast.*wind_speed_10m/,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: OPEN_METEO_WIND,
        })
    );

    await page.goto('mapa/');
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );

    await openLayerRail(page);
    const btn = page.locator('#layerbtn-wind');
    await expect(btn).toBeEnabled();
    const windResp = page.waitForResponse(
      /api\.open-meteo\.com\/v1\/forecast.*wind_speed_10m/
    );
    await btn.click();
    await windResp;

    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend-bar')).toBeVisible();
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#opacitywrap')).toBeVisible();

    await page.locator('#layerbtn-base').click();
    await expect(page.locator('#legend-bar')).toBeHidden();
    await expect(page.locator('#tl-time')).toHaveText('—');
  });

  test('tapping the map opens a 10-day / 48-h place card (Story 15.4)', async ({
    page,
  }) => {
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/*.arcgisonline.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );
    // The place card calls the rich forecast endpoint (has `daily=`);
    // field layers call the same host without it.
    await page.route('**/api.open-meteo.com/v1/forecast**', (route) => {
      const url = route.request().url();
      if (url.includes('daily=')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: richForecastForUrl(url),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: fieldResponseForUrl(url),
        });
      }
    });
    await page.goto('mapa/');
    // Story 22.5 — the rail is folded to its tab bar: built is enough.
    await expect(page.locator('#layerbtn-base')).toBeAttached();
    const card = page.locator('#mw-place-card');
    await expect(card).toBeHidden();
    const forecastResp = page.waitForResponse(
      (r) =>
        r.url().includes('api.open-meteo.com') && r.url().includes('daily=')
    );
    await page.locator('#map canvas').click({ position: { x: 400, y: 300 } });
    await forecastResp;
    await expect(card).toBeVisible();
    await expect(card.locator('[data-pc-day]')).toHaveCount(10);
    await card.locator('[data-pc-mode="hourly"]').click();
    await expect(card.locator('[data-pc-hour]')).toHaveCount(48);
    await expect(
      card.getByRole('link', { name: /Ver pronóstico completo/ })
    ).toHaveAttribute('href', /\/forecast\?lat=/);
    await card.locator('[data-pc-fav]').click();
    await expect(card.locator('[data-pc-fav]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
  });

  test('locate button drops a pin on /mapa and never navigates away', async ({
    page,
    context,
  }) => {
    // The home CTA (#geo) NAVIGATES after a fix; the map's locate button
    // shares the flow (src/lib/locate-flow.ts) but its final action is a
    // PIN. Guard that the two never get merged (plan home map-first, phase 2).
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 19.43, longitude: -99.13 });
    await mockOpenMeteo(page);
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/*.arcgisonline.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );
    await page.goto('mapa/');
    await expect(page.locator('.maplibregl-marker')).toHaveCount(5);
    await page.locator('#maploc').click();
    await expect(page.locator('.maplibregl-marker')).toHaveCount(6);
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toMatch(/\/mapa\/$/);
  });

  test('search input shows an autocomplete listbox with multiple options before fly', async ({
    page,
  }) => {
    // Mocks: geocode (CDMX fixture has 2 results) + RainViewer + OSM tiles.
    // The static MX-cities dictionary is mocked EMPTY so the search falls
    // through to the mocked remote geocoder: the real dictionary is
    // refreshed monthly by a cron and its match count for "Ciudad" is not
    // stable (the 2026-06-07 refresh grew it from 2 to 8+ and broke the
    // exact-count assertion below).
    await page.route('**/data/mx-cities.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"cities":[]}',
      })
    );
    await mockOpenMeteo(page);
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/*.arcgisonline.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );

    await page.goto('mapa/');

    // Wait for the map's preset pins (5 cities) to render before snapshotting
    // the marker count — they're added by renderPins() on `map.on('load')`.
    await expect(page.locator('.maplibregl-marker')).toHaveCount(5);
    const presetCount = 5;

    // P1.7 — Search is collapsed by default; expand it via the icon.
    await page.locator('#mw-search-toggle').click();
    const mapq = page.locator('#mapq');
    await expect(mapq).toBeVisible();
    await expect(mapq).toHaveAttribute('aria-expanded', 'false');
    await mapq.fill('Ciudad');

    const listbox = page.locator('#mapac');
    await expect(listbox).toBeVisible();
    await expect(mapq).toHaveAttribute('aria-expanded', 'true');

    // The CDMX fixture returns 2 distinct results (Ciudad de México +
    // Mexicali). The combobox must show more than one option so the user
    // can verify which match they want — issue #81's regression assertion.
    const options = page.locator('#mapac > li');
    await expect(options).toHaveCount(2);

    // Marker count is unchanged: no auto-fly, no auto-pin happened.
    await expect(page.locator('.maplibregl-marker')).toHaveCount(presetCount);

    // Clicking an option drops a user pin (+1 marker) and closes the list.
    await options.first().click();
    await expect(listbox).toBeHidden();
    await expect(mapq).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.maplibregl-marker')).toHaveCount(
      presetCount + 1
    );
  });

  test('sunlight overlay activates without timeline or legend', async ({
    page,
  }) => {
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    await page.route('**/tilecache.rainviewer.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );

    await page.goto('mapa/');
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );

    await openLayerRail(page);
    const btn = page.locator('#layerbtn-sunlight');
    await expect(btn).toBeEnabled();
    await btn.click();

    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend-bar')).toBeHidden();
    // P0.3 — timeline stays mounted; just check the placeholder text.
    await expect(page.locator('#tl-time')).toHaveText('—');
    await expect(page.locator('#opacitywrap')).toBeVisible();

    await page.locator('#layerbtn-base').click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  // Story 16.4 — animation controls persist and apply live.
  test('settings panel persists animation controls; tapping the time pill cycles the label', async ({
    page,
  }) => {
    await page.goto('mapa/');
    // Story 22.3 — ⚙ is the Ajustes tab of the ⋯ menu.
    await page.locator('#mw-tools-btn').click();
    await page.locator('#mw-tools-tab-settings').click();
    await expect(page.locator('#mw-settings')).toBeVisible();
    await page.locator('[data-mw-speed] button[data-val="fast"]').click();
    await page.locator('[data-mw-loop] button[data-val="6"]').click();
    await page.locator('[data-mw-style] button[data-val="fast"]').click();
    await expect(
      page.locator('[data-mw-speed] button[data-val="fast"]')
    ).toHaveAttribute('aria-pressed', 'true');
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('mw:settings') ?? '{}')
    );
    expect(stored).toMatchObject({
      playSpeed: 'fast',
      loopHours: 6,
      playStyle: 'fast',
    });
    await page.locator('#mw-tools-btn').click();
    await expect(page.locator('#mw-settings')).toBeHidden();
    await page.locator('#tl-time').click();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('mw:settings') ?? '{}').timeLabel
        )
      )
      .toBe('clock');
    await expect(
      page.locator('[data-mw-label] button[data-val="clock"]')
    ).toHaveAttribute('aria-pressed', 'true');
  });

  // Story 19.2 — first-visit welcome card, once per browser.
  test('welcome card shows on the first visit only and can be dismissed', async ({
    page,
  }) => {
    await page.goto('mapa/');
    const card = page.locator('#mw-welcome');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('role', 'dialog');
    await page.locator('#mw-welcome-dismiss').click();
    await expect(card).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mw:welcomed'))).toBe(
      '1'
    );
    await page.reload();
    await expect(page.locator('#mw-welcome')).toBeHidden();
  });

  // Story 19.1 — per-layer landing pages open the map on that layer.
  test('/mapa/temperatura/ renders its own copy and boots on the temperature layer', async ({
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
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: RAINVIEWER_MANIFEST,
        })
    );
    // Deterministic basemap: a decodable tile so MapLibre fires `load`
    // and `idle` regardless of the runner's network.
    await page.route('**/*.arcgisonline.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
    );
    await page.goto('mapa/temperatura/');
    await expect(page).toHaveTitle(/Mapa de temperatura/);
    await expect(
      page.getByRole('heading', { level: 1, name: /Mapa de temperatura/ })
    ).toBeVisible();
    await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 15_000 }
    );
    await expect(page.locator('#legend-bar')).toBeVisible();
  });
});

// Story 21.2 — /mapa opens on GeoColor and the clouds are already moving
// (plan PARIDAD_VISUAL E21). Tiles (Esri, GIBS, RainViewer) are mocked
// with the decodable transparent PNG so MapLibre fires `load` and the
// raster source reports loaded on any runner; the assertions are DOM
// state only (pressed layer, play state, frame index, hash, toast).
test.describe('Story 21.2 — /mapa boots on satellite', () => {
  const png = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });

  /** Deterministic boot network. `gibsStatus` ≠ 200 answers every GIBS
   *  request (the boot probe included) with that HTTP error;
   *  `manifestDown` makes the RainViewer manifest unparseable. Returns
   *  the GIBS URLs requested, in order. */
  async function mockBoot(
    page: import('@playwright/test').Page,
    opts: {
      gibsStatus?: number;
      manifestDown?: boolean;
      /** Holds every GIBS answer (the boot probe included) this long,
       *  so the boot activation lands late — the window in which a
       *  visitor's own click must win. */
      gibsDelayMs?: number;
    } = {}
  ): Promise<string[]> {
    await page.route('**/*.arcgisonline.com/**', png);
    await page.route('**/tilecache.rainviewer.com/**', png);
    await page.route(
      '**/api.rainviewer.com/public/weather-maps.json',
      (route) =>
        opts.manifestDown
          ? route.fulfill({
              status: 500,
              contentType: 'text/plain',
              body: 'down',
            })
          : route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: RAINVIEWER_MANIFEST,
            })
    );
    const gibsUrls: string[] = [];
    await page.route('**/gibs.earthdata.nasa.gov/**', async (route) => {
      gibsUrls.push(route.request().url());
      if (opts.gibsDelayMs) {
        await new Promise<void>((r) => setTimeout(r, opts.gibsDelayMs));
      }
      if ((opts.gibsStatus ?? 200) === 200) return png(route);
      return route.fulfill({ status: opts.gibsStatus!, body: '' });
    });
    // The welcome card is a one-time dialog, not part of this story.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mw:welcomed', '1');
      } catch {
        /* private mode — the card shows; nothing below depends on it */
      }
    });
    return gibsUrls;
  }

  test('a fresh /mapa opens on GeoColor and plays the last 3 h on its own', async ({
    page,
  }) => {
    const gibsUrls = await mockBoot(page);
    await page.goto('mapa/');

    const satBtn = page.locator('#layerbtn-satellite');
    await expect(satBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#layerbtn-base')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    // The 24 h GeoColor axis (Story 16.1), newest frame selected first.
    const range = page.locator('#tl-range');
    await expect(range).toHaveAttribute('max', '143');
    // The boot probe asked GIBS for one GeoColor tile over central
    // Mexico (z4 y6 x3) at the newest frame before any map tile.
    expect(gibsUrls[0]).toMatch(
      /GOES-East_ABI_GeoColor\/default\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\/GoogleMapsCompatible_Level7\/4\/6\/3\.png$/
    );

    // Autoplay: no click, the loop is running …
    const play = page.locator('#tl-play');
    await expect(play).toHaveAttribute('data-state', 'playing');
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    // … over the LAST 3 h only: the first tick jumps from the newest
    // frame (143) to the start of the ±3 h window (128–129 of 143) and
    // the index never drops into the older 21 h.
    await expect
      .poll(async () => Number(await range.inputValue()))
      .toBeLessThan(143);
    expect(Number(await range.inputValue())).toBeGreaterThanOrEqual(120);
    await expect(page).toHaveURL(/layer=satellite/);

    // The first interaction with the timeline pauses, as a manual ▶ does.
    await page.locator('#tl-prev').click();
    await expect(play).toHaveAttribute('data-state', 'paused');
    await expect(play).toHaveAttribute('aria-pressed', 'false');
    const held = await range.inputValue();
    await page.waitForTimeout(1500);
    expect(await range.inputValue()).toBe(held);
  });

  test('a hash with only view= keeps the satellite default and honours the view', async ({
    page,
  }) => {
    await mockBoot(page);
    await page.goto('mapa/?e2e=1#view=19.43,-99.13,6.5z');
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page).toHaveURL(/layer=satellite/);
    const zoom = await page.evaluate(() =>
      (window as unknown as { __map: { getZoom(): number } }).__map.getZoom()
    );
    expect(Math.abs(zoom - 6.5)).toBeLessThan(0.05);
  });

  test('prefers-reduced-motion: satellite boots, but paused', async ({
    page,
  }) => {
    await mockBoot(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('mapa/');
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const range = page.locator('#tl-range');
    await expect(range).toHaveAttribute('max', '143');
    const play = page.locator('#tl-play');
    await expect(play).toHaveAttribute('data-state', 'paused');
    await expect(play).toBeDisabled();
    // Still static a couple of cadences later.
    const held = await range.inputValue();
    await page.waitForTimeout(1500);
    expect(await range.inputValue()).toBe(held);
    await expect(play).toHaveAttribute('data-state', 'paused');
  });

  test('a shared instant (t=) stays put: satellite, no autoplay', async ({
    page,
  }) => {
    await mockBoot(page);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    await page.goto(
      `mapa/#view=23.6,-102.5,4.5z&layer=satellite&t=${twoHoursAgo}`
    );
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const range = page.locator('#tl-range');
    await expect(range).toHaveAttribute('max', '143');
    // ≈ 12 ten-minute frames before the newest (143), ± the 30 min lag.
    const idx = Number(await range.inputValue());
    expect(idx).toBeGreaterThan(125);
    expect(idx).toBeLessThan(140);
    await page.waitForTimeout(1500);
    expect(Number(await range.inputValue())).toBe(idx);
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'paused'
    );
  });

  test('GIBS down: the boot falls back to radar with the toast, static', async ({
    page,
  }) => {
    await mockBoot(page, { gibsStatus: 503 });
    await page.goto('mapa/');
    await expect(page.locator('#layerbtn-radar')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.locator('#mapmsg')).toContainText('Capa no disponible');
    // RainViewer's 4 frames (3 past + 1 nowcast), not the GeoColor axis.
    await expect(page.locator('#tl-range')).toHaveAttribute('max', '3');
    await expect(page).toHaveURL(/layer=radar/);
    // The fallback is not the story: radar does not autoplay.
    await page.waitForTimeout(1200);
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'paused'
    );
  });

  test('GIBS and RainViewer down: the boot falls back to base with the toast', async ({
    page,
  }) => {
    await mockBoot(page, { gibsStatus: 503, manifestDown: true });
    await page.goto('mapa/');
    await expect(page.locator('#mapmsg')).toContainText('Capa no disponible');
    await expect(page.locator('#layerbtn-base')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.locator('#tl-time')).toHaveText('—');
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'paused'
    );
  });
  test('a layer picked before the boot lands wins over the satellite default', async ({
    page,
  }) => {
    // The boot activation waits for the GIBS probe (≤ 5 s), the
    // RainViewer manifest and the map's first idle, then retries for
    // ~5 s more. Holding GIBS 2 s reproduces deterministically what a
    // slow probe does in production: the visitor clicks a rail layer
    // right after the manifest and the boot must yield to it (before
    // the fix it activated satellite ~3 s later, dropping the field).
    await mockBoot(page, { gibsDelayMs: 2000 });
    // Live field path (the snapshot would hydrate without a request).
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
    const manifest = page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );
    await page.goto('mapa/?e2e=1');
    await manifest;

    await openLayerRail(page);
    const tempBtn = page.locator('#layerbtn-temperature');
    await expect(tempBtn).toBeEnabled();
    const fieldResp = page.waitForResponse(
      '**/api.open-meteo.com/v1/forecast**'
    );
    await tempBtn.click();
    await fieldResp;
    await expect(tempBtn).toHaveAttribute('aria-pressed', 'true');
    const range = page.locator('#tl-range');
    // The −24 h … +48 h hourly field axis, not the 144-frame GeoColor one.
    await expect(range).toHaveAttribute('max', '71');

    // … and it stays that way for ≥ 6 s: past the held probe (2 s) and
    // the whole boot retry backoff (0 + 250 + 600 + 1300 + 2800 ms).
    const satBtn = page.locator('#layerbtn-satellite');
    const play = page.locator('#tl-play');
    const until = Date.now() + 6500;
    while (Date.now() < until) {
      expect(await tempBtn.getAttribute('aria-pressed')).toBe('true');
      expect(await satBtn.getAttribute('aria-pressed')).toBe('false');
      expect(await range.getAttribute('max')).toBe('71');
      // No boot autoplay over the visitor's own layer.
      expect(await play.getAttribute('data-state')).toBe('paused');
      await page.waitForTimeout(500);
    }
    await expect(page).toHaveURL(/layer=temperature/);
    expect(page.url()).not.toMatch(/layer=satellite/);
    // No fallback toast either: the visitor never saw a boot layer.
    await expect(page.locator('#mapmsg')).not.toContainText(
      'Capa no disponible'
    );
    // The field raster is still on the map.
    const hasField = await page.evaluate(() => {
      const m = (
        window as unknown as { __map?: { getLayer(id: string): unknown } }
      ).__map;
      return !!m?.getLayer('wx-field-layer');
    });
    expect(hasField).toBe(true);
  });
  test('a layer picked while a deep-link boot is still fetching its grid wins', async ({
    page,
  }) => {
    // #layer=temperature boots a field layer: its activation awaits the
    // Open-Meteo grid. A rail pick made while that fetch is in flight
    // must not be overwritten when the older grid finally lands.
    await mockBoot(page);
    await page.route('**/data/field-grids/**', (route) =>
      route.fulfill({ status: 404 })
    );
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    await page.route('**/api.open-meteo.com/v1/forecast**', async (route) => {
      await released;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: fieldResponseForUrl(route.request().url()),
      });
    });
    const manifest = page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );
    const bootFetch = page.waitForRequest(
      '**/api.open-meteo.com/v1/forecast**'
    );
    await page.goto('mapa/?e2e=1#view=23.6,-102.5,4.5z&layer=temperature');
    await manifest;
    // The boot activation has started: the temperature grid is in flight.
    await bootFetch;

    await openLayerRail(page);
    const radarBtn = page.locator('#layerbtn-radar');
    const tempBtn = page.locator('#layerbtn-temperature');
    await expect(radarBtn).toBeEnabled();
    await radarBtn.click();
    await expect(radarBtn).toHaveAttribute('aria-pressed', 'true');
    const landed = page.waitForResponse('**/api.open-meteo.com/v1/forecast**');
    release();

    // The held grid lands (and the boot's retry window elapses) without
    // taking the map back to temperature.
    await landed;
    const until = Date.now() + 6500;
    while (Date.now() < until) {
      expect(await radarBtn.getAttribute('aria-pressed')).toBe('true');
      expect(await tempBtn.getAttribute('aria-pressed')).toBe('false');
      await page.waitForTimeout(500);
    }
    await expect(page).toHaveURL(/layer=radar/);
    await expect(page.locator('#mapmsg')).not.toContainText(
      'Capa no disponible'
    );
    const layers = await page.evaluate(() => {
      const m = (
        window as unknown as { __map?: { getLayer(id: string): unknown } }
      ).__map;
      return {
        raster: !!m?.getLayer('wx-raster-layer'),
        field: !!m?.getLayer('wx-field-layer'),
      };
    });
    expect(layers).toEqual({ raster: true, field: false });
  });
});

// Story 21.3 — the loop swaps frames through two raster slots (A/B)
// instead of re-creating the source, and the play button shows a
// buffering state while the next frame is not in. Radar frames are
// prefetched ahead; satellite ones are not (GIBS serves tiles `no-store`,
// so an Image() download is never reused) — the satellite loop waits on
// the A/B swap instead.
test.describe('Story 21.3 — frame prefetch and A/B swap', () => {
  const png = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });

  async function mockNet(page: import('@playwright/test').Page) {
    await page.route('**/*.arcgisonline.com/**', png);
    await page.route('**/tilecache.rainviewer.com/**', png);
    await page.route('**/gibs.earthdata.nasa.gov/**', png);
    await page.route('**/api.rainviewer.com/public/weather-maps.json', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: RAINVIEWER_MANIFEST,
      })
    );
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mw:welcomed', '1');
      } catch {
        /* private mode — nothing below depends on it */
      }
    });
  }

  type E2eWin = {
    __map?: {
      getLayer(id: string): unknown;
      getSource(id: string): unknown;
      getStyle(): { layers: Array<{ id: string }> };
    };
    __framePrefetch?: { stats(): { requested: number } };
  };

  test('the loop swaps frames through two slots under the labels; radar prefetches ahead, satellite does not', async ({
    page,
  }) => {
    await mockNet(page);
    await page.goto('mapa/?e2e=1');
    // The boot (GIBS probe, manifest, first idle) can take a while on a
    // loaded runner before the loop starts.
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'playing',
      { timeout: 20_000 }
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!(window as unknown as E2eWin).__map?.getLayer('wx-raster-layer-b')
        )
      )
      .toBe(true);
    const state = await page.evaluate(() => {
      const w = window as unknown as E2eWin;
      const order = w.__map!.getStyle().layers.map((l) => l.id);
      return {
        order,
        a: !!w.__map!.getSource('wx-raster'),
        b: !!w.__map!.getSource('wx-raster-b'),
        requested: w.__framePrefetch?.stats().requested ?? -1,
      };
    });
    expect(state.a && state.b).toBe(true);
    const ref = state.order.indexOf('osm-reference');
    for (const id of ['wx-raster-layer', 'wx-raster-layer-b']) {
      expect(state.order.indexOf(id)).toBeGreaterThan(
        state.order.indexOf('osm')
      );
      expect(state.order.indexOf(id)).toBeLessThan(ref);
    }
    // Satellite: GIBS tiles are `no-store`, nothing is fetched ahead.
    expect(state.requested).toBe(0);

    // Radar: tiles of frames ahead of the playhead are fetched with
    // Image() (RainViewer tiles are cacheable).
    await openLayerRail(page);
    await page.locator('#layerbtn-radar').click();
    await expect(page.locator('#tl-range')).toHaveAttribute('max', '3');
    const play = page.locator('#tl-play');
    if ((await play.getAttribute('data-state')) !== 'playing') {
      await play.click();
    }
    await expect(play).toHaveAttribute('data-state', 'playing');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as E2eWin).__framePrefetch?.stats().requested ??
            -1
        )
      )
      .toBeGreaterThan(0);
  });

  test('the play button buffers (aria-busy) while the next frame is not cached', async ({
    page,
  }) => {
    await mockNet(page);
    await page.goto('mapa/?e2e=1');
    const play = page.locator('#tl-play');
    await expect(play).toHaveAttribute('data-state', 'playing', {
      timeout: 20_000,
    });
    // From now on GIBS answers only when released: the loop runs through
    // what is already cached, then waits on the first frame that is not.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/gibs.earthdata.nasa.gov/**', async (route) => {
      await gate;
      await png(route);
    });
    await expect(play).toHaveAttribute('aria-busy', 'true', {
      timeout: 15_000,
    });
    await expect(play).toHaveAttribute('data-state', 'playing');
    await expect(play.locator('use')).toHaveAttribute('href', '#i-loader');
    const range = page.locator('#tl-range');
    const held = await range.inputValue();
    await page.waitForTimeout(1000);
    expect(await range.inputValue()).toBe(held);
    release();
    await expect(play).not.toHaveAttribute('aria-busy', 'true');
    await expect
      .poll(async () => await range.inputValue(), { timeout: 10_000 })
      .not.toBe(held);
  });

  test('data saver: no prefetcher, and ▶ plays on the plain cadence', async ({
    page,
  }) => {
    await mockNet(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      });
    });
    await page.goto('mapa/?e2e=1');
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const range = page.locator('#tl-range');
    await expect(range).toHaveAttribute('max', '143');
    const play = page.locator('#tl-play');
    // Data saver also skips the boot autoplay (Story 21.2).
    await expect(play).toHaveAttribute('data-state', 'paused');
    const start = await range.inputValue();
    await play.click();
    await expect(play).toHaveAttribute('data-state', 'playing');
    await expect.poll(async () => await range.inputValue()).not.toBe(start);
    const hasPrefetcher = await page.evaluate(
      () => (window as unknown as E2eWin).__framePrefetch !== undefined
    );
    expect(hasPrefetcher).toBe(false);
  });
});

const png = (route: import('@playwright/test').Route) =>
  route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TRANSPARENT_PNG,
  });

/** /mapa on its GeoColor boot (Story 21.2), tiles and manifest served
 *  locally, welcome card pre-dismissed (a one-time dialog). Shared by the
 *  Story 22.2 and 22.3 blocks. */
async function openOnSatellite(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.route('**/*.arcgisonline.com/**', png);
  await page.route('**/gibs.earthdata.nasa.gov/**', png);
  await page.route('**/tilecache.rainviewer.com/**', png);
  await page.route('**/api.rainviewer.com/public/weather-maps.json', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: RAINVIEWER_MANIFEST,
    })
  );
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mw:welcomed', '1');
    } catch {
      /* private mode — the card shows */
    }
  });
  await page.goto('mapa/');
  await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 20_000 }
  );
}

test.describe('Story 22.2 — compact rail and progressive disclosure', () => {
  /** Visible controls of the rail, as boxes. */
  async function railBoxes(page: import('@playwright/test').Page) {
    return page.locator('.im-rail').evaluate((rail) =>
      Array.from(
        rail.querySelectorAll<HTMLElement>('button, input, select, summary')
      )
        .filter((el) => el.checkVisibility())
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { id: el.id, y: b.y, height: b.height, width: b.width };
        })
    );
  }

  test('desktop rail: ≤ 9 rows with a layer active, only its sub-options, no chips', async ({
    page,
  }) => {
    await openOnSatellite(page);
    // Story 22.5 — one click on "Capas" unfolds the rail on /mapa.
    await openLayerRail(page);
    const boxes = await railBoxes(page);
    expect(railRowCount(boxes)).toBeLessThanOrEqual(9);

    // Every layer is one click away, each tile icon + short label; the
    // full name stays the accessible name and the tooltip carries the
    // shortcut letter (the chips are gone until the `?` panel, 22.5).
    for (const id of [
      'base',
      'radar',
      'satellite',
      'temperature',
      'humidity',
      'pressure',
      'precipitation',
      'wind',
      'sunlight',
    ]) {
      await expect(page.locator(`#layerbtn-${id}`)).toBeVisible();
    }
    await expect(page.locator('#layerbtn-temperature')).toHaveText('Temp.');
    await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
      'aria-label',
      'Temperatura'
    );
    await expect(page.locator('#layerbtn-radar')).toHaveAttribute(
      'title',
      'Radar (R)'
    );
    await expect(page.locator('.im-rail kbd')).toHaveCount(0);

    // Only the active layer's variants show, inside its block, right
    // under the grid row of the satellite tile (row 1 of 3).
    await expect(page.locator('#satellite-sub-options')).toBeVisible();
    for (const g of ['temp', 'humidity', 'precipitation', 'pressure', 'wind']) {
      await expect(page.locator(`#${g}-sub-options`)).toBeHidden();
    }
    const block = page.locator('#mw-rail-active');
    await expect(block).toBeVisible();
    await expect(block.locator('#opacitywrap')).toBeVisible();
    await expect(block.locator('#satellite-sub-options')).toBeVisible();
    const sat = await page.locator('#layerbtn-satellite').boundingBox();
    const temp = await page.locator('#layerbtn-temperature').boundingBox();
    const blk = await block.boundingBox();
    expect(blk!.y).toBeGreaterThanOrEqual(sat!.y + sat!.height);
    expect(blk!.y + blk!.height).toBeLessThanOrEqual(temp!.y);
  });

  test('the active block follows the layer and leaves with the base map', async ({
    page,
  }) => {
    await openOnSatellite(page);
    await openLayerRail(page);
    const block = page.locator('#mw-rail-active');
    // Sun (row 3, no variants, computed locally): the block moves under
    // the last row, with the opacity control and no sub-options.
    await page.locator('#layerbtn-sunlight').click();
    await expect(page.locator('#layerbtn-sunlight')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('#opacitywrap')).toBeVisible();
    await expect(page.locator('#satellite-sub-options')).toBeHidden();
    await expect(page.locator('#mw-sub-options')).toBeHidden();
    const sun = await page.locator('#layerbtn-sunlight').boundingBox();
    const blk = await block.boundingBox();
    expect(blk!.y).toBeGreaterThanOrEqual(sun!.y + sun!.height);
    // The opacity control drives the active layer as before.
    await page.locator('#opacity').fill('30');
    await expect(page.locator('#opacity')).toHaveValue('30');

    await page.locator('#layerbtn-base').click();
    await expect(block).toBeHidden();
    await expect(page.locator('#opacitywrap')).toBeHidden();
  });

  test('overlays tab: most used pinned first, filter, every overlay in ≤ 2 clicks', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const tab = page.locator('#mw-overlays-tab');
    const panel = page.locator('#mw-overlays');
    await expect(panel).toBeHidden();
    await expect(tab).toHaveAttribute('aria-selected', 'false');

    // Click 1: the tab.
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toBeVisible();
    await expect(page.locator('#mw-layers')).toBeHidden();
    const order = await page
      .locator('#layerbtns-overlays [data-overlay-row]')
      .evaluateAll((rows) =>
        rows.map((r) => (r as HTMLElement).dataset.overlayRow)
      );
    expect(order.slice(0, 4)).toEqual([
      'tropical',
      'clouds',
      'precipMode',
      'windOverlay',
    ]);
    expect(order.length).toBeGreaterThanOrEqual(20);
    // Every overlay checkbox is there, with its old id, and visible.
    for (const id of order) {
      await expect(page.locator(`#overlay-${id}`)).toBeVisible();
    }
    // Click 2: toggle one that is not pinned.
    const grat = page.locator('#overlay-graticule');
    await grat.check();
    await expect(grat).toBeChecked();
    await expect(page.locator('#mw-overlays-count')).toBeVisible();

    // Filter: accent-insensitive, hides the rest, Escape clears.
    const filter = page.locator('#mw-overlays-filter');
    await filter.fill('reticula');
    await expect(
      page.locator('#layerbtns-overlays [data-overlay-row]:visible')
    ).toHaveCount(1);
    await expect(page.locator('[data-overlay-row="graticule"]')).toBeVisible();
    await filter.press('Escape');
    await expect(filter).toHaveValue('');
    await expect(
      page.locator('#layerbtns-overlays [data-overlay-row]:visible')
    ).toHaveCount(order.length);

    // Keyboard: ← goes back to the layers tab (roving focus).
    await tab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#mw-layers-tab')).toBeFocused();
    await expect(page.locator('#mw-layers')).toBeVisible();
    await expect(panel).toBeHidden();
  });
});

test.describe('Story 22.3 — one tools menu', () => {
  // Each test boots the satellite loop (~7 s) and then clicks through the
  // popover and the canvas while frames animate; ~9 interactions at 1.5–2 s
  // each under fullyParallel sit right at the default 30 s budget.
  test.describe.configure({ timeout: 60_000 });

  test('the ⋯ menu holds the tools, settings and info as tabs', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const btn = page.locator('#mw-tools-btn');
    const panel = page.locator('#mw-tools-panel');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toHaveAttribute('aria-controls', 'mw-tools-panel');
    await expect(panel).toBeHidden();
    // The old floating pills and ⚙ / ℹ panels kept their ids and moved
    // inside the popover: nothing of them is on the map until it opens.
    for (const id of [
      'mw-measure-wrap',
      'mw-snapshot-wrap',
      'mw-crosshair-btn',
      'mw-settings',
      'mw-info',
    ]) {
      await expect(panel.locator(`#${id}`), id).toHaveCount(1);
      await expect(page.locator(`#${id}`), id).toBeHidden();
    }
    await expect(page.locator('#mw-settings summary')).toHaveCount(0);

    // Open: the tools tab, every tool reachable in one more click.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(page.locator('#mw-tools-tab-tools')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('#mw-tools-tab-tools')).toBeFocused();
    for (const id of [
      'mw-measure-distance',
      'mw-measure-area',
      'mw-crosshair-btn',
      'mw-snapshot-capture',
      'mw-snapshot-24h',
    ]) {
      await expect(page.locator(`#${id}`), id).toBeVisible();
    }

    // Ajustes: the ⚙ groups, applied live; the menu stays open.
    await page.locator('#mw-tools-tab-settings').click();
    await expect(page.locator('#mw-settings')).toBeVisible();
    await expect(page.locator('#mw-tools-tools')).toBeHidden();
    const fahrenheit = page.locator('[data-mw-temp] button[data-val="F"]');
    await fahrenheit.click();
    await expect(fahrenheit).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toBeVisible();

    // → moves to Info (roving focus, like the rail tabs).
    await page.locator('#mw-tools-tab-settings').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#mw-tools-tab-info')).toBeFocused();
    await expect(page.locator('#mw-info')).toBeVisible();
    await expect(
      page.locator('#mw-info').getByRole('link', { name: 'Open-Meteo' })
    ).toBeVisible();
    // The back link moved here from the map's top-left corner, and the
    // MapLibre +/− buttons are gone on /mapa (scroll/pinch/keys zoom).
    await expect(
      page.locator('#mw-info').getByRole('link', { name: 'Volver al inicio' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Volver al inicio' })
    ).toHaveCount(1);
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toHaveCount(0);

    // Escape closes and hands the focus back to ⋯.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();

    // It reopens on the last tab; a click on the map closes it.
    await btn.click();
    await expect(page.locator('#mw-info')).toBeVisible();
    await page.locator('#map canvas').click({ position: { x: 640, y: 420 } });
    await expect(panel).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('an active tool shows one context pill; Salir turns it off', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const btn = page.locator('#mw-tools-btn');
    const panel = page.locator('#mw-tools-panel');
    const pill = page.locator('#mw-tool-pill');
    const label = page.locator('#mw-tool-pill-label');
    const exit = page.locator('#mw-tool-pill-exit');
    await expect(pill).toBeHidden();

    // Mira: picking it closes the menu and names it in the pill.
    await btn.click();
    await page.locator('#mw-crosshair-btn').click();
    await expect(panel).toBeHidden();
    await expect(page.locator('#mw-crosshair')).toBeVisible();
    await expect(pill).toBeVisible();
    await expect(label).toHaveText('Mira');
    await expect(exit).toHaveText('Salir');

    // Distancia on top: still ONE pill, naming both, with the running
    // total; measuring clicks add points and never open the place card.
    await btn.click();
    await page.locator('#mw-measure-distance').click();
    await expect(page.locator('#mw-measure-distance')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(label).toHaveText('Distancia · Mira');
    await expect(page.locator('#mw-tool-pill:visible')).toHaveCount(1);
    const canvas = page.locator('#map canvas');
    await canvas.click({ position: { x: 500, y: 400 } });
    await canvas.click({ position: { x: 700, y: 450 } });
    await expect(page.locator('#mw-measure-result')).toBeVisible();
    await expect(page.locator('#mw-measure-result')).toContainText(
      '1 segmento'
    );
    await expect(pill.locator('#mw-measure-result')).toHaveCount(1);
    await expect(page.locator('#mw-place-card')).toBeHidden();

    // With the menu open, Escape closes the menu only; the next one
    // exits measuring (the crosshair stays).
    await btn.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(label).toHaveText('Distancia · Mira');
    await page.keyboard.press('Escape');
    await expect(label).toHaveText('Mira');
    await expect(page.locator('#mw-measure-result')).toBeHidden();

    // Salir turns every active tool off.
    await btn.click();
    await page.locator('#mw-measure-area').click();
    await expect(label).toHaveText('Área · Mira');
    await exit.click();
    await expect(pill).toBeHidden();
    await expect(page.locator('#mw-crosshair')).toHaveCount(0);
    for (const id of [
      'mw-measure-distance',
      'mw-measure-area',
      'mw-crosshair-btn',
    ]) {
      await expect(page.locator(`#${id}`), id).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    }
  });

  test('a snapshot comparison lives in the pill: Ocultar/Mostrar and Salir', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const btn = page.locator('#mw-tools-btn');
    const pill = page.locator('#mw-tool-pill');
    const img = page.locator('#mw-snapshot-img');
    await btn.click();
    await page.locator('#mw-snapshot-capture').click();
    await expect(pill).toBeVisible();
    await expect(page.locator('#mw-tool-pill-label')).toHaveText('Comparación');
    await expect(img).toBeVisible();
    const toggle = pill.locator('#mw-snapshot-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('aria-label', 'Mostrar comparación');
    await expect(img).toBeHidden();
    // In the menu the capture pills gave way to Limpiar.
    await btn.click();
    await expect(page.locator('#mw-snapshot-capture')).toBeHidden();
    await expect(page.locator('#mw-snapshot-clear')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#mw-tool-pill-exit').click();
    await expect(pill).toBeHidden();
    await expect(img).toBeHidden();
    await btn.click();
    await expect(page.locator('#mw-snapshot-capture')).toBeVisible();
    await expect(page.locator('#mw-snapshot-clear')).toBeHidden();
  });

  test('the model toggle shows only with a forecast layer active', async ({
    page,
  }) => {
    await page.route('**/api.open-meteo.com/v1/forecast**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: fieldResponseForUrl(route.request().url()),
      })
    );
    await openOnSatellite(page);
    const toggle = page.locator('#mw-model-toggle');
    await expect(toggle).toBeHidden();

    await openLayerRail(page);
    await page.locator('#layerbtn-temperature').click();
    await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(toggle).toBeVisible();
    await expect(toggle.locator('.mw-model-btn')).toHaveCount(5);

    await page.locator('#layerbtn-sunlight').click();
    await expect(page.locator('#layerbtn-sunlight')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(toggle).toBeHidden();

    await page.locator('#layerbtn-satellite').click();
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(toggle).toBeHidden();
  });
});

test.describe('Story 22.4 — SMN avisos counter in the top bar', () => {
  test.describe.configure({ timeout: 60_000 });

  const aviso = (link: string, severity: 'critical' | 'warn' | 'info') => ({
    title: `Aviso ${link}`,
    link: `https://smn.example/${link}.pdf`,
    pubDate: 'Sun, 27 Sep 2026 12:00:00 -0600',
    category: 'Aviso',
    severity,
  });
  /** 3 distinct avisos: one shared by two states (counted once), a
   *  critical one in a state bucket (the site-wide ribbon only reads the
   *  global bucket, so it stays out of the way) and a national one. */
  const SMN_DOC = {
    metadata: { updated: new Date().toUTCString(), total_items: 3 },
    byState: {
      sonora: [aviso('polo', 'warn'), aviso('calor', 'critical')],
      sinaloa: [aviso('polo', 'warn')],
    },
    global: [aviso('frente', 'info')],
  };

  async function serveSmn(
    page: import('@playwright/test').Page,
    doc: object
  ): Promise<void> {
    await page.route('**/data/smn-by-state.json', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(doc),
      })
    );
  }

  test('the counter sits next to search and opens the same SMN panel', async ({
    page,
  }) => {
    await serveSmn(page, SMN_DOC);
    await openOnSatellite(page);
    const btn = page.locator('#mapa-smn-btn');
    const panel = page.locator('#mapa-smn-panel');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/3/);
    await expect(btn).toHaveAccessibleName('3 avisos SMN');
    await expect(btn).toHaveAttribute('data-severity', 'critical');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    // In the top bar: the search row, just left of the search button.
    await expect(
      page.locator(
        '#mw-search-wrap #mapa-smn-btn + #mapa-smn-panel + #mw-search-toggle'
      )
    ).toHaveCount(1);
    const b = (await btn.boundingBox())!;
    const s = (await page.locator('#mw-search-toggle').boundingBox())!;
    expect(Math.abs(b.y + b.height / 2 - (s.y + s.height / 2))).toBeLessThan(2);
    expect(b.x + b.width).toBeLessThanOrEqual(s.x);
    // The floating amber pill is gone.
    await expect(page.locator('details#mapa-smn-panel')).toHaveCount(0);
    await expect(page.locator('#mapa-smn-panel summary')).toHaveCount(0);

    // Open: the <SmnAvisos> widget, with the rows the counter counted.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    const widget = panel.locator('[data-smn-avisos]');
    await expect(widget).toBeVisible();
    await expect(widget).toHaveAttribute('data-smn-state', 'alert');
    await expect(widget.locator('[data-smn-list] li')).toHaveCount(3);
    await expect(widget.locator('[data-smn-loc]')).toHaveText(
      'Avisos vigentes en el país:'
    );

    // Escape closes and hands the focus back to the counter.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    // A press on the map closes it too.
    await btn.click();
    await expect(panel).toBeVisible();
    await page.locator('#map canvas').click({ position: { x: 400, y: 500 } });
    await expect(panel).toBeHidden();
  });

  test('no avisos: no counter on the map', async ({ page }) => {
    await serveSmn(page, { metadata: {}, byState: {}, global: [] });
    await openOnSatellite(page);
    // The widget inside the (closed) panel settles on its calm state once
    // the feed loaded — by then the counter has had its say too.
    await expect(
      page.locator('#mapa-smn-panel [data-smn-avisos]')
    ).toHaveAttribute('data-smn-state', 'calm');
    await expect(page.locator('#mapa-smn-btn')).toBeHidden();
    await expect(page.locator('#mapa-smn-panel')).toBeHidden();
  });

  test.describe('phone', () => {
    test.use({
      viewport: { width: 360, height: 640 },
      hasTouch: true,
      isMobile: true,
    });

    test('the counter and its panel fit a 360 px screen', async ({ page }) => {
      await serveSmn(page, SMN_DOC);
      await openOnSatellite(page);
      const btn = page.locator('#mapa-smn-btn');
      await expect(btn).toBeVisible();
      const b = (await btn.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
      await btn.tap();
      const panel = page.locator('#mapa-smn-panel');
      await expect(panel).toBeVisible();
      await expect(panel.locator('[data-smn-list] li')).toHaveCount(3);
      const p = (await panel.boundingBox())!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(360);
    });
  });
});

// Story 22.5 — the `?` keyboard cheat-sheet and the chrome budget on
// /mapa (≤ 8 controls over the map on desktop, ≤ 5 on a phone; the count
// itself lives in e2e/chrome-budget.spec.ts). What is asserted here is
// that nothing left the page: every folded control is one step away.
test.describe('Story 22.5 — `?` shortcuts panel and the chrome budget', () => {
  test.describe.configure({ timeout: 60_000 });

  test('the rail starts folded to its tabs and names the active layer', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const tab = page.locator('#mw-layers-tab');
    const rail = page.locator('.im-rail');
    await expect(rail).toHaveAttribute('data-rail-open', 'false');
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await expect(tab).toContainText('Satélite');
    await expect(page.locator('#layerbtn-radar')).toBeHidden();
    await expect(page.locator('#mw-rail-active')).toBeHidden();

    // One click unfolds it: every layer tile, the active block.
    await tab.click();
    await expect(rail).toHaveAttribute('data-rail-open', 'true');
    await expect(tab).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#layerbtn-radar')).toBeVisible();
    await expect(page.locator('#satellite-sub-options')).toBeVisible();

    // The layer name leaves the tab while the tiles show it, and comes
    // back (updated) when the rail folds again.
    await page.locator('#layerbtn-sunlight').click();
    await expect(page.locator('#layerbtn-sunlight')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await tab.click();
    await expect(rail).toHaveAttribute('data-rail-open', 'false');
    await expect(page.locator('#layerbtn-sunlight')).toBeHidden();
    await expect(tab).toContainText('Sol');

    // Escape inside an open rail folds it and keeps the focus on its tab.
    await page.locator('#mw-overlays-tab').click();
    await expect(page.locator('#mw-overlays')).toBeVisible();
    await page.locator('#overlay-graticule').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mw-overlays')).toBeHidden();
    await expect(page.locator('#mw-overlays-tab')).toBeFocused();
  });

  test('the step buttons show on hover and focus, and still work', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const prev = page.locator('#tl-prev');
    const opacity = () =>
      prev.evaluate((el) => Number(getComputedStyle(el).opacity));
    // Nothing points at the pill: transparent (not counted as chrome),
    // still in the page and the accessibility tree.
    await page.mouse.move(640, 300);
    await expect.poll(opacity).toBe(0);
    await expect(prev).toHaveAttribute('aria-label', /.+/);
    // Hover reveals them in place.
    await page.locator('#tl-time').hover();
    await expect.poll(opacity).toBe(1);
    // Keyboard: focus inside the pill reveals them too.
    await page.mouse.move(640, 300);
    await expect.poll(opacity).toBe(0);
    await page.locator('#tl-play').focus();
    await expect.poll(opacity).toBe(1);
    // And a click steps (and pauses the boot loop, as before).
    await prev.click();
    await expect(page.locator('#tl-play')).toHaveAttribute(
      'data-state',
      'paused'
    );
  });

  test('`?` opens the cheat-sheet generated from the layers and overlays', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const dialog = page.getByRole('dialog', { name: 'Atajos de teclado' });
    await expect(dialog).toBeHidden();
    await page.locator('#map canvas').click({ position: { x: 640, y: 400 } });
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-shortcuts-close]')).toBeFocused();

    // Every layer letter, from LAYERS.
    for (const [id, key] of [
      ['base', 'M'],
      ['radar', 'R'],
      ['satellite', 'A'],
      ['temperature', 'T'],
      ['humidity', 'H'],
      ['pressure', 'P'],
      ['wind', 'V'],
      ['sunlight', 'L'],
    ]) {
      await expect(
        dialog.locator(`[data-shortcut="layer:${id}"] kbd`)
      ).toHaveText(key);
    }
    // Overlay letters, from overlayDefs, with their names.
    await expect(
      dialog.locator('[data-shortcut="overlay:graticule"]')
    ).toContainText('Retícula');
    await expect(
      dialog.locator('[data-shortcut="overlay:graticule"] kbd')
    ).toHaveText('X');
    await expect(
      dialog.locator('[data-shortcut="overlay:clouds"] kbd')
    ).toHaveText('U');
    // No letter is listed twice (T and A belong to their layers).
    const letters = await dialog
      .locator(
        '[data-shortcuts-section="layers"] kbd, [data-shortcuts-section="overlays"] kbd'
      )
      .allTextContents();
    expect(letters.length).toBeGreaterThanOrEqual(25);
    expect(new Set(letters).size).toBe(letters.length);

    // Modal: a letter typed while reading does not switch the layer.
    await page.keyboard.press('r');
    await expect(page.locator('#layerbtn-radar')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.locator('#layerbtn-satellite')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Esc closes; the letters work again afterwards.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('?');
    await expect(dialog).toBeHidden();

    // `?` typed in the search box is text, not a shortcut.
    await page.locator('#mw-search-toggle').click();
    await page.locator('#mapq').fill('');
    await page.locator('#mapq').press('?');
    await expect(dialog).toBeHidden();
  });

  test('the ⋯ menu has an entry for the cheat-sheet; closing returns to ⋯', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const tools = page.locator('#mw-tools-btn');
    await tools.click();
    await page.locator('#mw-tools-tab-info').click();
    const entry = page.locator('#mw-shortcuts-open');
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Atajos de teclado');
    await entry.click();
    const dialog = page.locator('#mw-shortcuts');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#mw-tools-panel')).toBeHidden();
    await dialog.locator('[data-shortcuts-close]').click();
    await expect(dialog).toBeHidden();
    await expect(tools).toBeFocused();
  });

  test('?lang=en: the cheat-sheet reads in English', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mw:welcomed', '1');
      } catch {
        /* the card shows */
      }
    });
    await page.goto('mapa/?lang=en');
    await expect(page.locator('#layerbtn-base')).toBeAttached();
    await page.locator('#map canvas').click({ position: { x: 640, y: 400 } });
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator('[data-shortcut="overlay:graticule"]')
    ).toContainText('Graticule');
    await expect(dialog.locator('[data-shortcut="layer:radar"]')).toContainText(
      'Radar'
    );
    await expect(
      dialog.locator('[data-shortcuts-section="layers"] h3')
    ).toHaveText('Layers');
  });

  test('the feedback button sits in the nav bar, not over the map', async ({
    page,
  }) => {
    await openOnSatellite(page);
    const fab = page.locator('#secid-report-btn');
    await expect(fab).toBeVisible();
    await expect(page.locator('nav #secid-report-btn')).toHaveCount(1);
    const f = (await fab.boundingBox())!;
    const m = (await page.locator('#map-root').boundingBox())!;
    expect(f.y + f.height).toBeLessThanOrEqual(m.y);
    await fab.click();
    await expect(page.locator('#secid-report-modal')).toBeVisible();
  });

  test.describe('phone', () => {
    test.use({
      viewport: { width: 360, height: 640 },
      hasTouch: true,
      isMobile: true,
    });

    test('layers, steps and "Ver 10 días" come with "Capas y controles"', async ({
      page,
    }) => {
      await openOnSatellite(page);
      const trigger = page.locator('#mw-controls-toggle');
      await expect(trigger).toHaveAttribute('aria-label', 'Capas y controles');
      await expect(page.locator('.im-rail')).toBeHidden();
      await expect(page.locator('#tl-next')).toBeHidden();
      await expect(page.locator('#tl-extend')).toBeHidden();
      await expect(page.locator('#tl-play')).toBeVisible();
      // The feedback button fits the phone nav bar.
      const fab = (await page.locator('#secid-report-btn').boundingBox())!;
      expect(fab.x + fab.width).toBeLessThanOrEqual(360);

      await trigger.tap();
      await expect(page.locator('#layerbtn-radar')).toBeVisible();
      await expect(page.locator('#mw-layers-tab')).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      await expect(page.locator('#tl-next')).toBeVisible();
      await expect(page.locator('#tl-extend')).toBeVisible();
      await page.locator('#layerbtn-radar').tap();
      await expect(page.locator('#layerbtn-radar')).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      await trigger.tap();
      await expect(page.locator('.im-rail')).toBeHidden();
      await expect(page.locator('#tl-next')).toBeHidden();
    });
  });
});
