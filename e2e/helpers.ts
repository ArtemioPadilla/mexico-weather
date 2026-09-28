import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(HERE, 'fixtures', name), 'utf8');
}

/**
 * Deterministic network: intercept *all* Open-Meteo calls so no spec ever
 * hits the live network (critical for CI). The geocoding host and the
 * forecast host are matched separately and answered with local fixtures.
 */
export async function mockOpenMeteo(page: Page): Promise<void> {
  await page.route('**://geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: fixture('geocode.cdmx.json'),
    }),
  );

  await page.route('**://api.open-meteo.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: fixture('forecast.cdmx.json'),
    }),
  );
}

/**
 * Story 22.5 — on /mapa the layer rail starts folded to its Capas /
 * Superposiciones tab bar (the chrome budget of plan PARIDAD_VISUAL §1.2).
 * Open it on the layers tab so the #layerbtn-* tiles can be clicked, the
 * way a visitor does: one click on "Capas". No-op when it is already open
 * there; on a rail that does not fold (home embed, /mapa/<capa>/) it just
 * selects the layers tab. Desktop only: on a phone the rail opens with the
 * Controles panel (#mw-controls-toggle).
 */
export async function openLayerRail(page: Page): Promise<void> {
  const tab = page.locator('#mw-layers-tab');
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
  await expect(page.locator('#layerbtn-base')).toBeVisible();
}
