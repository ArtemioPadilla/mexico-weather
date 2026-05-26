import { test, expect } from '@playwright/test';

/**
 * Story 1.1 — National alert ribbon e2e.
 *
 * Intercepts /data/smn-by-state.json with a synthetic doc containing a
 * critical global aviso and asserts the ribbon renders + dismiss works.
 */

const CRITICAL_DOC = {
  metadata: { updated: new Date().toISOString(), total_items: 1 },
  byState: {},
  global: [
    {
      title: 'Huracán Cat. 4 acercándose a Yucatán — Evacuación recomendada en zonas costeras',
      link: 'https://example.com/huracan-test',
      pubDate: new Date().toUTCString(),
      category: 'Alerta',
      severity: 'critical',
    },
  ],
};

const QUIET_DOC = {
  metadata: { updated: new Date().toISOString(), total_items: 0 },
  byState: {},
  global: [],
};

test.describe('national alert ribbon', () => {
  test('renders when a critical global aviso is active', async ({ page }) => {
    await page.route('**/data/smn-by-state.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CRITICAL_DOC),
      }),
    );
    await page.goto('');

    const ribbon = page.locator('#smn-alert-ribbon');
    await expect(ribbon).toBeVisible();
    await expect(ribbon.getByText(/Huracán Cat\. 4/)).toBeVisible();
    // Title gets truncated to ~80 chars with an ellipsis on long strings.
    const titleEl = ribbon.locator('[data-alert-title]');
    const titleText = (await titleEl.textContent()) ?? '';
    expect(titleText.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    // Link points at the specific advisory.
    const link = ribbon.locator('[data-alert-link]');
    await expect(link).toHaveAttribute('href', 'https://example.com/huracan-test');
  });

  test('hidden when no critical global avisos exist', async ({ page }) => {
    await page.route('**/data/smn-by-state.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(QUIET_DOC),
      }),
    );
    await page.goto('');
    const ribbon = page.locator('#smn-alert-ribbon');
    // Element exists in DOM (server-rendered placeholder) but the
    // hidden class prevents visibility.
    await expect(ribbon).toBeHidden();
  });

  test('dismiss button hides ribbon + persists via sessionStorage', async ({ page }) => {
    await page.route('**/data/smn-by-state.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CRITICAL_DOC),
      }),
    );
    await page.goto('');
    const ribbon = page.locator('#smn-alert-ribbon');
    await expect(ribbon).toBeVisible();

    await ribbon.locator('[data-alert-dismiss]').click();
    await expect(ribbon).toBeHidden();

    // Navigate within the same session — should stay dismissed.
    await page.goto('privacidad/');
    await expect(page.locator('#smn-alert-ribbon')).toBeHidden();
  });
});
