import { test, expect } from '@playwright/test';
import { mockOpenMeteo } from './helpers';

test.describe('homepage', () => {
  test.beforeEach(async ({ page }) => {
    // Even the homepage fires Open-Meteo (city cards refresh on load).
    await mockOpenMeteo(page);
    // Start every test with no favorites so the preset grid is not
    // deduped by previously favorited cities (closes #95). Playwright
    // gives every test an isolated browser context, but tests that run
    // in the same project process can share localStorage via
    // storageState. Clearing here keeps the preset assertions stable.
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('secid-mwx-favorites');
      } catch {
        // ignore — some browsers/contexts deny storage access in init.
      }
    });
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

  test('hides preset cards for already-favorited cities (closes #95)', async ({
    page,
  }) => {
    // Seed a favorite that matches a preset (Ciudad de México). The
    // dedupe filter must remove it from "Pronóstico por Ciudad".
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'secid-mwx-favorites',
        JSON.stringify([
          {
            lat: 19.43,
            lng: -99.13,
            name: 'Ciudad de México',
            admin: 'CDMX',
            tz: 'America/Mexico_City',
            addedAt: Date.now(),
          },
        ]),
      );
    });

    await page.goto('');

    // "Tus lugares" shows the favorited city.
    await expect(page.locator('#fav-section')).toBeVisible();
    await expect(page.locator('#fav-grid')).toContainText('Ciudad de México');

    // Preset grid no longer contains the duplicate (4 preset cards left).
    const presetCards = page.locator('#preset-grid [data-city-card]');
    await expect(presetCards).toHaveCount(4);
    await expect(
      presetCards.filter({ hasText: 'Ciudad de México' }),
    ).toHaveCount(0);

    // The "+ Más ciudades" placeholder still anchors the end of the grid.
    await expect(page.getByText('Más ciudades próximamente')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Sugerir ciudad/ }),
    ).toBeVisible();
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
