/**
 * Active fires overlay (zoom.earth "Incendios activos").
 *
 * NASA FIRMS VIIRS-SNPP 24-hour fire detections in NA/Central America.
 * FIRMS's public CSV endpoint has no CORS, so we cache to
 * public/data/fires-na.json via the firms-fires.yml GitHub Action and
 * fetch the JSON at runtime.
 *
 * Radius scales with Fire Radiative Power (frp, MW).
 */
import type { FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';

const SOURCE_ID = 'wx-fires-src';
const LAYER_ID = 'wx-fires-circle';

export interface FiresOverlay {
  isEnabled: () => boolean;
  setEnabled: (on: boolean) => Promise<void>;
}

export interface FiresOverlayDeps {
  fetch: typeof fetch;
  /** Site base (e.g. '/mexico-weather/') used to resolve the cached
   *  fire JSON shipped under public/data/. */
  base: string;
}

export function createFiresOverlay(
  map: maplibregl.Map,
  deps: FiresOverlayDeps,
): FiresOverlay {
  let fetchPromise: Promise<FeatureCollection> | null = null;

  const loadData = (): Promise<FeatureCollection> => {
    if (fetchPromise) return fetchPromise;
    fetchPromise = deps
      .fetch(`${deps.base}data/fires-na.json`)
      .then((r) =>
        r.ok
          ? (r.json() as Promise<FeatureCollection>)
          : ({
              type: 'FeatureCollection',
              features: [],
            } as FeatureCollection),
      )
      .catch(
        () =>
          ({ type: 'FeatureCollection', features: [] } as FeatureCollection),
      );
    return fetchPromise;
  };

  return {
    isEnabled: (): boolean => !!map.getLayer(LAYER_ID),
    setEnabled: async (on: boolean): Promise<void> => {
      if (!on) {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        return;
      }
      if (map.getSource(SOURCE_ID)) return;
      const data = await loadData();
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, { type: 'geojson', data });
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          // FRP-scaled radius: small detections 3 px, intense 9 px.
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'frp'],
            0, 3,
            5, 4,
            50, 6,
            200, 9,
          ],
          'circle-color': '#f97316', // orange-500
          'circle-opacity': 0.85,
          'circle-stroke-color': '#fef3c7',
          'circle-stroke-width': 0.8,
        },
      });
    },
  };
}
