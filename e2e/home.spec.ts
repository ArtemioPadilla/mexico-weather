import { test, expect } from '@playwright/test';
import { mockOpenMeteo } from './helpers';

test.describe('homepage', () => {
  test.beforeEach(async ({ page }) => {
    // Even the homepage fires Open-Meteo (city cards refresh on load).
    await mockOpenMeteo(page);
  });

  test('loads with 200 and the Clima México heading', async ({ page }) => {
    const res = await page.goto('');
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: /Clima México/ }),
    ).toBeVisible();
  });

  test('renders the 5 preset city cards', async ({ page }) => {
    await page.goto('');
    const cards = page.locator('[data-city-card]');
    await expect(cards).toHaveCount(5);
    for (const name of [
      'Ciudad de México',
      'Oaxaca',
      'Puerto Vallarta',
      'Monterrey',
      'Guadalajara',
    ]) {
      await expect(
        page.getByRole('heading', { level: 3, name }),
      ).toBeVisible();
    }
  });

  test('shows the SMN alert RSS link', async ({ page }) => {
    await page.goto('');
    const rss = page.getByRole('link', { name: /Feed RSS del SMN/ });
    await expect(rss).toBeVisible();
    await expect(rss).toHaveAttribute('href', /\/rss\.xml$/);
  });

  test('has the footer privacy link', async ({ page }) => {
    await page.goto('');
    const privacy = page.getByRole('link', { name: 'Privacidad', exact: true });
    await expect(privacy).toBeVisible();
    await expect(privacy).toHaveAttribute('href', /\/privacidad\/$/);
  });
});
