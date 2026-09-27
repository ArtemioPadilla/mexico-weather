import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import {
  TRACK_POINT_COLORS,
  WW_COLORS,
  stormGisFeatures,
} from './tropical-storms';
import { outlookColor, outlookFeatures } from './tropical-outlook';

// The Python side (scripts/nhc_kml.py: KMZ → cone / track / watches /
// outlook) carries its own self-test, run by CI as a separate step.

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
const line: GeoJSON.LineString = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1],
  ],
};

const fc: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { kind: 'cone', stormId: 'ep172026' },
      geometry: poly,
    },
    {
      type: 'Feature',
      properties: { kind: 'track-line', hours: 72 },
      geometry: line,
    },
    {
      type: 'Feature',
      properties: { kind: 'track-point', pointKind: 'major', hour: 12 },
      geometry: { type: 'Point', coordinates: [1, 1] },
    },
    {
      type: 'Feature',
      properties: { kind: 'ww', wwType: 'HWR' },
      geometry: line,
    },
    {
      type: 'Feature',
      properties: { kind: 'outlook-area', pct7: 70 },
      geometry: poly,
    },
    {
      type: 'Feature',
      properties: {
        kind: 'outlook-point',
        pct7: 70,
        label: '2 d: 40 % · 7 d: 70 %',
      },
      geometry: { type: 'Point', coordinates: [0.5, 0.5] },
    },
  ],
};

describe('storms GIS split (Stories 18.1 / 18.2)', () => {
  it('storm overlay keeps cone / track / watches, outlook keeps the areas', () => {
    expect(
      stormGisFeatures(fc).features.map((f) => f.properties?.kind)
    ).toEqual(['cone', 'track-line', 'track-point', 'ww']);
    expect(outlookFeatures(fc).features.map((f) => f.properties?.kind)).toEqual(
      ['outlook-area', 'outlook-point']
    );
    expect(stormGisFeatures(null).features).toEqual([]);
    expect(outlookFeatures(null).features).toEqual([]);
  });

  it('colour tables cover every NHC point style and watch code', () => {
    for (const k of [
      'major',
      'hurricane',
      'storm',
      'depression',
      'low',
      'initial',
    ])
      expect(TRACK_POINT_COLORS[k]).toMatch(/^#[0-9a-f]{6}$/);
    for (const k of ['HWR', 'HWA', 'TWR', 'TWA'])
      expect(WW_COLORS[k]).toMatch(/^#[0-9a-f]{6}$/);
    expect(outlookColor(90)).toBe('#dc2626');
    expect(outlookColor(40)).toBe('#f97316');
    expect(outlookColor(10)).toBe('#facc15');
    expect(outlookColor(null)).toBe('#facc15');
  });
});
