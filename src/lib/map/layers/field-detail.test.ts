import { describe, expect, it, vi } from 'vitest';
import {
  FIELD_DETAIL_COLS,
  FIELD_DETAIL_DEBOUNCE_MS,
  FIELD_DETAIL_FADE,
  FIELD_DETAIL_MIN_ZOOM,
  FIELD_DETAIL_ROWS,
  FIELD_DETAIL_TIMEOUT_MS,
  boundsCover,
  createDetailCache,
  createFieldDetail,
  detailCacheKey,
  detailHourIndex,
  detailLevel,
  detailPoints,
  detailQuantum,
  detailRequestFor,
  detailWeight,
  mergeFieldValue,
  type DetailEntry,
  type DetailIds,
  type DetailView,
} from './field-detail';
import { FIELD_CHUNK_SIZE, type Bounds, type FieldGrid } from '../../mapfields';
import { bicubicValue, fillFieldImageData } from '../../mapraster';

const NATIONAL: Bounds = { west: -130, south: -5, east: -60, north: 50 };
const TEMP: DetailIds = { hourlyVar: 'temperature_2m', model: 'best_match' };

/** A 1280×800 view at `zoom` centred on (lng, lat), in degrees (the
 *  Mercator stretch is ignored: close enough for box arithmetic). */
function view(lng: number, lat: number, zoom: number): DetailView {
  const degPerPx = 360 / (256 * 2 ** zoom);
  const hw = (1280 / 2) * degPerPx;
  const hh = (800 / 2) * degPerPx * 0.95;
  return {
    zoom,
    bounds: {
      west: lng - hw,
      south: lat - hh,
      east: lng + hw,
      north: lat + hh,
    },
  };
}

function gridOver(
  b: Bounds,
  times: string[],
  fn: (lng: number, lat: number) => number | null
): FieldGrid {
  return {
    times,
    points: detailPoints(b).map((p) => ({
      lat: p.lat,
      lng: p.lng,
      values: times.map(() => fn(p.lng, p.lat)),
    })),
  };
}

describe('Story 24.2 — sub-grid bounds', () => {
  it('starts at zoom 6 and stops shrinking at level 9', () => {
    expect(FIELD_DETAIL_MIN_ZOOM).toBe(6);
    expect(detailLevel(5.99)).toBeNull();
    expect(detailLevel(Number.NaN)).toBeNull();
    expect(detailLevel(6)).toBe(6);
    expect(detailLevel(7.8)).toBe(7);
    expect(detailLevel(14)).toBe(9);
    expect(
      detailRequestFor(view(-99.13, 19.43, 5.5), NATIONAL, TEMP)
    ).toBeNull();
  });

  it('768 points: the national layout, in 4 URL-safe chunks', () => {
    const pts = detailPoints({ west: -100, south: 18, east: -98, north: 20 });
    expect(pts).toHaveLength(768);
    expect(FIELD_DETAIL_COLS * FIELD_DETAIL_ROWS).toBe(768);
    expect(Math.ceil(pts.length / FIELD_CHUNK_SIZE)).toBe(4);
  });

  it('covers the view with a margin, snapped to the level lattice', () => {
    const v = view(-99.13, 19.43, 7);
    const r = detailRequestFor(v, NATIONAL, TEMP)!;
    expect(r.level).toBe(7);
    expect(boundsCover(r.bounds, v.bounds)).toBe(true);
    const q = detailQuantum(7);
    for (const k of ['west', 'south', 'east', 'north'] as const) {
      const n = r.bounds[k] / q;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-3);
    }
    // Padded, but not wildly: ≤ 2× the view on each axis.
    const vw = v.bounds.east - v.bounds.west;
    const bw = r.bounds.east - r.bounds.west;
    expect(bw).toBeGreaterThan(vw * 1.3);
    expect(bw).toBeLessThan(vw * 2);
    // The view sits inside the blend band's inner edge: fully local.
    for (const [lng, lat] of [
      [v.bounds.west, v.bounds.south],
      [v.bounds.east, v.bounds.north],
      [-99.13, 19.43],
    ]) {
      expect(detailWeight(lng, lat, r.bounds)).toBe(1);
    }
  });

  it('a fractional zoom reuses its level box; the next level is finer', () => {
    const a = detailRequestFor(view(-99.13, 19.43, 7), NATIONAL, TEMP)!;
    const b = detailRequestFor(view(-99.13, 19.43, 7.7), NATIONAL, TEMP)!;
    const c = detailRequestFor(view(-99.13, 19.43, 8), NATIONAL, TEMP)!;
    expect(b.key).toBe(a.key);
    expect(c.key).not.toBe(a.key);
    expect(c.bounds.east - c.bounds.west).toBeLessThan(
      (a.bounds.east - a.bounds.west) * 0.6
    );
  });

  it('nearby views share a key; a pan of a screen does not', () => {
    const q = detailQuantum(7);
    const a = detailRequestFor(view(-99.13, 19.43, 7), NATIONAL, TEMP)!;
    const b = detailRequestFor(
      view(-99.13 + q * 0.3, 19.43, 7),
      NATIONAL,
      TEMP
    )!;
    const far = detailRequestFor(view(-89, 19.43, 7), NATIONAL, TEMP)!;
    expect(b.key).toBe(a.key);
    expect(far.key).not.toBe(a.key);
  });

  it('is clipped to the national box, and null outside it', () => {
    const edge = detailRequestFor(view(-129, 20, 6), NATIONAL, TEMP)!;
    expect(edge.bounds.west).toBe(-130);
    expect(edge.bounds.east).toBeGreaterThan(-129);
    expect(detailRequestFor(view(10, 45, 7), NATIONAL, TEMP)).toBeNull();
    // A degenerate view.
    expect(
      detailRequestFor(
        { zoom: 7, bounds: { west: -99, south: 19, east: -99, north: 20 } },
        NATIONAL,
        TEMP
      )
    ).toBeNull();
  });

  it('cache key: variable, model, level and the rounded box', () => {
    const b = { west: -100.12345, south: 18.5, east: -98, north: 20.0004 };
    expect(detailCacheKey(TEMP, 7, b)).toBe(
      'temperature_2m|best_match|z7|-100.123|18.500|-98.000|20.000'
    );
    expect(detailCacheKey({ ...TEMP, model: 'gfs_seamless' }, 7, b)).not.toBe(
      detailCacheKey(TEMP, 7, b)
    );
    expect(
      detailCacheKey({ ...TEMP, hourlyVar: 'dew_point_2m' }, 7, b)
    ).not.toBe(detailCacheKey(TEMP, 7, b));
    const v = view(-99.13, 19.43, 7);
    expect(detailRequestFor(v, NATIONAL, TEMP)!.key).not.toBe(
      detailRequestFor(v, NATIONAL, { ...TEMP, model: 'icon_seamless' })!.key
    );
  });
});

describe('Story 24.2 — merge by bounds', () => {
  const B: Bounds = { west: -100, south: 18, east: -98, north: 20 };

  it('weight: 0 outside, 1 inside, smooth across the blend band', () => {
    expect(detailWeight(-101, 19, B)).toBe(0);
    expect(detailWeight(-99, 21, B)).toBe(0);
    expect(detailWeight(-99, 19, B)).toBe(1);
    expect(detailWeight(-100, 19, B)).toBe(0);
    const band = 2 * FIELD_DETAIL_FADE;
    // Half-way across the band: smoothstep(0.5) = 0.5.
    expect(detailWeight(-100 + band / 2, 19, B)).toBeCloseTo(0.5, 6);
    let prev = 0;
    for (let i = 1; i <= 10; i++) {
      const w = detailWeight(-100 + (band * i) / 10, 19, B);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(prev).toBe(1);
    expect(detailWeight(-99, 19, { ...B, east: -100 })).toBe(0);
  });

  it('value: national outside, local inside, blended in the band', () => {
    expect(mergeFieldValue(10, 20, 0)).toEqual({ value: 10, alpha: 1 });
    expect(mergeFieldValue(10, 20, 1)).toEqual({ value: 20, alpha: 1 });
    expect(mergeFieldValue(10, 20, 0.25)).toEqual({ value: 12.5, alpha: 1 });
    // No local value there: the national one.
    expect(mergeFieldValue(10, null, 1)).toEqual({ value: 10, alpha: 1 });
    // No national value: the local one fades out with the weight.
    expect(mergeFieldValue(null, 20, 0.4)).toEqual({ value: 20, alpha: 0.4 });
    expect(mergeFieldValue(null, 20, 0)).toBeNull();
    expect(mergeFieldValue(null, null, 1)).toBeNull();
  });

  it('hour alignment by timestamp, not by index', () => {
    const g = gridOver(B, ['2026-09-28T01:00', '2026-09-28T02:00'], () => 1);
    expect(detailHourIndex(g, '2026-09-28T02:00')).toBe(1);
    expect(detailHourIndex(g, '2026-09-28T02:00:00.000Z')).toBe(1);
    expect(detailHourIndex(g, '2026-09-28T00:00')).toBe(-1);
    expect(detailHourIndex(g, undefined)).toBe(-1);
  });

  it('canvas: the local grid paints inside its box, the national outside', () => {
    // National: a flat 10 °C. Local box: a flat 30 °C.
    const nat: FieldGrid = {
      times: ['2026-09-28T00:00'],
      points: detailPoints(NATIONAL).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        values: [10],
      })),
    };
    const loc = gridOver(
      { west: -110, south: 15, east: -90, north: 30 },
      nat.times,
      () => 30
    );
    const W = 140;
    const H = 110;
    const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    const color = (v: number): string => (v > 20 ? '#ff0000' : '#0000ff');
    fillFieldImageData(img, nat, 24, 32, NATIONAL, 0, color, 255, {
      detail: {
        grid: loc,
        rows: FIELD_DETAIL_ROWS,
        cols: FIELD_DETAIL_COLS,
        bounds: { west: -110, south: 15, east: -90, north: 30 },
        hourIdx: 0,
      },
    });
    const px = (lng: number, lat: number): number[] => {
      const x = Math.round(((lng + 130) / 70) * (W - 1));
      const y = Math.round(((50 - lat) / 55) * (H - 1));
      const i = (y * W + x) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    expect(px(-100, 22)).toEqual([255, 0, 0]); // inside: local
    expect(px(-75, 22)).toEqual([0, 0, 255]); // outside: national
    expect(px(-100, 40)).toEqual([0, 0, 255]);
    // Without a detail layer the same pixel is national.
    const plain = {
      data: new Uint8ClampedArray(W * H * 4),
      width: W,
      height: H,
    };
    fillFieldImageData(plain, nat, 24, 32, NATIONAL, 0, color, 255);
    const x = Math.round(((-100 + 130) / 70) * (W - 1));
    const y = Math.round(((50 - 22) / 55) * (H - 1));
    expect(plain.data[(y * W + x) * 4 + 2]).toBe(255);
    expect(bicubicValue(nat, 24, 32, NATIONAL, 22, -100, 0)).toBeCloseTo(10, 6);
  });
});

describe('Story 24.2 — detail cache', () => {
  const entry = (
    key: string,
    b: Bounds,
    level = 7,
    ids = TEMP
  ): DetailEntry => ({
    key,
    level,
    bounds: b,
    ids,
    grid: { times: [], points: [] },
  });

  it('LRU: the least recently used entry goes first', () => {
    const c = createDetailCache(2);
    const B = { west: 0, south: 0, east: 1, north: 1 };
    c.set(entry('a', B));
    c.set(entry('b', B));
    expect(c.get('a')?.key).toBe('a'); // touch a
    c.set(entry('c', B));
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeDefined();
    expect(c.size()).toBe(2);
    c.clear();
    expect(c.size()).toBe(0);
  });

  it('covering: same level, variable and model, box containing the area', () => {
    const c = createDetailCache(4);
    const big = { west: -102, south: 17, east: -96, north: 22 };
    c.set(entry('k', big));
    const inner = { west: -101, south: 18, east: -97, north: 21 };
    expect(c.covering(inner, 7, TEMP)?.key).toBe('k');
    expect(c.covering(inner, 8, TEMP)).toBeUndefined();
    expect(
      c.covering(inner, 7, { ...TEMP, model: 'gfs_seamless' })
    ).toBeUndefined();
    expect(c.covering({ ...inner, east: -95 }, 7, TEMP)).toBeUndefined();
  });
});

describe('Story 24.2 — the moveend loader', () => {
  function harness(opts: { saveData?: boolean } = {}) {
    const timers: { fn: () => void; ms: number; id: number }[] = [];
    let next = 1;
    const signals: AbortSignal[] = [];
    const resolvers: ((g: FieldGrid | null) => void)[] = [];
    const load = vi.fn(
      (
        pts: { lat: number; lng: number }[],
        _ids: DetailIds,
        signal: AbortSignal
      ) =>
        new Promise<FieldGrid | null>((resolve) => {
          signals.push(signal);
          resolvers.push((g) =>
            resolve(
              g ?? {
                times: ['2026-09-28T00:00'],
                points: pts.map((p) => ({ ...p, values: [1] })),
              }
            )
          );
        })
    );
    const onChange = vi.fn();
    let saveData = opts.saveData ?? false;
    const d = createFieldDetail({
      load,
      onChange,
      saveData: () => saveData,
      setTimer: (fn, ms) => {
        const id = next++;
        timers.push({ fn, ms, id });
        return id;
      },
      clearTimer: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    const fire = (): void => {
      const t = timers.splice(0);
      t.forEach((x) => x.fn());
    };
    const settle = async (): Promise<void> => {
      resolvers.splice(0).forEach((r) => r(null));
      await new Promise((r) => setTimeout(r, 0));
    };
    return {
      d,
      load,
      onChange,
      timers,
      signals,
      fire,
      settle,
      setSaveData: (v: boolean) => (saveData = v),
    };
  }

  it('debounces moveend into one request set, then serves the cache', async () => {
    const h = harness();
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h.d.update(view(-99.1, 19.45, 7.2), NATIONAL, TEMP); // same box
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(FIELD_DETAIL_DEBOUNCE_MS);
    expect(h.load).not.toHaveBeenCalled();
    h.fire();
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.load.mock.calls[0][0]).toHaveLength(768);
    await h.settle();
    expect(h.d.active()?.level).toBe(7);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.d.fetches()).toBe(1);

    // A small pan inside the padded box: no request.
    h.d.update(view(-99.3, 19.5, 7), NATIONAL, TEMP);
    expect(h.timers).toHaveLength(0);
    // Out below zoom 6: national only.
    h.d.update(view(-99.13, 19.43, 5), NATIONAL, TEMP);
    expect(h.d.active()).toBeNull();
    expect(h.onChange).toHaveBeenLastCalledWith(null);
    // Back in: from the cache, at once.
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    expect(h.timers).toHaveLength(0);
    expect(h.d.active()?.level).toBe(7);
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('a short pan while the box loads keeps it; it lands and serves', async () => {
    const h = harness();
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h.fire();
    // Inside the padded box, though its rounded key differs.
    const q = detailQuantum(7);
    const moved = view(-99.13 + q * 0.8, 19.43, 7);
    expect(detailRequestFor(moved, NATIONAL, TEMP)!.key).not.toBe(
      detailRequestFor(view(-99.13, 19.43, 7), NATIONAL, TEMP)!.key
    );
    h.d.update(moved, NATIONAL, TEMP);
    expect(h.signals[0].aborted).toBe(false);
    expect(h.timers.map((t) => t.ms)).toEqual([FIELD_DETAIL_TIMEOUT_MS]);
    await h.settle();
    expect(h.d.active()).not.toBeNull();
    h.d.update(moved, NATIONAL, TEMP);
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('a newer view aborts the one in flight; cancel() aborts and drops', async () => {
    const h = harness();
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h.fire();
    h.d.update(view(-89, 19.43, 7), NATIONAL, TEMP);
    expect(h.signals[0].aborted).toBe(true);
    h.fire();
    expect(h.load).toHaveBeenCalledTimes(2);
    h.d.cancel();
    expect(h.signals[1].aborted).toBe(true);
    await h.settle();
    expect(h.d.active()).toBeNull();
    expect(h.onChange).not.toHaveBeenCalled();
    // A pending (not yet fired) timer is cleared too.
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    expect(h.timers).toHaveLength(1);
    h.d.cancel();
    expect(h.timers).toHaveLength(0);
  });

  it('another variable or model is another grid', async () => {
    const h = harness();
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h.fire();
    await h.settle();
    const gfs = { ...TEMP, model: 'gfs_seamless' };
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, gfs);
    // The temperature/best_match grid is dropped at once…
    expect(h.d.active()).toBeNull();
    h.fire();
    await h.settle();
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.load.mock.calls[1][1]).toEqual(gfs);
    expect(h.d.active()?.ids).toEqual(gfs);
  });

  it('a hung request times out and the next moveend asks again', () => {
    const h = harness();
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h.fire(); // debounce → fetch, arms the deadline
    expect(h.timers.map((t) => t.ms)).toEqual([FIELD_DETAIL_TIMEOUT_MS]);
    // Same view while in flight: no second request.
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    expect(h.timers).toHaveLength(1);
    h.fire(); // deadline
    expect(h.signals[0].aborted).toBe(true);
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    expect(h.timers.map((t) => t.ms)).toEqual([FIELD_DETAIL_DEBOUNCE_MS]);
    h.fire();
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('respects data saver', () => {
    const h = harness({ saveData: true });
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    expect(h.timers).toHaveLength(0);
    expect(h.load).not.toHaveBeenCalled();
    h.setSaveData(false);
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    expect(h.timers).toHaveLength(1);
  });

  it('a failed or malformed fetch leaves the national grid alone', async () => {
    const h = harness();
    h.load.mockImplementationOnce(() => Promise.reject(new Error('HTTP 429')));
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.d.active()).toBeNull();
    expect(h.onChange).not.toHaveBeenCalled();
    h.load.mockImplementationOnce(() =>
      Promise.resolve({ times: [], points: [] })
    );
    h.d.update(view(-89, 19.43, 7), NATIONAL, TEMP);
    h.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.d.active()).toBeNull();
  });

  it('destroy() clears the timer and aborts the fetch', () => {
    const h = harness();
    h.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h.d.destroy();
    expect(h.timers).toHaveLength(0);
    h.d.update(view(-89, 19.43, 7), NATIONAL, TEMP);
    expect(h.timers).toHaveLength(0);
    const h2 = harness();
    h2.d.update(view(-99.13, 19.43, 7), NATIONAL, TEMP);
    h2.fire();
    h2.d.destroy();
    expect(h2.signals[0].aborted).toBe(true);
  });
});
