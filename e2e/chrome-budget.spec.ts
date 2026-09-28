import { test, expect } from '@playwright/test';
import { CHROME_BUDGET } from '../src/lib/map/chrome/chrome-budget';
import { bootMap, measureStable } from './chrome-budget-helpers';

/**
 * Story 22.1 — the chrome budget as a test (plan PARIDAD_VISUAL §1.2, §5).
 *
 * Counts the interactive elements (button, a[href], input, select,
 * [role=button], summary) that are visible and overlap the map container on
 * a cold /mapa load, at desktop 1280×800 and phone 360×640. Two tests per
 * viewport:
 *
 *  - the BASELINE test asserts the exact number measured when the story
 *    shipped. It fails when a PR adds a control, and it fails when a story
 *    removes one — on purpose: each of Stories 22.2–22.5 lowers the number
 *    here and in the "Hoy" column of PLAN_PARIDAD_VISUAL §5, so the plan
 *    and the test never drift apart.
 *  - the BUDGET test (≤ 8 desktop, ≤ 5 mobile), a real `test()` since
 *    Story 22.5 closed the chrome diet (it was `test.fixme` until then).
 *
 * What is measured: every match of CHROME_SELECTOR outside the MapLibre
 * markers/popups/attribution (data and legal text, not controls we chose),
 * with a non-empty box and no `visibility: hidden`, whose box overlaps the
 * `#map-root` container and the viewport. The pure decision lives in
 * src/lib/map/chrome/chrome-budget.ts (unit-tested); the boot and the
 * measurement live in e2e/chrome-budget-helpers.ts (shared with the Story
 * 26.2 UX metrics spec); this file only asserts.
 *
 * State: first-visit welcome card pre-dismissed (a one-time dialog, not
 * chrome — the visual audit keeps it because it captures first impressions,
 * this test counts what stays). Satellite active and its loop running (the
 * Story 21.2 boot), nothing clicked. Tiles are mocked with the same 256×256
 * transparent PNG e2e/mapa.spec.ts uses so MapLibre fires `load` on runners
 * without Esri/GIBS access; the count is DOM state, so tile pixels never
 * matter.
 */

interface Variant {
  name: 'desktop' | 'mobile';
  viewport: { width: number; height: number };
  mobile: boolean;
  budget: number;
  /** Measured 2026-09-27 on this branch (Story 22.1, re-measured after the
   *  Story 21.2 satellite boot and on 2026-09-28 after the Story 22.2
   *  compact rail and the Story 22.3 tools menu, after the Story 22.4
   *  SMN counter and after the Story 22.5 chrome budget); see the
   *  per-variant comment. */
  baseline: number;
}

const VARIANTS: Variant[] = [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 800 },
    mobile: false,
    budget: CHROME_BUDGET.desktop,
    // Search, locate, the rail's 2 tabs (Capas /
    // Superposiciones — Story 22.2, in place of the overlays summary), 9
    // layer tiles, 3 satellite sub-options (GeoColor / Infrarrojo / Color
    // real) and the opacity range in the active layer's block, 8 timeline
    // controls (the 7 of the base layer + "Ver 10 días"), the ⋯ tools
    // menu, feedback FAB (the SMN counter only with avisos, Story 22.4).
    // 38 on the base layer (Story 22.1) → 42 since /mapa boots on
    // satellite (21.2) → 43 with the compact rail (22.2): the tab bar
    // costs one control more than the summary it replaced, while the rail
    // itself went from 15 visible rows to 7 → 32 with the one tools menu
    // (22.3): 2 snapshot + 3 measure pills, ⚙ and ℹ became one ⋯ button
    // (−4), and the 5 model segments show only with a forecast layer, not
    // on satellite (−5) → 28 with the back link moved into the ⋯ menu's
    // Info tab and no MapLibre +/−/compass buttons on /mapa (zoom by
    // scroll, pinch and keys; −4) → 27 with the always-on SMN pill
    // turned into a top-bar counter that hides on a quiet feed (22.4,
    // −1; +1 again while there are avisos) → 8 with the chrome budget
    // (22.5): the rail starts folded to its 2 tabs (−9 tiles, −3
    // sub-options, −opacity), the timeline's « ‹ › » Ahora fade in only on
    // hover/focus (−5) and the feedback button moved to the nav bar (−1).
    // Left: search, locate, ⋯, the 2 rail tabs, ▶, "Ver 10 días", scrubber.
    baseline: 8,
  },
  {
    name: 'mobile',
    viewport: { width: 360, height: 640 },
    mobile: true,
    budget: CHROME_BUDGET.mobile,
    // Same minus what `hidden sm:*` drops on a phone (the rail's tab bar
    // and active-layer block, day-skip/now/range), plus the Controles
    // trigger and "Ver 10 días" (satellite, Story 21.2). 26 on the base
    // layer (Story 22.1) → 27 since /mapa boots on satellite; unchanged by
    // the compact rail (Story 22.2) → 23 with the one tools menu (22.3):
    // the Distancia/Área/Mira pills (which leaked onto the phone map on
    // the first `idle`), ⚙ and ℹ became one ⋯ button (−4) → 19 with the
    // back link inside the ⋯ menu and no MapLibre nav buttons (−4) → 18
    // with the SMN pill turned into a counter hidden on a quiet feed (22.4)
    // → 5 with the chrome budget (22.5): the 9 layer icons, ‹ › and "Ver
    // 10 días" show with the Controles panel (now "Capas y controles"),
    // the feedback button sits in the nav bar. Left: search, locate, ⋯,
    // Controles, ▶.
    baseline: 5,
  },
];

for (const variant of VARIANTS) {
  test.describe(`chrome budget · ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      ...(variant.mobile
        ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
        : {}),
    });

    test(`/mapa ${variant.name}: interactive elements over the map match the recorded baseline (${variant.baseline})`, async ({
      page,
    }, testInfo) => {
      await bootMap(page);
      const over = await measureStable(page, variant, testInfo);
      expect(
        over.length,
        `${variant.name} chrome count changed (baseline ${variant.baseline}, now ${over.length}). ` +
          `Went up: a control was added over the map — move it behind ⋯ / ⚙ or drop it. ` +
          `Went down: good, record the new number in VARIANTS[].baseline here and in the "Hoy" column of docs/PLAN_PARIDAD_VISUAL.md §5. ` +
          `Elements: ${over.map((c) => c.id).join(', ')}`
      ).toBe(variant.baseline);
    });

    // Plan §1.2 / §2 E22 — real since Story 22.5 (compact rail 22.2, one
    // tools menu 22.3, SMN counter 22.4, `?` panel + chrome budget 22.5).
    test(`/mapa ${variant.name}: interactive elements over the map fit the budget (≤ ${variant.budget})`, async ({
      page,
    }, testInfo) => {
      await bootMap(page);
      const over = await measureStable(page, variant, testInfo);
      expect(
        over.length,
        `${variant.name} chrome over the map exceeds the plan §1.2 budget: ${over
          .map((c) => c.id)
          .join(', ')}`
      ).toBeLessThanOrEqual(variant.budget);
    });
  });
}
