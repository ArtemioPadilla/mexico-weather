import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Story 7.1 — mobile UX audit.
 *
 * Survey every page family on a 360×640 portrait viewport (the
 * conservative end of common Android phones) and assert:
 *   - No horizontal overflow (body.scrollWidth <= viewport)
 *   - Every interactive (button, a, input) has tap target ≥44 px,
 *     excluding inline links in prose (WCAG 2.5.5/2.5.8 "inline" exception)
 *   - axe still reports 0 critical / 0 serious
 *
 * Uses a manual viewport + DPR + touch config rather than
 * Playwright's iPhone preset so we run on chromium (already
 * installed via the e2e suite) rather than webkit.
 */

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
  { name: 'forecast', url: 'forecast/?lat=19.43&lng=-99.13&name=CDMX&tz=America/Mexico_City' },
];

test.use({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

// Story 11.2 — the strict rule.
//
// The global rule below accepts >=44px in *either* axis and grants a
// parent-container escape hatch, which is why 36px-tall full-bleed nav
// links never failed it. These selectors are the controls a phone user
// actually touches, and they must clear 44px in *both* axes measured on
// the element itself. Listed explicitly so the rule can never silently
// widen or narrow.
const STRICT_SELECTORS: string[] = [
  '#mobile-menu summary',
  '#mobile-menu a[href]',
  'body > footer a[href]',
  '#tl-play',
  '#tl-prev',
  '#tl-next',
  '#mw-search-toggle',
  '#maploc',
  '#mw-settings summary',
  '#mw-info summary',
];

async function strictViolations(page: import('@playwright/test').Page) {
  return page.evaluate((selectors: string[]) => {
    const bad: Array<{ selector: string; w: number; h: number }> = [];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        // Not rendered at this viewport (no map on /clima, no site footer
        // on /mapa, collapsed <details> contents) — nothing to measure.
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 || r.height < 44) {
          bad.push({
            selector: sel,
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }
    }
    return bad;
  }, STRICT_SELECTORS);
}

test.describe('mobile UX — 360x640 portrait', () => {
  for (const p of PAGES) {
    test(`${p.name}: no horizontal overflow`, async ({ page }) => {
      await page.goto(p.url);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        overflow.scrollWidth,
        `${p.url} overflows: ${overflow.scrollWidth}px > ${overflow.clientWidth}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test(`${p.name}: all visible interactives have ≥44px tap targets`, async ({
      page,
    }) => {
      await page.goto(p.url);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Tap-target rule: every visible interactive element should
      // have at least one dimension ≥44 px. WCAG 2.5.5 (AAA) — we
      // enforce the 44 px target as AA-equivalent because mobile
      // usability is critical for this site.
      const issues = await page.evaluate(() => {
        const els = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button:not([aria-hidden="true"]), a[href]:not([aria-hidden="true"]), input:not([type="hidden"]), [role="button"]',
          ),
        );
        // Interactive map embeds intentionally use dense controls
        // (matching Google Maps / zoom.earth conventions). The
        // tap-target rule still applies to /mapa page audits but
        // the embedded teaser on / shouldn't be the gate.
        const inMap = (el: Element): boolean =>
          !!el.closest('.maplibregl-map, [id^="home-map-"], [id="home-map"]') ||
          !!el.id?.startsWith('home-map-') ||
          !!el.id?.startsWith('layerbtn-');
        const small: Array<{ selector: string; w: number; h: number }> = [];
        for (const el of els) {
          // Skip map controls — dense by design, evaluated separately.
          if (inMap(el)) continue;
          // Skip elements that aren't actually rendered.
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // Skip elements with display:none in ancestors.
          if (el.offsetParent === null && el.tagName !== 'BODY') continue;
          // Skip sr-only patterns (skip links, etc). These are
          // intentionally 1×1 until focused — at which point the
          // focus: utilities make them full-size. Tapping requires
          // visibility, so an unfocused sr-only link can't be a
          // mobile target by definition.
          if (el.classList.contains('sr-only')) continue;
          // WCAG 2.5.5 and 2.5.8 both exempt *inline* targets — a link
          // inside a sentence or block of text, where the author cannot
          // change the size without changing the text. Without this,
          // prose links trip the rule purely on font metrics: the state
          // links on /volcan/<slug>/ measure 44.0px wide on macOS and
          // 43.x on the Linux CI runner, so the same commit passed
          // locally and failed in CI depending on which state names the
          // data refresh happened to link.
          const inlineInProse =
            getComputedStyle(el).display === 'inline' &&
            !!el.parentElement &&
            Array.from(el.parentElement.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
            );
          if (inlineInProse) continue;
          // Targets where the element is small but is inside a larger
          // touchable parent (the parent's hit area is what counts).
          // We check the parent <li> / wrapper for grid lists.
          // <label> wrappers around inputs also count — the label is
          // the actual hit area users tap.
          const parent = el.closest('li, label, .card, [data-card], [data-row]');
          const target = parent && parent.getBoundingClientRect();
          const effectiveW = target ? Math.max(r.width, target.width) : r.width;
          const effectiveH = target ? Math.max(r.height, target.height) : r.height;
          if (effectiveW < 44 && effectiveH < 44) {
            // Construct a useful selector for the report.
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const cls = el.className && typeof el.className === 'string'
              ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
              : '';
            small.push({
              selector: `${tag}${id}${cls}`,
              w: Math.round(r.width),
              h: Math.round(r.height),
            });
          }
        }
        return small;
      });

      if (issues.length > 0) {
        const report = issues
          .slice(0, 10)
          .map((i) => `  ${i.selector} (${i.w}x${i.h}px)`)
          .join('\n');
        throw new Error(
          `${p.url} has ${issues.length} interactive(s) under 44 px:\n${report}`,
        );
      }
    });
  }

  for (const p of PAGES) {
    test(`${p.name}: strict-set tap targets are ≥44px in both axes`, async ({
      page,
    }) => {
      await page.goto(p.url);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      // Open the mobile menu so its items are measurable.
      const summary = page.locator('#mobile-menu summary');
      if (await summary.count()) await summary.click();
      expect(await strictViolations(page)).toEqual([]);
    });
  }

  // Guard against the strict rule going vacuous. Every selector in
  // STRICT_SELECTORS is measured only if it matches a rendered element, so
  // an id rename would silently turn the assertions above into no-ops.
  // These counts are the observed truth at 360px, menu open.
  const STRICT_COVERAGE: Array<{ page: string; selector: string; min: number }> = [
    { page: '', selector: '#mobile-menu summary', min: 1 },
    { page: '', selector: '#mobile-menu a[href]', min: 11 },
    { page: '', selector: 'body > footer a[href]', min: 7 },
    { page: 'mapa', selector: '#tl-play', min: 1 },
    { page: 'mapa', selector: '#tl-prev', min: 1 },
    { page: 'mapa', selector: '#tl-next', min: 1 },
    { page: 'mapa', selector: '#mw-search-toggle', min: 1 },
    { page: 'mapa', selector: '#maploc', min: 1 },
    { page: 'mapa', selector: '#mw-settings summary', min: 1 },
    { page: 'mapa', selector: '#mw-info summary', min: 1 },
  ];

  for (const pageUrl of ['', 'mapa']) {
    test(`${pageUrl || 'home'}: the strict rule actually measures its targets`, async ({
      page,
    }) => {
      await page.goto(pageUrl);
      await page.waitForLoadState('domcontentloaded');
      if (pageUrl === 'mapa') {
        await expect(page.locator('#layerbtn-base')).toBeVisible();
      }
      const summary = page.locator('#mobile-menu summary');
      if (await summary.count()) await summary.click();
      for (const c of STRICT_COVERAGE.filter((x) => x.page === pageUrl)) {
        const rendered = await page.evaluate(
          (sel) =>
            Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            }).length,
          c.selector,
        );
        expect(rendered, `${c.selector} matched nothing — strict rule is vacuous`)
          .toBeGreaterThanOrEqual(c.min);
      }
    });
  }

  // /mapa deliberately stays out of PAGES: its no-scroll design and dense
  // controls would fail the overflow and global rules for unrelated
  // reasons. The strict set still applies to it.
  //
  // Coverage limit: this runs with the layer rail's hidden-below-sm
  // controls collapsed, so anything `hidden sm:*` is display:none and
  // skipped by the zero-size guard above.
  test('mapa: mobile-visible chrome meets the strict rule', async ({ page }) => {
    await page.goto('mapa');
    await expect(page.locator('#layerbtn-base')).toBeVisible(); // rail wired up
    expect(await strictViolations(page)).toEqual([]);
  });

  test('home: axe still passes at mobile viewport', async ({ page }) => {
    await page.goto('');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking).toEqual([]);
  });
});
