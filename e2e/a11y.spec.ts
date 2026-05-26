import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Story 8.1 — a11y audit refresh.
 *
 * One test per page family asserting 0 critical / 0 serious axe
 * violations. Tests fail with the full violation report (selector
 * + help text) when something regresses.
 *
 * Tags: wcag2a, wcag2aa, wcag21a, wcag21aa. Catches the most-cited
 * findings. Note: we explicitly do NOT include 'best-practice' tag
 * — those are advisory, not blocking, and tend to flag stylistic
 * choices like 'use unique landmark labels' that are subjective.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Page {
  name: string;
  url: string;
}

const PAGES: Page[] = [
  { name: 'home', url: '' },
  { name: 'clima/cdmx', url: 'clima/cdmx/' },
  { name: 'playa/cancun', url: 'playa/cancun/' },
  { name: 'estado/jalisco', url: 'estado/jalisco/' },
  { name: 'volcan/popocatepetl', url: 'volcan/popocatepetl/' },
  { name: 'clima/ index', url: 'clima/' },
  { name: 'playa/ index', url: 'playa/' },
  { name: 'estado/ index', url: 'estado/' },
  { name: 'volcan/ index', url: 'volcan/' },
  { name: 'forecast', url: 'forecast/?lat=19.43&lng=-99.13&name=Ciudad%20de%20M%C3%A9xico&tz=America/Mexico_City' },
  { name: 'privacidad', url: 'privacidad/' },
];

test.describe('a11y audit — 0 critical / 0 serious', () => {
  for (const p of PAGES) {
    test(`${p.name} has no critical or serious WCAG violations`, async ({ page }) => {
      await page.goto(p.url);
      // Wait long enough for hydration-driven widgets (SmnAvisos,
      // city snapshot, alert ribbon, badges) to render. Using
      // `domcontentloaded` + a short settle delay rather than
      // `networkidle` — /forecast keeps long-lived fetches alive
      // and `networkidle` never fires within Playwright's default
      // timeout.
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);

      const results = await new AxeBuilder({ page })
        .withTags(TAGS)
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (blocking.length > 0) {
        const report = blocking
          .map((v) => {
            const targets = v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join('\n      ');
            return (
              `\n  [${v.impact}] ${v.id}: ${v.help}\n` +
              `    help: ${v.helpUrl}\n` +
              `    targets:\n      ${targets}`
            );
          })
          .join('\n');
        throw new Error(
          `${blocking.length} blocking a11y violation(s) on ${p.url}:${report}`,
        );
      }

      expect(blocking).toEqual([]);
    });
  }
});

test.describe('a11y audit — /mapa (interactive, slower)', () => {
  // /mapa is heavier (MapLibre, layer rail, timeline) so it gets its
  // own slower test with the same assertions.
  test('mapa has no critical or serious WCAG violations', async ({ page }) => {
    await page.goto('mapa/');
    // Give MapLibre time to render before scanning.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    const results = await new AxeBuilder({ page })
      .withTags(TAGS)
      // The MapLibre canvas itself is a known-unauditable widget;
      // exclude it from the scan rather than ship a fake aria
      // shim. The page's surrounding controls (search, layer rail,
      // timeline) are still audited.
      .exclude('.maplibregl-canvas-container')
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (blocking.length > 0) {
      const report = blocking
        .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
        .join('\n  ');
      throw new Error(`/mapa a11y violations:\n  ${report}`);
    }
    expect(blocking).toEqual([]);
  });
});
