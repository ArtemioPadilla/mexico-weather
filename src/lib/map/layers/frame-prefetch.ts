/**
 * Story 21.3 — frame prefetch for the raster-tile timeline layers
 * (satellite GIBS, radar RainViewer).
 *
 * While the loop plays, the tiles the viewport needs for the next N
 * frames are fetched ahead with `Image()` — the exact URLs MapLibre
 * will ask for (same template, same z/x/y), so when the frame arrives
 * the browser answers from its HTTP cache and the swap is instant.
 *
 * Two layers:
 *  - pure geometry: `coveringTileZoom`, `visibleTileCoords`,
 *    `fillTileTemplate`, `upcomingFrames` (no DOM, no map);
 *  - `createFramePrefetcher`: a scheduler over an injected `TileLoader`
 *    (the default one is `imageTileLoader()`), so the policy — N frames,
 *    byte budget, cancellation, already-cached skip — is unit-tested
 *    without a browser.
 *
 * Budget semantics: `budgetBytes` caps the look-ahead WINDOW, i.e. the
 * summed (estimated) size of every tile of the frames scheduled ahead of
 * the playhead, cached or not. Frames are taken nearest first and the
 * first one that would overflow ends the window, so the budget always
 * wins over N (a 4K screen at a high zoom gets fewer frames ahead, never
 * more bytes). In a steady loop that means at most one frame's worth of
 * new requests per tick, and none once a lap has been cached.
 *
 * The caller (interactive-map.ts) never creates a prefetcher on the home
 * embed, nor when `navigator.connection.saveData` is on.
 */

/** Frames fetched ahead of the playhead. */
export const PREFETCH_FRAMES = 6;
/** Hard cap for the look-ahead window, in bytes. */
export const PREFETCH_BUDGET_BYTES = 4 * 1024 * 1024;
/** Size assumed for a tile whose real size is unknown (an `Image()` does
 *  not expose it, and Resource Timing only does with Timing-Allow-Origin).
 *  An assumption, not a measurement (the sandbox cannot reach GIBS or
 *  RainViewer): at 32 KB a 1280×720 view at z4.5 (32 GeoColor tiles)
 *  costs ~1 MB per frame, so the 4 MB window holds 4 frames there and
 *  the full 6 on a phone. Real sizes replace it whenever reported. */
export const EST_TILE_BYTES = 32 * 1024;
/** Parallel tile loads. During the loop the map's own tile fetches are
 *  HTTP-cache hits, so 8 in flight keep a ~30-tile frame inside one
 *  700 ms cadence (4 did not in the local probe: ~1.5 s per frame). */
export const PREFETCH_CONCURRENCY = 8;
/** Hard cap on tiles per frame: a pathological viewport (huge screen,
 *  antimeridian) never floods the queue. */
export const MAX_TILES_PER_FRAME = 96;

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface TileGridOpts {
  /** Source tileSize (256 GIBS, 512 RainViewer). */
  tileSize: number;
  /** Source maxzoom: past it MapLibre overscales the maxzoom tiles. */
  maxZoom: number;
  minZoom?: number;
  maxTiles?: number;
}

/** The tile zoom MapLibre requests for a raster source at `mapZoom`:
 *  its transform is 512-px based, raster sources round (not floor), and
 *  the result is clamped to the source's [minzoom, maxzoom]. */
export function coveringTileZoom(
  mapZoom: number,
  tileSize: number,
  maxZoom: number,
  minZoom = 0
): number {
  const z = Math.round(mapZoom + Math.log2(512 / tileSize));
  return Math.max(minZoom, Math.min(maxZoom, Math.max(0, z)));
}

function lngToTileX(lng: number, n: number): number {
  return Math.floor(((lng + 180) / 360) * n);
}

function latToTileY(lat: number, n: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const r = (clamped * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return Math.floor(y);
}

/** Tile coordinates covering `bounds` at the zoom MapLibre would use,
 *  nearest-the-centre first (the first frames of a budget-cut window
 *  still cover what the eye looks at). x wraps around the antimeridian;
 *  y is clamped to the Web-Mercator range. */
export function visibleTileCoords(
  bounds: TileBounds,
  mapZoom: number,
  opts: TileGridOpts
): TileCoord[] {
  const z = coveringTileZoom(
    mapZoom,
    opts.tileSize,
    opts.maxZoom,
    opts.minZoom ?? 0
  );
  const n = 2 ** z;
  const x0 = lngToTileX(bounds.west, n);
  let x1 = lngToTileX(bounds.east, n);
  if (x1 < x0) x1 += n; // bounds crossing the antimeridian
  // Cap the span at one world width.
  x1 = Math.min(x1, x0 + n - 1);
  const y0 = Math.max(0, latToTileY(bounds.north, n));
  const y1 = Math.min(n - 1, latToTileY(bounds.south, n));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const out: Array<TileCoord & { d: number }> = [];
  const seen = new Set<string>();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const wx = ((x % n) + n) % n;
      const k = `${wx}/${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ z, x: wx, y, d: (x - cx) ** 2 + (y - cy) ** 2 });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out
    .slice(0, opts.maxTiles ?? MAX_TILES_PER_FRAME)
    .map(({ z: tz, x, y }) => ({ z: tz, x, y }));
}

/** `{z}/{x}/{y}` template → concrete URL (any placeholder order). */
export function fillTileTemplate(template: string, c: TileCoord): string {
  return template
    .replace('{z}', String(c.z))
    .replace('{x}', String(c.x))
    .replace('{y}', String(c.y));
}

/** The next `n` frame indices the loop will show after `current`, with
 *  the same wrap rule as the timeline player: past the loop window's
 *  end (or outside it) the next frame is its start. Never repeats an
 *  index and never includes `current`. */
export function upcomingFrames(
  current: number,
  frameCount: number,
  n: number,
  range?: [number, number]
): number[] {
  if (frameCount < 2 || n <= 0) return [];
  let [lo, hi] = range ?? [0, frameCount - 1];
  lo = Math.max(0, Math.min(lo, frameCount - 1));
  hi = Math.max(lo, Math.min(hi, frameCount - 1));
  const out: number[] = [];
  let cur = current;
  for (let step = 0; step < n; step++) {
    const next = cur < lo || cur >= hi ? lo : cur + 1;
    if (next === current || out.includes(next)) break;
    out.push(next);
    cur = next;
  }
  return out;
}

/** One tile fetch. `promise` resolves with the byte size when known
 *  (undefined otherwise) and rejects on a load error; `cancel` aborts it
 *  (the promise may then never settle). */
export interface TileLoad {
  promise: Promise<number | undefined | void>;
  cancel: () => void;
}
export type TileLoader = (url: string) => TileLoad;

/** Encoded size of a finished load from Resource Timing, when the
 *  server allows it (`Timing-Allow-Origin`); undefined otherwise, and
 *  the scheduler falls back to EST_TILE_BYTES. */
function transferredBytes(url: string): number | undefined {
  try {
    const entries = performance.getEntriesByName(url);
    const last = entries[entries.length - 1] as
      PerformanceResourceTiming | undefined;
    const size = last?.encodedBodySize ?? 0;
    return size > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

/** Browser loader: `new Image()` with `crossOrigin = 'anonymous'` so the
 *  request is CORS-mode, like MapLibre's own tile fetch — the response
 *  lands in the HTTP cache under the same terms the map will ask for. */
export function imageTileLoader(): TileLoader {
  return (url) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const promise = new Promise<number | undefined>((resolve, reject) => {
      img.onload = (): void => resolve(transferredBytes(url));
      img.onerror = (): void => reject(new Error(`tile failed: ${url}`));
    });
    img.src = url;
    return {
      promise,
      cancel: (): void => {
        img.onload = null;
        img.onerror = null;
        // Dropping the src aborts a pending image request in Chromium,
        // Firefox and WebKit.
        img.src = '';
      },
    };
  };
}

export interface PrefetchPlan {
  /** Identity of what the URLs depend on (layer, product, view). A new
   *  key cancels everything in flight for the old one. */
  key: string;
  /** Frame indices in play order, nearest first (`upcomingFrames`). */
  frames: number[];
  /** Tile URLs a frame needs in the current view. */
  urlsFor: (frameIndex: number) => string[];
}

export interface PrefetchStats {
  /** Loads started (prefetch + ensure). */
  requested: number;
  loaded: number;
  failed: number;
  cancelled: number;
}

export interface FramePrefetcher {
  /** (Re)plan the look-ahead window. Same key: queued tiles no longer
   *  wanted are dropped, in-flight ones finish. New key: cancel all. */
  schedule: (plan: PrefetchPlan) => void;
  /** Abort in-flight loads, clear the queue, settle waiters `false`. */
  cancel: () => void;
  /** Every URL is loaded (or failed for this key — nothing to wait for). */
  isCached: (urls: string[]) => boolean;
  /** Load whatever of `urls` is missing ahead of the queue (outside the
   *  budget: the frame is needed now). Resolves true once every URL has
   *  settled, false on timeout or cancel. */
  ensure: (urls: string[], timeoutMs?: number) => Promise<boolean>;
  /** URLs the scheduler would still fetch for the current plan (tests,
   *  probes). */
  pending: () => string[];
  stats: () => PrefetchStats;
}

export interface FramePrefetcherOpts {
  loader: TileLoader;
  n?: number;
  budgetBytes?: number;
  estTileBytes?: number;
  concurrency?: number;
  /** Loaded-URL memory (LRU). The HTTP cache holds the bytes; this only
   *  remembers what not to ask for again. */
  maxCachedUrls?: number;
}

interface Waiter {
  urls: string[];
  resolve: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createFramePrefetcher(
  opts: FramePrefetcherOpts
): FramePrefetcher {
  const n = opts.n ?? PREFETCH_FRAMES;
  const budget = opts.budgetBytes ?? PREFETCH_BUDGET_BYTES;
  const est = opts.estTileBytes ?? EST_TILE_BYTES;
  const concurrency = opts.concurrency ?? PREFETCH_CONCURRENCY;
  const maxCached = opts.maxCachedUrls ?? 4000;

  /** url → bytes (real when the loader knew, else the estimate). */
  const cached = new Map<string, number>();
  /** Failed for the current key: not retried until the key changes. */
  let failed = new Set<string>();
  const inflight = new Map<string, TileLoad>();
  let queue: string[] = [];
  /** URLs `ensure()` asked for: they stay at the head across replans. */
  let priority: string[] = [];
  let key: string | null = null;
  let waiters: Waiter[] = [];
  const st: PrefetchStats = {
    requested: 0,
    loaded: 0,
    failed: 0,
    cancelled: 0,
  };
  let epoch = 0;

  const settled = (u: string): boolean => cached.has(u) || failed.has(u);

  function remember(url: string, bytes: number): void {
    cached.delete(url);
    cached.set(url, bytes);
    while (cached.size > maxCached) {
      const oldest = cached.keys().next().value;
      if (oldest === undefined) break;
      cached.delete(oldest);
    }
  }

  function checkWaiters(): void {
    if (!waiters.length) return;
    const still: Waiter[] = [];
    for (const w of waiters) {
      if (w.urls.every(settled)) {
        if (w.timer) clearTimeout(w.timer);
        w.resolve(true);
      } else {
        still.push(w);
      }
    }
    waiters = still;
  }

  function pump(): void {
    while (inflight.size < concurrency && queue.length) {
      const url = queue.shift()!;
      if (settled(url) || inflight.has(url)) continue;
      const myEpoch = epoch;
      const load = opts.loader(url);
      inflight.set(url, load);
      st.requested++;
      load.promise.then(
        (bytes) => {
          if (myEpoch !== epoch) return;
          inflight.delete(url);
          st.loaded++;
          remember(url, typeof bytes === 'number' && bytes > 0 ? bytes : est);
          checkWaiters();
          pump();
        },
        () => {
          if (myEpoch !== epoch) return;
          inflight.delete(url);
          st.failed++;
          failed.add(url);
          checkWaiters();
          pump();
        }
      );
    }
  }

  function cancel(): void {
    epoch++;
    for (const load of inflight.values()) {
      load.cancel();
      st.cancelled++;
    }
    inflight.clear();
    queue = [];
    priority = [];
    failed = new Set();
    key = null;
    const ws = waiters;
    waiters = [];
    for (const w of ws) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve(false);
    }
  }

  function plan(p: PrefetchPlan): string[] {
    const wanted = new Set<string>();
    let spent = 0;
    for (const i of p.frames.slice(0, n)) {
      const urls = p.urlsFor(i);
      const cost = urls.reduce((s, u) => s + (cached.get(u) ?? est), 0);
      if (spent + cost > budget) break;
      spent += cost;
      for (const u of urls) {
        if (!settled(u) && !inflight.has(u)) wanted.add(u);
      }
    }
    return [...wanted];
  }

  function withPriority(rest: string[]): string[] {
    priority = priority.filter((u) => !settled(u) && !inflight.has(u));
    return [...priority, ...rest.filter((u) => !priority.includes(u))];
  }

  return {
    schedule: (p): void => {
      if (p.key !== key) {
        cancel();
        key = p.key;
      }
      // Priority (ensure) entries stay at the head; the rest is replanned.
      queue = withPriority(plan(p));
      pump();
    },
    cancel,
    isCached: (urls): boolean => urls.every(settled),
    ensure: (urls, timeoutMs = 3000): Promise<boolean> => {
      if (urls.every(settled)) return Promise.resolve(true);
      const missing = urls.filter((u) => !settled(u) && !inflight.has(u));
      priority = [...missing, ...priority.filter((u) => !missing.includes(u))];
      queue = withPriority(queue);
      return new Promise<boolean>((resolve) => {
        const w: Waiter = { urls, resolve, timer: null };
        w.timer = setTimeout(() => {
          waiters = waiters.filter((x) => x !== w);
          resolve(false);
        }, timeoutMs);
        waiters.push(w);
        pump();
      });
    },
    pending: (): string[] => [...inflight.keys(), ...queue],
    stats: (): PrefetchStats => ({ ...st }),
  };
}
