/**
 * Layer rail layout — Story 22.2 (plan PARIDAD_VISUAL E22, "revelación
 * progresiva").
 *
 * The rail is a grid of icon + short-label tiles (3 columns from `sm`, one
 * column of icons below it). The active layer's block — its sub-options
 * and the opacity control — sits right under the grid row that holds the
 * active tile, spanning the whole row, so the variants read as belonging to
 * the layer the visitor just picked and nothing else takes a row.
 *
 * The overlays list became the second tab of the same panel: a filter
 * input plus the four most used overlays pinned first.
 *
 * Pure helpers only (no DOM), unit-tested in node; the e2e specs import
 * `railRowCount` to measure the "≤ 9 visible rows" acceptance.
 */

/** Columns of the desktop rail grid (`sm:grid-cols-3`). */
export const RAIL_COLUMNS_DESKTOP = 3;

/** Overlays pinned at the top of the overlays tab, in this order — the
 *  four most used (tropical systems, clouds, precipitation mode, wind
 *  animation), per the plan. */
export const PINNED_OVERLAYS = [
  'tropical',
  'clouds',
  'precipMode',
  'windOverlay',
] as const;

/**
 * Index of the tile after which the active block goes: the last tile of
 * the grid row that contains the active tile. -1 when there is no active
 * tile in the rail (e.g. an embed whose subset lacks the active layer).
 */
export function activeBlockAnchor(
  tileCount: number,
  activeIndex: number,
  columns: number
): number {
  if (tileCount <= 0 || activeIndex < 0 || activeIndex >= tileCount) return -1;
  const cols = Math.max(1, Math.floor(columns));
  const rowEnd = (Math.floor(activeIndex / cols) + 1) * cols - 1;
  return Math.min(rowEnd, tileCount - 1);
}

/** Minimal shape the overlay ordering/filter needs. */
export interface OverlayLike {
  id: string;
  label: string;
}

/**
 * Pinned overlays first (in `pinned` order, skipping ids that do not
 * exist), then every other overlay in its declared order. Never drops or
 * duplicates an entry.
 */
export function orderOverlays<T extends OverlayLike>(
  defs: ReadonlyArray<T>,
  pinned: ReadonlyArray<string>
): { pinned: T[]; rest: T[] } {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const head: T[] = [];
  const seen = new Set<string>();
  for (const id of pinned) {
    const d = byId.get(id);
    if (d && !seen.has(id)) {
      head.push(d);
      seen.add(id);
    }
  }
  return { pinned: head, rest: defs.filter((d) => !seen.has(d.id)) };
}

/** Lower-case, accent-free, trimmed — "Satélite" and "satelite" match. */
export function normalizeQuery(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Does an overlay label match the filter text? Empty query matches all.
 * Every whitespace-separated word must appear in the label (any order),
 * so "nubes sat" finds "Modo precipitación (satélite + nubes + radar)".
 */
export function overlayMatches(label: string, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const hay = normalizeQuery(label);
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/**
 * Number of visual rows among boxes (e.g. the visible controls of the
 * rail): boxes whose vertical centres lie within `tolerance` px of a row
 * already seen share it. Zero-size boxes are ignored.
 */
export function railRowCount(
  rects: ReadonlyArray<{ y: number; height: number; width?: number }>,
  tolerance = 4
): number {
  const centres = rects
    .filter((r) => r.height > 0 && (r.width === undefined || r.width > 0))
    .map((r) => r.y + r.height / 2)
    .sort((a, b) => a - b);
  let rows = 0;
  let last = Number.NEGATIVE_INFINITY;
  for (const c of centres) {
    if (c - last > tolerance) {
      rows++;
      last = c;
    }
  }
  return rows;
}
