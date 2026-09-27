/**
 * Pressure isobars layer.
 *
 * Renders d3-contour iso-lines over the active pressure field as thin
 * white polylines. Visible only when the pressure layer is active —
 * the wiring code in interactive-map.ts gates refresh() accordingly.
 *
 * The factory exposes update() / remove() so the caller can keep its
 * existing tick (post-frame, post-pan) flow.
 */
import type { FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';
import { computeIsobars } from '../utils/isobars';

const SOURCE_ID = 'wx-isobars-src';
const LAYER_ID = 'wx-isobars-line';
// Story 18.3 — values printed along the lines (symbol-placement: line).
const LABEL_LAYER_ID = 'wx-isobars-label';

export type IsobarUnit = 'hPa' | 'inHg';

/** MapLibre expression for the label in the chosen unit; the source
 *  keeps hPa so switching units is a layout-property change only. */
export function isobarLabelExpression(
  unit: IsobarUnit
): maplibregl.ExpressionSpecification {
  if (unit === 'inHg') {
    return [
      'number-format',
      ['/', ['get', 'pressure'], 33.8639],
      { 'min-fraction-digits': 2, 'max-fraction-digits': 2 },
    ];
  }
  return ['to-string', ['round', ['get', 'pressure']]];
}

export interface IsobarsLayer {
  /** Add/update the layer with iso-lines for the given field values
   *  laid out row-major. Internally builds the GeoJSON via
   *  computeIsobars() and either creates the source/layer (first
   *  call) or replaces its data (subsequent calls). */
  update: (input: {
    values: number[];
    cols: number;
    rows: number;
    bounds: { south: number; west: number; north: number; east: number };
  }) => void;
  /** Tear down the source + layer. */
  remove: () => void;
  /** Story 18.3 — re-label the lines in hPa or inHg (no data change). */
  setUnit: (unit: IsobarUnit) => void;
}

export function createIsobarsLayer(
  map: maplibregl.Map,
  getUnit: () => IsobarUnit = () => 'hPa'
): IsobarsLayer {
  return {
    update: (input): void => {
      const fc: FeatureCollection = computeIsobars({
        values: input.values,
        cols: input.cols,
        rows: input.rows,
        south: input.bounds.south,
        west: input.bounds.west,
        north: input.bounds.north,
        east: input.bounds.east,
      });
      const existing = map.getSource(SOURCE_ID) as
        maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(fc);
        return;
      }
      map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#ffffff',
          'line-width': 1.0,
          'line-opacity': 0.55,
        },
      });
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 260,
          'text-field': isobarLabelExpression(getUnit()),
          'text-size': 10,
          'text-font': ['Open Sans Semibold'],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'text-max-angle': 30,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.75)',
          'text-halo-width': 1.2,
        },
      });
    },
    remove: (): void => {
      if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    },
    setUnit: (unit): void => {
      if (map.getLayer(LABEL_LAYER_ID)) {
        map.setLayoutProperty(
          LABEL_LAYER_ID,
          'text-field',
          isobarLabelExpression(unit)
        );
      }
    },
  };
}
