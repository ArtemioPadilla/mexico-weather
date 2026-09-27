/**
 * Story 21.4 — loading skeleton reveal.
 *
 * The map root (`.im-root`) paints a dark gradient + shimmer through a
 * CSS-only `::before` pseudo-element (see src/styles/global.css) from the
 * very first HTML byte, so no embed ever shows a flat gray rectangle
 * while MapLibre boots and the first tiles decode. This module owns the
 * one JS decision: WHEN to fade it out. It adds `MAP_READY_CLASS` to the
 * root on the first `sourcedata` event that reports `isSourceLoaded`
 * (the exact moment a tile batch finished decoding), on `load` as a
 * belt, and after `fallbackMs` as braces — a map whose tiles never
 * arrive (offline, CDN down) must not hide its chrome forever.
 *
 * Kept out of interactive-map.ts so every map instance (home embed,
 * /mapa, layer pages, forecast embed) shares the behaviour and it can be
 * tested in isolation with jsdom.
 */

/** Class the CSS keys the fade on. */
export const MAP_READY_CLASS = 'im-ready';

/** Selector of the element that paints the skeleton. */
export const MAP_ROOT_SELECTOR = '.im-root';

/** Ceiling before the skeleton is dropped regardless of tile state. */
export const SKELETON_FALLBACK_MS = 8000;

export interface SourceDataEventLike {
  isSourceLoaded?: boolean;
  sourceId?: string;
}

/** Pure: does this `sourcedata` event mean "pixels are on the canvas"? */
export function revealsSkeleton(e: SourceDataEventLike): boolean {
  return e.isSourceLoaded === true;
}

/** The `.im-root` that owns a MapLibre container (or the container itself
 *  when it IS the root). Null when the map is mounted outside the Astro
 *  component. */
export function findMapRoot(container: Element | null): HTMLElement | null {
  return (container?.closest(MAP_ROOT_SELECTOR) as HTMLElement | null) ?? null;
}

export interface SkeletonReveal {
  /** Feed every `sourcedata` event; reveals on the first loaded one. */
  onSourceData: (e: SourceDataEventLike) => void;
  /** Reveal now (idempotent). Used for `load` and the fallback timer. */
  reveal: () => void;
  /** True once the class has been added. */
  readonly revealed: boolean;
  /** Clear the fallback timer (call from the map's destroy()). */
  dispose: () => void;
}

export interface SkeletonRevealOptions {
  fallbackMs?: number;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

/**
 * Attach the reveal to a root. `root` null → a no-op controller, so the
 * caller never has to branch.
 */
export function createSkeletonReveal(
  root: HTMLElement | null,
  opts: SkeletonRevealOptions = {}
): SkeletonReveal {
  const fallbackMs = opts.fallbackMs ?? SKELETON_FALLBACK_MS;
  const setT =
    opts.setTimeout ??
    ((fn: () => void, ms: number): number => window.setTimeout(fn, ms));
  const clearT =
    opts.clearTimeout ?? ((id: number): void => window.clearTimeout(id));
  let revealed = false;
  let timer: number | null = null;

  const reveal = (): void => {
    if (revealed) return;
    revealed = true;
    if (timer != null) {
      clearT(timer);
      timer = null;
    }
    try {
      root?.classList.add(MAP_READY_CLASS);
    } catch {
      /* detached root — nothing to paint on */
    }
  };

  if (root && fallbackMs > 0) timer = setT(reveal, fallbackMs);

  return {
    onSourceData: (e): void => {
      if (revealsSkeleton(e)) reveal();
    },
    reveal,
    get revealed(): boolean {
      return revealed;
    },
    dispose: (): void => {
      if (timer != null) {
        clearT(timer);
        timer = null;
      }
    },
  };
}
