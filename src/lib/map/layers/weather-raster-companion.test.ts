import { describe, expect, it } from 'vitest';
import type maplibregl from 'maplibre-gl';
import { createWeatherRaster } from './weather-raster';

function fakeMap() {
  const sources = new Map<string, unknown>();
  const layers: string[] = [];
  const map = {
    getSource: (id: string) => (sources.has(id) ? { id } : undefined),
    addSource: (id: string, spec: unknown) => sources.set(id, spec),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: { id: string }) => layers.push(spec.id),
    removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    setPaintProperty: () => undefined,
  };
  return { map: map as unknown as maplibregl.Map, sources, layers };
}

const rvData = {
  host: 'https://tilecache.rainviewer.com',
  frames: [{ time: 1000, path: '/v2/radar/p1' }],
  satelliteFrames: [],
};

describe('weather raster — radar companion (Story 13.2)', () => {
  it('adds a radar tile layer on top and removes it with the raster', () => {
    const { map, sources, layers } = fakeMap();
    const wr = createWeatherRaster(map);
    wr.showRadarCompanion(
      { time: 1000, path: '/v2/radar/p1' },
      { rvData, opacity: 0.8 }
    );
    expect(layers).toContain('wx-radar-companion');
    const src = sources.get('wx-radar-companion-src') as { tiles: string[] };
    expect(src.tiles[0]).toContain('/v2/radar/p1/512/{z}/{x}/{y}/');
    wr.showRadarCompanion(null, { rvData, opacity: 0.8 });
    expect(layers).not.toContain('wx-radar-companion');
    wr.showRadarCompanion(
      { time: 1000, path: '/v2/radar/p1' },
      { rvData, opacity: 0.8 }
    );
    wr.remove();
    expect(layers).not.toContain('wx-radar-companion');
    expect(sources.has('wx-radar-companion-src')).toBe(false);
  });
});
