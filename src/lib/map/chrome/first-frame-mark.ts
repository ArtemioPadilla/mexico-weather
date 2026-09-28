/**
 * Story 26.2 — "time to first satellite frame" as a User Timing mark.
 *
 * The UX metrics spec (e2e/ux-metrics.spec.ts) reads
 * `performance.getEntriesByName(FIRST_SATELLITE_FRAME_MARK)[0].startTime`:
 * milliseconds from navigation start to the moment the first satellite
 * frame's tiles are all on the canvas. The app sets the mark exactly once
 * per page, on the first `sourcedata` event that
 *
 *  - belongs to one of the weather raster sources (A/B slots, Story 21.3),
 *  - carries a decoded tile (`tile` present — a `metadata` event right
 *    after `addSource` reports `isSourceLoaded` with zero tiles requested),
 *  - reports the source loaded (no tile of that frame still in flight),
 *  - while satellite is the active layer (the same sources carry radar).
 *
 * Pure decision + an injected `performance` so it is unit-tested without a
 * browser; a missing / throwing User Timing API is a silent no-op.
 */

export const FIRST_SATELLITE_FRAME_MARK = 'mw:first-satellite-frame';

export interface FrameSourceDataEvent {
  sourceId?: string;
  isSourceLoaded?: boolean;
  sourceDataType?: string;
  tile?: unknown;
}

/** Pure: does this `sourcedata` event mean "a satellite frame is fully on
 *  the canvas"? */
export function completesSatelliteFrame(
  e: FrameSourceDataEvent,
  activeLayer: string,
  sourceIds: readonly string[]
): boolean {
  return (
    activeLayer === 'satellite' &&
    e.isSourceLoaded === true &&
    e.sourceDataType !== 'metadata' &&
    e.tile != null &&
    typeof e.sourceId === 'string' &&
    sourceIds.includes(e.sourceId)
  );
}

export interface MarkPerformance {
  mark(name: string): unknown;
  getEntriesByName(name: string, type?: string): ArrayLike<unknown>;
}

export interface FirstFrameMarkOpts {
  sourceIds: readonly string[];
  getActiveLayer: () => string;
  perf?: MarkPerformance | null;
}

export interface FirstFrameMark {
  /** Feed every `sourcedata` event; returns true when this call set the
   *  mark. */
  onSourceData(e: FrameSourceDataEvent): boolean;
  readonly marked: boolean;
}

export function createFirstFrameMark(opts: FirstFrameMarkOpts): FirstFrameMark {
  const perf =
    opts.perf !== undefined
      ? opts.perf
      : typeof performance !== 'undefined'
        ? performance
        : null;
  let marked = false;
  return {
    onSourceData(e) {
      if (marked || !perf) return false;
      if (!completesSatelliteFrame(e, opts.getActiveLayer(), opts.sourceIds))
        return false;
      marked = true;
      try {
        // One mark per document: a second map instance on the same page
        // (none today) must not move the number.
        if (perf.getEntriesByName(FIRST_SATELLITE_FRAME_MARK, 'mark').length)
          return false;
        perf.mark(FIRST_SATELLITE_FRAME_MARK);
        return true;
      } catch {
        return false;
      }
    },
    get marked() {
      return marked;
    },
  };
}
