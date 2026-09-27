/**
 * Chrome budget — Story 22.1, plan PARIDAD_VISUAL E22.
 *
 * "Chrome" is every interactive control floating over the map on /mapa:
 * rail buttons, timeline, tool pills, search, locate, settings, info, the
 * SMN pill… Plan §1.2 caps it at 8 controls on desktop and 5 on a phone;
 * everything else must be reachable in ≤ 2 taps. e2e/chrome-budget.spec.ts
 * measures the count on the real page and asserts the baseline so any story
 * that adds a control fails CI, and any story that removes one has to record
 * its new number.
 *
 * This module is the pure half: it takes rects already measured in the
 * browser and decides what counts. No DOM here, so it is unit-tested in
 * plain node and the spec can import it from outside the app bundle.
 */

/** Axis-aligned box in CSS pixels (what getBoundingClientRect yields). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element measured in the browser by the spec's collector. */
export interface ChromeCandidate {
  /** Stable handle for logs: `#id`, or `tag.class` when the element has no id. */
  id: string;
  rect: Rect;
  /**
   * Playwright's notion of visible, as `Element.checkVisibility()` reports
   * it: rendered (no `display: none`, not inside a closed `<details>` or
   * other `content-visibility: hidden` subtree), not `visibility: hidden`,
   * not `opacity: 0`, and with a non-empty box.
   */
  visible: boolean;
}

/**
 * What counts as a control. `[role=button]` catches the promoted markers
 * and any div-as-button; `summary` catches the `<details>` disclosures
 * (settings, info, overlays, the SMN pill) that Playwright's role queries
 * would otherwise miss.
 */
export const CHROME_SELECTOR =
  'button, a[href], input, select, [role="button"], summary';

/**
 * Not chrome: the preset-city pins are data on the map (zoom.earth draws
 * its own city markers too), their popups are transient, and MapLibre's
 * attribution link is a legal requirement rather than a control we choose.
 * Anything inside these subtrees is dropped before counting.
 */
export const CHROME_EXCLUDE_SELECTOR =
  '.maplibregl-marker, .maplibregl-popup, .maplibregl-ctrl-attrib';

/** Plan §1.2 / §5 targets. Stories 22.2–22.5 are the ones that reach them. */
export const CHROME_BUDGET = { desktop: 8, mobile: 5 } as const;

/** Strictly positive overlap area (touching edges do not count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * The candidates that count against the budget: visible, with a real box,
 * overlapping the map container, and (when a viewport is given) at least
 * partly on screen — a rail that has grown past the bottom of a phone
 * screen is not "visible chrome" for the person holding it.
 */
export function chromeOverMap(
  map: Rect,
  candidates: readonly ChromeCandidate[],
  viewport?: Rect
): ChromeCandidate[] {
  return candidates.filter(
    (c) =>
      c.visible &&
      rectsIntersect(c.rect, map) &&
      (viewport === undefined || rectsIntersect(c.rect, viewport))
  );
}

/** Count of `chromeOverMap()`; the number the spec logs and asserts. */
export function countChromeOverMap(
  map: Rect,
  candidates: readonly ChromeCandidate[],
  viewport?: Rect
): number {
  return chromeOverMap(map, candidates, viewport).length;
}
