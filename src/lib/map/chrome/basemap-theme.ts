/**
 * Basemap theme + label-density controller.
 *
 * Drives two raster sources (base + reference/labels) in response to
 * three inputs:
 *   1. html.dark class — swaps both sources' tile URLs dark↔light.
 *   2. map zoom level  — hides the reference (labels) layer at z<5 to
 *      reduce label saturation (plan P2.5).
 *   3. imagery flag    — Story 21.1: while a raster-tile weather layer
 *      (satellite / radar) is on screen the basemap is dark even in
 *      the light theme (clouds and echoes read like zoom.earth, not
 *      like a print-out), and the reference layer — which the weather
 *      raster is inserted BENEATH (see layers/weather-raster.ts) — is
 *      dimmed to 0.8 so labels stay legible without shouting over the
 *      imagery.
 *
 * Stays out of interactive-map.ts so the theme logic is reusable on
 * any other map instance (e.g. forecast page embed) and testable in
 * isolation.
 *
 * Design notes (why Esri Canvas, why two layers, why sharding):
 *
 * - CARTO Positron / Dark Matter (the previous provider) started
 *   watermarking every anonymous tile with "API KEY REQUIRED" while
 *   still returning HTTP 200 — a failure mode no URL-template test can
 *   see. Esri's public Canvas services serve clean tiles with no key.
 *   A nightly network canary (.github/workflows/basemap-canary.yml)
 *   downloads a sample tile from every host below and fails if the
 *   content stops looking like a map tile.
 * - Esri ships labels as a separate "Reference" service instead of
 *   `_all` / `_nolabels` variants, so the labels toggle is now a
 *   visibility flip on the reference layer, not a URL swap.
 * - Host sharding is mandatory. A single tile host gives MapLibre's
 *   concurrent tile burst no parallelism (HTTP/1.1, 6 connections per
 *   host) and blanked the light basemap at zoom ≥5 when it was served
 *   from `tile.openstreetmap.org`. Esri exposes exactly two subdomains,
 *   `server` and `server2` (verified 2026-09-15: `server3`/`server4`
 *   time out), each a distinct CloudFront distribution. Both are used.
 * - Esri's tile path order is `{z}/{y}/{x}` (not `{z}/{x}/{y}`), and
 *   the Canvas services stop at zoom 16.
 */
import type maplibregl from 'maplibre-gl';

const ESRI_HOSTS = ['server', 'server2'] as const;

function esriTiles(service: string): string[] {
  return ESRI_HOSTS.map(
    (h) =>
      `https://${h}.arcgisonline.com/ArcGIS/rest/services/Canvas/${service}/MapServer/tile/{z}/{y}/{x}`
  );
}

/** Dark gray canvas — no labels (jpeg). */
export const ESRI_DARK_BASE = esriTiles('World_Dark_Gray_Base');
/** Dark gray canvas — labels + boundaries only (png, transparent). */
export const ESRI_DARK_REFERENCE = esriTiles('World_Dark_Gray_Reference');
/** Light gray canvas — no labels (jpeg). */
export const ESRI_LIGHT_BASE = esriTiles('World_Light_Gray_Base');
/** Light gray canvas — labels + boundaries only (png, transparent). */
export const ESRI_LIGHT_REFERENCE = esriTiles('World_Light_Gray_Reference');

/** Max zoom the Esri Canvas services are published at. */
export const ESRI_CANVAS_MAX_ZOOM = 16;

/** Attribution string required by Esri's public basemap terms. */
export const BASEMAP_ATTRIBUTION =
  'Esri, HERE, Garmin, © OpenStreetMap contributors';

/** Below this zoom the basemap drops labels to reduce saturation. */
export const LABEL_ZOOM_THRESHOLD = 5;

/** Story 21.1 — raster-opacity of the reference (labels) layer while it
 *  sits on top of satellite / radar imagery. 1 when no imagery is shown. */
export const REFERENCE_OVER_IMAGERY_OPACITY = 0.8;

export interface BasemapTiles {
  base: string[];
  reference: string[];
}

export interface BasemapTilesInput {
  /** html.dark is set (user / OS theme). */
  dark: boolean;
  /** A raster-tile weather layer (satellite, radar) is on screen. */
  imagery: boolean;
}

/**
 * Pure mapping { dark, imagery } → { base, reference } tile URL lists.
 * Exposed for tests. Imagery forces the dark canvas regardless of the
 * theme (Story 21.1): light gray under GeoColor clouds looks washed
 * out and the light reference labels vanish over white cloud tops.
 * The returned arrays are the module constants, so callers can compare
 * two picks by identity.
 */
export function pickBasemapTiles(input: BasemapTilesInput): BasemapTiles {
  return input.dark || input.imagery
    ? { base: ESRI_DARK_BASE, reference: ESRI_DARK_REFERENCE }
    : { base: ESRI_LIGHT_BASE, reference: ESRI_LIGHT_REFERENCE };
}

/** True when a pick points at the dark canvas. */
export function isDarkBasemap(tiles: BasemapTiles): boolean {
  return tiles.base === ESRI_DARK_BASE;
}

export interface BasemapThemeController {
  /** Re-evaluate (dark, imagery, zoom) and swap tiles / label visibility
   *  / label opacity if any of them changed. */
  sync: () => void;
  /** Story 21.1 — tell the controller whether a raster-tile weather
   *  layer is on screen; re-syncs immediately. Idempotent. */
  setImagery: (on: boolean) => void;
  /** Tear down the html.dark MutationObserver started by start(). */
  dispose: () => void;
}

export interface BasemapThemeOptions {
  /** Raster source id of the gray canvas. Default 'osm' (legacy id). */
  baseSourceId?: string;
  /** Raster source id of the labels/reference overlay. Default 'osm-reference'. */
  referenceSourceId?: string;
  /** Layer id rendering the reference source. Default 'osm-reference'. */
  referenceLayerId?: string;
  /** Theme the map was constructed with (its sources already carry the
   *  matching tiles, so the first sync() skips the swap). */
  initialDark?: boolean;
  /** Story 21.1 — imagery state the map was constructed with; pairs
   *  with initialDark to describe the tiles already in the sources.
   *  Default false. */
  initialImagery?: boolean;
}

export const DEFAULT_BASE_SOURCE_ID = 'osm';
export const DEFAULT_REFERENCE_SOURCE_ID = 'osm-reference';
export const DEFAULT_REFERENCE_LAYER_ID = 'osm-reference';

type RasterSourceLike = {
  setTiles?: (tiles: string[]) => unknown;
  attribution?: string;
};

/**
 * Attach the theme controller to a map. Returns { sync, dispose }.
 * Caller wires `map.on('zoomend', sync)` and the initial `sync()`.
 */
export function createBasemapThemeController(
  map: maplibregl.Map,
  opts: BasemapThemeOptions = {}
): BasemapThemeController {
  const baseSourceId = opts.baseSourceId ?? DEFAULT_BASE_SOURCE_ID;
  const referenceSourceId =
    opts.referenceSourceId ?? DEFAULT_REFERENCE_SOURCE_ID;
  const referenceLayerId = opts.referenceLayerId ?? DEFAULT_REFERENCE_LAYER_ID;
  let imagery = opts.initialImagery ?? false;
  // Tiles the sources currently carry (null = unknown → swap on first sync).
  let lastTiles: BasemapTiles | null =
    opts.initialDark == null
      ? null
      : pickBasemapTiles({ dark: opts.initialDark, imagery });
  let lastDense: boolean | null = null;
  // Reference raster-opacity last applied (imagery ? 0.8 : 1).
  let lastImageryOpacity: boolean | null = null;
  let observer: MutationObserver | null = null;

  const refetch = (sourceId: string): void => {
    // setTiles updates the URL template for FUTURE fetches but leaves
    // already-cached tiles painting from the old theme. Force a refetch
    // via the source cache so all tiles re-resolve through the new
    // URL within one frame.
    const styleAny = map.style as unknown as {
      sourceCaches?: Record<
        string,
        { clearTiles?: () => void; update?: (t: unknown) => void }
      >;
      _otherSourceCaches?: Record<
        string,
        { clearTiles?: () => void; update?: (t: unknown) => void }
      >;
    };
    const sc =
      styleAny.sourceCaches?.[sourceId] ??
      styleAny._otherSourceCaches?.[sourceId];
    sc?.clearTiles?.();
    sc?.update?.((map as unknown as { transform: unknown }).transform);
  };

  const sync = (): void => {
    const dark = document.documentElement.classList.contains('dark');
    const dense = map.getZoom() >= LABEL_ZOOM_THRESHOLD;
    const tiles = pickBasemapTiles({ dark, imagery });
    const tilesChanged =
      !lastTiles ||
      tiles.base !== lastTiles.base ||
      tiles.reference !== lastTiles.reference;
    if (
      !tilesChanged &&
      dense === lastDense &&
      imagery === lastImageryOpacity
    ) {
      return;
    }

    if (tilesChanged) {
      const pairs: Array<[string, string[]]> = [
        [baseSourceId, tiles.base],
        [referenceSourceId, tiles.reference],
      ];
      let swapped = 0;
      for (const [id, urls] of pairs) {
        const src = map.getSource(id) as unknown as
          RasterSourceLike | undefined;
        if (!src || typeof src.setTiles !== 'function') continue;
        try {
          src.setTiles(urls);
          src.attribution = BASEMAP_ATTRIBUTION;
          refetch(id);
          swapped++;
        } catch {
          /* retry on next mutation */
        }
      }
      if (swapped === pairs.length) lastTiles = tiles;
    }

    if (dense !== lastDense) {
      try {
        if (map.getLayer(referenceLayerId)) {
          map.setLayoutProperty(
            referenceLayerId,
            'visibility',
            dense ? 'visible' : 'none'
          );
          lastDense = dense;
        }
      } catch {
        /* retry on next zoomend */
      }
    }

    if (imagery !== lastImageryOpacity) {
      // Story 21.1 — the weather raster sits between base and labels;
      // dim the labels a notch so they read as annotation, not chrome.
      try {
        if (map.getLayer(referenceLayerId)) {
          map.setPaintProperty(
            referenceLayerId,
            'raster-opacity',
            imagery ? REFERENCE_OVER_IMAGERY_OPACITY : 1
          );
          lastImageryOpacity = imagery;
        }
      } catch {
        /* retry on next sync */
      }
    }
  };

  const setImagery = (on: boolean): void => {
    if (on === imagery) return;
    imagery = on;
    sync();
  };

  // Watch html.dark class changes (user-driven theme toggle).
  observer = new MutationObserver(() => sync());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  return {
    sync,
    setImagery,
    dispose: (): void => {
      observer?.disconnect();
      observer = null;
    },
  };
}
