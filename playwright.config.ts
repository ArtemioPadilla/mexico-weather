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
const PORT = 4321;
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
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
