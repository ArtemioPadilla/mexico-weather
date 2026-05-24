/**
 * NASA GIBS (Global Imagery Browse Services) data source.
 *
 * GIBS publishes WMTS tile pyramids for hundreds of NASA Earth-observing
 * imagery products at https://gibs.earthdata.nasa.gov/. Free, no API key,
 * CORS-enabled. Suitable for direct browser tile fetching.
 *
 * URL template:
 *   https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/
 *   {LAYER}/default/{TIME}/GoogleMapsCompatible_Level{Z}/{z}/{y}/{x}.{ext}
 *
 * - LAYER: GIBS layer identifier (e.g. GOES-East_ABI_Band13_Clean_Infrared)
 * - TIME: ISO 8601 timestamp; "default" or a specific moment
 * - Z: max zoom for the layer (depends on the product)
 * - ext: png or jpg per layer
 */

/** Minutes between GIBS imagery updates for live satellite layers. */
const REFRESH_MS = 10 * 60 * 1000;

export interface GibsLayerDef {
  /** GIBS layer id, e.g. 'GOES-East_ABI_Band13_Clean_Infrared'. */
  id: string;
  /** Maximum native zoom level supported by GIBS for this product. */
  maxZoom: number;
  /** File extension served by GIBS for this product. */
  ext: 'png' | 'jpg';
  /** Whether the layer supports per-frame TIME query (true) or only the
   *  literal string 'default' (false). */
  hasTime: boolean;
}

/** Common GIBS layers used by Clima México. */
export const GIBS_LAYERS = {
  goesIR: {
    id: 'GOES-East_ABI_Band13_Clean_Infrared',
    maxZoom: 6,
    ext: 'png',
    hasTime: true,
  },
  goesGeocolor: {
    id: 'GOES-East_ABI_GeoColor',
    maxZoom: 6,
    ext: 'png',
    hasTime: true,
  },
  viirsNightLights: {
    id: 'VIIRS_SNPP_DayNightBand_ENCC',
    maxZoom: 8,
    ext: 'png',
    hasTime: true,
  },
  modisTrueColor: {
    id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    maxZoom: 9,
    ext: 'jpg',
    hasTime: true,
  },
} as const satisfies Record<string, GibsLayerDef>;

const HOST = 'https://gibs.earthdata.nasa.gov';

/**
 * Build a tile URL template suitable for use as a MapLibre raster source
 * `tiles` entry.
 *
 * @param layer  GIBS layer definition (see {@link GIBS_LAYERS}).
 * @param time   ISO 8601 timestamp, or 'default' for the latest available.
 */
export function gibsTileUrl(
  layer: GibsLayerDef,
  time: string = 'default',
): string {
  return (
    `${HOST}/wmts/epsg3857/best/${layer.id}/default/` +
    `${time}/GoogleMapsCompatible_Level${layer.maxZoom}/` +
    `{z}/{y}/{x}.${layer.ext}`
  );
}

/** Round a timestamp down to the nearest GIBS refresh interval. Used so
 *  tile URLs stay stable for {@link REFRESH_MS} and benefit from HTTP
 *  caching. */
export function gibsRoundedTime(date: Date = new Date()): string {
  const t = Math.floor(date.getTime() / REFRESH_MS) * REFRESH_MS;
  // GIBS expects ISO 8601 with seconds resolution.
  return new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
}

export const ATTRIBUTION_GIBS = '© NASA EOSDIS GIBS';
