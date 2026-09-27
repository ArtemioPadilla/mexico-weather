import { test, expect } from '@playwright/test';

/**
 * Story 1.3 — /huracanes/ active-systems index.
 */

test.describe('/huracanes/', () => {
  test('renders title + breadcrumb', async ({ page }) => {
    await page.goto('huracanes/');
    await expect(page).toHaveTitle(/Huracanes/);
    await expect(
      page.getByRole('heading', { level: 1, name: /Huracanes activos/ })
    ).toBeVisible();
  });

  test('shows empty state when zero active storms', async ({ page }) => {
    await page.route('**/data/storms-snapshot.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          updated: new Date().toISOString(),
          storms: [],
        }),
      })
    );
    await page.goto('huracanes/');
    await expect(
      page.getByText(/Sin sistemas tropicales activos/)
    ).toBeVisible();
  });

  test('renders storm cards with classification + winds', async ({ page }) => {
    await page.route('**/data/storms-snapshot.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          updated: new Date().toISOString(),
          storms: [
            {
              name: 'ARTHUR',
              lat: 22.1,
              lng: -85.3,
              classification: 'HU',
              // 100 kt = Cat 3 per Saffir-Simpson (≥96 kt).
              intensityKt: 100,
            },
            {
              name: 'BERTHA',
              lat: 18.5,
              lng: -98.2,
              classification: 'TS',
              intensityKt: 45,
            },
          ],
        }),
      })
    );
    await page.goto('huracanes/');
    await expect(
      page.getByRole('heading', { level: 3, name: 'ARTHUR' })
    ).toBeVisible();
    await expect(page.getByText(/Huracán categoría 3/)).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'BERTHA' })
    ).toBeVisible();
    await expect(page.getByText(/Tormenta tropical/)).toBeVisible();
  });

  // Story 18.1 — cards link to /huracanes/<id>/ only when the snapshot
  // says the page was built with a cone / track.
  test('cards link to the per-storm track page when hasDetail is set', async ({
    page,
  }) => {
    await page.route('**/data/storms-snapshot.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          updated: new Date().toISOString(),
          storms: [
            {
              id: 'ep992026',
              name: 'POLO',
              lat: 19.8,
              lng: -113.4,
              classification: 'HU',
              intensityKt: 105,
              hasDetail: true,
            },
            {
              id: 'al992026',
              name: 'FAY',
              lat: 29.6,
              lng: -43.9,
              classification: 'TD',
              intensityKt: 30,
              hasDetail: false,
            },
          ],
        }),
      })
    );
    await page.goto('huracanes/');
    const links = page.locator('a[data-storm-detail]');
    await expect(links).toHaveCount(1);
    await expect(links.first()).toHaveAttribute(
      'href',
      /huracanes\/ep992026\/$/
    );
  });

  test('graceful fallback when snapshot 404s (workflow not yet run)', async ({
    page,
  }) => {
    await page.route('**/data/storms-snapshot.json', (route) =>
      route.fulfill({ status: 404, body: '' })
    );
    await page.goto('huracanes/');
    // We treat 404 as "no active systems" (functionally equivalent
    // for the user, whether the deploy hasn't built the file yet or
    // there are actually zero active systems).
    await expect(
      page.getByText(/Sin sistemas tropicales activos/)
    ).toBeVisible();
  });
});
