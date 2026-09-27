/**
 * Tropical Weather Outlook overlay (Story 18.2, plan PRO_GRATIS E18):
 * NHC's "areas of possible development" for the Atlantic and East
 * Pacific, with the 2-day / 7-day formation chance. Data comes from
 * the storms-gis.json snapshot (features tagged `outlook-area` /
 * `outlook-point`); the overlay auto-hides when there is none.
 */
import type { FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';

const SOURCE_ID = 'wx-outlook-src';
const AREA_FILL_ID = 'wx-outlook-fill';
const AREA_LINE_ID = 'wx-outlook-line';
const POINT_ID = 'wx-outlook-point';
const LABEL_ID = 'wx-outlook-label';
const LAYER_IDS = [AREA_FILL_ID, AREA_LINE_ID, POINT_ID, LABEL_ID] as const;

/** NHC's own colour scale: yellow < 40 %, orange 40–60 %, red ≥ 60 %
 *  (7-day chance decides, like the TWO graphic). */
export function outlookColor(pct7: number | null | undefined): string {
  const p = typeof pct7 === 'number' ? pct7 : 0;
  if (p >= 60) return '#dc2626';
  if (p >= 40) return '#f97316';
  return '#facc15';
}

/** Outlook features only (the storm overlay owns the rest). */
export function outlookFeatures(
  fc: FeatureCollection | null
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (fc?.features ?? []).filter((f) => {
      const k = String(f.properties?.kind ?? '');
      return k === 'outlook-area' || k === 'outlook-point';
    }),
  };
}

export interface TropicalOutlookOverlay {
  isEnabled: () => boolean;
  setEnabled: (on: boolean) => void;
  /** Re-read the snapshot; resolves to the number of areas drawn. */
  refresh: () => Promise<number>;
}

export function createTropicalOutlookOverlay(
  map: maplibregl.Map,
  fetchGis: () => Promise<FeatureCollection | null>,
  onEmpty?: () => void
): TropicalOutlookOverlay {
  let wanted = true;

  function ensureLayers(): void {
    if (map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    const colorExpr: maplibregl.ExpressionSpecification = [
      'case',
      ['>=', ['coalesce', ['get', 'pct7'], 0], 60],
      '#dc2626',
      ['>=', ['coalesce', ['get', 'pct7'], 0], 40],
      '#f97316',
      '#facc15',
    ];
    map.addLayer({
      id: AREA_FILL_ID,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'outlook-area'],
      paint: { 'fill-color': colorExpr, 'fill-opacity': 0.18 },
    });
    map.addLayer({
      id: AREA_LINE_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'outlook-area'],
      paint: {
        'line-color': colorExpr,
        'line-width': 1.5,
        'line-dasharray': [3, 2],
        'line-opacity': 0.9,
      },
    });
    map.addLayer({
      id: POINT_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'outlook-point'],
      paint: {
        'circle-color': colorExpr,
        'circle-radius': 7,
        'circle-opacity': 0.9,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: LABEL_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'outlook-point'],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-font': ['Open Sans Semibold'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.4,
      },
    });
  }

  function applyVisibility(): void {
    const vis = wanted ? 'visible' : 'none';
    for (const id of LAYER_IDS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    }
  }

  return {
    isEnabled: (): boolean => wanted && !!map.getLayer(AREA_FILL_ID),
    setEnabled: (on: boolean): void => {
      wanted = on;
      applyVisibility();
    },
    refresh: async (): Promise<number> => {
      const fc = await fetchGis().catch((): FeatureCollection | null => null);
      const data = outlookFeatures(fc);
      const areas = data.features.filter(
        (f) => f.properties?.kind === 'outlook-area'
      ).length;
      if (areas === 0) {
        // Nothing to show: drop the layers so the checkbox reads off.
        for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        onEmpty?.();
        return 0;
      }
      ensureLayers();
      (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(data);
      applyVisibility();
      return areas;
    },
  };
}
