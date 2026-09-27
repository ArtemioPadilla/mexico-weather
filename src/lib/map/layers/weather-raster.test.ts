import { describe, expect, it } from 'vitest';
import {
  WEATHER_RASTER_LAYER_ID,
  WEATHER_RASTER_SOURCE_ID,
  createWeatherRaster,
  pickGibsLayer,
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

    it('frame swap keeps the order (teardown + re-add before labels)', () => {
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
