/**
 * Tropical storms overlay (zoom.earth "Sistemas tropicales").
 *
 * Active NHC Atlantic + East Pacific systems rendered as classification-
 * coloured circles + a name label. During hurricane off-season (Dec-May
 * typically) the data is empty and the overlay auto-disables.
 *
 * The factory takes:
 *   - a `source` with `fetch(): Promise<readonly NhcStorm[]>` (typically
 *     nhcSource from src/lib/map/sources/nhc.ts so this remains testable),
 *   - an optional `onEmpty()` callback fired when NHC returns zero storms;
 *     the wiring layer uses this to auto-uncheck the overlay checkbox.
 */
import type { FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';
import type { NhcStorm } from '../sources/nhc';
import { labelHalo, labelLayout } from '../utils/label-style';

const SOURCE_ID = 'wx-storms-src';
const CIRCLE_LAYER_ID = 'wx-storms-circle';
const LABEL_LAYER_ID = 'wx-storms-label';
// Stories 18.1 — forecast cone, track and watches/warnings from the
// storms-gis.json snapshot, drawn under the position circles.
const GIS_SOURCE_ID = 'wx-storms-gis-src';
const CONE_FILL_ID = 'wx-storms-cone-fill';
const CONE_LINE_ID = 'wx-storms-cone-line';
const WW_LINE_ID = 'wx-storms-ww';
const TRACK_LINE_ID = 'wx-storms-track';
const TRACK_POINT_ID = 'wx-storms-track-pt';
const TRACK_LABEL_ID = 'wx-storms-track-label';
const GIS_LAYER_IDS = [
  CONE_FILL_ID,
  CONE_LINE_ID,
  WW_LINE_ID,
  TRACK_LINE_ID,
  TRACK_POINT_ID,
  TRACK_LABEL_ID,
] as const;

/** Forecast-point colour by NHC style: major (≥96 kt) → hurricane →
 *  storm → depression → low; the initial position reads as the storm's
 *  own circle so it takes the hurricane colour. */
export const TRACK_POINT_COLORS: Record<string, string> = {
  major: '#b91c1c',
  hurricane: '#dc2626',
  storm: '#f97316',
  depression: '#eab308',
  low: '#9ca3af',
  initial: '#ffffff',
};

/** NHC watch/warning colours (their KML uses the same hues). */
export const WW_COLORS: Record<string, string> = {
  HWR: '#dc2626',
  HWA: '#f472b6',
  TWR: '#2563eb',
  TWA: '#facc15',
};

/** Storm-related features (everything but the outlook areas, which
 *  the tropical-outlook overlay owns). Pure, so it is unit-testable. */
export function stormGisFeatures(
  fc: FeatureCollection | null
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (fc?.features ?? []).filter((f) => {
      const k = String(f.properties?.kind ?? '');
      return (
        k === 'cone' || k === 'track-line' || k === 'track-point' || k === 'ww'
      );
    }),
  };
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

export type { NhcStorm } from '../sources/nhc';

export interface TropicalStormsSource {
  fetch: () => Promise<readonly NhcStorm[]>;
  /** Optional GIS snapshot (cone / track / watches). Absent or null →
   *  positions only, exactly the pre-18.1 behaviour. */
  fetchGis?: () => Promise<FeatureCollection | null>;
}

export function stormsFeatureCollection(
  storms: readonly NhcStorm[]
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: storms.map((s) => ({
      type: 'Feature',
      properties: {
        name: s.name,
        classification: s.classification,
        intensityKt: s.intensityKt ?? 0,
        label: `${s.classification} ${s.name}`,
      },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  };
}

export interface TropicalStormsOverlay {
  isEnabled: () => boolean;
  /** Toggle visibility of the layers (the data is fetched separately
   *  via refresh(); this is a pure visibility flip). */
  setEnabled: (on: boolean) => void;
  /** Re-fetch from NHC and update the source data. Safe to call any
   *  number of times — idempotent across calls. */
  refresh: () => Promise<void>;
}

export function createTropicalStormsOverlay(
  map: maplibregl.Map,
  source: TropicalStormsSource,
  onEmpty?: () => void
): TropicalStormsOverlay {
  function ensureGisLayers(): void {
    if (map.getSource(GIS_SOURCE_ID)) return;
    map.addSource(GIS_SOURCE_ID, { type: 'geojson', data: EMPTY_FC });
    const beneath = map.getLayer(CIRCLE_LAYER_ID) ? CIRCLE_LAYER_ID : undefined;
    map.addLayer(
      {
        id: CONE_FILL_ID,
        type: 'fill',
        source: GIS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'cone'],
        paint: { 'fill-color': '#f97316', 'fill-opacity': 0.15 },
      },
      beneath
    );
    map.addLayer(
      {
        id: CONE_LINE_ID,
        type: 'line',
        source: GIS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'cone'],
        paint: {
          'line-color': '#f97316',
          'line-width': 1.2,
          'line-opacity': 0.8,
        },
      },
      beneath
    );
    map.addLayer(
      {
        id: WW_LINE_ID,
        type: 'line',
        source: GIS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'ww'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'wwType'],
            'HWR',
            WW_COLORS.HWR,
            'HWA',
            WW_COLORS.HWA,
            'TWR',
            WW_COLORS.TWR,
            'TWA',
            WW_COLORS.TWA,
            '#9ca3af',
          ],
          'line-width': 5,
          'line-opacity': 0.85,
        },
      },
      beneath
    );
    map.addLayer(
      {
        id: TRACK_LINE_ID,
        type: 'line',
        source: GIS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'track-line'],
        paint: {
          'line-color': '#ffffff',
          'line-width': 2,
          'line-opacity': 0.9,
          // Days 4–5 (the 120 h line) dashed, like NHC's own graphic.
          'line-dasharray': [
            'case',
            ['>', ['get', 'hours'], 72],
            ['literal', [2, 2]],
            ['literal', [1, 0]],
          ],
        },
      },
      beneath
    );
    map.addLayer(
      {
        id: TRACK_POINT_ID,
        type: 'circle',
        source: GIS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'track-point'],
        paint: {
          'circle-color': [
            'match',
            ['get', 'pointKind'],
            'major',
            TRACK_POINT_COLORS.major,
            'hurricane',
            TRACK_POINT_COLORS.hurricane,
            'storm',
            TRACK_POINT_COLORS.storm,
            'depression',
            TRACK_POINT_COLORS.depression,
            'low',
            TRACK_POINT_COLORS.low,
            TRACK_POINT_COLORS.initial,
          ],
          'circle-radius': 4.5,
          'circle-opacity': ['case', ['get', 'extended'], 0.55, 0.95],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      },
      beneath
    );
    map.addLayer(
      {
        id: TRACK_LABEL_ID,
        type: 'symbol',
        source: GIS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'track-point'],
        minzoom: 4,
        layout: {
          'text-field': ['get', 'label'],
          ...labelLayout('detail'),
          'text-offset': [0, -1.1],
          'text-anchor': 'bottom',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#ffffff',
          ...labelHalo('light'),
        },
      },
      beneath
    );
  }

  function ensureLayers(initial: FeatureCollection): void {
    if (map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, { type: 'geojson', data: initial });
    map.addLayer({
      id: CIRCLE_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        // HU/MH red; TS orange; TD yellow; default orange.
        'circle-color': [
          'match',
          ['get', 'classification'],
          'HU',
          '#dc2626',
          'MH',
          '#b91c1c',
          'TS',
          '#f97316',
          'TD',
          '#eab308',
          '#f97316',
        ],
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'intensityKt'],
          0,
          6,
          50,
          9,
          100,
          13,
          150,
          18,
        ],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        ...labelLayout('name'),
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#ffffff',
        ...labelHalo('light'),
      },
    });
  }

  return {
    isEnabled: (): boolean => {
      const c = map.getLayer(CIRCLE_LAYER_ID);
      if (!c) return false;
      return map.getLayoutProperty(CIRCLE_LAYER_ID, 'visibility') !== 'none';
    },
    setEnabled: (on: boolean): void => {
      const vis = on ? 'visible' : 'none';
      if (map.getLayer(CIRCLE_LAYER_ID))
        map.setLayoutProperty(CIRCLE_LAYER_ID, 'visibility', vis);
      if (map.getLayer(LABEL_LAYER_ID))
        map.setLayoutProperty(LABEL_LAYER_ID, 'visibility', vis);
      for (const id of GIS_LAYER_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
    },
    refresh: async (): Promise<void> => {
      let storms: readonly NhcStorm[];
      try {
        storms = await source.fetch();
      } catch {
        storms = [];
      }
      const fc = stormsFeatureCollection(storms);
      const existing = map.getSource(SOURCE_ID) as
        maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(fc);
      } else {
        ensureLayers(fc);
      }
      // Story 18.1 — cone / track / watches ride along; a missing or
      // failed snapshot just leaves the GIS source empty.
      if (source.fetchGis && storms.length > 0) {
        const gis = await source
          .fetchGis()
          .catch((): FeatureCollection | null => null);
        ensureGisLayers();
        (map.getSource(GIS_SOURCE_ID) as maplibregl.GeoJSONSource).setData(
          stormGisFeatures(gis)
        );
        const vis = map.getLayoutProperty(CIRCLE_LAYER_ID, 'visibility');
        for (const id of GIS_LAYER_IDS) {
          if (map.getLayer(id))
            map.setLayoutProperty(id, 'visibility', vis ?? 'visible');
        }
      }
      if (storms.length === 0 && onEmpty) onEmpty();
    },
  };
}
