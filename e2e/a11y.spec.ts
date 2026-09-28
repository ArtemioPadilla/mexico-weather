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
  { name: 'alertas', url: 'alertas/' },
  { name: 'mapa/radar (layer page)', url: 'mapa/radar/' },
  { name: 'clima/cdmx', url: 'clima/cdmx/' },
  { name: 'playa/cancun', url: 'playa/cancun/' },
  { name: 'estado/jalisco', url: 'estado/jalisco/' },
  { name: 'volcan/popocatepetl', url: 'volcan/popocatepetl/' },
  { name: 'clima/ index', url: 'clima/' },
  { name: 'playa/ index', url: 'playa/' },
  { name: 'estado/ index', url: 'estado/' },
  { name: 'volcan/ index', url: 'volcan/' },
  {
    name: 'forecast',
    url: 'forecast/?lat=19.43&lng=-99.13&name=Ciudad%20de%20M%C3%A9xico&tz=America/Mexico_City',
  },
  { name: 'privacidad', url: 'privacidad/' },
];

test.describe('a11y audit — 0 critical / 0 serious', () => {
  for (const p of PAGES) {
    test(`${p.name} has no critical or serious WCAG violations`, async ({
      page,
    }) => {
      await page.goto(p.url);
      // Wait long enough for hydration-driven widgets (SmnAvisos,
      // city snapshot, alert ribbon, badges) to render. Using
      // `domcontentloaded` + a short settle delay rather than
      // `networkidle` — /forecast keeps long-lived fetches alive
      // and `networkidle` never fires within Playwright's default
      // timeout.
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
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
          `${blocking.length} blocking a11y violation(s) on ${p.url}:${report}`
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
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );
    if (blocking.length > 0) {
      const report = blocking
        .map(
          (v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`
        )
        .join('\n  ');
      throw new Error(`/mapa a11y violations:\n  ${report}`);
    }
    expect(blocking).toEqual([]);
  });

  // Story 22.3 — the ⋯ menu (a dialog popover with three tabs) is closed on
  // load, so the scan above never sees its content. Scan each tab open.
  test('mapa with the ⋯ tools menu open has no critical or serious WCAG violations', async ({
    page,
  }) => {
    await page.goto('mapa/');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#mw-tools-btn').click();
    await expect(page.locator('#mw-tools-panel')).toBeVisible();
    for (const tab of ['tools', 'settings', 'info']) {
      await page.locator(`#mw-tools-tab-${tab}`).click();
      const results = await new AxeBuilder({ page })
        .withTags(TAGS)
        .include('#mw-tools')
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      expect(
        blocking.map((v) => `${tab}: [${v.impact}] ${v.id}: ${v.help}`)
      ).toEqual([]);
    }
  });
  // Story 22.4 — the SMN counter's popover is closed on load too; serve a
  // feed with avisos (the counter hides on a quiet one) and scan it open.
  test('mapa with the SMN avisos popover open has no critical or serious WCAG violations', async ({
    page,
  }) => {
    const aviso = (link: string, severity: string) => ({
      title: `Aviso ${link}`,
      link: `https://smn.example/${link}.pdf`,
      pubDate: 'Sun, 27 Sep 2026 12:00:00 -0600',
      category: 'Aviso',
      severity,
    });
    await page.route('**/data/smn-by-state.json', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          metadata: { updated: new Date().toUTCString() },
          byState: { sonora: [aviso('a', 'critical'), aviso('b', 'warn')] },
          global: [aviso('c', 'info')],
        }),
      })
    );
    await page.goto('mapa/');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#mapa-smn-btn').click();
    await expect(
      page.locator('#mapa-smn-panel [data-smn-list] li')
    ).toHaveCount(3);
    const results = await new AxeBuilder({ page })
      .withTags(TAGS)
      .include('#mw-search-wrap')
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`)).toEqual([]);
  });

  // Story 22.5 — /mapa folds the layer rail to its tabs on load, so the
  // first scan never sees the tiles; and the `?` cheat-sheet is a modal
  // dialog. Scan the unfolded rail, then the open dialog.
  test('mapa with the rail unfolded and the `?` cheat-sheet open has no critical or serious WCAG violations', async ({
    page,
  }) => {
    await page.goto('mapa/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#layerbtn-base')).toBeAttached();
    await page.locator('#mw-layers-tab').click();
    await expect(page.locator('#layerbtn-radar')).toBeVisible();
    const blockingIn = async (sel: string): Promise<string[]> => {
      const results = await new AxeBuilder({ page })
        .withTags(TAGS)
        .include(sel)
        .analyze();
      return results.violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => `${sel}: [${v.impact}] ${v.id}: ${v.help}`);
    };
    expect(await blockingIn('.im-rail')).toEqual([]);

    await page.locator('#map canvas').click({ position: { x: 640, y: 400 } });
    await page.keyboard.press('?');
    await expect(page.locator('#mw-shortcuts')).toBeVisible();
    await expect(
      page.locator('#mw-shortcuts [data-shortcut]').first()
    ).toBeVisible();
    expect(await blockingIn('#mw-shortcuts')).toEqual([]);
  });
});

// Story 25.2 review — the /forecast embed's marker popup is MapLibre's, not
// InteractiveMap.astro's: it lives in `#fc-map` inside `.fc-map-wrap`, not in
// an `.im-root`, and it is closed on load, so the page scan above never saw
// it. A token-only link class once left it at 1.8:1 on a white popup. Open it
// in both themes and scan it; also compute the text contrast directly, since
// axe can report a translucent panel over a canvas as "incomplete" instead of
// a violation.
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAABPO1TCQAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('a11y audit — /forecast marker popup', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`forecast marker popup (${theme} theme) has no critical or serious WCAG violations`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {
          /* private mode — the media emulation still picks the theme */
        }
      }, theme);
      for (const host of [
        '**.arcgisonline.com/**',
        '**gibs.earthdata.nasa.gov/**',
      ]) {
        await page.route(host, (r) =>
          r.fulfill({
            status: 200,
            contentType: 'image/png',
            body: TRANSPARENT_PNG,
          })
        );
      }
      await page.goto(
        'forecast/?lat=19.43&lng=-99.13&name=Ciudad%20de%20M%C3%A9xico&tz=America/Mexico_City'
      );
      await page.waitForLoadState('domcontentloaded');
      if (theme === 'dark') {
        await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
      } else {
        await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
      }

      const marker = page.locator('#fc-map .maplibregl-marker[role=button]');
      await marker.scrollIntoViewIfNeeded({ timeout: 30_000 });
      await marker.click();
      const popup = page.locator('#fc-map .maplibregl-popup');
      await expect(popup).toBeVisible();
      await expect(popup.locator('a')).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(TAGS)
        .include('#fc-map .maplibregl-popup')
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      expect(
        blocking.map(
          (v) =>
            `${theme}: [${v.impact}] ${v.id}: ${v.help} — ${v.nodes
              .map((n) => n.target.join(' '))
              .join(', ')}`
        )
      ).toEqual([]);

      // Contrast of the name and the link against the popup panel (its
      // background is ≥ 0.97 opaque, so compositing it is negligible).
      const ratios = await popup.evaluate((el) => {
        const rgb = (c: string): number[] =>
          (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = ([r, g, b]: number[]): number => {
          const f = (v: number): number => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a: string, b: string): number => {
          const [l1, l2] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
          return (l1 + 0.05) / (l2 + 0.05);
        };
        const content = el.querySelector('.maplibregl-popup-content')!;
        const bg = getComputedStyle(content).backgroundColor;
        return Object.fromEntries(
          ['strong', 'a'].map((sel) => [
            sel,
            ratio(getComputedStyle(el.querySelector(sel)!).color, bg),
          ])
        );
      });
      expect(ratios.strong, `${theme}: name contrast`).toBeGreaterThanOrEqual(
        4.5
      );
      expect(ratios.a, `${theme}: link contrast`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
