import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Story 11.1 — the mobile menu shipped in #296 with no test coverage at all.
 *
 * Acceptance: below 640px, every top-level destination is reachable from
 * any page — including /mapa, which passes noFooter and therefore has no
 * footer links either.
 */

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

const DESTINATIONS = [
  { label: 'Inicio', path: 'mexico-weather/' },
  { label: 'Mapa', path: 'mapa' },
  { label: 'Ciudades', path: 'clima/' },
  { label: 'Playas', path: 'playa/' },
  { label: 'Estados', path: 'estado/' },
  { label: 'Volcanes', path: 'volcan/' },
  { label: 'Pregunta', path: 'pregunta' },
  { label: 'Comparar', path: 'compara/' },
  { label: 'Huracanes', path: 'huracanes/' },
  { label: 'Privacidad', path: 'privacidad/' },
  { label: 'Feed RSS', path: 'rss.xml' },
];

test('every top-level destination is reachable from the mobile menu', async ({
  page,
}) => {
  await page.goto('');
  const menu = page.locator('#mobile-menu');
  for (const d of DESTINATIONS) {
    await menu.locator('summary').click();
    const link = menu.getByRole('link', { name: new RegExp(d.label, 'i') });
    await expect(link, `${d.label} missing from the mobile menu`).toBeVisible();
    await expect(link).toHaveAttribute('href', new RegExp(`${d.path}$`));
    await page.keyboard.press('Escape');
  }
});

test('the mobile menu is the only nav path on /mapa (noFooter)', async ({ page }) => {
  await page.goto('mapa');
  // NOT `page.locator('footer')`: FeedbackFAB renders a <footer> inside its
  // <dialog> on every page, so a count-0 assertion would fail for an
  // unrelated reason. Target the site footer's own links instead.
  await expect(
    page.locator('body > footer').getByRole('link', { name: /Privacidad/i }),
  ).toHaveCount(0);
  await page.locator('#mobile-menu summary').click();
  const menu = page.locator('#mobile-menu');
  for (const label of ['Huracanes', 'Comparar', 'Privacidad']) {
    await expect(
      menu.getByRole('link', { name: new RegExp(label, 'i') }),
      `${label} unreachable on /mapa at 360px`,
    ).toBeVisible();
  }
});

test('Escape closes the menu and restores focus to the toggle', async ({ page }) => {
  await page.goto('');
  const summary = page.locator('#mobile-menu summary');
  await summary.click();
  await expect(page.locator('#mobile-menu')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-menu')).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
});

test('tabbing out of the menu closes it', async ({ page }) => {
  await page.goto('');
  const summary = page.locator('#mobile-menu summary');
  await summary.click();
  await expect(page.locator('#mobile-menu')).toHaveAttribute('open', '');
  // Shift+Tab from the summary moves focus out of the <details> entirely.
  await summary.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#mobile-menu')).not.toHaveAttribute('open', '');
});

test('axe is clean with the mobile menu open', async ({ page }) => {
  await page.goto('');
  await page.locator('#mobile-menu summary').click();
  await expect(page.locator('#mobile-menu')).toHaveAttribute('open', '');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking).toEqual([]);
});
