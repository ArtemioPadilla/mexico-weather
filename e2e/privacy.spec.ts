import { test, expect } from '@playwright/test';

test.describe('privacy page', () => {
  test('/privacidad/ renders with the privacy heading', async ({ page }) => {
    const res = await page.goto('privacidad/');
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: /Privacidad/ }),
    ).toBeVisible();
  });

  test('asserts no cookies / no tracking', async ({ page }) => {
    await page.goto('privacidad/');
    const main = page.locator('main');
    await expect(main).toContainText('No usamos cookies');
    await expect(main).toContainText(/No usamos analítica/);
    await expect(main).toContainText(/Sin cookies/);
    await expect(main).toContainText(/Sin rastreo/);
    // No cookies should be set by the page.
    expect(await page.context().cookies()).toEqual([]);
  });

  test('data-source attribution links present', async ({ page }) => {
    await page.goto('privacidad/');
    const openMeteo = page.getByRole('link', { name: 'Open-Meteo' });
    const smn = page.getByRole('link', { name: 'SMN / CONAGUA' });
    await expect(openMeteo.first()).toBeVisible();
    await expect(openMeteo.first()).toHaveAttribute(
      'href',
      'https://open-meteo.com',
    );
    await expect(smn).toBeVisible();
    await expect(smn).toHaveAttribute('href', 'https://smn.conagua.gob.mx');
  });
});
