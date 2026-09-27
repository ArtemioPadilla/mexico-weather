import { test, expect } from '@playwright/test';
import { mockOpenMeteo } from './helpers';

/** Minimal 1×1 transparent PNG (base64) — satisfies MapLibre tile requests. */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
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
  // Day 0 is fixed at 2026-05-19; past_days (Story 15.2) prepends whole
  // days before it, as Open-Meteo does.
  const t0 = Date.UTC(2026, 4, 19);
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
    await expect(page.locator('#layerbtn-base')).toBeVisible();
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

    await page.goto('mapa/');

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
    await expect.poll(() => gibsUrls.length).toBeGreaterThan(before);
    const second = timeOf(gibsUrls[gibsUrls.length - 1]!);
    expect(second).toBeTruthy();
    expect(Date.parse(second!)).toBe(Date.parse(first!) - 600_000);
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

    await page.goto('mapa/');
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );

    // P0.3 — Timeline pill is always visible now (was conditionally
    // 'hidden' before). Initial state is the dash placeholder.
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#tl-time')).toHaveText('—');

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

    await page.goto('mapa/');
    await page.waitForResponse(
      '**/api.rainviewer.com/public/weather-maps.json'
    );

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
    await expect(page.locator('#layerbtn-base')).toBeVisible();
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
    await page.locator('#mw-settings summary').click();
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
    await page.locator('#mw-settings summary').click();
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
