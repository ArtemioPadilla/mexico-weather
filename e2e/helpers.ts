import type { Page } from '@playwright/test';
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
