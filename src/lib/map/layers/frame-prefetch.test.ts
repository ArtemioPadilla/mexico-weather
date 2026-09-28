import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EST_TILE_BYTES,
  PREFETCH_BUDGET_BYTES,
  PREFETCH_FRAMES,
  coveringTileZoom,
  createFramePrefetcher,
  fillTileTemplate,
  upcomingFrames,
  visibleTileCoords,
  type TileLoader,
} from './frame-prefetch';

/** Loader whose loads settle only when the test says so. */
function manualLoader(): {
  loader: TileLoader;
  started: string[];
  cancelled: string[];
  resolve: (url: string, bytes?: number) => Promise<void>;
  reject: (url: string) => Promise<void>;
} {
  const started: string[] = [];
  const cancelled: string[] = [];
  const pending = new Map<
    string,
    { res: (b?: number) => void; rej: (e: Error) => void }
  >();
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    started,
    cancelled,
    loader: (url) => {
      started.push(url);
      const promise = new Promise<number | undefined>((res, rej) => {
        pending.set(url, { res, rej });
      });
      return {
        promise,
        cancel: () => {
          cancelled.push(url);
        },
      };
    },
    resolve: async (url, bytes) => {
      pending.get(url)?.res(bytes);
      await flush();
    },
    reject: async (url) => {
      pending.get(url)?.rej(new Error('x'));
      await flush();
    },
  };
}

/** 2 tiles per frame: `f<i>-a`, `f<i>-b`. */
const urlsFor = (i: number): string[] => [`f${i}-a`, `f${i}-b`];

describe('coveringTileZoom', () => {
  it('matches MapLibre: 512-px transform, rounded, clamped to the source', () => {
    expect(coveringTileZoom(4.5, 256, 7)).toBe(6); // round(5.5)
    expect(coveringTileZoom(4.4, 256, 7)).toBe(5);
    expect(coveringTileZoom(4.5, 512, 10)).toBe(5); // round(4.5)
    expect(coveringTileZoom(9.2, 256, 7)).toBe(7); // overscaled past maxzoom
    expect(coveringTileZoom(-1, 512, 10)).toBe(0);
  });
});

describe('visibleTileCoords', () => {
  it('covers Mexico at z4.5 with the z6 GIBS tiles, centre first', () => {
    const tiles = visibleTileCoords(
      { west: -118, south: 14, east: -86, north: 33 },
      4.5,
      { tileSize: 256, maxZoom: 7 }
    );
    expect(tiles.every((t) => t.z === 6)).toBe(true);
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    // lng -118 → x 11, lng -86 → x 16; lat 33 → y 25, lat 14 → y 29.
    expect(Math.min(...xs)).toBe(11);
    expect(Math.max(...xs)).toBe(16);
    expect(Math.min(...ys)).toBe(25);
    expect(Math.max(...ys)).toBe(29);
    expect(tiles).toHaveLength(6 * 5);
    // Nearest the centre (x 13.5, y 27) comes first.
    expect([13, 14]).toContain(tiles[0].x);
    expect(tiles[0].y).toBe(27);
  });

  it('wraps x across the antimeridian and caps the count', () => {
    const tiles = visibleTileCoords(
      { west: 170, south: -10, east: -170, north: 10 },
      3,
      { tileSize: 512, maxZoom: 10 }
    );
    const xs = new Set(tiles.map((t) => t.x));
    expect(xs.has(7)).toBe(true); // 170°E at z3
    expect(xs.has(0)).toBe(true); // -170° at z3
    expect(tiles.every((t) => t.x >= 0 && t.x < 8)).toBe(true);
    const capped = visibleTileCoords(
      { west: -180, south: -85, east: 179.9, north: 85 },
      6,
      { tileSize: 256, maxZoom: 7, maxTiles: 10 }
    );
    expect(capped).toHaveLength(10);
  });
});

describe('fillTileTemplate', () => {
  it('fills GIBS ({z}/{y}/{x}) and RainViewer ({z}/{x}/{y}) templates', () => {
    const c = { z: 6, x: 13, y: 27 };
    expect(fillTileTemplate('https://g/L7/{z}/{y}/{x}.png', c)).toBe(
      'https://g/L7/6/27/13.png'
    );
    expect(fillTileTemplate('https://rv/512/{z}/{x}/{y}/4/1_1.png', c)).toBe(
      'https://rv/512/6/13/27/4/1_1.png'
    );
  });
});

describe('upcomingFrames', () => {
  it('walks forward and wraps inside the loop window like the player', () => {
    expect(upcomingFrames(3, 10, 4)).toEqual([4, 5, 6, 7]);
    expect(upcomingFrames(8, 10, 4)).toEqual([9, 0, 1, 2]);
    expect(upcomingFrames(6, 10, 4, [5, 7])).toEqual([7, 5]);
    // Outside the window: the next frame is its start.
    expect(upcomingFrames(9, 10, 2, [2, 5])).toEqual([2, 3]);
    expect(upcomingFrames(0, 1, 6)).toEqual([]);
  });
});

describe('createFramePrefetcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefetches at most N frames ahead (default 6)', () => {
    expect(PREFETCH_FRAMES).toBe(6);
    const l = manualLoader();
    const p = createFramePrefetcher({ loader: l.loader, concurrency: 100 });
    p.schedule({
      key: 'k',
      frames: upcomingFrames(0, 20, 10),
      urlsFor,
    });
    const frames = new Set(l.started.map((u) => u.split('-')[0]));
    expect([...frames]).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
    expect(l.started).toHaveLength(12);
  });

  it('stops at the byte budget: the frame that would overflow is not fetched', () => {
    const l = manualLoader();
    // 2 tiles × 1000 B per frame; 5000 B fits 2 whole frames, not 3.
    const p = createFramePrefetcher({
      loader: l.loader,
      estTileBytes: 1000,
      budgetBytes: 5000,
      concurrency: 100,
    });
    p.schedule({ key: 'k', frames: [1, 2, 3, 4], urlsFor });
    expect(l.started).toEqual(['f1-a', 'f1-b', 'f2-a', 'f2-b']);
    expect(PREFETCH_BUDGET_BYTES).toBe(4 * 1024 * 1024);
    expect(EST_TILE_BYTES).toBeGreaterThan(0);
  });

  it('counts real sizes reported by the loader against the budget', async () => {
    const l = manualLoader();
    const p = createFramePrefetcher({
      loader: l.loader,
      estTileBytes: 1000,
      budgetBytes: 5000,
      concurrency: 100,
    });
    p.schedule({ key: 'k', frames: [1], urlsFor });
    await l.resolve('f1-a', 3000);
    await l.resolve('f1-b', 1500);
    // f1 now weighs 4500 B: f2 (2000 B estimated) no longer fits.
    p.schedule({ key: 'k', frames: [1, 2], urlsFor });
    expect(l.started).toEqual(['f1-a', 'f1-b']);
  });

  it('respects the concurrency cap and drains the queue as loads land', async () => {
    const l = manualLoader();
    const p = createFramePrefetcher({ loader: l.loader, concurrency: 2 });
    p.schedule({ key: 'k', frames: [1, 2], urlsFor });
    expect(l.started).toEqual(['f1-a', 'f1-b']);
    expect(p.pending()).toEqual(['f1-a', 'f1-b', 'f2-a', 'f2-b']);
    await l.resolve('f1-a');
    expect(l.started).toEqual(['f1-a', 'f1-b', 'f2-a']);
  });

  it('skips tiles already cached (a second lap requests nothing)', async () => {
    const l = manualLoader();
    const p = createFramePrefetcher({ loader: l.loader, concurrency: 100 });
    p.schedule({ key: 'k', frames: [1, 2], urlsFor });
    for (const u of [...l.started]) await l.resolve(u);
    expect(p.isCached(urlsFor(1))).toBe(true);
    expect(p.isCached(urlsFor(2))).toBe(true);
    expect(p.isCached(urlsFor(3))).toBe(false);
    const before = l.started.length;
    p.schedule({ key: 'k', frames: [1, 2, 3], urlsFor });
    expect(l.started.slice(before)).toEqual(['f3-a', 'f3-b']);
    // Same URLs under a new key (view came back): still cached.
    p.schedule({ key: 'k2', frames: [1, 2], urlsFor });
    expect(l.started).toHaveLength(before + 2);
    expect(p.stats().requested).toBe(6);
  });

  it('a new key (layer or view change) cancels everything in flight', () => {
    const l = manualLoader();
    const p = createFramePrefetcher({ loader: l.loader, concurrency: 2 });
    p.schedule({ key: 'satellite|view1', frames: [1, 2], urlsFor });
    expect(l.started).toEqual(['f1-a', 'f1-b']);
    p.schedule({
      key: 'satellite|view2',
      frames: [5],
      urlsFor: (i) => [`v2-${i}`],
    });
    expect(l.cancelled).toEqual(['f1-a', 'f1-b']);
    expect(l.started.slice(2)).toEqual(['v2-5']);
    expect(p.pending()).toEqual(['v2-5']);
  });

  it('cancel() aborts loads, empties the queue and ignores late results', async () => {
    const l = manualLoader();
    const p = createFramePrefetcher({ loader: l.loader, concurrency: 1 });
    p.schedule({ key: 'k', frames: [1, 2], urlsFor });
    p.cancel();
    expect(l.cancelled).toEqual(['f1-a']);
    expect(p.pending()).toEqual([]);
    await l.resolve('f1-a');
    // The cancelled load did not mark the URL cached.
    expect(p.isCached(['f1-a'])).toBe(false);
    expect(l.started).toEqual(['f1-a']);
  });

  it('a failed tile is not retried for the same key and does not block', async () => {
    const l = manualLoader();
    const p = createFramePrefetcher({ loader: l.loader, concurrency: 100 });
    p.schedule({ key: 'k', frames: [1], urlsFor });
    await l.reject('f1-a');
    await l.resolve('f1-b');
    expect(p.isCached(urlsFor(1))).toBe(true);
    p.schedule({ key: 'k', frames: [1], urlsFor });
    expect(l.started).toEqual(['f1-a', 'f1-b']);
    expect(p.stats().failed).toBe(1);
  });

  it('ensure() jumps the queue, resolves when settled, false on timeout/cancel', async () => {
    const l = manualLoader();
    const p = createFramePrefetcher({ loader: l.loader, concurrency: 1 });
    p.schedule({ key: 'k', frames: [1, 2], urlsFor });
    expect(l.started).toEqual(['f1-a']);
    let ok: boolean | null = null;
    void p.ensure(['f9-a'], 1000).then((v) => (ok = v));
    // A replan keeps the priority tile at the head.
    p.schedule({ key: 'k', frames: [1, 2], urlsFor });
    await l.resolve('f1-a');
    expect(l.started[1]).toBe('f9-a');
    await l.resolve('f9-a');
    expect(ok).toBe(true);
    // Already cached → immediate true.
    await expect(p.ensure(['f9-a'])).resolves.toBe(true);

    let late: boolean | null = null;
    void p.ensure(['never'], 500).then((v) => (late = v));
    await vi.advanceTimersByTimeAsync(501);
    expect(late).toBe(false);

    let aborted: boolean | null = null;
    void p.ensure(['also-never'], 5000).then((v) => (aborted = v));
    p.cancel();
    await Promise.resolve();
    expect(aborted).toBe(false);
  });
});
