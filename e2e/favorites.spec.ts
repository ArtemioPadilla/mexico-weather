import { test, expect } from '@playwright/test';
import { mockOpenMeteo } from './helpers';

test.describe('favorites add / persist / remove (deterministic, mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockOpenMeteo(page);
  });

  test('star on detail → appears in Tus lugares → persists → remove hides section', async ({
    page,
  }) => {
    // 1. Open a forecast detail page and favorite it.
    await page.goto(
      'forecast?lat=19.43&lng=-99.13&tz=America/Mexico_City&name=Ciudad%20de%20M%C3%A9xico&admin=CDMX',
    );

    const star = page.locator('#fc-fav');
    await expect(star).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'false');

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    // 2. Homepage shows the favorites section with the saved place.
    await page.goto('');
    const favSection = page.locator('#fav-section');
    const favGrid = page.locator('#fav-grid');
    await expect(favSection).toBeVisible();
    await expect(favGrid).toContainText('Ciudad de México');

    // 3. Persistence across reload.
    await page.reload();
    await expect(page.locator('#fav-section')).toBeVisible();
    await expect(page.locator('#fav-grid')).toContainText('Ciudad de México');

    // 4. Remove via the ✕ button → section hides again.
    await page
      .locator('#fav-grid')
      .getByRole('button', { name: 'Quitar de favoritos' })
      .first()
      .click();
    await expect(page.locator('#fav-section')).toBeHidden();
  });
});
