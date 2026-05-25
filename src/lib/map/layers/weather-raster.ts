/**
 * Weather raster layer — radar (RainViewer) and satellite (NASA GIBS).
 *
 * These two products share the same MapLibre layer slot but pull from
 * different sources/parameters. Encapsulating the wiring + the
 * "no-coverage dim" backdrop into a single factory keeps
 * interactive-map.ts free of tile-URL knowledge.
 *
 * Why one factory instead of two: the radar-dim fill must paint UNDER
 * whichever raster (radar or satellite) is active, so the dim's
 * `beforeId` argument needs to know the raster layer id — they really
 * are coupled.
 */
import type { FeatureCollection } from 'geojson';
import type maplibregl from 'maplibre-gl';
import {
  ATTRIBUTION_GIBS,
  GIBS_LAYERS,
  type GibsLayerDef,
  gibsRoundedTime,
  gibsTileUrl,
} from '../sources/nasa-gibs';
import { rainviewerTileUrl, type RadarFrame, type RainviewerData } from '../../maplayers';

const RV_SOURCE = 'wx-raster';
const RV_LAYER = 'wx-raster-layer';
const DIM_SOURCE = 'wx-rv-dim-src';
const DIM_LAYER = 'wx-rv-dim-layer';

/** Public layer + source ids — exported so the existing setActiveLayer
 *  cold-load verification (which checks getLayer(RV_LAYER)) keeps
 *  working without duplicating the constant. */
export const WEATHER_RASTER_LAYER_ID = RV_LAYER;
export const WEATHER_RASTER_SOURCE_ID = RV_SOURCE;

const WORLD_RECT_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -85],
            [180, -85],
            [180, 85],
            [-180, 85],
            [-180, -85],
          ],
        ],
      },
    },
  ],
};

export type SatelliteSubOption = 'geocolor' | 'ir' | 'truecolor';

export function pickGibsLayer(opt: SatelliteSubOption): GibsLayerDef {
  if (opt === 'ir') return GIBS_LAYERS.goesIR;
  if (opt === 'truecolor') return GIBS_LAYERS.modisTrueColor;
  return GIBS_LAYERS.goesGeocolor;
}

export interface WeatherRasterDeps {
  /** Show a transient toast — the factory calls this when satellite
   *  is requested above the GIBS-product max zoom (i.e. user is
   *  zoomed in past where the imagery has usable detail). */
  showMsg?: (text: string) => void;
  hideMsg?: () => void;
}

export interface WeatherRasterFactory {
  /** Show a RainViewer radar/satellite frame OR a NASA GIBS satellite
   *  product. layerId is the active layer id from the public LAYERS
   *  registry — 'radar' / 'satellite'. */
  show: (
    layerId: 'radar' | 'satellite',
    frame: RadarFrame | null,
    ctx: {
      rvData: RainviewerData | null;
      satelliteSubOption: SatelliteSubOption;
      opacity: number;
      currentZoom: number;
    },
  ) => void;
  /** Tear down the active raster + the dim backdrop. */
  remove: () => void;
  /** Set raster-opacity on the layer if it exists. Called by the
   *  global opacity slider. */
  setOpacity: (opacity: number) => void;
}

export function createWeatherRaster(
  map: maplibregl.Map,
  deps: WeatherRasterDeps = {},
): WeatherRasterFactory {
  function addDim(): void {
    if (map.getLayer(DIM_LAYER)) return;
    if (!map.getSource(DIM_SOURCE)) {
      map.addSource(DIM_SOURCE, { type: 'geojson', data: WORLD_RECT_FC });
    }
    const beneath = map.getLayer(RV_LAYER) ? RV_LAYER : undefined;
    map.addLayer(
      {
        id: DIM_LAYER,
        type: 'fill',
        source: DIM_SOURCE,
        paint: {
          'fill-color': '#0a0e1a',
          'fill-opacity': 0.45,
        },
      },
      beneath,
    );
  }

  function removeDim(): void {
    if (map.getLayer(DIM_LAYER)) map.removeLayer(DIM_LAYER);
    if (map.getSource(DIM_SOURCE)) map.removeSource(DIM_SOURCE);
  }

  function teardownRaster(): void {
    if (map.getLayer(RV_LAYER)) map.removeLayer(RV_LAYER);
    if (map.getSource(RV_SOURCE)) map.removeSource(RV_SOURCE);
    removeDim();
  }

  return {
    show: (layerId, frame, ctx): void => {
      teardownRaster();
      addDim();
      if (layerId === 'satellite') {
        const gibsLayer = pickGibsLayer(ctx.satelliteSubOption);
        map.addSource(RV_SOURCE, {
          type: 'raster',
          tiles: [gibsTileUrl(gibsLayer, gibsRoundedTime())],
          tileSize: 256,
          maxzoom: gibsLayer.maxZoom,
          attribution: ATTRIBUTION_GIBS,
        });
        if (ctx.currentZoom > gibsLayer.maxZoom + 1 && deps.showMsg) {
          deps.showMsg(
            `Satélite limitado a zoom z${gibsLayer.maxZoom} (NASA GIBS). Acercando más solo aparece la mancha del basemap.`,
          );
          if (deps.hideMsg) window.setTimeout(deps.hideMsg, 5000);
        }
      } else {
        // Radar from RainViewer.
        // 256px pyramid maxes at ~z8 → server returns "Zoom Level Not
        // Supported" placeholder at higher zoom. 512px pyramid covers
        // through z10. tileSize:512 keeps visual density equivalent.
        if (!ctx.rvData || !frame) return;
        const tileUrl = rainviewerTileUrl(ctx.rvData.host, frame, { size: 512 });
        map.addSource(RV_SOURCE, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 512,
          maxzoom: 10,
          attribution: '© RainViewer',
        });
      }
      map.addLayer({
        id: RV_LAYER,
        type: 'raster',
        source: RV_SOURCE,
        paint: {
          'raster-opacity': ctx.opacity,
          'raster-resampling': 'linear',
        },
      });
    },
    remove: teardownRaster,
    setOpacity: (opacity: number): void => {
      if (map.getLayer(RV_LAYER)) {
        map.setPaintProperty(RV_LAYER, 'raster-opacity', opacity);
      }
    },
  };
}
