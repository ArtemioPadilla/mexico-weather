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

/** How far behind "now" the newest GOES tile usually is. Measured
 *  2026-09-27: the capabilities' default TIME was 25–30 min old and a
 *  tile 20 min old returned 404. Frames newer than now − lag are not
 *  offered on the timeline. */
export const GIBS_LAG_MS = 30 * 60 * 1000;

/** How far back GOES imagery is kept. Measured 2026-09-27: GeoColor
 *  tiles at −3 d, −30 d and −44 d returned 200, −60 d returned 404.
 *  45 days of 10-minute frames — zoom.earth's free tier offers 10. */
export const GIBS_HISTORY_DAYS = 45;

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
  /** TIME granularity: 'PT10M' → full ISO timestamp rounded to 10 min
   *  (GOES); 'P1D' → a bare YYYY-MM-DD (MODIS, VIIRS daily products). */
  step: 'PT10M' | 'P1D';
}

/** Common GIBS layers used by Clima México. */
// `maxZoom` doubles as the TileMatrixSet level in the URL
// (GoogleMapsCompatible_Level<N>). It MUST match what the GIBS
// capabilities publish for the layer or every tile is a 400
// "TILEMATRIXSET is invalid for LAYER". Verified against
// https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
// on 2026-09-27 (GeoColor moved from Level6 to Level7; the SNPP ENCC
// night-lights product stopped in 2023-07 and was replaced here by the
// NOAA-20 at-sensor DNB, which is current). basemap-canary.yml probes
// GeoColor nightly so the next silent change is caught.
export const GIBS_LAYERS = {
  goesIR: {
    id: 'GOES-East_ABI_Band13_Clean_Infrared',
    maxZoom: 6,
    ext: 'png',
    hasTime: true,
    step: 'PT10M',
  },
  goesGeocolor: {
    id: 'GOES-East_ABI_GeoColor',
    maxZoom: 7,
    ext: 'png',
    hasTime: true,
    step: 'PT10M',
  },
  viirsNightLights: {
    id: 'VIIRS_NOAA20_DayNightBand_AtSensor_M15',
    maxZoom: 8,
    ext: 'png',
    hasTime: true,
    step: 'P1D',
  },
  modisTrueColor: {
    id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    maxZoom: 9,
    ext: 'jpg',
    hasTime: true,
    step: 'P1D',
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
  time: string = 'default'
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

/** TIME parameter for a layer at an instant: 10-minute ISO for GOES,
 *  bare date for daily products. */
export function gibsTimeParam(layer: GibsLayerDef, epochMs: number): string {
  if (layer.step === 'P1D') return new Date(epochMs).toISOString().slice(0, 10);
  return gibsRoundedTime(new Date(epochMs));
}

/** Newest GOES frame we expect to exist: now minus the publishing lag,
 *  rounded down to the 10-minute grid. */
export function gibsLatestTime(now: Date = new Date()): string {
  return gibsRoundedTime(new Date(now.getTime() - GIBS_LAG_MS));
}

export const ATTRIBUTION_GIBS = '© NASA EOSDIS GIBS';
