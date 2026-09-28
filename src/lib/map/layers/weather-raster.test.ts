import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SWAP_TIMEOUT_MS,
  WEATHER_RASTER_LAYER_B_ID,
  WEATHER_RASTER_LAYER_ID,
  WEATHER_RASTER_SOURCE_B_ID,
  WEATHER_RASTER_SOURCE_ID,
  createWeatherRaster,
  pickGibsLayer,
  weatherRasterTileSpec,
} from './weather-raster';
import { GIBS_LAYERS } from '../sources/nasa-gibs';

describe('pickGibsLayer', () => {
  it('maps sub-option to the matching GIBS layer def', () => {
    expect(pickGibsLayer('ir')).toBe(GIBS_LAYERS.goesIR);
    expect(pickGibsLayer('truecolor')).toBe(GIBS_LAYERS.modisTrueColor);
    expect(pickGibsLayer('geocolor')).toBe(GIBS_LAYERS.goesGeocolor);
  });
});

describe('createWeatherRaster', () => {
  function mockMap(): {
    map: Parameters<typeof createWeatherRaster>[0];
    layers: Set<string>;
    sources: Set<string>;
    paintProps: Map<string, Map<string, unknown>>;
  } {
    const layers = new Set<string>();
    const sources = new Set<string>();
    const paintProps = new Map<string, Map<string, unknown>>();
    const map = {
      getSource: (id: string): unknown => (sources.has(id) ? {} : undefined),
      getLayer: (id: string): unknown => (layers.has(id) ? {} : undefined),
      addSource: (id: string): void => {
        sources.add(id);
      },
      addLayer: (def: { id: string }): void => {
        layers.add(def.id);
      },
      removeLayer: (id: string): void => {
        layers.delete(id);
      },
      removeSource: (id: string): void => {
        sources.delete(id);
      },
      setPaintProperty: (
        layerId: string,
        prop: string,
        value: unknown
      ): void => {
        if (!paintProps.has(layerId)) paintProps.set(layerId, new Map());
        paintProps.get(layerId)!.set(prop, value);
      },
    } as unknown as Parameters<typeof createWeatherRaster>[0];
    return { map, layers, sources, paintProps };
  }

  it('show satellite adds dim + GIBS raster layer', () => {
    const { map, layers, sources } = mockMap();
    const factory = createWeatherRaster(map);
    factory.show('satellite', null, {
      rvData: null,
      satelliteSubOption: 'geocolor',
      opacity: 1,
      currentZoom: 5,
    });
    expect(layers.has(WEATHER_RASTER_LAYER_ID)).toBe(true);
    expect(sources.has(WEATHER_RASTER_SOURCE_ID)).toBe(true);
    expect(layers.has('wx-rv-dim-layer')).toBe(true);
  });

  it('show radar without rvData is a no-op (defensive)', () => {
    const { map, layers } = mockMap();
    const factory = createWeatherRaster(map);
    factory.show('radar', null, {
      rvData: null,
      satelliteSubOption: 'geocolor',
      opacity: 1,
      currentZoom: 5,
    });
    // The dim layer is added preemptively in show(), but the raster
    // layer never lands without rvData.
    expect(layers.has(WEATHER_RASTER_LAYER_ID)).toBe(false);
  });

  it('show radar with rvData adds the layer', () => {
    const { map, layers } = mockMap();
    const factory = createWeatherRaster(map);
    factory.show(
      'radar',
      { time: 1700000000, path: '/v2/radar/1700000000' },
      {
        rvData: {
          host: 'https://tilecache.rainviewer.com',
          frames: [],
          satelliteFrames: [],
        },
        satelliteSubOption: 'geocolor',
        opacity: 0.8,
        currentZoom: 5,
      }
    );
    expect(layers.has(WEATHER_RASTER_LAYER_ID)).toBe(true);
  });

  it('remove tears down layer + source + dim', () => {
    const { map, layers, sources } = mockMap();
    const factory = createWeatherRaster(map);
    factory.show('satellite', null, {
      rvData: null,
      satelliteSubOption: 'geocolor',
      opacity: 1,
      currentZoom: 5,
    });
    factory.remove();
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });

  it('satellite at zoom > maxZoom+1 fires the limit toast', () => {
    let msg = '';
    const { map } = mockMap();
    const factory = createWeatherRaster(map, {
      showMsg: (s) => {
        msg = s;
      },
    });
    factory.show('satellite', null, {
      rvData: null,
      satelliteSubOption: 'geocolor',
      opacity: 1,
      currentZoom: 10, // geocolor maxZoom = 6 → 10 > 7 triggers
    });
    expect(msg).toMatch(/Satélite limitado/);
  });

  // Story 21.1 — imagery is inserted BENEATH the basemap labels layer.
  describe('beforeLayerId (labels stay above imagery)', () => {
    const LABELS = 'osm-reference';
    function orderedMap(initial: string[]) {
      const order: string[] = [...initial];
      const sources = new Set<string>();
      const map = {
        getSource: (id: string): unknown => (sources.has(id) ? {} : undefined),
        getLayer: (id: string): unknown =>
          order.includes(id) ? {} : undefined,
        addSource: (id: string): void => {
          sources.add(id);
        },
        addLayer: (def: { id: string }, beforeId?: string): void => {
          const at = beforeId ? order.indexOf(beforeId) : -1;
          if (at >= 0) order.splice(at, 0, def.id);
          else order.push(def.id);
        },
        removeLayer: (id: string): void => {
          const at = order.indexOf(id);
          if (at >= 0) order.splice(at, 1);
        },
        removeSource: (id: string): void => {
          sources.delete(id);
        },
        setPaintProperty: (): void => {},
        on: (): void => {},
        off: (): void => {},
      } as unknown as Parameters<typeof createWeatherRaster>[0];
      return { map, order };
    }
    const RV = {
      host: 'https://tilecache.rainviewer.com',
      frames: [],
      satelliteFrames: [],
    };

    it('dim < raster < labels, and an overlay added earlier stays above', () => {
      const { map, order } = orderedMap(['osm', LABELS, 'ov-clouds']);
      const factory = createWeatherRaster(map, { beforeLayerId: LABELS });
      factory.show('satellite', null, {
        rvData: null,
        satelliteSubOption: 'geocolor',
        opacity: 1,
        currentZoom: 5,
      });
      expect(order).toEqual([
        'osm',
        'wx-rv-dim-layer',
        WEATHER_RASTER_LAYER_ID,
        LABELS,
        'ov-clouds',
      ]);
    });

    it('radar companion lands above the satellite raster, still below labels', () => {
      const { map, order } = orderedMap(['osm', LABELS]);
      const factory = createWeatherRaster(map, { beforeLayerId: LABELS });
      factory.show('satellite', null, {
        rvData: null,
        satelliteSubOption: 'geocolor',
        opacity: 1,
        currentZoom: 5,
      });
      factory.showRadarCompanion(
        { time: 0, path: '/x' },
        {
          rvData: RV,
          opacity: 0.7,
        }
      );
      expect(order.indexOf('wx-radar-companion')).toBeGreaterThan(
        order.indexOf(WEATHER_RASTER_LAYER_ID)
      );
      expect(order.indexOf('wx-radar-companion')).toBeLessThan(
        order.indexOf(LABELS)
      );
    });

    it('frame swap keeps the order (A/B pair, both before labels)', () => {
      const { map, order } = orderedMap(['osm', LABELS]);
      const factory = createWeatherRaster(map, { beforeLayerId: LABELS });
      const ctx = {
        rvData: RV,
        satelliteSubOption: 'geocolor' as const,
        opacity: 0.8,
        currentZoom: 5,
      };
      factory.show('radar', { time: 1, path: '/a' }, ctx);
      factory.show('radar', { time: 2, path: '/b' }, ctx);
      expect(order).toEqual([
        'osm',
        'wx-rv-dim-layer',
        WEATHER_RASTER_LAYER_ID,
        WEATHER_RASTER_LAYER_B_ID,
        LABELS,
      ]);
    });

    it('falls back to appending on top when the labels layer is missing', () => {
      const { map, order } = orderedMap(['osm']);
      const factory = createWeatherRaster(map, { beforeLayerId: LABELS });
      factory.show('satellite', null, {
        rvData: null,
        satelliteSubOption: 'geocolor',
        opacity: 1,
        currentZoom: 5,
      });
      expect(order).toEqual([
        'osm',
        'wx-rv-dim-layer',
        WEATHER_RASTER_LAYER_ID,
      ]);
    });
  });

  it('setOpacity writes through to the active raster layer', () => {
    const { map, paintProps } = mockMap();
    const factory = createWeatherRaster(map);
    factory.show(
      'radar',
      { time: 0, path: '/x' },
      {
        rvData: {
          host: 'https://tilecache.rainviewer.com',
          frames: [],
          satelliteFrames: [],
        },
        satelliteSubOption: 'geocolor',
        opacity: 0.6,
        currentZoom: 5,
      }
    );
    factory.setOpacity(0.3);
    expect(paintProps.get(WEATHER_RASTER_LAYER_ID)?.get('raster-opacity')).toBe(
      0.3
    );
  });
});

describe('weatherRasterTileSpec', () => {
  const RV = {
    host: 'https://tilecache.rainviewer.com',
    frames: [],
    satelliteFrames: [],
  };
  it('satellite: GIBS template at the frame instant, 256 px, product per variant', () => {
    const spec = weatherRasterTileSpec(
      'satellite',
      { time: Date.UTC(2026, 8, 28, 12, 7) / 1000, path: '' },
      { rvData: null, satelliteSubOption: 'geocolor' }
    )!;
    expect(spec.url).toContain('/2026-09-28T12:00:00Z/');
    expect(spec.url).toMatch(/\{z\}\/\{y\}\/\{x\}\.png$/);
    expect(spec.tileSize).toBe(256);
    expect(spec.maxzoom).toBe(GIBS_LAYERS.goesGeocolor.maxZoom);
    const ir = weatherRasterTileSpec(
      'satellite',
      { time: Date.UTC(2026, 8, 28, 12, 7) / 1000, path: '' },
      { rvData: null, satelliteSubOption: 'ir' }
    )!;
    expect(ir.productKey).not.toBe(spec.productKey);
  });
  it('radar: RainViewer 512 px template; null without manifest or frame', () => {
    const spec = weatherRasterTileSpec(
      'radar',
      { time: 1, path: '/v2/radar/p1' },
      { rvData: RV, satelliteSubOption: 'geocolor' }
    )!;
    expect(spec.url).toBe(
      'https://tilecache.rainviewer.com/v2/radar/p1/512/{z}/{x}/{y}/4/1_1.png'
    );
    expect(spec.tileSize).toBe(512);
    expect(
      weatherRasterTileSpec('radar', null, {
        rvData: RV,
        satelliteSubOption: 'geocolor',
      })
    ).toBeNull();
    expect(
      weatherRasterTileSpec(
        'radar',
        { time: 1, path: '/x' },
        { rvData: null, satelliteSubOption: 'geocolor' }
      )
    ).toBeNull();
  });
});

// Story 21.3 — frames of one product alternate between two sources/layers
// instead of tearing one down and re-adding it.
describe('A/B frame swap (Story 21.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Handler = (e: Record<string, unknown>) => void;
  function abMap(initial: string[] = ['osm', 'osm-reference']) {
    const order: string[] = [...initial];
    const sources = new Map<
      string,
      { tiles: string[]; setTiles: (t: string[]) => void }
    >();
    const added: string[] = [];
    const paint = new Map<string, Record<string, unknown>>();
    const loaded = new Map<string, boolean>();
    const handlers = new Map<string, Set<Handler>>();
    const map = {
      getSource: (id: string): unknown => sources.get(id),
      getLayer: (id: string): unknown => (order.includes(id) ? {} : undefined),
      addSource: (id: string, spec: { tiles?: string[] }): void => {
        added.push(id);
        const src = {
          tiles: spec.tiles ?? [],
          setTiles(t: string[]): void {
            src.tiles = t;
            loaded.set(id, false);
          },
        };
        sources.set(id, src);
        loaded.set(id, false);
      },
      addLayer: (
        def: { id: string; paint?: Record<string, unknown> },
        beforeId?: string
      ): void => {
        const at = beforeId ? order.indexOf(beforeId) : -1;
        if (at >= 0) order.splice(at, 0, def.id);
        else order.push(def.id);
        paint.set(def.id, { ...(def.paint ?? {}) });
      },
      moveLayer: (id: string, beforeId?: string): void => {
        order.splice(order.indexOf(id), 1);
        const at = beforeId ? order.indexOf(beforeId) : -1;
        if (at >= 0) order.splice(at, 0, id);
        else order.push(id);
      },
      removeLayer: (id: string): void => {
        order.splice(order.indexOf(id), 1);
        paint.delete(id);
      },
      removeSource: (id: string): void => {
        sources.delete(id);
      },
      setPaintProperty: (id: string, prop: string, v: unknown): void => {
        if (!paint.has(id)) paint.set(id, {});
        paint.get(id)![prop] = v;
      },
      isSourceLoaded: (id: string): boolean => loaded.get(id) === true,
      on: (type: string, fn: Handler): void => {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)!.add(fn);
      },
      off: (type: string, fn: Handler): void => {
        handlers.get(type)?.delete(fn);
      },
    } as unknown as Parameters<typeof createWeatherRaster>[0];
    /** Mark a source loaded and fire its `sourcedata`, as MapLibre does
     *  when the last in-view tile lands. */
    async function loadSource(id: string): Promise<void> {
      loaded.set(id, true);
      for (const fn of [...(handlers.get('sourcedata') ?? [])]) {
        fn({ sourceId: id, sourceDataType: undefined, tile: {} });
      }
      await Promise.resolve();
      await Promise.resolve();
    }
    const listenerCount = (): number =>
      [...handlers.values()].reduce((n, s) => n + s.size, 0);
    return { map, order, sources, added, paint, loadSource, listenerCount };
  }

  const RV = {
    host: 'https://tilecache.rainviewer.com',
    frames: [],
    satelliteFrames: [],
  };
  const ctx = {
    rvData: RV,
    satelliteSubOption: 'geocolor' as const,
    opacity: 0.8,
    currentZoom: 5,
  };
  const A = WEATHER_RASTER_LAYER_ID;
  const B = WEATHER_RASTER_LAYER_B_ID;

  it('the next frame loads into a hidden B slot; A stays on screen', () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, {
      beforeLayerId: 'osm-reference',
      getFadeMs: () => 300,
    });
    f.show('radar', { time: 1, path: '/a' }, ctx);
    f.show('radar', { time: 2, path: '/b' }, ctx);
    expect(m.added).toEqual([
      'wx-rv-dim-src',
      WEATHER_RASTER_SOURCE_ID,
      WEATHER_RASTER_SOURCE_B_ID,
    ]);
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0.8);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0);
    expect(m.paint.get(B)?.['raster-fade-duration']).toBe(300);
    expect(m.sources.get(WEATHER_RASTER_SOURCE_B_ID)?.tiles[0]).toContain(
      '/b/512/'
    );
  });

  it('once B is loaded it fades in on top over raster-fade-duration, then A hides', async () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, {
      beforeLayerId: 'osm-reference',
      getFadeMs: () => 300,
    });
    f.show('radar', { time: 1, path: '/a' }, ctx);
    f.show('radar', { time: 2, path: '/b' }, ctx);
    await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0.8);
    expect(m.paint.get(B)?.['raster-opacity-transition']).toEqual({
      duration: 300,
      delay: 0,
    });
    // The outgoing frame stays under it for the whole fade: no dip.
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0.8);
    expect(m.order.indexOf(B)).toBeGreaterThan(m.order.indexOf(A));
    expect(m.order.indexOf(B)).toBeLessThan(m.order.indexOf('osm-reference'));
    vi.advanceTimersByTime(300);
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0);
    expect(m.listenerCount()).toBe(0);
  });

  it('the third frame reuses slot A via setTiles — no source is re-added', async () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, { getFadeMs: () => 300 });
    f.show('radar', { time: 1, path: '/a' }, ctx);
    f.show('radar', { time: 2, path: '/b' }, ctx);
    await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
    vi.advanceTimersByTime(300);
    const addedBefore = m.added.length;
    f.show('radar', { time: 3, path: '/c' }, ctx);
    expect(m.added).toHaveLength(addedBefore);
    expect(m.sources.get(WEATHER_RASTER_SOURCE_ID)?.tiles[0]).toContain(
      '/c/512/'
    );
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0);
    await m.loadSource(WEATHER_RASTER_SOURCE_ID);
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0.8);
    // A moved back on top of B for its fade-in.
    expect(m.order.indexOf(A)).toBeGreaterThan(m.order.indexOf(B));
    vi.advanceTimersByTime(300);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0);
  });

  it('fast style (fade 0) swaps instantly', async () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
    f.show('radar', { time: 1, path: '/a' }, ctx);
    f.show('radar', { time: 2, path: '/b' }, ctx);
    await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0.8);
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0);
  });

  it('a slot that never reports loaded cross-fades after SWAP_TIMEOUT_MS', () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
    f.show('radar', { time: 1, path: '/a' }, ctx);
    f.show('radar', { time: 2, path: '/b' }, ctx);
    vi.advanceTimersByTime(SWAP_TIMEOUT_MS - 1);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0);
    vi.advanceTimersByTime(1);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0.8);
  });

  it('a newer frame while B loads retargets B; scrubbing back to A cancels', async () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
    f.show('radar', { time: 1, path: '/a' }, ctx);
    f.show('radar', { time: 2, path: '/b' }, ctx);
    f.show('radar', { time: 3, path: '/c' }, ctx);
    expect(m.sources.get(WEATHER_RASTER_SOURCE_B_ID)?.tiles[0]).toContain(
      '/c/512/'
    );
    f.show('radar', { time: 1, path: '/a' }, ctx);
    expect(m.listenerCount()).toBe(0);
    await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
    vi.advanceTimersByTime(SWAP_TIMEOUT_MS);
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0.8);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0);
  });

  it('a new product (satellite variant) rebuilds from slot A', () => {
    const m = abMap();
    const f = createWeatherRaster(m.map);
    const sat = { ...ctx, rvData: null };
    f.show('satellite', { time: 1_800_000_000, path: '' }, sat);
    f.show('satellite', { time: 1_800_000_600, path: '' }, sat);
    expect(m.order).toContain(B);
    f.show(
      'satellite',
      { time: 1_800_000_600, path: '' },
      { ...sat, satelliteSubOption: 'ir' }
    );
    expect(m.order).toContain(A);
    expect(m.order).not.toContain(B);
    expect(m.sources.get(WEATHER_RASTER_SOURCE_ID)?.tiles[0]).toContain(
      GIBS_LAYERS.goesIR.id
    );
  });

  it('the radar companion stays above both slots across a swap', async () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, {
      beforeLayerId: 'osm-reference',
      getFadeMs: () => 0,
    });
    const sat = { ...ctx, rvData: null };
    f.show('satellite', { time: 1_800_000_000, path: '' }, sat);
    f.showRadarCompanion({ time: 1, path: '/r' }, { rvData: RV, opacity: 0.7 });
    f.show('satellite', { time: 1_800_000_600, path: '' }, sat);
    await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
    const comp = m.order.indexOf('wx-radar-companion');
    expect(comp).toBeGreaterThan(m.order.indexOf(A));
    expect(comp).toBeGreaterThan(m.order.indexOf(B));
    expect(comp).toBeLessThan(m.order.indexOf('osm-reference'));
  });

  it('setOpacity follows the visible slot; setFadeMs reaches both; remove clears all', async () => {
    const m = abMap();
    const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
    f.show('radar', { time: 1, path: '/a' }, ctx);
    f.show('radar', { time: 2, path: '/b' }, ctx);
    await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
    f.setOpacity(0.4);
    expect(m.paint.get(B)?.['raster-opacity']).toBe(0.4);
    expect(m.paint.get(A)?.['raster-opacity']).toBe(0);
    f.setFadeMs(300);
    expect(m.paint.get(A)?.['raster-fade-duration']).toBe(300);
    expect(m.paint.get(B)?.['raster-fade-duration']).toBe(300);
    // The next swap fades in at the new opacity.
    f.show('radar', { time: 3, path: '/c' }, { ...ctx, opacity: 0.4 });
    f.remove();
    expect(m.order).toEqual(['osm', 'osm-reference']);
    expect(m.sources.size).toBe(0);
    expect(m.listenerCount()).toBe(0);
    vi.advanceTimersByTime(SWAP_TIMEOUT_MS);
    // A fresh show after remove starts over on A.
    f.show('radar', { time: 4, path: '/d' }, ctx);
    expect(m.order).toContain(A);
    expect(m.order).not.toContain(B);
  });

  // Review fix (paridad visual V1) — the satellite loop's timeline gate:
  // GIBS tiles are `no-store`, so instead of a prefetch the loop waits
  // until the frame it asked for is on screen with its tiles in.
  describe('swapSettled', () => {
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    it('resolves at once when the visible slot is loaded and nothing is in flight', async () => {
      const m = abMap();
      const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
      f.show('radar', { time: 1, path: '/a' }, ctx);
      await m.loadSource(WEATHER_RASTER_SOURCE_ID);
      const spy = vi.fn();
      void f.swapSettled(3000).then(spy);
      await flush();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("waits for the first frame's tiles, then for the incoming slot to land", async () => {
      const m = abMap();
      const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
      f.show('radar', { time: 1, path: '/a' }, ctx);
      const first = vi.fn();
      void f.swapSettled(3000).then(first);
      await flush();
      expect(first).not.toHaveBeenCalled();
      await m.loadSource(WEATHER_RASTER_SOURCE_ID);
      await flush();
      expect(first).toHaveBeenCalledTimes(1);

      f.show('radar', { time: 2, path: '/b' }, ctx);
      const spy = vi.fn();
      void f.swapSettled(3000).then(spy);
      await flush();
      expect(spy).not.toHaveBeenCalled();
      await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
      await flush();
      expect(spy).toHaveBeenCalledTimes(1);
      // Every listener and timer (the swap's and the waiter's) is gone.
      expect(m.listenerCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a swap that cross-faded on SWAP_TIMEOUT_MS is not settled until its tiles land', async () => {
      const m = abMap();
      const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
      f.show('radar', { time: 1, path: '/a' }, ctx);
      await m.loadSource(WEATHER_RASTER_SOURCE_ID);
      f.show('radar', { time: 2, path: '/b' }, ctx);
      const spy = vi.fn();
      void f.swapSettled(5000).then(spy);
      vi.advanceTimersByTime(SWAP_TIMEOUT_MS);
      await flush();
      // B is on screen now, but still loading.
      expect(m.paint.get(B)?.['raster-opacity']).toBe(0.8);
      expect(spy).not.toHaveBeenCalled();
      await m.loadSource(WEATHER_RASTER_SOURCE_B_ID);
      await flush();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('a retarget keeps it waiting; scrubbing back to the frame on screen releases it', async () => {
      const m = abMap();
      const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
      f.show('radar', { time: 1, path: '/a' }, ctx);
      await m.loadSource(WEATHER_RASTER_SOURCE_ID);
      f.show('radar', { time: 2, path: '/b' }, ctx);
      const spy = vi.fn();
      void f.swapSettled(3000).then(spy);
      f.show('radar', { time: 3, path: '/c' }, ctx);
      await flush();
      expect(spy).not.toHaveBeenCalled();
      f.show('radar', { time: 1, path: '/a' }, ctx);
      await flush();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('resolves after timeoutMs when nothing lands, and on remove()', async () => {
      const m = abMap();
      const f = createWeatherRaster(m.map, { getFadeMs: () => 0 });
      f.show('radar', { time: 1, path: '/a' }, ctx);
      await m.loadSource(WEATHER_RASTER_SOURCE_ID);
      f.show('radar', { time: 2, path: '/b' }, ctx);
      const late = vi.fn();
      void f.swapSettled(500).then(late);
      vi.advanceTimersByTime(499);
      await flush();
      expect(late).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      await flush();
      expect(late).toHaveBeenCalledTimes(1);
      const onRemove = vi.fn();
      void f.swapSettled(3000).then(onRemove);
      f.remove();
      await flush();
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(m.listenerCount()).toBe(0);
    });
  });
});
