import { test, expect } from '@playwright/test';

/**
 * Story 4.1 — Catalog dropdown nav.
 *
 * The dropdown sits between Mapa and Pregunta in the top nav,
 * visible on sm+ viewports. Hidden on narrow mobile (where it
 * would push the nav past the viewport width).
 */

test.describe('catalog dropdown nav', () => {
  test('opens on click + lists 4 categories', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('');
    const dd = page.locator('#catalog-dropdown');
    await expect(dd).toBeVisible();
    await dd.locator('summary').click();
    await expect(page.getByRole('menuitem', { name: 'Ciudades' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Playas/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Estados' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Volcanes/ })).toBeVisible();
  });

  test('Ciudades navigates to /clima/', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('');
    await page.locator('#catalog-dropdown summary').click();
    await page.getByRole('menuitem', { name: 'Ciudades' }).click();
    await page.waitForURL(/\/clima\/?$/);
    expect(page.url()).toMatch(/\/mexico-weather\/clima\/$/);
  });

  test('Escape closes the dropdown', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('');
    const dd = page.locator('#catalog-dropdown');
    await dd.locator('summary').click();
    await expect(dd).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(dd).not.toHaveAttribute('open', '');
  });

  test('hidden on narrow mobile viewport (360px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('');
    await expect(page.locator('#catalog-dropdown')).toBeHidden();
  });
});
