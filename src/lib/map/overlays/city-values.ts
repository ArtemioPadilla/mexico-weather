/**
 * City value pills overlay (zoom.earth "Valores de etiquetas").
 *
 * For each preset city, render a symbol layer pill containing the
 * city name + the current value of the active field/particles layer
 * ("CDMX\n26°", "GDL\n78 %", "MTY\n12 km/h ↑", etc).
 *
 * The factory takes a `getValueAt(lng, lat)` callback so it stays
 * decoupled from the field-state machinery that owns tooltipValueAt
 * in interactive-map.ts.
 */
import type { FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';

const SOURCE_ID = 'wx-city-values-src';
const LAYER_ID = 'wx-city-values-text';

export interface CityPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface CityValuesOverlay {
  /** Recompute the value at each city via the supplied callback and
   *  add/update the layer. Caller invokes this whenever the active
   *  layer's grid or frame changes. */
  refresh: () => void;
  /** Tear down the source + layer. */
  remove: () => void;
  /** Toggle whether the pills should be rendered. Default true. The
   *  caller's overlay registry mirrors this value. */
  setEnabled: (on: boolean) => void;
  isEnabled: () => boolean;
}

export interface CityValuesDeps {
  /** List of cities to pin. */
  cities: ReadonlyArray<CityPoint>;
  /** Returns the value string ("26°", "78 %", etc) at the given
   *  coords, or null when no value is available yet. */
  getValueAt: (lng: number, lat: number) => string | null;
  /** Predicate: should the layer be shown for the current map state?
   *  Typical wiring: true iff active layer kind is 'field' or
   *  'particles'. */
  isShowable: () => boolean;
}

export function createCityValuesOverlay(
  map: maplibregl.Map,
  deps: CityValuesDeps,
): CityValuesOverlay {
  let enabled = true;

  function remove(): void {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  function refresh(): void {
    const showable = enabled && deps.isShowable();
    if (!showable) {
      remove();
      return;
    }
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: deps.cities
        .map((c) => {
          const value = deps.getValueAt(c.lng, c.lat);
          if (!value) return null;
          // Pre-compose "Name\nValue" so the symbol layer uses a plain
          // ['get', 'label'] expression. The format/section expression
          // was silently failing in production on our MapLibre version.
          const label = `${c.name}\n${value}`;
          return {
            type: 'Feature' as const,
            properties: { value, name: c.name, label },
            geometry: {
              type: 'Point' as const,
              coordinates: [c.lng, c.lat] as [number, number],
            },
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null),
    };
    const existing = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (existing) {
      existing.setData(fc);
      return;
    }
    map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
    map.addLayer({
      id: LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      // Hide at country-wide zoom (≤4.99) to avoid label saturation.
      // At z5 the largest 15 MX cities fit; from z7+ values read clearly.
      minzoom: 5,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 4,
        'text-line-height': 1.1,
        'text-font': ['Open Sans Semibold'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.75)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.2,
      },
    });
  }

  return {
    refresh,
    remove,
    setEnabled: (on: boolean): void => {
      enabled = on;
      refresh();
    },
    isEnabled: (): boolean => enabled,
  };
}
