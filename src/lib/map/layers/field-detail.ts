/**
 * Story 24.2 — local detail on demand.
 *
 * The national field is a fixed 32×24 grid over −130…−60° × −5…50°
 * (~2.3° between samples): at a city's zoom it is a smooth blob. From
 * zoom 6 on, the map asks Open-Meteo for a second 32×24 grid (768 points,
 * the same URL builder and the same ≤ 200-point chunks as the national
 * one) over the viewport, and the renderer draws that local grid inside
 * its bounds and the national one outside, blending the two over the
 * outer 12 % of the local box so there is no seam.
 *
 * Everything here is pure except {@link createFieldDetail}, whose timers
 * and fetch are injected (tests drive it with fakes):
 *
 * - {@link detailRequestFor}: which box to fetch for a view — sized by the
 *   integer zoom level (so zooming within a level reuses one grid), padded
 *   20 % per side (so a short pan stays inside it), snapped to a lattice
 *   (so nearby views share one cache key) and clipped to the national box.
 * - {@link detailCacheKey}: rounded box + level + variable + model.
 * - {@link detailWeight} / {@link mergeFieldValue}: the merge by bounds,
 *   mirrored by the WebGL shader, the canvas fallback and the tooltip.
 * - {@link createDetailCache}: a small LRU of fetched grids.
 */
import type { Bounds, FieldGrid, LngLat } from '../../mapfields';
import { parseUtcMs, viewportGrid } from '../../mapfields';

/** Below this zoom the national grid alone is drawn. */
export const FIELD_DETAIL_MIN_ZOOM = 6;
/** Past this level the box stops shrinking: at z9 the samples are already
 *  ~5 km apart, finer than the models behind Open-Meteo's best_match. */
export const FIELD_DETAIL_MAX_LEVEL = 9;
/** Same layout as the national grid: 768 points, 4 chunk requests. */
export const FIELD_DETAIL_COLS = 32;
export const FIELD_DETAIL_ROWS = 24;
/** Margin around the view, as a fraction of its size, per side. */
export const FIELD_DETAIL_PAD = 0.2;
/** Width of the blend band inside the local box, as a fraction of its
 *  size, per side. Smaller than the pad, so the view itself is fully
 *  local at an integer zoom. */
export const FIELD_DETAIL_FADE = 0.12;
/** moveend → fetch delay: a wheel zoom or a fling fires several. */
export const FIELD_DETAIL_DEBOUNCE_MS = 400;
/** Grids kept in memory (~0.5 MB each: 768 points × 72 hourly values). */
export const FIELD_DETAIL_CACHE_SIZE = 8;
/** A local grid that has not landed by then is aborted, so a hung
 *  request cannot pin its view: the next moveend asks again. */
export const FIELD_DETAIL_TIMEOUT_MS = 20_000;

/** What the camera shows. */
export interface DetailView {
  bounds: Bounds;
  zoom: number;
}

/** Which field the grid is for. */
export interface DetailIds {
  hourlyVar: string;
  model: string;
}

/** A box to fetch: its level, bounds and cache key. */
export interface DetailRequest {
  level: number;
  bounds: Bounds;
  key: string;
}

/** A fetched local grid. */
export interface DetailEntry extends DetailRequest {
  ids: DetailIds;
  grid: FieldGrid;
}

/** Integer zoom level a view fetches at, or null below the threshold. */
export function detailLevel(zoom: number): number | null {
  if (!Number.isFinite(zoom) || zoom < FIELD_DETAIL_MIN_ZOOM) return null;
  return Math.min(Math.floor(zoom), FIELD_DETAIL_MAX_LEVEL);
}

/** Lattice the box snaps to at `level` (degrees): 1.4° at z6, 0.7° at z7. */
export function detailQuantum(level: number): number {
  return 90 / 2 ** level;
}

function intersect(a: Bounds, b: Bounds): Bounds | null {
  const out = {
    west: Math.max(a.west, b.west),
    south: Math.max(a.south, b.south),
    east: Math.min(a.east, b.east),
    north: Math.min(a.north, b.north),
  };
  return out.east > out.west && out.north > out.south ? out : null;
}

const r4 = (v: number): number => Number(v.toFixed(4));

/** Cache key: variable, model, level and the box rounded to 0.001°. */
export function detailCacheKey(
  ids: DetailIds,
  level: number,
  b: Bounds
): string {
  const r = (v: number): string => v.toFixed(3);
  return [
    ids.hourlyVar,
    ids.model,
    `z${level}`,
    r(b.west),
    r(b.south),
    r(b.east),
    r(b.north),
  ].join('|');
}

/**
 * The local box for a view, or null when none applies (zoom below 6, a
 * degenerate view, or a view outside the national box).
 *
 * The box is the view's extent at the integer level (a view at z6.8 gets
 * the z6 box around its centre), plus {@link FIELD_DETAIL_PAD} per side,
 * with centre and half-sizes snapped to {@link detailQuantum}, clipped to
 * `national`.
 */
export function detailRequestFor(
  view: DetailView,
  national: Bounds,
  ids: DetailIds
): DetailRequest | null {
  const level = detailLevel(view.zoom);
  if (level === null) return null;
  const { west, south, east, north } = view.bounds;
  const w = east - west;
  const h = north - south;
  if (!(w > 0) || !(h > 0)) return null;
  const scale = 2 ** (view.zoom - level);
  const q = detailQuantum(level);
  const half = (size: number): number =>
    Math.max(
      q,
      Math.ceil(
        (((size * scale) / 2) * (1 + 2 * FIELD_DETAIL_PAD)) / q - 1e-9
      ) * q
    );
  const hw = half(w);
  const hh = half(h);
  const cx = Math.round((west + east) / 2 / q) * q;
  const cy = Math.round((south + north) / 2 / q) * q;
  const clipped = intersect(
    { west: cx - hw, south: cy - hh, east: cx + hw, north: cy + hh },
    national
  );
  if (!clipped) return null;
  const bounds: Bounds = {
    west: r4(clipped.west),
    south: r4(clipped.south),
    east: r4(clipped.east),
    north: r4(clipped.north),
  };
  // A sliver along the national edge is not worth 768 points.
  if (bounds.east - bounds.west < q || bounds.north - bounds.south < q)
    return null;
  return { level, bounds, key: detailCacheKey(ids, level, bounds) };
}

/** True when `outer` contains `inner` (1e-6° slack for rounding). */
export function boundsCover(outer: Bounds, inner: Bounds): boolean {
  const e = 1e-6;
  return (
    outer.west <= inner.west + e &&
    outer.south <= inner.south + e &&
    outer.east >= inner.east - e &&
    outer.north >= inner.north - e
  );
}

/** The part of `view` inside `national` (what a local box must cover). */
export function visiblePart(view: Bounds, national: Bounds): Bounds | null {
  return intersect(view, national);
}

/**
 * Weight of the local grid at (lng, lat): 0 outside `b`, 1 in its interior,
 * and a smoothstep across the outer `fade` of each side. The shader and
 * the canvas fallback evaluate the same function.
 */
export function detailWeight(
  lng: number,
  lat: number,
  b: Bounds,
  fade = FIELD_DETAIL_FADE
): number {
  const w = b.east - b.west;
  const h = b.north - b.south;
  if (!(w > 0) || !(h > 0)) return 0;
  const u = (lng - b.west) / w;
  const v = (lat - b.south) / h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const edge = (t: number): number => {
    const d = Math.min(t, 1 - t);
    const f = fade > 0 ? Math.min(1, Math.max(0, d) / fade) : 1;
    return f * f * (3 - 2 * f);
  };
  return edge(u) * edge(v);
}

/**
 * The merge by bounds for one point. `national` / `detail` are the two
 * interpolated values (null when that grid has no data there), `w` the
 * {@link detailWeight}. Both present ⇒ national + (detail − national)·w;
 * only the local one ⇒ its value with alpha `w` (it fades out instead of
 * ending in a hard edge); only the national one ⇒ it. Null ⇒ nothing.
 */
export function mergeFieldValue(
  national: number | null,
  detail: number | null,
  w: number
): { value: number; alpha: number } | null {
  if (detail !== null && w > 0) {
    if (national !== null)
      return { value: national + (detail - national) * w, alpha: 1 };
    return { value: detail, alpha: w };
  }
  if (national !== null) return { value: national, alpha: 1 };
  return null;
}

const hourIndexCache = new WeakMap<FieldGrid, Map<number, number>>();

/** Index of the hour `iso` in the local grid, −1 when it has none (the
 *  national grid may reach +10 d, the local one stops at +48 h). */
export function detailHourIndex(
  grid: FieldGrid,
  iso: string | undefined
): number {
  if (!iso) return -1;
  let idx = hourIndexCache.get(grid);
  if (!idx) {
    idx = new Map();
    grid.times.forEach((t, i) => idx!.set(parseUtcMs(t), i));
    hourIndexCache.set(grid, idx);
  }
  return idx.get(parseUtcMs(iso)) ?? -1;
}

/** The 768 sample points of a local box (rows south→north). */
export function detailPoints(b: Bounds): LngLat[] {
  return viewportGrid(b, FIELD_DETAIL_COLS, FIELD_DETAIL_ROWS);
}

export interface DetailCache {
  get(key: string): DetailEntry | undefined;
  set(entry: DetailEntry): void;
  /** Most recent entry at `level` for `ids` whose box contains `area`. */
  covering(
    area: Bounds,
    level: number,
    ids: DetailIds
  ): DetailEntry | undefined;
  size(): number;
  clear(): void;
}

/** Least-recently-used cache of local grids, `max` entries. */
export function createDetailCache(max = FIELD_DETAIL_CACHE_SIZE): DetailCache {
  const m = new Map<string, DetailEntry>();
  const touch = (e: DetailEntry): DetailEntry => {
    m.delete(e.key);
    m.set(e.key, e);
    return e;
  };
  return {
    get(key) {
      const e = m.get(key);
      return e ? touch(e) : undefined;
    },
    set(entry) {
      touch(entry);
      while (m.size > Math.max(1, max)) {
        const oldest = m.keys().next().value as string;
        m.delete(oldest);
      }
    },
    covering(area, level, ids) {
      const all = [...m.values()].reverse();
      const hit = all.find(
        (e) =>
          e.level === level &&
          e.ids.hourlyVar === ids.hourlyVar &&
          e.ids.model === ids.model &&
          boundsCover(e.bounds, area)
      );
      return hit ? touch(hit) : undefined;
    },
    size: () => m.size,
    clear: () => m.clear(),
  };
}

export interface FieldDetailDeps {
  /** Fetch + parse the grid for `points` (the map passes the same chunked
   *  Open-Meteo fetch as the national grid). Null or a throw ⇒ no detail. */
  load(
    points: LngLat[],
    ids: DetailIds,
    signal: AbortSignal
  ): Promise<FieldGrid | null>;
  /** The grid the renderer should merge changed (null ⇒ national only).
   *  Not called by {@link FieldDetail.cancel}. */
  onChange(entry: DetailEntry | null): void;
  /** navigator.connection.saveData — read on every update. */
  saveData?: () => boolean;
  debounceMs?: number;
  timeoutMs?: number;
  cacheSize?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface FieldDetail {
  /** Call on moveend and after the national grid loads. Uses a cached or
   *  covering grid at once; otherwise fetches after the debounce. */
  update(view: DetailView, national: Bounds, ids: DetailIds): void;
  /** Layer / variable / model change: drops the pending fetch (aborting
   *  one in flight) and the active grid, without calling onChange. The
   *  cache is kept. */
  cancel(): void;
  /** The grid to merge now, if any. */
  active(): DetailEntry | null;
  /** How many local grid fetches started (e2e / tests). */
  fetches(): number;
  destroy(): void;
}

/** The moveend-driven loader: debounce, abort, cache, saveData. */
export function createFieldDetail(deps: FieldDetailDeps): FieldDetail {
  const cache = createDetailCache(deps.cacheSize);
  const debounceMs = deps.debounceMs ?? FIELD_DETAIL_DEBOUNCE_MS;
  const timeoutMs = deps.timeoutMs ?? FIELD_DETAIL_TIMEOUT_MS;
  const setTimer =
    deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ??
    ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let active: DetailEntry | null = null;
  let timer: unknown = null;
  /** The box scheduled or in flight, and for which field. */
  let pending: { req: DetailRequest; ids: DetailIds } | null = null;
  let inflight: AbortController | null = null;
  let deadline: unknown = null;
  let started = 0;
  let destroyed = false;

  function setActive(e: DetailEntry | null): void {
    if (e === active) return;
    active = e;
    deps.onChange(e);
  }

  function stop(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (deadline !== null) clearTimer(deadline);
    deadline = null;
    inflight?.abort();
    inflight = null;
    pending = null;
  }

  async function run(req: DetailRequest, ids: DetailIds): Promise<void> {
    timer = null;
    const ac = new AbortController();
    inflight = ac;
    started++;
    deadline = setTimer(() => {
      deadline = null;
      if (inflight === ac) {
        inflight = null;
        pending = null;
      }
      ac.abort();
    }, timeoutMs);
    let grid: FieldGrid | null;
    try {
      grid = await deps.load(detailPoints(req.bounds), ids, ac.signal);
    } catch {
      grid = null;
    }
    // Superseded or timed out (inflight was cleared), or destroyed.
    if (inflight !== ac || destroyed) return;
    if (deadline !== null) clearTimer(deadline);
    deadline = null;
    inflight = null;
    pending = null;
    if (!grid || grid.points.length !== FIELD_DETAIL_COLS * FIELD_DETAIL_ROWS)
      return;
    const entry: DetailEntry = { ...req, ids: { ...ids }, grid };
    cache.set(entry);
    setActive(entry);
  }

  return {
    update(view, national, ids) {
      if (destroyed) return;
      const req =
        deps.saveData?.() === true
          ? null
          : detailRequestFor(view, national, ids);
      if (!req) {
        stop();
        setActive(null);
        return;
      }
      const area = visiblePart(view.bounds, national) ?? view.bounds;
      const hit = cache.get(req.key) ?? cache.covering(area, req.level, ids);
      if (hit) {
        stop();
        setActive(hit);
        return;
      }
      // A grid for another field is wrong everywhere; one for this field
      // at another spot is still right inside its box until the new one
      // lands.
      if (
        active &&
        (active.ids.hourlyVar !== ids.hourlyVar ||
          active.ids.model !== ids.model)
      )
        setActive(null);
      // The box already on its way still covers this view (a short pan
      // while it loads): let it land rather than abort it — an aborted
      // request has been paid for anyway.
      if (
        pending &&
        pending.req.level === req.level &&
        pending.ids.hourlyVar === ids.hourlyVar &&
        pending.ids.model === ids.model &&
        (pending.req.key === req.key || boundsCover(pending.req.bounds, area))
      )
        return;
      stop();
      const snapshot = { ...ids };
      pending = { req, ids: snapshot };
      timer = setTimer(() => void run(req, snapshot), debounceMs);
    },
    cancel() {
      stop();
      active = null;
    },
    active: () => active,
    fetches: () => started,
    destroy() {
      destroyed = true;
      stop();
      active = null;
      cache.clear();
    },
  };
}
