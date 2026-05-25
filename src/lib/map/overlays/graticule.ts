/**
 * Graticule overlay (zoom.earth "Retícula").
 *
 * Lat/lng grid at 10° intervals as dashed white lines. Self-contained
 * — no external data, no fetches.
 */
import type { Feature, FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';

const SOURCE_ID = 'wx-graticule-src';
const LAYER_ID = 'wx-graticule-line';

/** Generate a 10°-spacing lat/lng grid as GeoJSON LineStrings.
 *  Pure — independent of map state, exposed for tests. */
export function buildGraticule(): FeatureCollection {
  const features: Feature[] = [];
  for (let lng = -180; lng <= 180; lng += 10) {
    features.push({
      type: 'Feature',
      properties: { kind: 'meridian', value: lng },
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, -85],
          [lng, 85],
        ],
      },
    });
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    const coords: [number, number][] = [];
    for (let lng = -180; lng <= 180; lng += 5) coords.push([lng, lat]);
    features.push({
      type: 'Feature',
      properties: { kind: 'parallel', value: lat },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface GraticuleOverlay {
  isEnabled: () => boolean;
  setEnabled: (on: boolean) => void;
}

export function createGraticuleOverlay(
  map: maplibregl.Map,
): GraticuleOverlay {
  return {
    isEnabled: (): boolean => !!map.getLayer(LAYER_ID),
    setEnabled: (on: boolean): void => {
      if (!on) {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        return;
      }
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, { type: 'geojson', data: buildGraticule() });
      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#ffffff',
          'line-width': 0.6,
          'line-opacity': 0.25,
          'line-dasharray': [2, 2],
        },
      });
    },
  };
}
