// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';
import { createTropicalStormsOverlay } from './tropical-storms';
import { createTropicalOutlookOverlay } from './tropical-outlook';

/** Minimal MapLibre stand-in recording sources, layers and visibility. */
function fakeMap() {
  const sources = new Map<string, { data: unknown }>();
  const layers = new Map<string, { visibility: string; before?: string }>();
  const order: string[] = [];
  const map = {
    getSource: (id: string) =>
      sources.has(id)
        ? { setData: (d: unknown) => sources.set(id, { data: d }) }
        : undefined,
    addSource: (id: string, spec: { data: unknown }) =>
      sources.set(id, { data: spec.data }),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: { id: string }, before?: string) => {
      layers.set(spec.id, { visibility: 'visible', before });
      order.push(spec.id);
    },
    removeLayer: (id: string) => layers.delete(id),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    setLayoutProperty: (id: string, _k: string, v: string) => {
      const l = layers.get(id);
      if (l) l.visibility = v;
    },
    getLayoutProperty: (id: string) => layers.get(id)?.visibility,
  };
  return { map: map as unknown as maplibregl.Map, sources, layers, order };
}

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};
const gis: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { kind: 'cone' }, geometry: poly },
    {
      type: 'Feature',
      properties: {
        kind: 'track-point',
        pointKind: 'major',
        hour: 12,
        label: '+12 h',
      },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { kind: 'outlook-area', pct7: 90 },
      geometry: poly,
    },
    {
      type: 'Feature',
      properties: {
        kind: 'outlook-point',
        pct7: 90,
        label: '2 d: 90 % · 7 d: 90 %',
      },
      geometry: { type: 'Point', coordinates: [0.5, 0.5] },
    },
  ],
};
const storm = {
  id: 'ep172026',
  name: 'Polo',
  classification: 'HU',
  intensityKt: 105,
  pressureHpa: 950,
  lat: 19.8,
  lng: -113.4,
  advisoryTime: null,
};

describe('tropical storms overlay with the GIS snapshot (Story 18.1)', () => {
  it('draws cone / track layers beneath the position circles and toggles them together', async () => {
    const { map, sources, layers, order } = fakeMap();
    const fetchGis = vi.fn(async () => gis);
    const ov = createTropicalStormsOverlay(map, {
      fetch: async () => [storm],
      fetchGis,
    });
    await ov.refresh();
    expect(fetchGis).toHaveBeenCalledTimes(1);
    const gisData = sources.get('wx-storms-gis-src')?.data as FeatureCollection;
    expect(gisData.features.map((f) => f.properties?.kind)).toEqual([
      'cone',
      'track-point',
    ]);
    // GIS layers exist and were inserted before the circle layer.
    for (const id of [
      'wx-storms-cone-fill',
      'wx-storms-track',
      'wx-storms-track-pt',
      'wx-storms-ww',
    ])
      expect(layers.get(id)?.before).toBe('wx-storms-circle');
    expect(order.indexOf('wx-storms-circle')).toBeLessThan(
      order.indexOf('wx-storms-cone-fill')
    );
    ov.setEnabled(false);
    expect(layers.get('wx-storms-cone-fill')?.visibility).toBe('none');
    expect(layers.get('wx-storms-circle')?.visibility).toBe('none');
    ov.setEnabled(true);
    expect(layers.get('wx-storms-track-pt')?.visibility).toBe('visible');
  });

  it('skips the GIS fetch when there are no active storms and survives a failed one', async () => {
    const { map, sources } = fakeMap();
    const fetchGis = vi.fn(async () => gis);
    const onEmpty = vi.fn();
    const ov = createTropicalStormsOverlay(
      map,
      { fetch: async () => [], fetchGis },
      onEmpty
    );
    await ov.refresh();
    expect(fetchGis).not.toHaveBeenCalled();
    expect(onEmpty).toHaveBeenCalled();
    const failing = createTropicalStormsOverlay(map, {
      fetch: async () => [storm],
      fetchGis: async () => {
        throw new Error('offline');
      },
    });
    await failing.refresh();
    expect(
      (sources.get('wx-storms-gis-src')?.data as FeatureCollection).features
    ).toEqual([]);
  });
});

describe('tropical outlook overlay (Story 18.2)', () => {
  it('draws the outlook areas only, hides on demand and removes itself when empty', async () => {
    const { map, sources, layers } = fakeMap();
    const onEmpty = vi.fn();
    const ov = createTropicalOutlookOverlay(map, async () => gis, onEmpty);
    expect(ov.isEnabled()).toBe(false);
    expect(await ov.refresh()).toBe(1);
    expect(ov.isEnabled()).toBe(true);
    const data = sources.get('wx-outlook-src')?.data as FeatureCollection;
    expect(data.features.map((f) => f.properties?.kind)).toEqual([
      'outlook-area',
      'outlook-point',
    ]);
    ov.setEnabled(false);
    expect(layers.get('wx-outlook-fill')?.visibility).toBe('none');
    expect(ov.isEnabled()).toBe(false);
    const empty = createTropicalOutlookOverlay(map, async () => null, onEmpty);
    expect(await empty.refresh()).toBe(0);
    expect(layers.has('wx-outlook-fill')).toBe(false);
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });
});
