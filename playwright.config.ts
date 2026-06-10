import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the Astro static site.
 *
 * The site is built with a `base` of `/mexico-weather` (see
 * astro.config.mjs), and `astro preview` serves it *under* that base path on
 * http://localhost:4321. `baseURL` therefore includes the trailing base path
 * so specs can use root-relative navigation (`page.goto('/')`).
 */
// astro preview serves the site under the configured `base`
// (/mexico-weather). The trailing slash is required so that
// page.goto('forecast') resolves *relative to the base path* rather than
// replacing it.
const BASE_PATH = '/mexico-weather/';
// Overridable so e2e can run on machines where 4321 is taken by
// another dev server (astro preview silently falls back to 4322+,
// which would leave the webServer probe waiting forever).
const PORT = Number(process.env.PREVIEW_PORT ?? 4321);
const BASE_URL = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Pin navigator.language so the i18n auto-detect (Story 6.1)
    // doesn't flip the UI to English on test runners with an
    // en-* system locale. Specs that exercise the EN path
    // override this individually.
    locale: 'es-MX',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
