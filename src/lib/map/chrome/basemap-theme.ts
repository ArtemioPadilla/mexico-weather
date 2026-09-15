/**
 * Basemap theme + label-density controller.
 *
 * Drives two raster sources (base + reference/labels) in response to
 * two inputs:
 *   1. html.dark class — swaps both sources' tile URLs dark↔light.
 *   2. map zoom level  — hides the reference (labels) layer at z<5 to
 *      reduce label saturation (plan P2.5).
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

export interface BasemapTiles {
  base: string[];
  reference: string[];
}

/** Pure mapping dark? → { base, reference } tile URL lists. Exposed for tests. */
export function pickBasemapTiles(dark: boolean): BasemapTiles {
  return dark
    ? { base: ESRI_DARK_BASE, reference: ESRI_DARK_REFERENCE }
    : { base: ESRI_LIGHT_BASE, reference: ESRI_LIGHT_REFERENCE };
}

export interface BasemapThemeController {
  /** Re-evaluate (dark, zoom) and swap tiles / label visibility if either changed. */
  sync: () => void;
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
  initialDark?: boolean;
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
  let lastDark: boolean | null = opts.initialDark ?? null;
  let lastDense: boolean | null = null;
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
    if (dark === lastDark && dense === lastDense) return;

    if (dark !== lastDark) {
      const tiles = pickBasemapTiles(dark);
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
      if (swapped === pairs.length) lastDark = dark;
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
  };

  // Watch html.dark class changes (user-driven theme toggle).
  observer = new MutationObserver(() => sync());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  return {
    sync,
    dispose: (): void => {
      observer?.disconnect();
      observer = null;
    },
  };
}
