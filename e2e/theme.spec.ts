import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockOpenMeteo } from './helpers';

// Force a deterministic OS preference so the 'system' branch resolves to a
// known theme regardless of the runner's settings.
test.use({ colorScheme: 'light' });

test.describe('theme', () => {
  test.beforeEach(async ({ page }) => {
    await mockOpenMeteo(page);
  });

  test('no-FOUC: served HTML has no hardcoded class="dark" on <html>', async () => {
    // The theme is applied by an inline script at runtime, never baked into
    // the static HTML. Assert against the built artifact on disk.
    const html = readFileSync('dist/index.html', 'utf8');
    const htmlTag = html.match(/<html[^>]*>/i)?.[0] ?? '';
    expect(htmlTag).not.toMatch(/class\s*=\s*["'][^"']*\bdark\b/i);
    // The anti-FOUC inline script must be present in <head>.
    expect(html).toContain("classList.toggle('dark'");
  });

  test('toggle cycles Sistema → Claro → Oscuro and toggles the .dark class', async ({
    page,
  }) => {
    await page.goto('');
    const html = page.locator('html');
    const toggle = page.getByRole('button', { name: /Cambiar tema/ });

    // Initial: no stored preference → 'system' → resolves light (forced).
    await expect(html).not.toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();

    // Click 1: system → light (still no .dark under forced light scheme).
    await toggle.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe(
      'light',
    );
    await expect(html).not.toHaveClass(/\bdark\b/);

    // Click 2: light → dark (.dark applied).
    await toggle.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe(
      'dark',
    );
    await expect(html).toHaveClass(/\bdark\b/);

    // Click 3: dark → system (resolves light again).
    await toggle.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe(
      'system',
    );
    await expect(html).not.toHaveClass(/\bdark\b/);
  });

  test('persists the chosen theme across reload', async ({ page }) => {
    await page.goto('');
    const html = page.locator('html');
    const toggle = page.getByRole('button', { name: /Cambiar tema/ });

    // Cycle to Oscuro (system → light → dark).
    await toggle.click();
    await toggle.click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe(
      'dark',
    );

    await page.reload();
    // Persisted 'dark' must survive the reload (and not flash to light).
    await expect(html).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  });
});
