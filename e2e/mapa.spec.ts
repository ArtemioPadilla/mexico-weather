import { test, expect } from '@playwright/test';

test.describe('mapa page', () => {
  test('mapa page loads with map container and search', async ({ page }) => {
    const res = await page.goto('mapa/');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#map')).toBeVisible();
    await expect(page.getByPlaceholder(/Buscar un lugar/)).toBeVisible();
  });
});
