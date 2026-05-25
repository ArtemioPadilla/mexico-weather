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
        value: unknown,
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
      },
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
      },
    );
    factory.setOpacity(0.3);
    expect(
      paintProps.get(WEATHER_RASTER_LAYER_ID)?.get('raster-opacity'),
    ).toBe(0.3);
  });
});
