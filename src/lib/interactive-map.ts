/**
 * Interactive map factory — extracted from /mapa for re-use on the
 * home page and the forecast page.
 *
 * The /mapa page passes `mode: 'fullscreen'` to keep the legacy stable IDs
 * (#map, #mapq, #mapac, #layerbtn-*, #opacity, #legend, #timeline, …) so
 * the e2e suite (mapa.spec.ts) and the ?e2e=1 affordance keep working.
 *
 * Embedded instances pass a unique `mapId` (e.g. 'home-map', 'fc-map');
 * all selectors inside the factory are scoped via the supplied `els`
 * record so two map instances on the same DOM never collide.
 *
 * MapLibre itself is dynamic-imported inside `init()` so the home page
 * does not download the GL bundle until the map is in the viewport.
 */
import type maplibregl from 'maplibre-gl';
import type { FeatureCollection, Feature } from 'geojson';

import { parseMapHash, buildMapHash, type MapHashState } from './maphash';
import {
  LAYERS,
  getLayer as getLayerDef,
  RADAR_LEGEND,
  parseRainviewerManifest,
  rainviewerTileUrl,
  type RadarFrame,
  type RainviewerData,
} from './maplayers';
import {
  framesForLayer,
  defaultFrameIndex,
  clampIndex,
  frameOffsetMinutes,
  seekIndexForIso,
  nearestFrame,
  satelliteFrames,
  satelliteFramesExtended,
  satelliteDailyFrames,
} from './maptimeline';
import {
  viewportGrid,
  fetchFieldChunks,
  fetchWindChunks,
  parseFieldResponse,
  parseWindResponse,
  fieldFrameIndex,
  tempColor,
  humidityColor,
  pressureColor,
  spreadFieldGrid,
  spreadColorFor,
  spreadLegendFor,
  HUMIDITY_LEGEND,
  PRESSURE_LEGEND,
  precipColor,
  snowColor,
  precipProbColor,
  PRECIP_LEGEND,
  SNOW_LEGEND,
  PRECIP_PROB_LEGEND,
  getTempLegend,
  setColorBlindMode,
  getColorBlindMode,
  mergeFieldGrids,
  mergeWindGrids,
  isExtendedGrid,
  parseUtcMs,
  EXTENDED_FIELD_RANGE,
  type FieldGrid,
  type LegendStop,
  type WindGrid,
} from './mapfields';
import { relativeFrameLabel, needsWeekday } from './map/chrome/timeline-label';
import {
  MAX_WIND_MPS,
  windSpeed,
  windSpeedColor,
  WIND_LEGEND,
  encodeWindGrid,
  initParticlePositions,
  type WindPoint,
} from './mapwind';
import {
  renderFieldRaster,
  bilerpValue,
  type RasterBounds,
  type ImageCorners,
} from './mapraster';
import { terminatorPolygon, solarPosition } from './mapsun';
import { presetPins, withUserPin, type MapPin } from './mappins';
import { cities } from '../data/cities';
import { geocode } from './geocode';
import { runLocateFlow, failureMessageKey } from './locate-flow';
import { getForecast, FORECAST_DAYS } from './forecast';
import { has as hasFavorite, toggle as toggleFavorite } from './favorites';
import {
  renderPlaceCard,
  renderPlaceCardStatus,
  type PlaceCardMode,
  type PlaceCardOpts,
} from './map/chrome/place-card';
import { ui } from '../i18n/ui';
import { siteBase } from '../utils/paths';
import {
  createNhcSource,
  createStormsGisSource,
  type NhcStorm,
  GIBS_LAYERS,
  gibsTileUrl,
  gibsRoundedTime,
  ATTRIBUTION_GIBS,
} from './map/sources';

export interface InteractiveMapElements {
  /** The container element MapLibre attaches to. Required. */
  container: HTMLElement;
  /** Search input (optional). */
  search?: HTMLInputElement | null;
  /** Autocomplete list (optional). */
  acList?: HTMLUListElement | null;
  /** Locate-me button (optional). */
  locate?: HTMLElement | null;
  /** Layer button wrapper, opacity slider, and legend (optional). */
  layerBtns?: HTMLElement | null;
  /** Overlays (Superposiciones) checkbox container — zoom.earth-style
   *  menu of toggleable map decorations. Optional; when null overlays
   *  are reachable only via keyboard shortcuts. */
  overlayBtns?: HTMLElement | null;
  /** Story 22.2 — overlays tab: filter input + "n on" badge. Optional. */
  overlayFilter?: HTMLInputElement | null;
  overlayCount?: HTMLElement | null;
  /** Story 22.2 — the active layer's block (sub-options + opacity) that
   *  follows the active tile's grid row, and its sub-options slot.
   *  Optional: without them the sub-options fall back to layerBtns. */
  railActive?: HTMLElement | null;
  subOptions?: HTMLElement | null;
  opacityWrap?: HTMLElement | null;
  opacity?: HTMLInputElement | null;
  legend?: HTMLElement | null;
  /** Timeline + status message (optional). */
  timeline?: HTMLElement | null;
  tlPrev?: HTMLElement | null;
  tlPlay?: HTMLButtonElement | null;
  tlNext?: HTMLElement | null;
  tlRange?: HTMLInputElement | null;
  tlTime?: HTMLElement | null;
  /** Story 23.1 — date-scale bar drawn over/next to `tlRange` (optional:
   *  without it the range is the only scrubber). */
  tlBar?: HTMLElement | null;
  msg?: HTMLElement | null;
  /** Floating tooltip overlay that follows the cursor on hover for
   *  field/wind/sun layers (zoom.earth-style). Optional — when absent
   *  the hover handler is a no-op. */
  tooltip?: HTMLElement | null;
  /** Cursor coordinate badge in the bottom-left corner. Optional —
   *  when present, the cursor's lat/lng renders as "19°25′N 99°07′O"
   *  on mousemove (zoom.earth-style). */
  coords?: HTMLElement | null;
  /** Place card container (Story 15.4): tap-anywhere 10-day / 48-h
   *  forecast panel. Optional — when absent, taps fall back to the
   *  small coordinates popup. */
  placeCard?: HTMLElement | null;
}

export interface InteractiveMapFeatures {
  /** Layer rail (base/radar/temp/… buttons + opacity + overlays). */
  layerRail?: boolean;
  /** Restrict the rail to this subset of LAYER_IDS (embeds). Omit for all. */
  railLayers?: string[];
  timeline?: boolean;
  search?: boolean;
  locateButton?: boolean;
  presetPins?: boolean;
  /** Measure (distance/area) + snapshot-compare tools. */
  tools?: boolean;
  /** ⚙️ settings popover (timezone, hour format). */
  settings?: boolean;
  /** ℹ️ info/sources popover. Markup-only. */
  info?: boolean;
  /** NWP model toggle pills (Auto/ICON/GFS/…). */
  modelToggle?: boolean;
  /** Cursor coordinates badge. Markup-only. */
  coords?: boolean;
  /** Floating colour-scale legend bar. Markup-only. */
  legend?: boolean;
  /** First-visit welcome card offering to locate the user (Story 19.2).
   *  Only the full-page maps set it; embeds never nag. */
  welcome?: boolean;
  /** "Controles" trigger that reveals the `hidden sm:*` chrome on phones
   *  (Story 11.3). Markup-only: with it present the rail's tab bar and
   *  the active layer's block (sub-options + opacity) show below `sm`
   *  only while the panel is open (Story 22.2). */
  mobileControls?: boolean;
  /** Story 22.3 — no +/−/compass buttons (MapLibre NavigationControl):
   *  zoom stays on scroll, pinch, double-click and the keyboard. /mapa and
   *  the layer pages set it (their chrome budget, plan PARIDAD_VISUAL
   *  §1.2); embeds leave it off and keep the buttons. */
  gestureZoomOnly?: boolean;
  /** Story 22.5 — chrome budget (plan PARIDAD_VISUAL §1.2). Markup-only:
   *  InteractiveMap.astro collapses the rail to its tab bar and hides the
   *  timeline's step buttons until hover/focus (Controles below `sm`).
   *  The script only fills the collapsed rail's active-layer label, which
   *  it finds by `[data-rail-current]`. /mapa sets it. */
  compactChrome?: boolean;
}

/** Build an <svg><use href="#i-name"/></svg> element for the inline
 *  sprite rendered by src/components/common/IconSprite.astro. */
export function spriteIcon(name: string, className = 'h-4 w-4'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

// ---------------------------------------------------------------------------
// Shared fetch cache + request coalescing lives in src/lib/map/utils/fetch.ts
// (extracted in F2 of the architecture migration — see docs/ARCHITECTURE.md).
// Re-imported here so existing call sites in this monolith keep working
// unchanged.
import {
  cachedFetch,
  formatLatLngDM,
  bearingToArrow,
  polylineLengthKm as measurePolylineLen,
  sphericalAreaKm2 as measureSphArea,
  formatArea as measureFmtArea,
} from './map/utils';
import { createVolcanoesOverlay } from './map/overlays/volcanoes';
import { createQuakesOverlay } from './map/overlays/quakes';
import { createLakesOverlay } from './map/overlays/lakes';
import { createHistStormsOverlay } from './map/overlays/hist-storms';
import { createWebcamsOverlay } from './map/overlays/webcams';
import { createAqiOverlay } from './map/overlays/aqi';
import { createSmnStateTintOverlay } from './map/overlays/smn-state-tint';
import { createMarineOverlay } from './map/overlays/marine';
import { createGraticuleOverlay } from './map/overlays/graticule';
import { createFiresOverlay } from './map/overlays/fires';
import { createBordersOverlay } from './map/overlays/borders';
import { createRadarCoverageOverlay } from './map/overlays/radar-coverage';
import { createNightLineOverlay } from './map/overlays/night-line';
import { createNightLightsOverlay } from './map/overlays/night-lights';
import { createTropicalStormsOverlay } from './map/overlays/tropical-storms';
import { createTropicalOutlookOverlay } from './map/overlays/tropical-outlook';
import {
  createBasemapThemeController,
  pickBasemapTiles,
  BASEMAP_ATTRIBUTION,
  ESRI_CANVAS_MAX_ZOOM,
  DEFAULT_BASE_SOURCE_ID as BASEMAP_SOURCE_ID,
  DEFAULT_REFERENCE_SOURCE_ID as BASEMAP_REFERENCE_SOURCE_ID,
  DEFAULT_REFERENCE_LAYER_ID as BASEMAP_REFERENCE_LAYER_ID,
} from './map/chrome/basemap-theme';
import { createSunLayer } from './map/layers/sun-layer';
import {
  WEATHER_RASTER_SOURCE_B_ID,
  WEATHER_RASTER_SOURCE_ID,
  createWeatherRaster,
  weatherRasterTileSpec,
} from './map/layers/weather-raster';
import { createFirstFrameMark } from './map/chrome/first-frame-mark';
import {
  PREFETCH_FRAMES,
  createFramePrefetcher,
  fillTileTemplate,
  imageTileLoader,
  upcomingFrames,
  visibleTileCoords,
  type FramePrefetcher,
} from './map/layers/frame-prefetch';
import { createSkeletonReveal, findMapRoot } from './map/chrome/map-skeleton';
import {
  bootActivationAllowed,
  bootLoopHours,
  readSaveData,
  shouldBootAutoplay,
  whenSourceLoaded,
} from './map/chrome/boot-autoplay';
import {
  bootLayerAfterProbe,
  probeGibs,
  type GibsProbeResult,
} from './map/sources/gibs-probe';
import {
  type MapSettings,
  readSettings,
  writeSettings,
  normalizeSettings,
  loopRange,
  unitsOf,
  PLAY_INTERVAL_MS,
  RASTER_FADE_MS,
  SETTINGS_KEY,
} from './map/settings';
import {
  convertLegendStops,
  formatDistanceKm,
  formatPressure,
  formatSpeed,
  formatTemp,
  PRESSURE_LABEL,
  SPEED_LABEL,
  TEMP_LABEL,
  type Units,
} from './units';
import { createAutocompleteController } from './map/chrome/autocomplete';
import { createSnapshotCompare } from './map/chrome/snapshot-compare';
import {
  createModelToggle,
  modelToggleApplies,
} from './map/chrome/model-toggle';
import { createToolPill, type ToolPill } from './map/chrome/tool-pill';
import {
  WIND_PARTICLES_LAYER_ID,
  makeWindParticlesLayer,
  windPointsAtHour,
} from './map/layers/wind-particles';
import { createIsobarsLayer } from './map/layers/isobars';
import { createCrosshair } from './map/chrome/crosshair';
import { layerPageFor } from './layer-pages';
import { createCloudsOverlay } from './map/overlays/clouds';
import { createCityValuesOverlay } from './map/overlays/city-values';
import { createTimelinePlayer } from './map/chrome/timeline-player';
import {
  createTimelineBar,
  formatValueText,
  type TickFormat,
  type TimelineBar,
} from './map/chrome/timeline-bar';
import {
  createTimelineJump,
  extendedFieldEnd,
  type JumpRange,
  type TimelineJump,
} from './map/chrome/timeline-jump';
import { createSubOptionsGroup } from './map/chrome/sub-options';
import {
  PINNED_OVERLAYS,
  RAIL_COLUMNS_DESKTOP,
  activeBlockAnchor,
} from './map/chrome/layer-rail';
import { createPinManager } from './map/chrome/pin-manager';
import { createOverlayRegistry } from './map/chrome/overlay-registry';
import {
  buildShortcutSections,
  overlayShortcutLabel,
} from './map/chrome/shortcuts';
import { wireShortcutsDialog } from './map/chrome/shortcuts-dialog';
import { computeIsobars } from './map/utils/isobars';

export interface InteractiveMapOptions {
  els: InteractiveMapElements;
  features: InteractiveMapFeatures;
  initialView?: { lat: number; lng: number; zoom: number };
  /** Layer to activate on first load. Defaults to 'base' (no overlay).
   *  When `useHash` is true and the URL hash specifies a layer, the hash wins.
   *  Use 'temperature' on the forecast embed so users see weather data
   *  near their location without a click. */
  initialLayer?: string;
  /** When true, parses location.hash + writes it back on moveend.
   *  /mapa = true, embeds = false. */
  useHash?: boolean;
  /** When true, exposes the MapLibre instance via window.__map if ?e2e=1.
   *  /mapa = true, embeds = false (only one instance should hold the global). */
  exposeE2eHook?: boolean;
  /** Add a maplibre attribution + nav control? Defaults to true. */
  controls?: boolean;
  /** When false, the map is non-interactive (no pan/zoom). Defaults to true. */
  interactive?: boolean;
  /** When false, marker click does NOT show a popup with a forecast link.
   *  Defaults to true. Set false for forecast page where only one preset pin is shown. */
  markerPopups?: boolean;
  /** Story 21.2 — when the boot layer that ends up active is satellite,
   *  start the timeline loop (last 3 h unless the visitor stored a loop
   *  window) once its first frame has tiles. Skipped under
   *  prefers-reduced-motion, `navigator.connection.saveData`, or a hash
   *  `t=`; the first interaction with the timeline pauses it. /mapa only;
   *  embeds and layer pages default to false. */
  bootAutoplay?: boolean;
  /** Story 21.3 — while the timeline plays satellite or radar, fetch the
   *  visible tiles of the next frames ahead (N = 6, 4 MB window) and
   *  hold the loop until the next frame is cached. Full-page maps only:
   *  never on the home embed, and always off under
   *  `navigator.connection.saveData`. */
  framePrefetch?: boolean;
  lang?: 'es' | 'en';
}

export interface MapHandle {
  map: maplibregl.Map;
  destroy: () => void;
}

/**
 * Init the interactive map inside `els.container`. Returns a handle the
 * caller can `destroy()` on unmount (kept simple — none of the current
 * pages currently unmount, but the contract is clean).
 */
export async function initInteractiveMap(
  opts: InteractiveMapOptions
): Promise<MapHandle> {
  const lang = opts.lang ?? 'es';
  const t = ui[lang];
  const base = siteBase();
  const features = opts.features;
  const useHash = opts.useHash ?? false;
  const exposeE2eHook = opts.exposeE2eHook ?? false;
  const controls = opts.controls ?? true;
  const interactive = opts.interactive ?? true;
  const markerPopups = opts.markerPopups ?? true;

  // Dynamic import of MapLibre — keeps the GL bundle out of pages until
  // this factory is actually invoked.
  const maplibreModule = (await import('maplibre-gl')) as unknown as Record<
    string,
    unknown
  >;
  await import('maplibre-gl/dist/maplibre-gl.css');
  // The module's export shape varies across bundlers and maplibre versions:
  //
  //   - maplibre-gl v4 (Vite/Rollup pre-bump): exposed via `.default`.
  //   - maplibre-gl v5 (current): rollup emits
  //       `export { ns as m }` so the namespace lives at `.m`.
  //   - Some interop paths expose everything at the top level.
  //
  // Probe each shape in order. The v5 case was a production regression
  // (#284 shipped v5 but the consumer still only checked `.default` and
  // top-level, so `new maplibre.Map(...)` threw "Cannot read properties
  // of undefined (reading 'Map')" and the whole map silently failed to
  // mount).
  const candidates = [
    (maplibreModule as { m?: typeof maplibregl }).m,
    (maplibreModule as { default?: typeof maplibregl }).default,
    maplibreModule as unknown as typeof maplibregl,
  ];
  const maplibre = candidates.find(
    (c): c is typeof maplibregl => !!(c as { Map?: unknown } | undefined)?.Map
  );
  if (!maplibre) {
    throw new Error(
      'maplibre-gl module did not expose a Map constructor in any known shape'
    );
  }

  const deps = {
    // Module-scoped fetch with in-memory cache. Multiple map instances on the
    // same page (home embed + /mapa, or forecast embed) share the cache so we
    // don't repeatedly hammer Open-Meteo / RainViewer with the same request.
    // TTL = 10 min, matching the SDK's natural refresh interval. Coalescing
    // (one in-flight Promise per URL) prevents bursts when two layers ask for
    // overlapping data concurrently.
    fetch: cachedFetch,
    sleep: (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)),
  };

  function esc(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showMsg(text: string): void {
    const el = opts.els.msg;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    window.setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function hideMsg(): void {
    opts.els.msg?.classList.add('hidden');
  }

  // ------------------------------------------------------------------
  // Initial view: optionally seeded from URL hash on /mapa, else opts.
  // ------------------------------------------------------------------
  // An empty hash is "no state", not the default view: parseMapHash()
  // would otherwise answer layer 'base' and beat the page's initialLayer
  // (the /mapa/<capa>/ pages, Story 19.1).
  const hashed =
    useHash && location.hash.length > 1 ? parseMapHash(location.hash) : null;
  const initial = hashed ?? {
    lat: opts.initialView?.lat ?? 23.6,
    lng: opts.initialView?.lng ?? -102.5,
    zoom: opts.initialView?.zoom ?? 4.5,
    layer: null as string | null,
    t: null as string | null,
  };

  // Pick the basemap tile URL up-front from the current theme so the very
  // first tile fetches go to the right CDN. Initialising with OSM and then
  // swapping to Dark Matter via setTiles causes a race at low zoom — tiles
  // already in flight come back as OSM (light) and paint as light patches
  // next to Dark Matter tiles for a couple of seconds.
  const initialDark = document.documentElement.classList.contains('dark');
  // Story 21.1 — a deep link / page that opens on satellite or radar (or
  // the combined precipitation mode) gets the dark canvas from the very
  // first tile fetch, instead of light tiles that flip dark a second
  // later when the raster lands.
  const initialLayerWanted = hashed?.layer ?? opts.initialLayer ?? null;
  const initialImagery =
    hashed?.mode === 'precip' ||
    (initialLayerWanted != null &&
      getLayerDef(initialLayerWanted)?.kind === 'raster-tile');
  // Initial tile arrays — sourced from the shared basemap-theme module
  // to keep the single source of truth (no diverging URL lists between
  // the map construction and the runtime theme controller).
  const BASEMAP_TILES_INIT = pickBasemapTiles({
    dark: initialDark,
    imagery: initialImagery,
  });

  // A11Y-3 — translate MapLibre's built-in control strings (zoom
  // buttons, compass) when the document language is Spanish. MapLibre
  // ships English defaults; `locale` patches the default table.
  const docLang =
    document.documentElement.getAttribute('data-lang') ||
    document.documentElement.lang;
  const mapLocale =
    docLang === 'es'
      ? {
          'NavigationControl.ZoomIn': 'Acercar',
          'NavigationControl.ZoomOut': 'Alejar',
          'NavigationControl.ResetBearing': 'Restablecer orientación al norte',
        }
      : undefined;

  const map = new maplibre.Map({
    container: opts.els.container,
    center: [initial.lng, initial.lat],
    zoom: initial.zoom,
    interactive,
    locale: mapLocale,
    // Required so map.getCanvas().toDataURL() returns the rendered
    // pixels (plan 3.3 snapshot compare). WebGL discards the buffer
    // by default at the end of each frame; this keeps it readable.
    // maplibre-gl v5 moved this into canvasContextAttributes (was a
    // top-level MapOption in v4).
    canvasContextAttributes: { preserveDrawingBuffer: true },
    // MapLibre's attributionControl typing is `false | AttributionControlOptions`;
    // pass `false` to suppress it, or omit (undefined) to use the default control.
    attributionControl: controls ? undefined : false,
    style: {
      version: 8,
      // Symbol layers (e.g. city value pills) need a glyphs URL to render
      // text. MapLibre's demotiles host serves a stable Noto/Open Sans
      // stack with no API key required.
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        // Esri Canvas gray basemap (no key, no watermark). The source id
        // keeps its legacy name 'osm' because several call-sites and the
        // e2e suite reference the 'osm' layer by id.
        [BASEMAP_SOURCE_ID]: {
          type: 'raster',
          tiles: BASEMAP_TILES_INIT.base,
          tileSize: 256,
          maxzoom: ESRI_CANVAS_MAX_ZOOM,
          attribution: BASEMAP_ATTRIBUTION,
        },
        // Labels + boundaries live in a separate Esri "Reference"
        // service; the theme controller toggles this layer's visibility
        // below LABEL_ZOOM_THRESHOLD instead of swapping to a
        // `_nolabels` URL variant.
        [BASEMAP_REFERENCE_SOURCE_ID]: {
          type: 'raster',
          tiles: BASEMAP_TILES_INIT.reference,
          tileSize: 256,
          maxzoom: ESRI_CANVAS_MAX_ZOOM,
          attribution: BASEMAP_ATTRIBUTION,
        },
      },
      layers: [
        { id: BASEMAP_SOURCE_ID, type: 'raster', source: BASEMAP_SOURCE_ID },
        {
          id: BASEMAP_REFERENCE_LAYER_ID,
          type: 'raster',
          source: BASEMAP_REFERENCE_SOURCE_ID,
        },
      ],
    },
  });

  if (controls) {
    if (features.gestureZoomOnly !== true) {
      map.addControl(new maplibre.NavigationControl({}), 'bottom-left');
    }
    // Scale bar in the bottom-right — zoom.earth-style, distance updates
    // with zoom (e.g. "200 km" at z=6, "10 km" at z=12).
    map.addControl(
      new maplibre.ScaleControl({ unit: 'metric', maxWidth: 120 }),
      'bottom-right'
    );
  }

  // Cursor coordinate badge — only shown on the full /mapa page, not on
  // the smaller embedded maps. Renders DM-style "19°25′N 99°07′O" in the
  // bottom-left corner, the same format zoom.earth uses.
  if (controls && opts.els.coords) {
    const coordsEl = opts.els.coords;
    map.on('mousemove', (e) => {
      coordsEl.textContent = formatLatLngDM(e.lngLat.lat, e.lngLat.lng);
    });
    map.on('mouseout', () => {
      coordsEl.textContent = '';
    });
  }

  // Pin manager owns the per-pin Marker + Popup lifecycle. The popup
  // HTML builders stay here because they reference the local `base`,
  // `t`, and `esc` closure references.
  function popupHtml(p: MapPin): string {
    const fc = `${base}forecast?lat=${p.lat}&lng=${p.lng}&name=${encodeURIComponent(p.name)}`;
    return (
      `<div class="text-sm"><strong>${esc(p.name)}</strong><br>` +
      `<a href="${esc(fc)}" class="text-im-accent underline">${esc(t.map_popup_full_forecast)} →</a></div>`
    );
  }

  function placePopupHtml(lat: number, lng: number): string {
    const coords = formatLatLngDM(lat, lng);
    const name = `Ubicación ${coords}`;
    const fc = `${base}forecast?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&name=${encodeURIComponent(coords)}`;
    return (
      `<div class="text-sm">` +
      `<strong>${esc(coords)}</strong><br>` +
      `<span class="text-im-muted">${esc(name)}</span><br>` +
      `<a href="${esc(fc)}" class="mt-1 inline-block text-im-accent underline">${esc(t.map_popup_full_forecast)} →</a>` +
      `</div>`
    );
  }

  const pinManager = createPinManager(
    map,
    features.presetPins ? presetPins(cities) : [],
    { maplibre, popupHtml, enablePopups: !!markerPopups }
  );
  // Aliases kept so the rest of the file's wiring stays unchanged.
  const renderPins = (): void => pinManager.render();
  const setUserPin = (
    name: string,
    lat: number,
    lng: number,
    kind: 'search' | 'geo'
  ): void => {
    pinManager.setUserPin({ name, lat, lng, kind });
  };

  // Click-to-place popup — zoom.earth-style. When the user clicks on
  // empty map (not on a city marker), open a popup with the cursor's
  // DMS coordinates and a link to the full forecast page for that point.
  // Only wired on the full /mapa page (features.layerRail) and when
  // markerPopups is enabled.
  let placePopup: maplibregl.Popup | null = null;

  // ----------------------------------------------------------------
  // Place card (Story 15.4 — plan PRO_GRATIS E15). zoom.earth's
  // "location weather" panel: tap anywhere → 10 daily rows (Pro-only
  // there) + 48 hourly rows for that point, a favourite star and the
  // link to the full forecast. One Open-Meteo call per tap (cachedFetch
  // dedupes for 10 min). Markup lives in map/chrome/place-card.ts.
  // ----------------------------------------------------------------
  const placeCardEl = opts.els.placeCard ?? null;
  let placeMarker: maplibregl.Marker | null = null;
  let placeCardMode: PlaceCardMode = 'daily';
  let placeCardPoint: { lat: number; lng: number } | null = null;
  let placeCardFc: Awaited<ReturnType<typeof getForecast>> | null = null;
  let placeCardSeq = 0;

  function placeCardOpts(): PlaceCardOpts | null {
    if (!placeCardPoint) return null;
    const { lat, lng } = placeCardPoint;
    const coords = formatLatLngDM(lat, lng);
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let isFavorite = false;
    try {
      isFavorite = hasFavorite(window.localStorage, lat, lng);
    } catch {
      /* storage blocked */
    }
    return {
      mode: placeCardMode,
      coordsLabel: coords,
      forecastHref: `${base}forecast?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&name=${encodeURIComponent(coords)}`,
      isFavorite,
      tempUnit: currentUnits().temp,
      nowLine: tooltipValueAt(lng, lat),
      strings: {
        title: t.place_card_title,
        daily: t.place_card_daily,
        hourly: t.place_card_hourly,
        close: t.place_card_close,
        favAdd: t.fav_add,
        favRemove: t.fav_remove,
        fullForecast: t.map_popup_full_forecast,
        loading: t.loading,
        today: t.place_card_today,
        tomorrow: t.place_card_tomorrow,
        error: t.place_card_error,
      },
      lang,
      todayIso,
    };
  }

  function paintPlaceCard(status?: 'loading' | 'error'): void {
    if (!placeCardEl) return;
    const o = placeCardOpts();
    if (!o) return;
    placeCardEl.innerHTML =
      status || !placeCardFc
        ? renderPlaceCardStatus(o, status ?? 'loading')
        : renderPlaceCard(placeCardFc, o);
    placeCardEl.hidden = false;
  }

  function closePlaceCard(): void {
    if (placeCardEl) {
      placeCardEl.hidden = true;
      placeCardEl.innerHTML = '';
    }
    placeMarker?.remove();
    placeMarker = null;
    placeCardPoint = null;
    placeCardFc = null;
    placeCardSeq++;
  }

  async function openPlaceCard(latRaw: number, lngRaw: number): Promise<void> {
    if (!placeCardEl) return;
    // 4 dp (~11 m): what the favourites key and the /forecast URL carry.
    const lat = Number(latRaw.toFixed(4));
    const lng = Number(lngRaw.toFixed(4));
    const seq = ++placeCardSeq;
    placeCardPoint = { lat, lng };
    placeCardFc = null;
    placeMarker?.remove();
    const dot = document.createElement('div');
    dot.className =
      'h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow-md';
    // Hoisted function: TS can't carry the module guard's narrowing in.
    const ml = maplibre as typeof maplibregl;
    placeMarker = new ml.Marker({ element: dot })
      .setLngLat([lng, lat])
      .addTo(map);
    paintPlaceCard('loading');
    placeCardEl.querySelector<HTMLElement>('[data-pc-close]')?.focus();
    try {
      const fc = await getForecast(
        { lat, lng, tz: 'auto' },
        deps,
        undefined,
        FORECAST_DAYS
      );
      if (seq !== placeCardSeq) return; // closed or re-opened meanwhile
      placeCardFc = fc;
      paintPlaceCard();
    } catch {
      if (seq !== placeCardSeq) return;
      paintPlaceCard('error');
    }
  }

  if (placeCardEl) {
    placeCardEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-pc-close]')) {
        closePlaceCard();
        return;
      }
      const modeBtn = target.closest<HTMLElement>('[data-pc-mode]');
      if (modeBtn) {
        const m = modeBtn.dataset.pcMode === 'hourly' ? 'hourly' : 'daily';
        if (m !== placeCardMode) {
          placeCardMode = m;
          paintPlaceCard();
        }
        return;
      }
      if (target.closest('[data-pc-fav]') && placeCardPoint) {
        try {
          toggleFavorite(window.localStorage, {
            lat: placeCardPoint.lat,
            lng: placeCardPoint.lng,
            name: formatLatLngDM(placeCardPoint.lat, placeCardPoint.lng),
            tz: 'America/Mexico_City',
            addedAt: Date.now(),
          });
        } catch {
          /* storage blocked */
        }
        paintPlaceCard();
      }
    });
  }

  // Story 22.3 — true while the measure tool is on (set by the tools
  // block below): a click then adds a measure point, and the place card
  // stays shut so it never covers the active-tool pill mid-measurement.
  let measuring = false;
  if (features.layerRail && markerPopups) {
    map.on('click', (e) => {
      if (measuring) return;
      // Ignore clicks that landed on a layer feature (storm dots, city
      // values, isobars). Those have their own interactions or none.
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['wx-storms-circle'],
      });
      if (features.length > 0) return;
      if (placeCardEl) {
        void openPlaceCard(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (placePopup) {
        placePopup.remove();
        placePopup = null;
      }
      placePopup = new maplibre.Popup({ offset: 8, closeButton: true })
        .setLngLat(e.lngLat)
        .setHTML(placePopupHtml(e.lngLat.lat, e.lngLat.lng))
        .addTo(map);
    });
  }

  function syncHash(): void {
    if (!useHash) return;
    const c = map.getCenter();
    const state: MapHashState = {
      lat: c.lat,
      lng: c.lng,
      zoom: map.getZoom(),
      layer: activeLayer,
      t: activeLayer === 'base' ? null : activeFrameIso,
      model: activeModel === 'best_match' ? null : activeModel,
      mode: precipMode ? 'precip' : null,
    };
    history.replaceState(null, '', buildMapHash(state));
  }

  let hashTimer = 0;
  map.on('moveend', () => {
    if (!useHash) return;
    window.clearTimeout(hashTimer);
    hashTimer = window.setTimeout(syncHash, 250);
  });

  // Field layers (temperature/humidity/pressure) now use a FIXED MX
  // grid (see MX_FIELD_BOUNDS) so panning/zooming no longer needs to
  // refetch — values stay stable per lat/lng. The moveend resample
  // handler is intentionally removed; the raster gets upscaled by
  // MapLibre at zoom-in (raster-resampling: linear) and clips
  // gracefully at the fixed extent when the user pans WAY out.

  if (
    exposeE2eHook &&
    new URLSearchParams(location.search).get('e2e') === '1'
  ) {
    (window as unknown as { __map?: maplibregl.Map }).__map = map;
  }

  const initialCenter = map.getCenter();
  const initialZoom = map.getZoom();
  const firstPaintNudge = (): void => {
    try {
      map.resize();
      map.jumpTo({ center: initialCenter, zoom: initialZoom });
      // Force a layout-property recompute by flipping the basemap raster
      // layer visibility. This is the most reliable way to force MapLibre
      // to schedule a render frame; the bare triggerRepaint() / jumpTo()
      // duo isn't enough on stubborn cold loads (issue #124). Wrapping in
      // a separate try so a missing 'osm' layer (during teardown) doesn't
      // mask the other operations.
      try {
        if (map.getLayer('osm')) {
          map.setLayoutProperty('osm', 'visibility', 'none');
          map.setLayoutProperty('osm', 'visibility', 'visible');
        }
      } catch {
        /* best-effort */
      }
      map.triggerRepaint();
    } catch {
      /* best-effort */
    }
  };
  /** Brute-force first-paint nudger: triggers a repaint at multiple
   *  intervals after init. Some cold loads need the canvas to be hit
   *  4–5 times before the GL backing store actually paints (race between
   *  tile arrival, DOM layout, and the first render frame). The cost of
   *  N extra triggerRepaint() calls is essentially zero — they're no-ops
   *  once the buffer is dirty / a frame is already scheduled — but they
   *  cover the worst-case race. */
  const aggressiveNudge = (): void => {
    [60, 200, 400, 800, 1500, 2500].forEach((delay) => {
      window.setTimeout(firstPaintNudge, delay);
    });
  };
  /** Synthesize a tiny pointer-move sequence on the map canvas after init.
   *  The cold-load blank canvas (#124) is reliably resolved when the user
   *  clicks/moves the pointer anywhere on the map — that suggests
   *  MapLibre's pointer-event handler is the trigger that schedules the
   *  first paint frame the unprompted nudges miss. Replaying the same
   *  pointer trigger programmatically should defeat the race without
   *  user interaction. Tiny offset (1 px) so the synthetic move isn't a
   *  noticeable interaction. */
  const synthesizeMove = (): void => {
    try {
      const canvas = map.getCanvas();
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dispatch = (type: string, x: number, y: number): void => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: 'mouse',
            clientX: x,
            clientY: y,
          })
        );
        canvas.dispatchEvent(
          new MouseEvent(
            type === 'pointerdown'
              ? 'mousedown'
              : type === 'pointerup'
                ? 'mouseup'
                : type === 'pointermove'
                  ? 'mousemove'
                  : type,
            {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
            }
          )
        );
      };
      dispatch('pointermove', cx, cy);
      dispatch('pointermove', cx + 1, cy + 1);
      dispatch('pointermove', cx, cy);
    } catch {
      /* synthetic-event dispatch is best-effort */
    }
  };
  // Source-data hook: whenever ANY source finishes loading (basemap tile
  // batch, raster, geojson), trigger a repaint. This is the final answer
  // to #124 — instead of guessing when tiles arrive, listen for the
  // sourcedata event that fires exactly when tiles finish decoding, then
  // schedule a paint. Cheap (the event also fires during normal panning,
  // which already triggers paints anyway, so this is a no-op there).
  // Story 21.4 — the CSS-only loading skeleton on `.im-root::before`
  // fades out on the first loaded source (first tiles decoded); `load`
  // and an 8 s ceiling guarantee it never masks a map whose tiles fail.
  const skeleton = createSkeletonReveal(findMapRoot(opts.els.container));
  map.on('sourcedata', (e: { isSourceLoaded?: boolean; sourceId?: string }) => {
    if (!e.isSourceLoaded) return;
    skeleton.onSourceData(e);
    try {
      map.triggerRepaint();
    } catch {
      /* best-effort */
    }
  });
  // A tile that fails (CDN down, offline, undecodable body) marks its
  // source loaded without scheduling a frame; if that was the last
  // pending tile, `loaded()` flips true but `_render` never runs again
  // and MapLibre never fires `load` — no pins, no overlays, no deep-link
  // activation. One repaint after each error closes that gap.
  map.on('error', () => {
    try {
      map.triggerRepaint();
    } catch {
      /* best-effort */
    }
  });
  // First-5-seconds repaint-nudge interval id, hoisted so destroy()
  // can clear it if the map is torn down before it self-clears.
  let repaintNudgeInterval = 0;
  map.on('load', () => {
    skeleton.reveal();
    renderPins();
    // Fetch active NHC tropical systems once at mount. List is empty
    // outside hurricane season (Dec-May) so this is a no-op then; in
    // season it adds dots over each active storm.
    void refreshTropicalStorms();
    window.requestAnimationFrame(firstPaintNudge);
    aggressiveNudge();
    // Belt-and-suspenders interval: poll triggerRepaint every 200 ms for
    // the first 5 seconds. Each call is essentially free if a frame is
    // already scheduled; covers the worst-case race where neither the
    // load event, sourcedata events, nor the deferred timers happen to
    // align with the moment tiles actually arrive.
    let ticks = 0;
    repaintNudgeInterval = window.setInterval(() => {
      try {
        map.triggerRepaint();
      } catch {
        /* best-effort */
      }
      ticks += 1;
      if (ticks >= 25) window.clearInterval(repaintNudgeInterval);
    }, 200);
    // Replay the click/pointer trigger that resolves the cold-load blank
    // canvas (#124) when the user clicks the map. We can't tell what
    // pointer-event MapLibre uses to schedule the first frame in the
    // worst-case timing, so spread the synthetic moves across several
    // intervals after the nudges have run.
    [100, 300, 700, 1200].forEach((delay) => {
      window.setTimeout(synthesizeMove, delay);
    });
    syncBasemapTheme();
    observeThemeForBasemap();
    void (async () => {
      // Hash layer wins over the `initialLayer` opt (so deep-links to
      // /mapa#layer=radar still activate radar even when the caller's
      // initialLayer is 'temperature'). A hash without `layer=` reads
      // null and lets the page default through (Story 21.2).
      // Story 13.2 — a shared combined-mode link opens on satellite with
      // clouds + radar even if the hash names another layer.
      const bootWanted = precipMode
        ? 'satellite'
        : (hashed?.layer ?? opts.initialLayer ?? null);
      // Story 21.2 — satellite's axis is synthetic, so GIBS being down
      // never tripped "Capa no disponible": the visitor got a dark canvas
      // and nothing else. One GeoColor tile is probed in parallel with
      // the manifest; on a definite failure the boot falls to radar, then
      // base, with the usual toast. A timeout keeps satellite.
      const gibsProbe: Promise<GibsProbeResult> =
        bootWanted === 'satellite'
          ? probeGibs((u, i) => fetch(u, i))
          : Promise.resolve('ok');
      try {
        const res = await deps.fetch(
          'https://api.rainviewer.com/public/weather-maps.json'
        );
        rvData = parseRainviewerManifest(await res.json());
      } catch {
        rvData = null;
      }
      const wanted = bootLayerAfterProbe(bootWanted, await gibsProbe, !!rvData);
      const fellBack = wanted !== bootWanted;
      // Story 21.2 — the boot lands late (probe ≤ 5 s + manifest + first
      // idle) and its retries run ~5 s more; a layer the visitor picked
      // meanwhile wins. Checked here and before every activation below.
      const bootMayActivate = (): boolean =>
        bootActivationAllowed({
          userPickedLayer,
          activeLayer,
          wanted: wanted ?? 'base',
        });
      if (fellBack) {
        precipMode = false;
        if (wanted === 'base' && bootMayActivate()) {
          // Nothing to activate: toast now, and back to the theme's own
          // canvas (the dark one was chosen up-front for satellite).
          showMsg(t.map_layer_unavailable);
          removeWeatherRaster();
        }
      }
      if (precipMode) void cloudsOverlay.setEnabled(true);
      if (
        wanted &&
        wanted !== 'base' &&
        getLayerDef(wanted) &&
        bootMayActivate()
      ) {
        // Cold-load bug (#124, P0.1 in PLAN_UX_PARITY.md): historically a
        // single setTimeout(..., 700) raced the style/source load and the
        // raster layer would silently fail to add ~5% of the time. The
        // user-visible symptom was a "blank field" on first load.
        //
        // Two-part fix:
        //   1. Wait for map.once('idle') — guarantees the style is
        //      resolved AND a paint frame has completed.
        //   2. After activation, verify a known wx layer (RV_LAYER for
        //      raster-tile, wx-field-layer for field) actually exists.
        //      If not, retry with increasing backoff.
        const activateWithRetry = async (): Promise<boolean> => {
          const def = getLayerDef(wanted);
          if (!def) return false;
          const expectedLayerId =
            def.kind === 'raster-tile'
              ? RV_LAYER
              : def.kind === 'field'
                ? 'wx-field-layer'
                : def.kind === 'particles'
                  ? WIND_CIRCLE_LAYER
                  : null;
          const delays = [0, 250, 600, 1300, 2800]; // ~4.9 s total
          // The hash `t=` is consumed by the first activation; a retry
          // must re-arm it or the shared frame silently resets to "now"
          // (and drops a Story 15.1 auto-extension already in flight).
          const bootSeekIso = hashed?.t ?? null;
          for (let i = 0; i < delays.length; i++) {
            if (delays[i] > 0) {
              await new Promise<void>((r) => window.setTimeout(r, delays[i]));
            }
            // The visitor picked a layer while we waited: theirs stays.
            if (!bootMayActivate()) return false;
            if (i > 0 && bootSeekIso && !pendingSeekIso) {
              pendingSeekIso = bootSeekIso;
            }
            try {
              await applyLayer(wanted);
            } catch {
              continue;
            }
            // Success when the expected layer exists on the map, or
            // when the layer kind has no checkable artifact (overlay).
            // The field raster is added asynchronously (renderFieldFrame
            // → canvas → blob → addLayer), so give it up to ~1 s before
            // deciding the activation failed and re-running it.
            if (!expectedLayerId) return true;
            for (let w = 0; w < 8; w++) {
              if (map.getLayer(expectedLayerId)) return true;
              await new Promise<void>((r) => window.setTimeout(r, 125));
            }
          }
          return false;
        };
        // Story 21.2 — the boot loop starts only once the layer is
        // verifiably on the map (the retry above may re-run activation).
        const bootActivate = (): void => {
          void activateWithRetry().then((ok) => {
            // The visitor chose a layer before the boot landed: no toast
            // about a fallback they never saw, no autoplay over their pick.
            if (userPickedLayer) return;
            // The fallback toast goes AFTER the activation so the
            // first-time layer explainer (Story 19.2) cannot paint over
            // the one message that explains why this is not satellite.
            if (fellBack) showMsg(t.map_layer_unavailable);
            if (ok) armBootAutoplay();
          });
        };
        if (map.loaded() && map.isStyleLoaded()) {
          bootActivate();
        } else {
          // First of: idle, load, or a 4 s timeout — a slow or failing
          // basemap CDN must not keep a shared link from activating its
          // layer (activateWithRetry copes with a raster not yet ready).
          let started = false;
          const go = (): void => {
            if (started) return;
            started = true;
            bootActivate();
          };
          map.once('idle', go);
          map.once('load', go);
          window.setTimeout(go, 4000);
        }
      }
    })();
  });
  map.once('idle', firstPaintNudge);

  // ResizeObserver — catches embed container size changes (sibling content
  // settling, responsive breakpoints).
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => firstPaintNudge());
    ro.observe(opts.els.container);
  }

  // Basemap theme + label-density controller — extracted to
  // src/lib/map/chrome/basemap-theme.ts. Watches the html.dark class
  // and the map's zoom level; swaps both raster sources' tiles on a
  // theme change and flips the reference (labels) layer visibility
  // when the zoom crosses LABEL_ZOOM_THRESHOLD.
  const basemapTheme = createBasemapThemeController(map, {
    baseSourceId: BASEMAP_SOURCE_ID,
    referenceSourceId: BASEMAP_REFERENCE_SOURCE_ID,
    referenceLayerId: BASEMAP_REFERENCE_LAYER_ID,
    initialDark,
    initialImagery,
  });
  map.on('zoomend', () => basemapTheme.sync());
  const syncBasemapTheme = (): void => basemapTheme.sync();
  // observeThemeForBasemap is now a no-op shim — the observer starts
  // automatically inside the controller's constructor. Kept here so
  // the existing call site in map.on('load') compiles unchanged.
  const observeThemeForBasemap = (): void => {
    /* observer attached by createBasemapThemeController() */
  };
  const themeObserver: { disconnect: () => void } | null = {
    disconnect: () => basemapTheme.dispose(),
  };

  // setUserPin and renderPins now delegate to pinManager (defined
  // earlier in the file via createPinManager).

  // ------------------------------------------------------------------
  // Search autocomplete (scoped to the supplied els.search / els.acList).
  // ------------------------------------------------------------------
  const q = features.search ? (opts.els.search ?? null) : null;
  const acList = features.search ? (opts.els.acList ?? null) : null;
  let qTimer = 0;
  let searchGen = 0;

  // Search autocomplete listbox — controller extracted to
  // src/lib/map/chrome/autocomplete.ts. The controller manages state +
  // DOM rendering; this layer wires the select handler (drop pin + set
  // active layer) and the search-input keyboard handlers below.
  const ac =
    q && acList
      ? createAutocompleteController(
          q as HTMLInputElement,
          acList as HTMLUListElement,
          (r) => {
            hideMsg();
            ac?.close();
            setUserPin(r.name, r.lat, r.lng, 'search');
          }
        )
      : null;
  // Thin wrappers preserve the historical names used by existing call
  // sites in this file (keyboard handlers, debounced fetch).
  const closeAcList = (): void => ac?.close();

  // ------------------------------------------------------------------
  // Weather layer state machine.
  // ------------------------------------------------------------------
  const RV_SOURCE = 'wx-raster';
  const RV_LAYER = 'wx-raster-layer';
  let activeLayer: string = 'base';
  // Story 21.2 — set by setActiveLayer(), whose every caller is a
  // visitor action: rail buttons, layer shortcuts, the sub-option pills,
  // the precipitation-mode overlay, the colour-blind palette toggle and
  // the model pills. The boot activation goes through `applyLayer`
  // directly and checks this flag first, so a layer picked before the
  // boot lands is never clobbered (and no boot autoplay starts).
  let userPickedLayer = false;
  // Bumped by every applyLayer(); an async activation (field / wind
  // grid fetch) that lands after a newer one bails instead of
  // overwriting it.
  let layerActivationGen = 0;
  // Story 26.2 — User Timing mark `mw:first-satellite-frame` when the
  // first satellite frame's tiles are all on the canvas (either A/B slot),
  // read by e2e/ux-metrics.spec.ts as "time to first satellite frame".
  const firstFrameMark = createFirstFrameMark({
    sourceIds: [WEATHER_RASTER_SOURCE_ID, WEATHER_RASTER_SOURCE_B_ID],
    getActiveLayer: () => activeLayer,
  });
  const onFirstFrameData = (e: {
    sourceId?: string;
    isSourceLoaded?: boolean;
    sourceDataType?: string;
    tile?: unknown;
  }): void => {
    if (firstFrameMark.onSourceData(e) || firstFrameMark.marked)
      map.off('sourcedata', onFirstFrameData);
  };
  map.on('sourcedata', onFirstFrameData);
  // NWP model selector (plan P1.1). best_match is Open-Meteo's default;
  // others route the request to a specific national model. State is
  // sourced from the URL hash (?model=icon_seamless etc.) and synced
  // back when the user clicks a different model pill.
  let activeModel: string = hashed?.model || 'best_match';
  let rvData: RainviewerData | null = null;
  let rvOpacity = getLayerDef('radar')?.defaultOpacity ?? 0.8;
  let tlFrames: RadarFrame[] = [];
  let frameIndex = -1;
  // Story 21.3 — assigned once the raster factory and the timeline
  // player exist (further down); declared here so applyFrame() can call
  // the prefetch hook whenever it runs.
  let framePrefetcher: FramePrefetcher | null = null;
  let tlIsPlaying = (): boolean => false;
  let activeFrameIso: string | null = null;
  let pendingSeekIso: string | null = hashed?.t ?? null;
  // Story 15.1 — one in-flight "Ver 10 días" fetch at a time.
  let extendInFlight: Promise<boolean> | null = null;

  const tlEl = opts.els.timeline ?? null;
  const tlRange = opts.els.tlRange ?? null;
  const tlTime = opts.els.tlTime ?? null;
  // Story 23.1 — the date-scale bar; created with the timeline controls
  // further down, redrawn by applyFrame()/showTimeline().
  let tlBar: TimelineBar | null = null;
  // Story 23.3 — "Saltar a fecha": the label (or Enter on the range)
  // opens a native date/time input; created with the bar.
  let tlJump: TimelineJump | null = null;

  /** Locale / zone / hour format for the bar and the range's valuetext
   *  (read live: the ⚙ panel and ?lang=en apply without a reload). */
  function tickFormat(): TickFormat {
    const s = readSettings();
    const docLangNow =
      document.documentElement.getAttribute('data-lang') || lang;
    return {
      locale: docLangNow === 'en' ? 'en-US' : 'es-MX',
      tz: s.tz === 'UTC' ? 'UTC' : 'local',
      hour12: s.hourFormat === '12',
    };
  }

  /** What a screen reader hears for the range: the full date and time
   *  plus the relative offset ("miércoles, 30 de septiembre, 15:00 ·
   *  +2 h"), not a bare frame index. */
  function frameValueText(frame: RadarFrame): string {
    const off = frameOffsetMinutes(frame, Math.floor(Date.now() / 1000));
    return `${formatValueText(frame.time, tickFormat())} · ${relativeFrameLabel(
      off,
      { now: t.timeline_now }
    )}`;
  }

  function frameLabel(frame: RadarFrame): string {
    const off = frameOffsetMinutes(frame, Math.floor(Date.now() / 1000));
    const s = readSettings();
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: s.hourFormat === '12',
    };
    if (s.tz === 'UTC') opts.timeZone = 'UTC';
    const d = new Date(frame.time * 1000);
    let clock = d.toLocaleTimeString('es-MX', opts);
    // Frames a day or more away read ambiguously as a bare "15:00";
    // prefix the weekday ("mié 15:00") past ±24 h (Story 15.1).
    if (needsWeekday(off)) {
      const wd = d.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', {
        weekday: 'short',
        ...(s.tz === 'UTC' ? { timeZone: 'UTC' } : {}),
      });
      clock = `${wd} ${clock}`;
    }
    const rel = relativeFrameLabel(off, { now: t.timeline_now });
    const clockFull = `${clock}${s.tz === 'UTC' ? ' UTC' : ''}`;
    // Story 16.4 — a tap on the pill (or the ⚙ panel) cycles between
    // both parts, clock only and relative only.
    if (s.timeLabel === 'clock') return clockFull;
    if (s.timeLabel === 'relative') return rel;
    return `${clockFull} · ${rel}`;
  }

  // Settings persistence — extracted to src/lib/map/settings.ts.
  // (readSettings / writeSettings / MapSettings re-exported via the
  // import so the existing references stay unchanged.)

  function applyFrame(i: number): void {
    const idx = clampIndex(i, tlFrames.length);
    if (idx < 0) return;
    frameIndex = idx;
    const fr = tlFrames[idx];
    if (getLayerDef(activeLayer)?.kind === 'particles') {
      showWindFrame(idx);
    } else if (getLayerDef(activeLayer)?.kind === 'field') {
      void renderFieldFrame(idx);
    } else {
      showWeatherFrame(activeLayer, fr);
      // Story 21.3 — slide the look-ahead window with the playhead.
      if (tlIsPlaying()) schedulePrefetch();
    }
    activeFrameIso = new Date(fr.time * 1000).toISOString();
    if (tlRange) {
      tlRange.max = String(tlFrames.length - 1);
      tlRange.value = String(idx);
      tlRange.setAttribute('aria-valuetext', frameValueText(fr));
    }
    if (tlTime) tlTime.textContent = frameLabel(fr);
    tlBar?.update();
    syncExtendButton();
    syncHash();
    // Story 18.3 — the centre readout follows the frame.
    crosshair.refresh();
  }

  function showTimeline(show: boolean): void {
    if (!tlEl || !features.timeline) return;
    // Plan P0.3 — timeline pill is now always visible; this function
    // only toggles the controls that depend on having frames. The
    // empty-state placeholder '—' is restored when frames clear.
    if (!show && tlTime) {
      tlTime.textContent = '—';
    }
    if (!show && tlRange) {
      tlRange.value = '0';
      tlRange.setAttribute('max', '0');
      tlRange.removeAttribute('aria-valuetext');
    }
    if (!show) tlBar?.update();
  }

  const FIELD_SOURCE = 'wx-field';
  const FIELD_LAYER = 'wx-field-layer';
  // Field-raster pipeline. The grid layout (cols × rows) and the lat/lng
  // bounds the grid covers are NOT carried inside FieldGrid itself, so we
  // store them alongside the grid for the bilinear-raster rebuild on every
  // frame change / pan resample. `fieldBlobUrl` is the URL backing the
  // current MapLibre image source — revoked + replaced on each update.
  // Sample density: 32×24 = 768 points over the ~70°×55° MX bbox
  // (~2.2°×2.3° per cell — finer than zoom.earth's ICON 13km globally
  // and matches their ECMWF 9km within MX). Open-Meteo bulk endpoint
  // accepts up to 5000 locations so 768 is well within limits.
  //
  // History: 10×7 (70 pts, #121 rollback from 140), bumped to 16×11
  // (176 pts, #169 for smoothness), now 32×24 (768 pts, plan 1.1A
  // for zoom.earth-superior field).
  const FIELD_GRID_COLS = 32;
  const FIELD_GRID_ROWS = 24;
  /**
   * Fixed bounding box used by all field layers (temperature, humidity,
   * pressure) so the bilinear interpolation samples the SAME 70 points
   * regardless of camera zoom. Without a fixed grid the same lat/lng
   * paints different colors at different zooms because the sample
   * density changes — temperature in MX would change just by zooming.
   *
   * Covers México plus a margin for the southern US, Caribbean,
   * Central America so when the user pans / zooms out we still have
   * meaningful coverage in the visible viewport.
   */
  const MX_FIELD_BOUNDS: RasterBounds = {
    // Wider bbox so the alpha fade at the raster edges (see mapraster.ts
    // edgeFalloff) lands BEYOND the typical /mapa viewport at z=4..6.
    // Otherwise the user sees the hard rectangle of the field source.
    // Coverage: continental MX + USA west/south + Caribbean + most of
    // Central America.
    west: -130,
    south: -5,
    east: -60,
    north: 50,
  };
  // Offscreen canvas size for the rendered raster. 600×420 is the
  // sweet spot for the bicubic upsample from the 10×7 input grid: each
  // input cell expands into a ~60×60 px region of smoothly-curving
  // color, well above the visual threshold where bilinear-at-the-same-
  // resolution would just look noisy. The per-frame cost (~12 ms on a
  // mid laptop) is still under the 16.6 ms frame budget; only paid on
  // hour-slider scrubs and the initial layer activation.
  // Bumped to 1000×700 to keep ~30×30 px per input cell at 32×24 grid.
  // Per-frame raster cost goes to ~30 ms on a mid laptop (still under
  // the budget for one-time scrubs and layer activation).
  const FIELD_RASTER_W = 1000;
  const FIELD_RASTER_H = 700;
  let fieldGrid: FieldGrid | null = null;
  // Cached per-layer grids so the multi-metric tooltip (#2.1) can show
  // temp + humidity + pressure + wind simultaneously even when the
  // user is only on one of those layers. Keyed by the layer id so the
  // most-recent grid per layer survives layer switches. Small memory
  // cost (~70 KB each) for materially better UX.
  let lastTempGrid: FieldGrid | null = null;
  let lastHumidityGrid: FieldGrid | null = null;
  let lastPressureGrid: FieldGrid | null = null;
  let fieldBounds: RasterBounds | null = null;
  let fieldBlobUrl: string | null = null;
  const fieldResampleTimer = 0;

  interface FieldConfig {
    hourlyVar: string;
    color: (v: number) => string;
  }
  /** Sub-option state per layer. zoom.earth's Temperatura has
   *  Actual/Aparente; we wire Actual + Aparente here. Other layers
   *  will follow the same pattern. */
  type TempSubOption = 'actual' | 'aparente' | 'bulbo';
  type HumiditySubOption = 'relativa' | 'rocio';
  type PressureSubOption = 'msl' | 'surface';
  type WindSubOption = 'velocidad' | 'rachas';
  type PrecipSubOption = 'lluvia' | 'nieve' | 'probabilidad';
  type SatelliteSubOption = 'geocolor' | 'ir' | 'truecolor';
  let tempSubOption: TempSubOption = 'actual';
  let humiditySubOption: HumiditySubOption = 'relativa';
  let pressureSubOption: PressureSubOption = 'msl';
  let windSubOption: WindSubOption = 'velocidad';
  let precipSubOption: PrecipSubOption = 'lluvia';
  let satelliteSubOption: SatelliteSubOption = 'geocolor';
  function tempHourlyVar(): string {
    if (tempSubOption === 'aparente') return 'apparent_temperature';
    if (tempSubOption === 'bulbo') return 'wet_bulb_temperature_2m';
    return 'temperature_2m';
  }
  function humidityHourlyVar(): string {
    return humiditySubOption === 'rocio'
      ? 'dew_point_2m'
      : 'relative_humidity_2m';
  }
  function pressureHourlyVar(): string {
    return pressureSubOption === 'surface'
      ? 'surface_pressure'
      : 'pressure_msl';
  }
  // Story 15.5 — precipitation sub-options map to Open-Meteo hourly
  // variables; `precipitation` (rain + showers + snow water) is the
  // pre-baked default, `snowfall` is cm/h, probability is %.
  function precipHourlyVar(): string {
    if (precipSubOption === 'nieve') return 'snowfall';
    if (precipSubOption === 'probabilidad') return 'precipitation_probability';
    return 'precipitation';
  }
  function precipColorFn(): (v: number) => string {
    if (precipSubOption === 'nieve') return snowColor;
    if (precipSubOption === 'probabilidad') return precipProbColor;
    return precipColor;
  }
  function precipUnit(): string {
    if (precipSubOption === 'nieve') return 'cm/h';
    if (precipSubOption === 'probabilidad') return '%';
    return 'mm/h';
  }
  /** Unit of the active field variable in the display units (Story 13.3
   *  legend + tooltip spread). Spread stays in metric steps. */
  function fieldUnitLabel(): string {
    if (activeLayer === 'temperature') return '°C';
    if (activeLayer === 'humidity') return '%';
    if (activeLayer === 'pressure') return 'hPa';
    if (activeLayer === 'precipitation') return precipUnit();
    return '';
  }
  function precipLegend(): LegendStop[] {
    if (precipSubOption === 'nieve') return SNOW_LEGEND;
    if (precipSubOption === 'probabilidad') return PRECIP_PROB_LEGEND;
    return PRECIP_LEGEND;
  }
  function formatPrecip(v: number): string {
    if (precipSubOption === 'probabilidad') return `${Math.round(v)}%`;
    const n = v < 1 ? Math.round(v * 10) / 10 : Math.round(v);
    return `${n} ${precipUnit()}`;
  }
  const FIELD_CONFIGS: Record<string, FieldConfig> = {
    temperature: {
      get hourlyVar() {
        return tempHourlyVar();
      },
      color: tempColor,
    },
    humidity: {
      get hourlyVar() {
        return humidityHourlyVar();
      },
      color: humidityColor,
    },
    pressure: {
      get hourlyVar() {
        return pressureHourlyVar();
      },
      color: pressureColor,
    },
    precipitation: {
      get hourlyVar() {
        return precipHourlyVar();
      },
      get color() {
        return precipColorFn();
      },
    },
  } as unknown as Record<string, FieldConfig>;
  let fieldAbort: AbortController | null = null;

  // Story 13.3 — model disagreement ("incertidumbre"): the same
  // variable from several NWP models, rendered as their spread.
  const SPREAD_MODELS = ['icon_seamless', 'gfs_seamless', 'ecmwf_ifs04'];
  let confidenceMode = false;
  let spreadGrid: FieldGrid | null = null;
  let spreadAbort: AbortController | null = null;
  let spreadFor = '';

  async function loadSpreadGrid(): Promise<void> {
    const cfg = FIELD_CONFIGS[activeLayer];
    if (!cfg || !fieldGrid || !confidenceMode) return;
    const key = `${activeLayer}:${cfg.hourlyVar}`;
    if (spreadGrid && spreadFor === key) return;
    spreadAbort?.abort();
    const ac = new AbortController();
    spreadAbort = ac;
    const pts = fieldGrid.points.map((p) => ({ lat: p.lat, lng: p.lng }));
    const refTimes = fieldGrid.times;
    showMsg(t.confidence_loading);
    try {
      const results = await Promise.allSettled(
        SPREAD_MODELS.map(async (model) => {
          const json = await fetchFieldChunks(pts, cfg.hourlyVar, deps.fetch, {
            signal: ac.signal,
            model,
          });
          return parseFieldResponse(json, pts, cfg.hourlyVar);
        })
      );
      if (ac.signal.aborted) return;
      const grids = results
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter((g): g is FieldGrid => !!g);
      spreadGrid = spreadFieldGrid(grids, pts, refTimes);
      spreadFor = key;
      hideMsg();
      if (!spreadGrid) {
        showMsg(t.confidence_failed);
        window.setTimeout(hideMsg, 4000);
        return;
      }
      if (getLayerDef(activeLayer)?.kind === 'field' && frameIndex >= 0) {
        void renderFieldFrame(frameIndex);
      }
      renderLegend(legendKindFor());
      refreshCityValues();
    } finally {
      if (spreadAbort === ac) spreadAbort = null;
    }
  }

  function setConfidenceMode(on: boolean): void {
    confidenceMode = on;
    if (!on) {
      spreadAbort?.abort();
      spreadGrid = null;
      spreadFor = '';
    }
    if (getLayerDef(activeLayer)?.kind === 'field' && frameIndex >= 0) {
      void renderFieldFrame(frameIndex);
    }
    renderLegend(legendKindFor());
    refreshCityValues();
    if (on) void loadSpreadGrid();
  }

  // Wind particles WebGL layer — shader + GPU setup extracted to
  // src/lib/map/layers/wind-particles.ts. Layer id is re-exported as
  // WIND_PARTICLES_LAYER_ID; alias kept for the rest of this file.
  const WIND_LAYER = WIND_PARTICLES_LAYER_ID;
  const WIND_CIRCLE_LAYER = 'wx-wind-circle';
  const WIND_CIRCLE_SOURCE = 'wx-wind-circle-src';

  let windGrid: WindGrid | null = null;
  let windHourIndex = 0;
  // Read live (not snapshotted) so toggling the OS accessibility
  // setting mid-session takes effect on the next wind frame.
  const isReducedMotion = (): boolean =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let windRaf = 0;
  let windTexDirty = true;

  // Sun / day-night terminator layer — extracted to
  // src/lib/map/layers/sun-layer.ts. The factory takes an opacity
  // getter so the layer follows the opacity slider's value.
  const sunLayer = createSunLayer(map, () => rvOpacity / 0.45);
  const refreshSun = (): void => sunLayer.refresh();
  const removeSun = (): void => sunLayer.remove();

  function removeWind(): void {
    if (windRaf) {
      window.cancelAnimationFrame(windRaf);
      windRaf = 0;
    }
    if (map.getLayer(WIND_LAYER)) map.removeLayer(WIND_LAYER);
    if (map.getLayer(WIND_CIRCLE_LAYER)) map.removeLayer(WIND_CIRCLE_LAYER);
    if (map.getSource(WIND_CIRCLE_SOURCE)) map.removeSource(WIND_CIRCLE_SOURCE);
    removeCityValues();
  }

  /** Plan P2.6 — Wind animation as a concurrent overlay.
   *
   * When the user enables "Animación de viento" with a field layer
   * active (temperatura/humedad/presión), we render the WIND particles
   * on top of the field without unsetting activeLayer. The wind grid
   * is fetched once for the current viewport and tracks the global
   * frameIndex (both are 1-hour stride from Open-Meteo).
   *
   * Distinct from removeWind() which is called by the layer switcher:
   * this one leaves city-value pills intact (those belong to the
   * underlying field).
   */
  let windOverlayEnabled = false;
  async function addWindOverlay(): Promise<void> {
    if (activeLayer === 'wind') return; // already showing
    const b = map.getBounds();
    const grid = viewportGrid(
      {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      },
      8,
      6
    );
    const speedVar =
      windSubOption === 'rachas' ? 'wind_gusts_10m' : 'wind_speed_10m';
    try {
      const json = await fetchWindChunks(grid, speedVar, deps.fetch, {
        model: activeModel,
      });
      const wg = parseWindResponse(json, grid, speedVar);
      if (!wg || wg.points.length === 0) return;
      windGrid = wg;
      windTexDirty = true;
      const h = Math.max(
        0,
        Math.min(wg.times.length - 1, frameIndex >= 0 ? frameIndex : 0)
      );
      showWindFrame(h);
    } catch {
      /* enhancement only — silent on failure */
    }
  }
  function removeWindOverlay(): void {
    if (activeLayer === 'wind') return; // owned by the layer, not us
    if (windRaf) {
      window.cancelAnimationFrame(windRaf);
      windRaf = 0;
    }
    if (map.getLayer(WIND_LAYER)) map.removeLayer(WIND_LAYER);
    if (map.getLayer(WIND_CIRCLE_LAYER)) map.removeLayer(WIND_CIRCLE_LAYER);
    if (map.getSource(WIND_CIRCLE_SOURCE)) map.removeSource(WIND_CIRCLE_SOURCE);
  }

  // windPointsAtHour now imported from the wind-particles module so
  // the layer + this layer-rail wiring share a single implementation.

  function windCircleGeoJSON(g: WindGrid, h: number): FeatureCollection {
    const feats: Feature[] = [];
    for (const p of g.points) {
      const u = p.u[h];
      const v = p.v[h];
      if (u === null || v === null) continue;
      const s = windSpeed(u, v);
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { color: windSpeedColor(s), speed: Math.round(s) },
      });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  function showWindFrame(h: number): void {
    if (!windGrid) return;
    windHourIndex = h;
    windTexDirty = true;
    if (isReducedMotion()) {
      const data = windCircleGeoJSON(windGrid, h);
      const src = map.getSource(WIND_CIRCLE_SOURCE) as
        maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        map.addSource(WIND_CIRCLE_SOURCE, { type: 'geojson', data });
        map.addLayer({
          id: WIND_CIRCLE_LAYER,
          type: 'circle',
          source: WIND_CIRCLE_SOURCE,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 8, 18],
            'circle-color': ['get', 'color'],
            'circle-opacity': rvOpacity,
          },
        });
      }
      return;
    }
    if (!map.getLayer(WIND_LAYER)) {
      map.addLayer(
        makeWindParticlesLayer(map, {
          getWindGrid: () => windGrid,
          getHourIndex: () => windHourIndex,
          isTexDirty: () => windTexDirty,
          markTexClean: () => {
            windTexDirty = false;
          },
          onTick: (id) => {
            windRaf = id;
          },
        })
      );
    }
    // City value pills for wind (e.g. "12 km/h ↑").
    refreshCityValues();
  }

  function revokeFieldBlob(): void {
    if (fieldBlobUrl) {
      try {
        URL.revokeObjectURL(fieldBlobUrl);
      } catch {
        /* some test envs lack URL.revokeObjectURL — ignore */
      }
      fieldBlobUrl = null;
    }
  }

  function removeField(): void {
    if (map.getLayer(FIELD_LAYER)) map.removeLayer(FIELD_LAYER);
    // Legacy halo + circle layer cleanup (PR #119/#121 stacks). Kept
    // defensive so older sessions / hot-reloads don't leak the layer.
    if (map.getLayer(FIELD_LAYER + '-halo'))
      map.removeLayer(FIELD_LAYER + '-halo');
    if (map.getSource(FIELD_SOURCE)) map.removeSource(FIELD_SOURCE);
    revokeFieldBlob();
    removeIsobars();
    removeCityValues();
  }

  // City value pills overlay — extracted to
  // src/lib/map/overlays/city-values.ts.
  const cityValues = createCityValuesOverlay(map, {
    cities,
    getValueAt: (lng, lat) => tooltipValueAt(lng, lat),
    isShowable: () => {
      const def = getLayerDef(activeLayer);
      return def?.kind === 'field' || def?.kind === 'particles';
    },
  });
  // Thin wrappers preserve historic names used by the multi-metric
  // tooltip + field/wind refresh paths.
  const removeCityValues = (): void => cityValues.remove();
  const refreshCityValues = (): void => cityValues.refresh();
  // Backing flag mirrored by the overlay registry entry below.
  let cityValuesEnabled = true;

  // Pressure isobars — extracted to src/lib/map/layers/isobars.ts.
  const isobarsLayer = createIsobarsLayer(map, () => currentUnits().pressure);
  // Story 18.3 — crosshair mode; getValueAt is hoisted (function
  // declaration) so wiring it here, before the tooltip block, is safe.
  const crosshair = createCrosshair(map, {
    container: map.getContainer(),
    getValueAt: (lng, lat) => tooltipValueAt(lng, lat),
  });
  const removeIsobars = (): void => isobarsLayer.remove();

  // Graticule overlay — extracted to src/lib/map/overlays/graticule.ts
  const graticuleOverlay = createGraticuleOverlay(map);

  // Night lights + night line overlays — extracted to modules.
  const nightLightsOverlay = createNightLightsOverlay(map);
  const nightLineOverlay = createNightLineOverlay(map);

  // Borders overlay — extracted to src/lib/map/overlays/borders.ts.
  const bordersOverlay = createBordersOverlay(map, {
    fetch: cachedFetch,
    base,
  });

  // Radar coverage overlay — extracted to src/lib/map/overlays/radar-coverage.ts.
  const radarCoverageOverlay = createRadarCoverageOverlay(map);

  // Fires overlay — extracted to src/lib/map/overlays/fires.ts. Takes
  // cachedFetch + the site base for the cached JSON path.
  const firesOverlay = createFiresOverlay(map, {
    fetch: cachedFetch,
    base,
  });

  // Static MX-unique overlays — extracted to per-module factories
  // under src/lib/map/overlays/. Single line per overlay because all
  // the implementation (data list + add/remove logic) lives in the
  // module, not here.
  const lakesOverlay = createLakesOverlay(map);
  const histStormsOverlay = createHistStormsOverlay(map, {
    fetch: cachedFetch,
    base,
  });
  const webcamsOverlay = createWebcamsOverlay(map);

  // Active volcanoes overlay — extracted to src/lib/map/overlays/volcanoes.ts
  // (refactor: see PLAN_UX_PARITY.md §Refactor). Factory returns an
  // object matching the overlay registry interface.
  const volcanoesOverlay = createVolcanoesOverlay(map);
  const aqiOverlay = createAqiOverlay(map, { fetch: cachedFetch, base });
  const smnStateTintOverlay = createSmnStateTintOverlay(map, {
    fetch: cachedFetch,
    base,
  });
  const marineOverlay = createMarineOverlay(map, {
    fetch: cachedFetch,
    base,
  });

  // USGS earthquakes overlay — extracted to src/lib/map/overlays/quakes.ts
  // (refactor). The factory takes a fetch function so it can be the
  // existing cachedFetch in production and a stub in unit tests.
  const quakesOverlay = createQuakesOverlay(map, {
    fetch: cachedFetch,
    base,
  });

  // ----------------------------------------------------------------
  // Cloud cover overlay (zoom.earth's "Nubes" — translucent grayscale
  // cloud field over any base layer). Uses Open-Meteo cloud_cover
  // sampled on the same 32×24 MX grid, rendered as a grayscale raster
  // where alpha tracks cloud_cover %.
  // ----------------------------------------------------------------
  // Clouds overlay — extracted to src/lib/map/overlays/clouds.ts.
  const cloudsOverlay = createCloudsOverlay(map, {
    fetch: deps.fetch,
    bounds: MX_FIELD_BOUNDS,
    gridCols: FIELD_GRID_COLS,
    gridRows: FIELD_GRID_ROWS,
    getModel: () => activeModel,
    base,
  });

  // Tropical storms overlay — extracted to src/lib/map/overlays/tropical-storms.ts.
  // The factory takes the NHC source and an onEmpty callback so it
  // can auto-disable the checkbox when there are no active systems.
  const stormsGisSource = createStormsGisSource(base);
  const nhcSourceBound = createNhcSource(base);
  const tropicalStormsOverlay = createTropicalStormsOverlay(
    map,
    {
      fetch: () => nhcSourceBound.fetch(undefined, undefined),
      // Story 18.1 — cone / track / watches from the GIS snapshot.
      fetchGis: () => stormsGisSource.fetch(),
    },
    () => {
      tropicalEnabled = false;
      refreshOverlayCheckboxes();
    }
  );
  // Story 18.2 — NHC Tropical Weather Outlook areas (2 d / 7 d chance).
  const tropicalOutlookOverlay = createTropicalOutlookOverlay(
    map,
    () => stormsGisSource.fetch(),
    () => refreshOverlayCheckboxes()
  );
  // Backwards-compat alias used by callers below (refreshTropicalStorms
  // is invoked from the map's 'load' handler).
  const refreshTropicalStorms = async (): Promise<void> => {
    await tropicalStormsOverlay.refresh();
    await tropicalOutlookOverlay.refresh();
    refreshOverlayCheckboxes();
  };

  function refreshIsobars(): void {
    if (activeLayer !== 'pressure' || !fieldGrid || !fieldBounds) {
      isobarsLayer.remove();
      return;
    }
    // Pick the values at the active hour for every grid point, in
    // row-major order matching viewportGrid (south→north, west→east).
    const values: number[] = [];
    for (const p of fieldGrid.points) {
      const v = p.values[frameIndex];
      values.push(typeof v === 'number' ? v : NaN);
    }
    // d3-contour can't handle NaN, replace with field mean (rare).
    const finite = values.filter((v) => Number.isFinite(v));
    if (finite.length < 4) {
      isobarsLayer.remove();
      return;
    }
    const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
    const safe = values.map((v) => (Number.isFinite(v) ? v : mean));
    isobarsLayer.update({
      values: safe,
      cols: FIELD_GRID_COLS,
      rows: FIELD_GRID_ROWS,
      bounds: fieldBounds,
    });
  }

  /**
   * Render the field's bilinearly interpolated continuous-gradient raster
   * for `hourIndex` and swap it into the FIELD_LAYER image source. First
   * call adds the source + raster layer; subsequent calls re-use the same
   * source via `updateImage`, revoking the previous Blob URL.
   *
   * In test environments where neither OffscreenCanvas nor a DOM canvas is
   * available, renderFieldRaster returns null and we skip the swap — the
   * layer is just absent (the e2e suite only asserts UI controls / opacity
   * wrap visibility for field layers, not the GL texture pixels).
   */
  async function renderFieldFrame(hourIndex: number): Promise<void> {
    const cfg = FIELD_CONFIGS[activeLayer];
    if (!fieldGrid || !fieldBounds || !cfg) return;
    // Isobars track the same field/frame as the pressure raster; refresh
    // them whenever the underlying grid or frame changes. No-op for other
    // field layers (early-returns inside refreshIsobars).
    refreshIsobars();
    // City value pills (zoom.earth "Valores de etiquetas") follow the same
    // cadence — value sampled via tooltipValueAt() at each city.
    refreshCityValues();
    // Story 13.3 — in confidence mode the raster shows the models'
    // spread instead of the value (same grid layout, own ramp).
    const useSpread = confidenceMode && !!spreadGrid;
    const render = await renderFieldRaster(
      useSpread && spreadGrid ? spreadGrid : fieldGrid,
      FIELD_GRID_ROWS,
      FIELD_GRID_COLS,
      fieldBounds,
      hourIndex,
      useSpread ? spreadColorFor(activeLayer) : cfg.color,
      { width: FIELD_RASTER_W, height: FIELD_RASTER_H }
    );
    if (!render) return;
    // Activelayer may have flipped while the canvas blob was settling.
    if (getLayerDef(activeLayer)?.kind !== 'field') {
      URL.revokeObjectURL(render.blobUrl);
      return;
    }
    const existing = map.getSource(FIELD_SOURCE) as
      | (maplibregl.ImageSource & {
          updateImage?: (opts: {
            url: string;
            coordinates?: ImageCorners;
          }) => void;
        })
      | undefined;
    if (existing && typeof existing.updateImage === 'function') {
      const prev = fieldBlobUrl;
      existing.updateImage({ url: render.blobUrl, coordinates: render.coords });
      fieldBlobUrl = render.blobUrl;
      // Defer revoking the previous blob a frame: on rapid scrubs the
      // GPU may still be decoding the just-swapped image and revoking
      // synchronously yields a blank/corrupt raster frame.
      if (prev && prev !== render.blobUrl) {
        window.requestAnimationFrame(() => {
          try {
            URL.revokeObjectURL(prev);
          } catch {
            /* already revoked */
          }
        });
      }
      return;
    }
    // Either no source yet, or the runtime stub lacks updateImage —
    // (re)create both the source and the layer.
    if (map.getLayer(FIELD_LAYER)) map.removeLayer(FIELD_LAYER);
    if (map.getSource(FIELD_SOURCE)) map.removeSource(FIELD_SOURCE);
    revokeFieldBlob();
    map.addSource(FIELD_SOURCE, {
      type: 'image',
      url: render.blobUrl,
      coordinates: render.coords,
    });
    map.addLayer({
      id: FIELD_LAYER,
      type: 'raster',
      source: FIELD_SOURCE,
      paint: {
        'raster-opacity': rvOpacity,
        'raster-fade-duration': 0,
        // Linear resampling is the critical bit — MapLibre's GPU does a
        // second bilinear pass on top of our 400×280 raster, smearing the
        // already-interpolated texels into a continuous gradient at any
        // zoom level. With nearest-neighbour the seams between texels
        // would still be visible at high zoom.
        'raster-resampling': 'linear',
      },
    });
    fieldBlobUrl = render.blobUrl;
  }

  /** Default hourly variables we pre-bake via the field-grids.yml
   *  workflow. When the user hasn't touched a sub-option AND is on
   *  best_match, the static cache is byte-compatible with the live
   *  response and we can skip the live API entirely. */
  const STATIC_FIELD_VARS: ReadonlySet<string> = new Set([
    'temperature_2m',
    'relative_humidity_2m',
    'pressure_msl',
    'cloud_cover',
    'precipitation',
  ]);

  async function loadFieldGrid(layerId: string): Promise<boolean> {
    const cfg = FIELD_CONFIGS[layerId];
    if (!cfg) return false;
    // Always sample on a FIXED grid covering Mexico + margin so the
    // bilinear interpolation gives stable values per lat/lng across
    // zoom levels. The raster image is drawn at MX_FIELD_BOUNDS — when
    // the viewport zooms in, MapLibre's raster-resampling: linear
    // smoothly upscales the same field; zooming changes detail, not
    // colors.
    const bounds: RasterBounds = { ...MX_FIELD_BOUNDS };
    const grid = viewportGrid(bounds, FIELD_GRID_COLS, FIELD_GRID_ROWS);
    fieldBounds = bounds;
    fieldAbort?.abort();
    const ac = new AbortController();
    fieldAbort = ac;

    // Static-first: when the current sub-option resolves to a pre-baked
    // hourly variable on best_match, try the snapshot before the live
    // API. Static returns the same FieldGrid shape so no conversion
    // needed; on miss / network failure we fall through to live.
    const wantsStatic =
      activeModel === 'best_match' && STATIC_FIELD_VARS.has(cfg.hourlyVar);
    if (wantsStatic) {
      try {
        const r = await deps.fetch(
          `${base}data/field-grids/${cfg.hourlyVar}.json`,
          { signal: ac.signal }
        );
        if (!ac.signal.aborted && r.ok) {
          const snap = (await r.json()) as FieldGrid | null;
          if (
            snap &&
            Array.isArray(snap.points) &&
            snap.points.length === grid.length &&
            Array.isArray(snap.times) &&
            snap.times.length > 0
          ) {
            fieldGrid = snap;
            if (layerId === 'temperature') lastTempGrid = snap;
            else if (layerId === 'humidity') lastHumidityGrid = snap;
            else if (layerId === 'pressure') lastPressureGrid = snap;
            if (fieldAbort === ac) fieldAbort = null;
            return true;
          }
        }
      } catch {
        /* fall through to live */
      }
      if (ac.signal.aborted) return false;
    }

    // Cold-load resilience: the first Open-Meteo fetch occasionally
    // fails (network race on page init, transient DNS, etc.). Retry
    // once after 500 ms before falling back to base layer — empirically
    // resolves the URL-hash cold-load failure where ?layer=temperature
    // sometimes activated as base.
    //
    // Chunked: at 32×24=768 points the single-request URL exceeds
    // Open-Meteo's ~8 KB GET limit and the server returns HTTP 414.
    // fetchFieldChunks splits into ≤200-point batches under the hood
    // and concatenates the response arrays in input order.
    async function attempt(): Promise<unknown[]> {
      return fetchFieldChunks(grid, cfg.hourlyVar, deps.fetch, {
        signal: ac.signal,
        model: activeModel,
      });
    }
    try {
      let json: unknown[];
      try {
        json = await attempt();
      } catch {
        if (ac.signal.aborted) return false;
        await new Promise((r) => setTimeout(r, 500));
        if (ac.signal.aborted) return false;
        json = await attempt();
      }
      if (ac.signal.aborted) return false;
      fieldGrid = parseFieldResponse(json, grid, cfg.hourlyVar);
      // Cache per layer so the multi-metric tooltip can read it later
      // even when the user has switched to a different layer.
      if (fieldGrid) {
        if (layerId === 'temperature') lastTempGrid = fieldGrid;
        else if (layerId === 'humidity') lastHumidityGrid = fieldGrid;
        else if (layerId === 'pressure') lastPressureGrid = fieldGrid;
        if (confidenceMode) {
          spreadGrid = null;
          void loadSpreadGrid();
        }
      }
    } catch {
      if (ac.signal.aborted) return false;
      fieldGrid = null;
    } finally {
      if (fieldAbort === ac) fieldAbort = null;
    }
    return !!fieldGrid && fieldGrid.points.length > 0;
  }

  // Radar/satellite weather raster + dim backdrop — extracted to
  // src/lib/map/layers/weather-raster.ts. The factory exposes show /
  // remove / setOpacity. We bind it to the existing showMsg/hideMsg so
  // the satellite zoom-limit hint still surfaces from this map's UI.
  const weatherRaster = createWeatherRaster(map, {
    showMsg,
    hideMsg,
    // Story 16.4 — "estilo" setting: smooth cross-fades tiles between
    // frames, fast swaps them instantly.
    getFadeMs: () => RASTER_FADE_MS[readSettings().playStyle],
    // Story 21.1 — imagery goes UNDER the basemap labels, never over them.
    beforeLayerId: BASEMAP_REFERENCE_LAYER_ID,
  });
  const removeWeatherRaster = (): void => {
    weatherRaster.remove();
    // Story 21.3 — nothing ahead to warm once the raster is gone.
    framePrefetcher?.cancel();
    // Story 21.1 — back to the theme's own canvas (light stays light).
    basemapTheme.setImagery(false);
  };
  const showWeatherFrame = (layerId: string, frame: RadarFrame): void => {
    // Story 21.1 — dark canvas under clouds/echoes even in the light theme.
    basemapTheme.setImagery(true);
    weatherRaster.show(layerId === 'satellite' ? 'satellite' : 'radar', frame, {
      rvData,
      satelliteSubOption,
      opacity: rvOpacity,
      currentZoom: map.getZoom(),
    });
    // Story 13.2 — combined mode: the radar frame nearest to the
    // satellite instant rides on top (RainViewer covers −2 h … +30 min,
    // so older satellite frames simply show no radar).
    if (precipMode && layerId === 'satellite') {
      weatherRaster.showRadarCompanion(
        rvData ? nearestFrame(rvData.frames, frame.time, 15 * 60) : null,
        { rvData, opacity: Math.min(1, rvOpacity * 0.9) }
      );
    } else {
      weatherRaster.removeRadarCompanion();
    }
  };

  // ------------------------------------------------------------------
  // Story 21.3 — frame prefetch. While the loop plays radar, the tiles
  // the viewport needs for the next frames are fetched ahead with
  // Image() (same URLs MapLibre builds from the same tile spec), under a
  // 4 MB look-ahead window. A layer or view change cancels whatever is
  // in flight. Opt-in per page (/mapa and the per-layer pages) and never
  // under data saver.
  //
  // Satellite is NOT prefetched: NASA GIBS answers every tile with
  // `Cache-Control: max-age=0, no-store` (checked live 2026-09-28, any
  // TIME, with and without Origin/Referer), so MapLibre's own fetch
  // never reuses an Image() download — prefetching only doubled the
  // GIBS traffic and made the gate wait on useless loads. RainViewer
  // sends `max-age=172800`, so radar is where the HTTP cache works. The
  // satellite loop is gated on the A/B swap instead (nextFrameReady).
  // ------------------------------------------------------------------
  framePrefetcher =
    opts.framePrefetch === true && !readSaveData(navigator)
      ? createFramePrefetcher({ loader: imageTileLoader() })
      : null;

  function prefetchLayer(): 'radar' | null {
    return activeLayer === 'radar' ? 'radar' : null;
  }

  /** Tile URLs frame `i` needs in the current view ([] when not a
   *  prefetchable raster frame). */
  function frameTileUrls(i: number): string[] {
    const layer = prefetchLayer();
    const frame = tlFrames[i];
    if (!layer || !frame) return [];
    const spec = weatherRasterTileSpec(layer, frame, {
      rvData,
      satelliteSubOption,
    });
    if (!spec) return [];
    const b = map.getBounds();
    return visibleTileCoords(
      {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      },
      map.getZoom(),
      { tileSize: spec.tileSize, maxZoom: spec.maxzoom }
    ).map((c) => fillTileTemplate(spec.url, c));
  }

  function currentLoopRange(): [number, number] {
    return loopRange(
      tlFrames.map((f) => f.time),
      // Story 21.2 — the boot loop covers the last 3 h unless the
      // visitor ever chose a window in ⚙ (read raw: readSettings()
      // fills the 24 h default in, and "default" is what we override).
      bootLoopActive
        ? bootLoopHours(readRawSettings())
        : readSettings().loopHours,
      Math.floor(Date.now() / 1000)
    );
  }

  function schedulePrefetch(): void {
    if (!framePrefetcher) return;
    const layer = prefetchLayer();
    if (!layer || tlFrames.length < 2 || frameIndex < 0) {
      framePrefetcher.cancel();
      return;
    }
    const b = map.getBounds();
    const r = (v: number): string => v.toFixed(3);
    framePrefetcher.schedule({
      key: [
        layer,
        rvData?.host ?? '',
        map.getZoom().toFixed(2),
        r(b.getWest()),
        r(b.getSouth()),
        r(b.getEast()),
        r(b.getNorth()),
      ].join('|'),
      frames: upcomingFrames(
        frameIndex,
        tlFrames.length,
        PREFETCH_FRAMES,
        currentLoopRange()
      ),
      urlsFor: frameTileUrls,
    });
  }

  /** Timeline gate. Radar: the next frame's tiles are cached. Satellite
   *  (not prefetchable, see above): the current frame is on screen
   *  with its tiles in (the A/B swap landed) — the loop never runs
   *  ahead of what is drawn, and each GIBS tile is downloaded once, by
   *  MapLibre. Story 23.2 — both also wait for the current frame's
   *  cross-fade (`raster-fade-duration`, the "estilo" setting) to end:
   *  a step mid-fade would snap it. Waits at most 3 s — a slow tile must
   *  not freeze the loop. */
  function nextFrameReady(next: number): Promise<boolean> {
    if (!framePrefetcher) return Promise.resolve(true);
    const layerAtAsk = activeLayer;
    const sameLayer = (): boolean => activeLayer === layerAtAsk;
    if (activeLayer === 'satellite') {
      return weatherRaster.swapSettled(3000).then(sameLayer);
    }
    if (!prefetchLayer()) return Promise.resolve(true);
    schedulePrefetch();
    const urls = frameTileUrls(next);
    const onScreen = weatherRaster.swapSettled(3000);
    if (framePrefetcher.isCached(urls)) return onScreen.then(sameLayer);
    return Promise.all([onScreen, framePrefetcher.ensure(urls, 3000)]).then(
      sameLayer
    );
  }

  if (framePrefetcher) {
    // The view is part of every URL: a pan/zoom voids the window, and
    // it is re-planned for the new view when the move ends.
    map.on('movestart', () => framePrefetcher?.cancel());
    map.on('moveend', () => {
      if (tlIsPlaying()) schedulePrefetch();
    });
    if (
      exposeE2eHook &&
      new URLSearchParams(location.search).get('e2e') === '1'
    ) {
      (
        window as unknown as { __framePrefetch?: FramePrefetcher }
      ).__framePrefetch = framePrefetcher;
    }
  }

  /** Story 13.2 — zoom.earth's "Precipitación" picture in one click:
   *  GeoColor satellite + cloud-cover overlay + radar, shareable via
   *  `&mode=precip`. Turning it off removes radar + clouds and leaves
   *  the satellite layer. */
  let precipMode = hashed?.mode === 'precip';
  function setPrecipMode(on: boolean): void {
    precipMode = on;
    void cloudsOverlay.setEnabled(on);
    if (on && activeLayer !== 'satellite') {
      void setActiveLayer('satellite');
    } else if (frameIndex >= 0 && tlFrames[frameIndex]) {
      applyFrame(frameIndex);
    } else {
      weatherRaster.removeRadarCompanion();
    }
    renderLegend(legendKindFor());
    refreshOverlayCheckboxes();
    syncHash();
  }

  /** Which legend the active layer needs (null hides the bar). */
  function legendKindFor():
    | 'radar'
    | 'temperature'
    | 'humidity'
    | 'pressure'
    | 'precipitation'
    | 'confidence'
    | 'wind'
    | null {
    const akind = getLayerDef(activeLayer)?.kind;
    if (confidenceMode && spreadGrid && akind === 'field') return 'confidence';
    if (activeLayer === 'radar') return 'radar';
    // Combined mode reads as precipitation: the radar scale applies.
    if (precipMode && activeLayer === 'satellite') return 'radar';
    if (akind === 'field')
      return activeLayer as
        'temperature' | 'humidity' | 'pressure' | 'precipitation';
    if (akind === 'particles') return 'wind';
    return null;
  }

  function renderLegend(
    kind:
      | 'radar'
      | 'temperature'
      | 'humidity'
      | 'pressure'
      | 'precipitation'
      | 'confidence'
      | 'wind'
      | null
  ): void {
    const el = opts.els.legend;
    const bar = document.getElementById('legend-bar');
    const unitEl = document.getElementById('legend-unit');
    if (!el) return;
    if (!kind) {
      el.innerHTML = '';
      // Inline display:none beats the base sm:flex utility in the
      // cascade — otherwise the legend would stay visible at sm+.
      if (bar) bar.style.display = 'none';
      // Story 23.4 — on the phone dock the Controles trigger sits right
      // above the dock unless a legend takes that spot (global.css).
      bar?.closest('.im-root')?.removeAttribute('data-legend');
      if (unitEl) unitEl.textContent = '';
      return;
    }
    const stops: LegendStop[] =
      kind === 'radar'
        ? RADAR_LEGEND.map((s) => ({
            label: t[s.labelKey as keyof typeof t] as string,
            color: s.color,
          }))
        : kind === 'temperature'
          ? getTempLegend()
          : kind === 'humidity'
            ? HUMIDITY_LEGEND
            : kind === 'pressure'
              ? PRESSURE_LEGEND
              : kind === 'precipitation'
                ? precipLegend()
                : kind === 'confidence'
                  ? spreadLegendFor(activeLayer, fieldUnitLabel())
                  : WIND_LEGEND.map((s) => ({
                      label: t[s.labelKey as keyof typeof t] as string,
                      color: s.color,
                    }));
    // Horizontal stop layout (plan P0.2): a 28×12 swatch with the
    // label below, similar to zoom.earth's bottom-left scale.
    // Story 19.3 — temperature / pressure scales read in the chosen unit.
    const U = currentUnits();
    el.innerHTML = convertLegendStops(stops, kind, U)
      .map(
        (s) =>
          `<li class="flex flex-col items-center gap-0.5 leading-none"><span class="inline-block h-2.5 w-7" style="background:${esc(
            s.color
          )}"></span><span class="text-[10px] tabular-nums">${esc(s.label)}</span></li>`
      )
      .join('');
    // Unit label varies per layer kind. zoom.earth shows °C for the
    // temperature scale; we mirror that for each metric.
    const unit: Record<typeof kind & string, string> = {
      radar: 'mm/h',
      temperature: TEMP_LABEL[U.temp],
      humidity: '%',
      pressure: PRESSURE_LABEL[U.pressure],
      precipitation: precipUnit(),
      confidence: `± ${fieldUnitLabel()}`,
      wind: SPEED_LABEL[U.speed],
    } as Record<string, string>;
    if (unitEl) unitEl.textContent = unit[kind] ?? '';
    if (bar) bar.style.display = '';
    bar?.closest('.im-root')?.setAttribute('data-legend', '');
  }

  /** Story 22.3 — the model toggle only while a forecast grid (field or
   *  wind particles) drives the map. Looked up by id on each call:
   *  refreshLayerButtons runs during boot, before the toggle's wiring. */
  function refreshModelToggle(): void {
    if (!features.modelToggle) return;
    const el = document.getElementById('mw-model-toggle');
    if (el) el.hidden = !modelToggleApplies(getLayerDef(activeLayer)?.kind);
  }

  function refreshLayerButtons(): void {
    refreshModelToggle();
    const wrap = opts.els.layerBtns;
    if (!wrap) return;
    for (const def of LAYERS) {
      const btn = wrap.querySelector(`#layerbtn-${def.id}`);
      if (btn) btn.setAttribute('aria-pressed', String(def.id === activeLayer));
    }
    // Story 22.5 — a collapsed rail (/mapa) names the active layer on its
    // Capas tab, so the choice stays readable with the tiles folded away.
    const current = wrap
      .closest('.im-rail')
      ?.querySelector<HTMLElement>('[data-rail-current]');
    if (current) {
      const def = getLayerDef(activeLayer);
      const short = def
        ? (t[def.shortLabelKey as keyof typeof t] ?? def.id)
        : activeLayer;
      current.textContent = `· ${short}`;
    }
    // Story 19.1 — the info panel links to the active layer's own page.
    const pageLink = document.getElementById(
      'mw-layer-page-link'
    ) as HTMLAnchorElement | null;
    if (pageLink) {
      const lp = layerPageFor(activeLayer);
      pageLink.hidden = !lp;
      if (lp) pageLink.href = `${base}mapa/${lp.slug}/`;
    }
    refreshTempSubOptions();
    refreshHumiditySubOptions();
    refreshPressureSubOptions();
    refreshPrecipSubOptions();
    refreshWindSubOptions();
    refreshSatelliteSubOptions();
    // Plan P2.6: reconcile the wind overlay so it persists across
    // layer changes. addWindOverlay() is async-safe and idempotent;
    // removeWindOverlay() refuses to touch the wind layer when it
    // belongs to the active layer (activeLayer === 'wind').
    if (activeLayer !== 'wind') {
      if (windOverlayEnabled && !map.getLayer(WIND_LAYER)) {
        void addWindOverlay();
      } else if (!windOverlayEnabled && map.getLayer(WIND_LAYER)) {
        removeWindOverlay();
      }
    }
    const akind = getLayerDef(activeLayer)?.kind;
    // Story 22.2 — the opacity control lives in the active layer's block,
    // which follows the active tile's grid row and exists only for a
    // weather layer (nothing to fade on the base map). The block's own
    // classes decide the phone case: with the Controles panel (Story
    // 11.3) it shows only while the panel is open — the fix for the
    // Story 21.2 leak of the slider onto the phone map stays — and the
    // home embed keeps the slider it always had.
    placeActiveBlock();
    if (opts.els.railActive) {
      opts.els.railActive.hidden = !(
        akind === 'raster-tile' ||
        akind === 'field' ||
        akind === 'particles' ||
        akind === 'overlay'
      );
    } else if (!features.mobileControls) {
      opts.els.opacityWrap?.classList.toggle(
        'hidden',
        akind !== 'raster-tile' &&
          akind !== 'field' &&
          akind !== 'particles' &&
          akind !== 'overlay'
      );
    }
    // Collapse the sub-options slot for layers without variants (radar,
    // sun) so it leaves no gap above the opacity row.
    const subSlot = opts.els.subOptions;
    if (subSlot) {
      subSlot.hidden = !Array.from(subSlot.children).some(
        (c) => !c.classList.contains('hidden')
      );
    }
    renderLegend(legendKindFor());
    // Hide the hover tooltip when switching to a layer that doesn't
    // expose per-pixel values (or back to base). The next mousemove
    // re-evaluates tooltipValueAt and re-shows when appropriate.
    if (activeLayer === 'base' || akind === 'raster-tile') {
      hideTooltip();
    }
  }

  // ------------------------------------------------------------------
  // Hover tooltip — zoom.earth-style floating card following the cursor
  // with the value at that pixel for the active field/wind/sun layer.
  //
  // We re-use the cheap bilinear sample (bilerpValue) rather than the
  // bicubic the raster uses — at one point per pointermove the visual
  // difference is invisible and bilinear is half the cost. The grid is
  // already at 10×7 with edge clamping so the interpolation reaches the
  // whole viewport.
  // ------------------------------------------------------------------
  const tooltipEl = opts.els.tooltip ?? null;
  // Avoid layout thrash by only writing to the tooltip when its content
  // changes (typing into the DOM with the same string would still
  // invalidate styles in some browsers).
  let lastTooltipText: string | null = null;

  function hideTooltip(): void {
    if (!tooltipEl) return;
    if (!tooltipEl.classList.contains('hidden')) {
      tooltipEl.classList.add('hidden');
    }
    lastTooltipText = null;
  }

  function setTooltip(text: string, x: number, y: number): void {
    if (!tooltipEl) return;
    if (text !== lastTooltipText) {
      tooltipEl.textContent = text;
      lastTooltipText = text;
    }
    // Offset so the cursor doesn't cover the card. The container is the
    // map root (position: relative), and e.point is canvas-relative —
    // which equals map-root-relative when the canvas fills the root, so
    // we can use e.point.x/y directly. The 14px offset clears the
    // pointer arrow and the GL cursor on mobile.
    tooltipEl.style.left = `${x + 14}px`;
    tooltipEl.style.top = `${y + 14}px`;
    if (tooltipEl.classList.contains('hidden')) {
      tooltipEl.classList.remove('hidden');
    }
  }

  /**
   * Multi-metric tooltip at the cursor. zoom.earth shows only the
   * active layer's value; we additionally surface any other previously-
   * loaded metric (temp, humidity, pressure) so the user sees the full
   * weather context with one hover. Returns null when no data is
   * available at this point.
   *
   * Format: "26°\n78%\n1014 hPa" — newline-separated; the floating
   * tooltip div whitespace-preserves them via CSS.
   */
  /** Story 19.3 — display units from the ⚙ settings, read per call so
   *  a change applies to the next tooltip / legend paint. */
  function currentUnits(): Units {
    return unitsOf(readSettings());
  }

  function tooltipValueAt(lng: number, lat: number): string | null {
    const def = getLayerDef(activeLayer);
    if (!def) return null;
    const U = currentUnits();
    if (def.kind === 'field' || def.kind === 'particles') {
      if (!fieldBounds || frameIndex < 0) return null;
      const bounds = fieldBounds;
      const lines: string[] = [];
      const sampleField = (g: FieldGrid | null): number | null =>
        g
          ? bilerpValue(
              g,
              FIELD_GRID_ROWS,
              FIELD_GRID_COLS,
              bounds,
              lat,
              lng,
              frameIndex
            )
          : null;

      // Precipitation (Story 15.5) — only while it is the active field;
      // shown first so the tooltip leads with the layer's own value.
      if (activeLayer === 'precipitation') {
        const pv = sampleField(fieldGrid);
        if (pv !== null) lines.push(`🌧 ${formatPrecip(pv)}`);
      }

      // Story 13.3 — model spread at the point, when the mode is on.
      if (confidenceMode && spreadGrid && def.kind === 'field') {
        const sv = sampleField(spreadGrid);
        if (sv !== null)
          lines.push(
            `± ${sv < 1 ? sv.toFixed(1) : Math.round(sv)} ${fieldUnitLabel()} ${t.confidence_between_models}`
          );
      }

      // Temperature
      const tGrid = activeLayer === 'temperature' ? fieldGrid : lastTempGrid;
      const tVal = sampleField(tGrid);
      if (tVal !== null) lines.push(`🌡 ${formatTemp(tVal, U.temp)}`);

      // Humidity
      const hGrid = activeLayer === 'humidity' ? fieldGrid : lastHumidityGrid;
      const hVal = sampleField(hGrid);
      if (hVal !== null) lines.push(`💧 ${Math.round(hVal)}%`);

      // Pressure
      const pGrid = activeLayer === 'pressure' ? fieldGrid : lastPressureGrid;
      const pVal = sampleField(pGrid);
      if (pVal !== null) lines.push(`🧭 ${formatPressure(pVal, U.pressure)}`);

      if (lines.length === 0 && def.kind !== 'particles') {
        // Fall through to legacy single-value behavior for field layers
        // when no cached grids exist yet (first paint).
        if (fieldGrid) {
          const v = bilerpValue(
            fieldGrid,
            FIELD_GRID_ROWS,
            FIELD_GRID_COLS,
            fieldBounds,
            lat,
            lng,
            frameIndex
          );
          if (v === null) return null;
          if (activeLayer === 'temperature') return formatTemp(v, U.temp);
          if (activeLayer === 'humidity') return `${Math.round(v)}%`;
          if (activeLayer === 'pressure') return formatPressure(v, U.pressure);
          if (activeLayer === 'precipitation') return formatPrecip(v);
          return `${Math.round(v)}`;
        }
        return null;
      }

      if (def.kind === 'field') {
        return lines.join('\n');
      }
      // particles continues below (wind) and appends to lines
    }
    if (def.kind === 'particles') {
      // Wind: lerp u/v at the cursor, then derive speed (km/h) +
      // cardinal heading. The wind grid is 8×6 covering the same
      // viewport bounds as the field grid (fieldBounds is the latest
      // viewportGrid bounds). When no wind grid is present we can't
      // sample — fall back to hiding the tooltip.
      if (!windGrid || !fieldBounds || frameIndex < 0) return null;
      const wg = windGrid;
      const fb = fieldBounds;
      const sampleUv = (h: number): { u: number; v: number } | null => {
        // Build a 1-hour pseudo-field of u and v and call bilerp on each
        // separately. We can't call bilerpValue on the WindGrid directly
        // because its shape differs (u/v vs values); inline the same
        // bilinear lerp here for the 8×6 wind grid.
        const cols = 8;
        const rows = 6;
        if (wg.points.length !== cols * rows) return null;
        const dLng = fb.east - fb.west;
        const dLat = fb.north - fb.south;
        if (dLng <= 0 || dLat <= 0) return null;
        let fx = ((lng - fb.west) / dLng) * (cols - 1);
        let fy = ((lat - fb.south) / dLat) * (rows - 1);
        if (fx < 0) fx = 0;
        if (fx > cols - 1) fx = cols - 1;
        if (fy < 0) fy = 0;
        if (fy > rows - 1) fy = rows - 1;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, cols - 1);
        const y1 = Math.min(y0 + 1, rows - 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const p00 = wg.points[y0 * cols + x0];
        const p10 = wg.points[y0 * cols + x1];
        const p01 = wg.points[y1 * cols + x0];
        const p11 = wg.points[y1 * cols + x1];
        const u00 = p00?.u[h];
        const u10 = p10?.u[h];
        const u01 = p01?.u[h];
        const u11 = p11?.u[h];
        const v00 = p00?.v[h];
        const v10 = p10?.v[h];
        const v01 = p01?.v[h];
        const v11 = p11?.v[h];
        if (
          u00 == null ||
          u10 == null ||
          u01 == null ||
          u11 == null ||
          v00 == null ||
          v10 == null ||
          v01 == null ||
          v11 == null
        )
          return null;
        const au = u00 * (1 - tx) + u10 * tx;
        const bu = u01 * (1 - tx) + u11 * tx;
        const av = v00 * (1 - tx) + v10 * tx;
        const bv = v01 * (1 - tx) + v11 * tx;
        return { u: au * (1 - ty) + bu * ty, v: av * (1 - ty) + bv * ty };
      };
      const uv = sampleUv(frameIndex);
      if (!uv) return null;
      const speedMps = Math.hypot(uv.u, uv.v);
      // Heading = direction wind is BLOWING TOWARD (math convention).
      // 0° = east (positive u), 90° = north (positive v). Convert to
      // compass bearing where 0° = north, 90° = east, then cardinal.
      const bearing = (Math.atan2(uv.u, uv.v) * 180) / Math.PI;
      const norm = ((bearing % 360) + 360) % 360;
      const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const idx = Math.round(norm / 45) % 8;
      // Story 13.1 — arrow glyph pointing where the wind blows toward
      // (bearingToArrow expects the meteorological FROM bearing).
      const windLine = `💨 ${formatSpeed(speedMps * 3.6, U.speed)} ${bearingToArrow((norm + 180) % 360)} ${cardinals[idx]}`;
      // Wind layer: combine with cached field grids (multi-metric).
      const fLines: string[] = [];
      const wb = fieldBounds;
      const sample = (g: FieldGrid | null): number | null =>
        g && wb
          ? bilerpValue(
              g,
              FIELD_GRID_ROWS,
              FIELD_GRID_COLS,
              wb,
              lat,
              lng,
              frameIndex
            )
          : null;
      const tV = sample(lastTempGrid);
      if (tV !== null) fLines.push(`🌡 ${formatTemp(tV, U.temp)}`);
      const hV = sample(lastHumidityGrid);
      if (hV !== null) fLines.push(`💧 ${Math.round(hV)}%`);
      const pV = sample(lastPressureGrid);
      if (pV !== null) fLines.push(`🧭 ${formatPressure(pV, U.pressure)}`);
      fLines.push(windLine);
      return fLines.join('\n');
    }
    if (def.kind === 'overlay' && activeLayer === 'sol') {
      // Day/Night = angular distance from subsolar point < or > 90°.
      // No polygon math needed; this is the same condition the
      // terminatorPolygon helper uses to draw the boundary.
      const sun = solarPosition(Date.now());
      const DEG = Math.PI / 180;
      const cosDist =
        Math.sin(sun.lat * DEG) * Math.sin(lat * DEG) +
        Math.cos(sun.lat * DEG) *
          Math.cos(lat * DEG) *
          Math.cos((lng - sun.lng) * DEG);
      return cosDist >= 0 ? 'Día' : 'Noche';
    }
    return null;
  }

  function handleHover(
    lng: number,
    lat: number,
    pointX: number,
    pointY: number
  ): void {
    if (!tooltipEl) return;
    const text = tooltipValueAt(lng, lat);
    if (text === null) {
      hideTooltip();
      return;
    }
    setTooltip(text, pointX, pointY);
  }

  if (tooltipEl) {
    map.on('mousemove', (e) => {
      handleHover(e.lngLat.lng, e.lngLat.lat, e.point.x, e.point.y);
    });
    map.on('mouseout', hideTooltip);
    // Map drags fire mousemove with stale lngLat under some browsers —
    // a fresh mouseleave on the canvas is the most reliable hide.
    map.getCanvas().addEventListener('mouseleave', hideTooltip);
    // Touch: hide on touchend, follow on touchmove. We need the same
    // canvas-relative coordinates Maplibre uses, so unproject the touch
    // x/y via the map's unproject helper.
    const canvas = map.getCanvas();
    const onTouchMove = (ev: TouchEvent): void => {
      if (!ev.touches || ev.touches.length === 0) return;
      const t0 = ev.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = t0.clientX - rect.left;
      const y = t0.clientY - rect.top;
      const ll = map.unproject([x, y]);
      handleHover(ll.lng, ll.lat, x, y);
    };
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchend', hideTooltip);
    canvas.addEventListener('touchcancel', hideTooltip);
  }

  /**
   * Layer first-use explainer (zoom.earth shows a modal the first time
   * the user opens each layer). We use a non-modal inline showMsg() so
   * the user can keep interacting with the map. Persisted per-layer in
   * localStorage so it only appears once.
   */
  // Story 19.2 — copy lives in ui.ts (es/en) so the English toggle
  // applies; one entry per weather layer.
  const LAYER_EXPLAINERS: Record<string, string> = {
    radar: t.layer_explainer_radar,
    satellite: t.layer_explainer_satellite,
    temperature: t.layer_explainer_temperature,
    humidity: t.layer_explainer_humidity,
    pressure: t.layer_explainer_pressure,
    precipitation: t.layer_explainer_precipitation,
    wind: t.layer_explainer_wind,
    sunlight: t.layer_explainer_sunlight,
  };
  function maybeShowLayerExplainer(id: string): void {
    const text = LAYER_EXPLAINERS[id];
    if (!text) return;
    let seen: Record<string, true>;
    try {
      seen = JSON.parse(
        window.localStorage.getItem('mw:seen-layer-explainer') ?? '{}'
      ) as Record<string, true>;
    } catch {
      seen = {};
    }
    if (seen[id]) return;
    seen[id] = true;
    try {
      window.localStorage.setItem(
        'mw:seen-layer-explainer',
        JSON.stringify(seen)
      );
    } catch {
      /* private mode — fall through */
    }
    showMsg(text);
    // Auto-dismiss after ~8 s so it doesn't linger forever.
    window.setTimeout(() => hideMsg(), 8000);
  }

  /** User-driven layer change: records the visitor's intent (the boot
   *  activation yields to it — Story 21.2) and applies the layer. */
  async function setActiveLayer(id: string): Promise<void> {
    if (!getLayerDef(id)) return;
    userPickedLayer = true;
    await applyLayer(id);
  }

  /** Activates `id` without touching `userPickedLayer`; the boot path
   *  calls this directly, everything else goes through setActiveLayer. */
  async function applyLayer(id: string): Promise<void> {
    const def = getLayerDef(id);
    if (!def) return;
    // Latest activation wins: field and wind layers await their grid,
    // and a newer activation (a visitor's click while a deep-link boot
    // is still fetching, or a quick second pick) must not be overwritten
    // when the older fetch lands (Story 21.2).
    const gen = ++layerActivationGen;
    maybeShowLayerExplainer(id);
    if (def.kind === 'particles') {
      rvOpacity = def.defaultOpacity;
      if (opacityEl) opacityEl.value = String(Math.round(rvOpacity * 100));
      tlStop();
      removeWeatherRaster();
      removeField();
      const b = map.getBounds();
      const grid = viewportGrid(
        {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        },
        8,
        6
      );
      fieldAbort?.abort();
      const ac = new AbortController();
      fieldAbort = ac;
      try {
        const speedVar =
          windSubOption === 'rachas' ? 'wind_gusts_10m' : 'wind_speed_10m';
        // Cold-load resilience: same retry pattern as loadFieldGrid (#164).
        // Wind layer activation from a fresh URL hash like ?layer=wind
        // sometimes hit TypeError: Failed to fetch on first try and fell
        // back to base. A single 500 ms retry resolves the transient.
        async function attempt(): Promise<unknown[]> {
          return await fetchWindChunks(grid, speedVar, deps.fetch, {
            signal: ac.signal,
            model: activeModel,
          });
        }
        let json: unknown[];
        try {
          json = await attempt();
        } catch {
          if (ac.signal.aborted) {
            removeWind();
            removeSun();
            activeLayer = 'base';
            refreshLayerButtons();
            syncHash();
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
          if (ac.signal.aborted) {
            removeWind();
            removeSun();
            activeLayer = 'base';
            refreshLayerButtons();
            syncHash();
            return;
          }
          json = await attempt();
        }
        if (ac.signal.aborted) {
          removeWind();
          removeSun();
          activeLayer = 'base';
          refreshLayerButtons();
          syncHash();
          return;
        }
        windGrid = parseWindResponse(json, grid, speedVar);
        windTexDirty = true;
      } catch {
        if (!ac.signal.aborted) windGrid = null;
      } finally {
        if (fieldAbort === ac) fieldAbort = null;
      }
      // A newer activation took over while the grid was in flight.
      if (gen !== layerActivationGen) return;
      if (!windGrid || windGrid.points.length === 0) {
        showMsg(t.map_layer_unavailable);
        activeLayer = 'base';
        removeWind();
        removeSun();
        tlFrames = [];
        frameIndex = -1;
        activeFrameIso = null;
        showTimeline(false);
        refreshLayerButtons();
        syncHash();
        return;
      }
      activeLayer = id;
      tlFrames = windGrid.times.map((iso) => ({
        time: Math.floor(
          Date.parse(/[Zz]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z') / 1000
        ),
        path: '',
      }));
      const idx = fieldFrameIndex(windGrid.times, pendingSeekIso, Date.now());
      const seekBeyond = seekBeyondGrid(windGrid.times, pendingSeekIso);
      pendingSeekIso = null;
      showTimeline(true);
      refreshLayerButtons();
      applyFrame(idx >= 0 ? idx : 0);
      if (seekBeyond) void extendTimeline(seekBeyond);
      return;
    }
    if (def.kind === 'overlay') {
      rvOpacity = def.defaultOpacity;
      if (opacityEl) opacityEl.value = String(Math.round(rvOpacity * 100));
      tlStop();
      removeWeatherRaster();
      removeField();
      removeWind();
      activeLayer = id;
      tlFrames = [];
      frameIndex = -1;
      activeFrameIso = null;
      showTimeline(false);
      refreshLayerButtons();
      refreshSun();
      sunLayer.startTicker(60_000);
      syncHash();
      return;
    }
    if (def.kind === 'field') {
      rvOpacity = def.defaultOpacity;
      if (opacityEl) opacityEl.value = String(Math.round(rvOpacity * 100));
      tlStop();
      removeWind();
      removeSun();
      removeWeatherRaster();
      const ok = await loadFieldGrid(id);
      // A newer activation took over while the grid was in flight: no
      // toast, no state change — that layer owns the map now.
      if (gen !== layerActivationGen) return;
      if (!ok || !fieldGrid) {
        showMsg(t.map_layer_unavailable);
        activeLayer = 'base';
        removeField();
        tlFrames = [];
        frameIndex = -1;
        activeFrameIso = null;
        showTimeline(false);
        refreshLayerButtons();
        syncHash();
        return;
      }
      activeLayer = id;
      tlFrames = fieldGrid.times.map((iso) => ({
        time: Math.floor(
          Date.parse(/[Zz]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z') / 1000
        ),
        path: '',
      }));
      const idx = fieldFrameIndex(fieldGrid.times, pendingSeekIso, Date.now());
      const seekBeyond = seekBeyondGrid(fieldGrid.times, pendingSeekIso);
      pendingSeekIso = null;
      showTimeline(true);
      refreshLayerButtons();
      applyFrame(idx >= 0 ? idx : 0);
      // A deep link past +48 h (e.g. a shared 9-day view) pulls the
      // extended window automatically, then lands on the asked frame.
      if (seekBeyond) void extendTimeline(seekBeyond);
      return;
    }
    if (def.kind === 'raster-tile') {
      rvOpacity = def.defaultOpacity;
      if (opacityEl) opacityEl.value = String(Math.round(rvOpacity * 100));
      // Story 16.1 — satellite frames are a synthetic GIBS TIME axis
      // (24 h of 10-min frames; daily for MODIS true colour), no longer
      // the RainViewer IR manifest that the raster never actually used.
      const frames =
        id === 'satellite' ? satelliteAxis(false) : framesForLayer(rvData, id);
      if ((id === 'radar' && !rvData) || frames.length === 0) {
        showMsg(t.map_layer_unavailable);
        activeLayer = 'base';
        tlStop();
        removeWeatherRaster();
        removeField();
        removeWind();
        removeSun();
        tlFrames = [];
        frameIndex = -1;
        activeFrameIso = null;
        showTimeline(false);
        refreshLayerButtons();
        syncHash();
        return;
      }
      activeLayer = id;
      tlFrames = frames;
      const now = Math.floor(Date.now() / 1000);
      const idx = seekIndexForIso(frames, pendingSeekIso, now);
      pendingSeekIso = null;
      showTimeline(true);
      refreshLayerButtons();
      removeField();
      removeWind();
      removeSun();
      applyFrame(idx >= 0 ? idx : defaultFrameIndex(frames, now));
      return;
    }
    tlStop();
    removeWeatherRaster();
    removeField();
    removeWind();
    removeSun();
    activeLayer = id;
    tlFrames = [];
    frameIndex = -1;
    activeFrameIso = null;
    showTimeline(false);
    refreshLayerButtons();
    syncHash();
  }

  // Story 22.2 — compact rail. Tiles: icon + short label (the full
  // name stays the accessible name and the tooltip, with the shortcut
  // letter until the `?` cheat-sheet of Story 22.5 takes it over). The
  // grid is 3 columns from `sm` and a single column of icons below it;
  // the active layer's block is re-inserted after the last tile of the
  // active tile's row (layer-rail.ts), so it opens right under the layer
  // the visitor picked.
  const railActiveEl =
    features.layerRail && opts.els.layerBtns && opts.els.railActive
      ? opts.els.railActive
      : null;
  const railDesktopMq =
    railActiveEl && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 640px)')
      : null;
  function placeActiveBlock(): void {
    const wrap = opts.els.layerBtns;
    if (!wrap || !railActiveEl) return;
    const tiles = Array.from(
      wrap.querySelectorAll<HTMLElement>(':scope > [id^="layerbtn-"]')
    );
    const anchor = activeBlockAnchor(
      tiles.length,
      tiles.findIndex((b) => b.id === `layerbtn-${activeLayer}`),
      railDesktopMq?.matches ? RAIL_COLUMNS_DESKTOP : 1
    );
    const after = anchor >= 0 ? tiles[anchor] : tiles[tiles.length - 1];
    if (after && after.nextElementSibling !== railActiveEl) {
      after.after(railActiveEl);
    }
  }
  const onRailMqChange = (): void => placeActiveBlock();
  railDesktopMq?.addEventListener('change', onRailMqChange);

  function buildLayerButtons(): void {
    const wrap = opts.els.layerBtns;
    if (!wrap || !features.layerRail) return;
    const allowed = features.railLayers ? new Set(features.railLayers) : null;
    for (const def of LAYERS) {
      if (allowed && !allowed.has(def.id)) continue;
      const fullLabel = t[def.labelKey as keyof typeof t] ?? def.id;
      const btn = document.createElement('button');
      btn.id = `layerbtn-${def.id}`;
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(def.id === activeLayer));
      btn.className =
        'flex min-w-0 items-center justify-center gap-1.5 rounded px-2 py-1 hover:bg-blue-500/10 aria-pressed:bg-blue-500/20 aria-pressed:font-semibold aria-pressed:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:flex-col sm:gap-0.5 sm:px-1 sm:py-1.5';
      // zoom.earth-style icon; falls back to text-only when LayerDef has
      // no icon glyph.
      if (def.icon) {
        // Sprite icon (IconSprite.astro symbol) — monochrome, follows
        // currentColor, identical on every OS unlike the emoji it replaced.
        btn.appendChild(spriteIcon(def.icon, 'h-4 w-4 shrink-0 sm:h-5 sm:w-5'));
      }
      // Short label under the icon from `sm` up; icons only on a phone
      // (the rail stays one narrow column there).
      const labelSpan = document.createElement('span');
      labelSpan.textContent =
        t[def.shortLabelKey as keyof typeof t] ?? fullLabel;
      labelSpan.className =
        'hidden max-w-full truncate text-[11px] leading-tight sm:block';
      btn.appendChild(labelSpan);
      btn.setAttribute('aria-label', fullLabel);
      // No shortcut chip any more (Story 22.2): the letter rides in the
      // tooltip until the `?` panel (Story 22.5) lists every shortcut.
      btn.title = def.shortcut ? `${fullLabel} (${def.shortcut})` : fullLabel;
      btn.addEventListener('click', () => void setActiveLayer(def.id));
      if (railActiveEl && railActiveEl.parentElement === wrap) {
        wrap.insertBefore(btn, railActiveEl);
      } else {
        wrap.appendChild(btn);
      }
    }
    placeActiveBlock();
  }
  buildLayerButtons();

  // ----------------------------------------------------------------
  // Settings panel wiring — pressed-state + click handlers for
  // the timezone (local/UTC) and hour format (12/24) toggle groups.
  // Pure DOM; settings persist via writeSettings(). On change the
  // timeline label re-renders so the user sees their preference take
  // effect immediately.
  // ----------------------------------------------------------------
  // One toggle group per setting: `[data-mw-<attr>] button[data-val]`.
  // Values are validated by normalizeSettings(), so an unknown data-val
  // in the markup falls back to the default instead of persisting junk.
  const SETTING_GROUPS: ReadonlyArray<{
    attr: string;
    key: keyof MapSettings;
  }> = [
    { attr: 'data-mw-tz', key: 'tz' },
    { attr: 'data-mw-hour', key: 'hourFormat' },
    // Story 16.4 — animation controls.
    { attr: 'data-mw-loop', key: 'loopHours' },
    { attr: 'data-mw-speed', key: 'playSpeed' },
    { attr: 'data-mw-style', key: 'playStyle' },
    { attr: 'data-mw-label', key: 'timeLabel' },
    // Story 19.3 — display units.
    { attr: 'data-mw-temp', key: 'tempUnit' },
    { attr: 'data-mw-speed-unit', key: 'speedUnit' },
    { attr: 'data-mw-pressure', key: 'pressureUnit' },
    { attr: 'data-mw-distance', key: 'distanceUnit' },
  ];
  function refreshSettingsButtons(): void {
    if (!features.settings) return;
    const cur = readSettings();
    for (const g of SETTING_GROUPS) {
      document
        .querySelectorAll<HTMLButtonElement>(`[${g.attr}] button`)
        .forEach((b) => {
          b.setAttribute(
            'aria-pressed',
            String(b.dataset.val === String(cur[g.key]))
          );
        });
    }
  }
  /** Re-render whatever reflects a setting live: the pressed states,
   *  the timeline label (tz / hour format / label mode) and the tile
   *  cross-fade (play style). Speed and loop window are read by the
   *  player on its next tick, so nothing to push there. */
  function afterSettingsChange(): void {
    refreshSettingsButtons();
    if (frameIndex >= 0 && tlFrames[frameIndex]) {
      const tt = opts.els.tlTime;
      if (tt) tt.textContent = frameLabel(tlFrames[frameIndex]);
      tlRange?.setAttribute(
        'aria-valuetext',
        frameValueText(tlFrames[frameIndex])
      );
    }
    // Story 23.1 — the bar's ticks follow the zone and hour format.
    tlBar?.update(true);
    weatherRaster.setFadeMs(RASTER_FADE_MS[readSettings().playStyle]);
    // Story 19.3 — units: legend scale + unit, city pills / tooltip
    // values, and the open place card re-render in place.
    renderLegend(legendKindFor());
    refreshCityValues();
    if (placeCardFc) paintPlaceCard();
    isobarsLayer.setUnit(currentUnits().pressure);
    crosshair.refresh();
  }
  function bindSettingsButtons(): void {
    if (!features.settings) return;
    for (const g of SETTING_GROUPS) {
      document
        .querySelectorAll<HTMLButtonElement>(`[${g.attr}] button`)
        .forEach((b) => {
          b.addEventListener('click', () => {
            writeSettings(
              normalizeSettings({ ...readSettings(), [g.key]: b.dataset.val })
            );
            afterSettingsChange();
          });
        });
    }
  }
  bindSettingsButtons();
  refreshSettingsButtons();
  // Story 16.4's label mode (both / clock / relative) used to cycle on a
  // tap on the timeline label; since Story 23.3 that tap opens the date
  // picker, and the mode lives in ⋯ → Ajustes (`data-mw-label`) only.

  // ----------------------------------------------------------------
  // Sub-options (zoom.earth's per-layer variants). Single generic
  // factory (createSubOptionsGroup) replaces five near-identical
  // copies — see src/lib/map/chrome/sub-options.ts.
  // Story 22.2 — they render in the active layer's block (subOptions
  // slot), not under the whole list; layerBtns is the fallback for a
  // caller without the compact rail markup.
  // ----------------------------------------------------------------
  const subOptionsWrap = opts.els.subOptions ?? opts.els.layerBtns ?? null;
  const tempSub = createSubOptionsGroup<TempSubOption>(subOptionsWrap, {
    containerId: 'temp-sub-options',
    getActive: () => tempSubOption,
    onSelect: (id) => {
      tempSubOption = id;
      void setActiveLayer('temperature');
    },
    isVisible: () => activeLayer === 'temperature',
    options: [
      { id: 'actual', label: 'Actual' },
      { id: 'aparente', label: 'Aparente' },
      { id: 'bulbo', label: 'Bulbo húmedo' },
    ],
  });
  const refreshTempSubOptions = (): void => tempSub.refresh();

  const humiditySub = createSubOptionsGroup<HumiditySubOption>(subOptionsWrap, {
    containerId: 'humidity-sub-options',
    getActive: () => humiditySubOption,
    onSelect: (id) => {
      humiditySubOption = id;
      void setActiveLayer('humidity');
    },
    isVisible: () => activeLayer === 'humidity',
    options: [
      { id: 'relativa', label: 'Relativa' },
      { id: 'rocio', label: 'Punto de rocío' },
    ],
  });
  const refreshHumiditySubOptions = (): void => humiditySub.refresh();

  const precipSub = createSubOptionsGroup<PrecipSubOption>(subOptionsWrap, {
    containerId: 'precipitation-sub-options',
    getActive: () => precipSubOption,
    onSelect: (id) => {
      precipSubOption = id;
      pendingSeekIso = activeFrameIso;
      void setActiveLayer('precipitation');
    },
    isVisible: () => activeLayer === 'precipitation',
    options: [
      { id: 'lluvia', label: 'Lluvia' },
      { id: 'nieve', label: 'Nieve' },
      { id: 'probabilidad', label: 'Probabilidad' },
    ],
  });
  const refreshPrecipSubOptions = (): void => precipSub.refresh();

  const pressureSub = createSubOptionsGroup<PressureSubOption>(subOptionsWrap, {
    containerId: 'pressure-sub-options',
    getActive: () => pressureSubOption,
    onSelect: (id) => {
      pressureSubOption = id;
      void setActiveLayer('pressure');
    },
    isVisible: () => activeLayer === 'pressure',
    options: [
      { id: 'msl', label: 'Nivel del mar' },
      { id: 'surface', label: 'Superficie' },
    ],
  });
  const refreshPressureSubOptions = (): void => pressureSub.refresh();

  const windSub = createSubOptionsGroup<WindSubOption>(subOptionsWrap, {
    containerId: 'wind-sub-options',
    getActive: () => windSubOption,
    onSelect: (id) => {
      windSubOption = id;
      void setActiveLayer('wind');
    },
    isVisible: () => activeLayer === 'wind',
    options: [
      { id: 'velocidad', label: 'Velocidad' },
      { id: 'rachas', label: 'Rachas' },
    ],
  });
  const refreshWindSubOptions = (): void => windSub.refresh();

  const satelliteSub = createSubOptionsGroup<SatelliteSubOption>(
    subOptionsWrap,
    {
      containerId: 'satellite-sub-options',
      getActive: () => satelliteSubOption,
      onSelect: (id) => {
        satelliteSubOption = id;
        // Re-activation rebuilds the frame axis (daily vs 10-min);
        // keep the user's scrub position across the switch.
        pendingSeekIso = activeFrameIso;
        void setActiveLayer('satellite');
      },
      isVisible: () => activeLayer === 'satellite',
      options: [
        { id: 'geocolor', label: 'GeoColor' },
        { id: 'ir', label: 'Infrarrojo' },
        { id: 'truecolor', label: 'Color real' },
      ],
    }
  );
  const refreshSatelliteSubOptions = (): void => satelliteSub.refresh();

  // ----------------------------------------------------------------
  // Overlays menu — zoom.earth's "Superposiciones" panel. Each entry
  // declares its label + keyboard shortcut + toggle function so the
  // UI checkboxes and the global keydown handler stay in sync via
  // refreshOverlayCheckboxes().
  // ----------------------------------------------------------------
  interface OverlayDef {
    id:
      | 'graticule'
      | 'tropical'
      | 'nightLights'
      | 'nightLine'
      | 'borders'
      | 'fires'
      | 'radarCoverage'
      | 'clouds'
      | 'quakes'
      | 'volcanoes'
      | 'colorBlind'
      | 'cityValues'
      | 'windOverlay'
      | 'aqi'
      | 'marine'
      | 'webcams'
      | 'lakes'
      | 'histStorms'
      | 'smnStateTint'
      | 'outlook'
      | 'precipMode'
      | 'confidence';
    label: string;
    shortcut: string;
    isEnabled: () => boolean;
    setEnabled: (on: boolean) => void;
  }
  let tropicalEnabled = true;
  const overlayDefs: OverlayDef[] = [
    {
      id: 'tropical',
      label: t.map_overlay_tropical,
      shortcut: 'T',
      isEnabled: () => tropicalEnabled,
      setEnabled: (on) => {
        tropicalEnabled = on;
        tropicalStormsOverlay.setEnabled(on);
      },
    },
    {
      id: 'outlook',
      label: t.map_overlay_outlook,
      shortcut: '',
      isEnabled: () => tropicalOutlookOverlay.isEnabled(),
      setEnabled: (on) => tropicalOutlookOverlay.setEnabled(on),
    },
    {
      id: 'graticule',
      label: t.map_overlay_graticule,
      shortcut: 'X',
      isEnabled: () => graticuleOverlay.isEnabled(),
      setEnabled: (on) => graticuleOverlay.setEnabled(on),
    },
    {
      id: 'nightLights',
      label: t.map_overlay_nightLights,
      shortcut: 'N',
      isEnabled: () => nightLightsOverlay.isEnabled(),
      setEnabled: (on) => nightLightsOverlay.setEnabled(on),
    },
    {
      id: 'nightLine',
      label: t.map_overlay_nightLine,
      shortcut: 'O',
      isEnabled: () => nightLineOverlay.isEnabled(),
      setEnabled: (on) => nightLineOverlay.setEnabled(on),
    },
    {
      id: 'borders',
      label: t.map_overlay_borders,
      shortcut: 'F',
      isEnabled: () => bordersOverlay.isEnabled(),
      setEnabled: (on) => {
        void bordersOverlay.setEnabled(on);
      },
    },
    {
      id: 'fires',
      label: t.map_overlay_fires,
      shortcut: 'I',
      isEnabled: () => firesOverlay.isEnabled(),
      setEnabled: (on) => {
        void firesOverlay.setEnabled(on);
      },
    },
    {
      id: 'radarCoverage',
      label: t.map_overlay_radarCoverage,
      shortcut: 'Q',
      isEnabled: () => radarCoverageOverlay.isEnabled(),
      setEnabled: (on) => radarCoverageOverlay.setEnabled(on),
    },
    {
      id: 'precipMode',
      label: t.map_overlay_precipMode,
      shortcut: '',
      isEnabled: () => precipMode,
      setEnabled: (on) => setPrecipMode(on),
    },
    {
      id: 'confidence',
      label: t.map_overlay_confidence,
      shortcut: '',
      isEnabled: () => confidenceMode,
      setEnabled: (on) => setConfidenceMode(on),
    },
    {
      id: 'clouds',
      label: t.map_overlay_clouds,
      shortcut: 'U',
      isEnabled: () => cloudsOverlay.isEnabled(),
      setEnabled: (on) => {
        void cloudsOverlay.setEnabled(on);
      },
    },
    {
      id: 'quakes',
      label: t.map_overlay_quakes,
      shortcut: 'K',
      isEnabled: () => quakesOverlay.isEnabled(),
      setEnabled: (on) => {
        void quakesOverlay.setEnabled(on);
      },
    },
    {
      id: 'volcanoes',
      label: t.map_overlay_volcanoes,
      shortcut: 'J',
      isEnabled: () => volcanoesOverlay.isEnabled(),
      setEnabled: (on) => volcanoesOverlay.setEnabled(on),
    },
    {
      id: 'cityValues',
      label: t.map_overlay_cityValues,
      shortcut: 'E',
      isEnabled: () => cityValues.isEnabled(),
      setEnabled: (on) => {
        cityValuesEnabled = on;
        cityValues.setEnabled(on);
      },
    },
    {
      id: 'windOverlay',
      label: t.map_overlay_windOverlay,
      shortcut: 'C',
      isEnabled: () => windOverlayEnabled || activeLayer === 'wind',
      setEnabled: (on) => {
        windOverlayEnabled = on;
        if (on) {
          void addWindOverlay();
        } else {
          removeWindOverlay();
        }
      },
    },
    {
      id: 'aqi',
      label: t.map_overlay_aqi,
      shortcut: 'Y',
      isEnabled: () => aqiOverlay.isEnabled(),
      setEnabled: (on) => {
        void aqiOverlay.setEnabled(on);
      },
    },
    {
      id: 'smnStateTint',
      label: t.map_overlay_smnStateTint,
      shortcut: 'A',
      isEnabled: () => smnStateTintOverlay.isEnabled(),
      setEnabled: (on) => {
        void smnStateTintOverlay.setEnabled(on);
      },
    },
    {
      id: 'marine',
      label: t.map_overlay_marine,
      shortcut: 'Z',
      isEnabled: () => marineOverlay.isEnabled(),
      setEnabled: (on) => {
        void marineOverlay.setEnabled(on);
      },
    },
    {
      id: 'webcams',
      label: t.map_overlay_webcams,
      shortcut: 'W',
      isEnabled: () => webcamsOverlay.isEnabled(),
      setEnabled: (on) => webcamsOverlay.setEnabled(on),
    },
    {
      id: 'lakes',
      label: t.map_overlay_lakes,
      shortcut: 'G',
      isEnabled: () => lakesOverlay.isEnabled(),
      setEnabled: (on) => lakesOverlay.setEnabled(on),
    },
    {
      id: 'histStorms',
      label: t.map_overlay_histStorms,
      shortcut: 'D',
      isEnabled: () => histStormsOverlay.isEnabled(),
      setEnabled: (on) => histStormsOverlay.setEnabled(on),
    },
    {
      id: 'colorBlind',
      label: t.map_overlay_colorBlind,
      shortcut: 'B',
      isEnabled: () => getColorBlindMode(),
      setEnabled: (on) => {
        setColorBlindMode(on);
        // Re-render temperature: legend swap + raster recolour.
        if (activeLayer === 'temperature') {
          void setActiveLayer('temperature');
        }
      },
    },
  ];

  // Overlay registry — extracted to chrome/overlay-registry.ts. Owns
  // the Superposiciones panel build + the global keyboard shortcuts.
  const overlayRegistry = createOverlayRegistry(
    {
      wrap: features.layerRail ? (opts.els.overlayBtns ?? null) : null,
      // Story 22.2 — the overlays tab: filter + "n on" badge.
      filter: features.layerRail ? (opts.els.overlayFilter ?? null) : null,
      count: features.layerRail ? (opts.els.overlayCount ?? null) : null,
    },
    overlayDefs,
    {
      pinned: PINNED_OVERLAYS,
      strings: {
        pinned: t.map_overlays_pinned,
        all: t.map_overlays_all,
        empty: t.map_overlays_empty,
      },
      layers: LAYERS.filter(
        (l): l is typeof l & { shortcut: string } => !!l.shortcut
      ).map((l) => ({ shortcut: l.shortcut, id: l.id })),
      onLayerShortcut: (id) => void setActiveLayer(id),
    }
  );
  overlayRegistry.build();
  const refreshOverlayCheckboxes = (): void => overlayRegistry.refresh();

  // Story 22.5 — the `?` keyboard cheat-sheet, generated from the same
  // two lists the shortcut handler reads (LAYERS + overlayDefs), in the
  // document's language (the page may be Spanish markup shown in English).
  const shortcutsDialogEl = features.layerRail
    ? document.getElementById('mw-shortcuts')
    : null;
  const shortcutsDialog = shortcutsDialogEl
    ? (() => {
        const docLangNow =
          document.documentElement.getAttribute('data-lang') === 'en'
            ? 'en'
            : lang;
        const tt = ui[docLangNow];
        const sections = buildShortcutSections(
          LAYERS.map((l) => ({
            id: l.id,
            shortcut: l.shortcut,
            label: String(tt[l.labelKey as keyof typeof tt] ?? l.id),
          })),
          overlayDefs.map((o) => ({
            id: o.id,
            shortcut: o.shortcut,
            label: overlayShortcutLabel(tt, o.id, o.label),
          })),
          {
            general: tt.map_shortcuts_general,
            layers: tt.map_layers,
            overlays: tt.map_overlays,
            help: tt.map_shortcuts_help,
            escape: tt.map_shortcuts_escape,
            zoom: tt.map_shortcuts_zoom,
            pan: tt.map_shortcuts_pan,
            ...(features.timeline
              ? {
                  jumpDate: {
                    key: tt.map_shortcuts_enter,
                    label: tt.map_shortcuts_jump_date,
                  },
                }
              : {}),
          },
          { withKeysOnly: true }
        );
        return wireShortcutsDialog(
          {
            dialog: shortcutsDialogEl,
            fallbackFocus: document.getElementById('mw-tools-btn'),
          },
          sections
        );
      })()
    : null;
  if (features.layerRail) {
    (
      overlayRegistry as ReturnType<typeof createOverlayRegistry> & {
        installShortcuts: () => void;
      }
    ).installShortcuts();
  }

  const opacityEl = features.layerRail ? (opts.els.opacity ?? null) : null;
  if (opacityEl) {
    opacityEl.value = String(Math.round(rvOpacity * 100));
    opacityEl.addEventListener('input', () => {
      rvOpacity = Number(opacityEl.value) / 100;
      // Story 21.3 — the factory knows which A/B slot is on screen.
      weatherRaster.setOpacity(rvOpacity);
      if (map.getLayer(FIELD_LAYER))
        map.setPaintProperty(FIELD_LAYER, 'raster-opacity', rvOpacity);
      if (map.getLayer(WIND_CIRCLE_LAYER))
        map.setPaintProperty(WIND_CIRCLE_LAYER, 'circle-opacity', rvOpacity);
      // Sun layer reads rvOpacity via its opacityScaleFn closure on
      // each refresh — calling refresh() re-applies the expression to
      // both tiers without duplicating the constants here.
      sunLayer.refresh();
    });
  }

  // ------------------------------------------------------------------
  // Timeline play/pause loop — extracted to chrome/timeline-player.ts.
  // ------------------------------------------------------------------
  const tlPlayBtn = features.timeline ? (opts.els.tlPlay ?? null) : null;
  const tlPlayer = createTimelinePlayer(
    { playBtn: tlPlayBtn },
    { play: t.timeline_play, pause: t.timeline_pause },
    () => tlFrames.length,
    () => frameIndex,
    (i) => applyFrame(i),
    {
      // Story 16.4 — speed and loop window come from settings and are
      // read on every tick, so the ⚙ panel applies live.
      getIntervalMs: () => PLAY_INTERVAL_MS[readSettings().playSpeed],
      getLoopRange: currentLoopRange,
      // Story 21.3 — never step onto a frame whose tiles are not in yet
      // (the button shows the buffering state meanwhile). Only where the
      // prefetcher exists: embeds and data saver keep the plain cadence.
      canAdvance: framePrefetcher ? nextFrameReady : undefined,
    }
  );
  tlIsPlaying = (): boolean => tlPlayer.isPlaying();
  const tlStop = (): void => {
    // Story 21.2 — any pause (prev/next/range, layer change, tools) ends
    // the one-shot boot loop and its 3 h window for good.
    bootAutoplayCancelled = true;
    bootLoopActive = false;
    tlPlayer.stop();
  };
  const tlStart = (): void => tlPlayer.start();
  const tlReducedMotion = tlPlayer.reducedMotion();
  tlPlayBtn?.addEventListener('click', () => {
    bootAutoplayCancelled = true;
    bootLoopActive = false;
    tlPlayer.toggle();
    // Story 21.3 — start warming the next frames with the first ▶, not
    // one cadence later.
    if (tlPlayer.isPlaying()) schedulePrefetch();
  });

  // ------------------------------------------------------------------
  // Story 21.2 — one-shot autoplay after the boot activation. /mapa
  // opens on GeoColor and, like zoom.earth, the clouds should already be
  // moving: once the satellite layer is verifiably on the map and its
  // first frame has tiles (capped), the loop starts over the last 3 h.
  // Not under reduced motion or data saver, not for a shared `t=`, not
  // for the radar/base fallback, and never once the visitor touched the
  // timeline. The setting itself is untouched: the window override lives
  // in `bootLoopActive` and dies with the first pause.
  // ------------------------------------------------------------------
  let bootLoopActive = false;
  let bootAutoplayCancelled = false;
  function readRawSettings(): string | null {
    try {
      return window.localStorage.getItem(SETTINGS_KEY);
    } catch {
      return null;
    }
  }
  function armBootAutoplay(): void {
    if (!opts.bootAutoplay || bootAutoplayCancelled) return;
    // A layer the visitor picked before the boot landed is theirs: no
    // loop starts on its own (Story 21.2).
    if (userPickedLayer) return;
    if (
      !shouldBootAutoplay({
        layerId: activeLayer,
        frameCount: tlFrames.length,
        seekIso: hashed?.t ?? null,
        reducedMotion: tlReducedMotion,
        saveData: readSaveData(navigator),
      })
    ) {
      return;
    }
    void whenSourceLoaded(map, RV_SOURCE).then(() => {
      if (bootAutoplayCancelled || userPickedLayer) return;
      if (activeLayer !== 'satellite') return;
      if (tlPlayer.isPlaying()) return;
      bootLoopActive = true;
      tlPlayer.start();
      schedulePrefetch();
    });
  }

  // ----------------------------------------------------------------
  // Story 15.1 — "Ver 10 días". Field and wind layers boot on the 2-day
  // hourly window (pre-baked snapshots, cheap). The 10-day window is
  // fetched on demand at 3-hourly steps (EXTENDED_FIELD_RANGE) and
  // merged under the hourly frames, so every index-aligned consumer
  // (raster, tooltip, isobars, city pills, wind texture) keeps working
  // unchanged — the frame axis simply gets longer. Quota: no extra
  // calls until the user asks; cachedFetch dedupes for 10 min.
  // ----------------------------------------------------------------
  function framesFromTimes(times: string[]): RadarFrame[] {
    return times.map((iso) => ({
      time: Math.floor(parseUtcMs(iso) / 1000),
      path: '',
    }));
  }

  /** ISO the user asked for (hash `t=`) when it lies past the grid's
   *  last frame — the cue to extend automatically. */
  function seekBeyondGrid(times: string[], iso: string | null): string | null {
    if (!iso || times.length === 0) return null;
    const ms = parseUtcMs(iso);
    if (!Number.isFinite(ms)) return null;
    return ms > parseUtcMs(times[times.length - 1]) ? iso : null;
  }

  /** Satellite timeline axis (Story 16.1). Daily products get one frame
   *  per day; GOES gets 10-minute frames for 24 h, or the 10-day
   *  hourly+tail axis when extended. */
  function satelliteAxis(extended: boolean): RadarFrame[] {
    const now = Math.floor(Date.now() / 1000);
    if (satelliteSubOption === 'truecolor') return satelliteDailyFrames(now);
    return extended ? satelliteFramesExtended(now) : satelliteFrames(now);
  }

  function canExtendTimeline(): boolean {
    const kind = getLayerDef(activeLayer)?.kind;
    if (kind === 'field') return !!fieldGrid && !isExtendedGrid(fieldGrid);
    if (kind === 'particles') return !!windGrid && !isExtendedGrid(windGrid);
    if (activeLayer === 'satellite') {
      if (satelliteSubOption === 'truecolor' || tlFrames.length < 2)
        return false;
      const span = tlFrames[tlFrames.length - 1].time - tlFrames[0].time;
      return span <= 2 * 86400;
    }
    return false;
  }

  /** Story 23.3 — the axis "Ver 10 días" would load (satellite: 10 days
   *  back; fields and wind: up to +10 d), or null when the loaded axis is
   *  all there is (radar, daily true colour, already extended). */
  function jumpPotential(): JumpRange | null {
    if (!tlFrames.length || !canExtendTimeline()) return null;
    if (activeLayer === 'satellite') {
      const ext = satelliteAxis(true);
      return ext.length
        ? { min: ext[0].time, max: ext[ext.length - 1].time }
        : null;
    }
    const kind = getLayerDef(activeLayer)?.kind;
    if (kind === 'field' || kind === 'particles') {
      const res = EXTENDED_FIELD_RANGE.temporalResolution;
      const stepSec =
        res === 'hourly_6' ? 6 * 3600 : res === 'hourly_3' ? 3 * 3600 : 3600;
      return {
        min: tlFrames[0].time,
        max: extendedFieldEnd(
          Date.now() / 1000,
          EXTENDED_FIELD_RANGE.forecastDays,
          stepSec
        ),
      };
    }
    return null;
  }

  function syncExtendButton(): void {
    const btn = document.getElementById(
      'tl-extend'
    ) as HTMLButtonElement | null;
    if (!btn) return;
    const busy = extendInFlight !== null;
    btn.hidden = !busy && !canExtendTimeline();
    btn.disabled = busy;
    btn.textContent = busy ? t.timeline_extending : t.timeline_extend;
  }

  async function extendTimeline(
    seekIso: string | null = null
  ): Promise<boolean> {
    if (extendInFlight) return extendInFlight;
    const kind = getLayerDef(activeLayer)?.kind;
    if (!canExtendTimeline()) return false;
    const layerAtStart = activeLayer;
    const keepIso = seekIso ?? activeFrameIso;
    if (activeLayer === 'satellite') {
      // No fetch needed: GIBS serves any instant in its window, so the
      // axis just gets longer (10 days) and we re-seek to the same time.
      tlFrames = satelliteAxis(true);
      const now = Math.floor(Date.now() / 1000);
      const idx = seekIndexForIso(tlFrames, keepIso, now);
      applyFrame(idx >= 0 ? idx : tlFrames.length - 1);
      syncExtendButton();
      return true;
    }
    const run = (async (): Promise<boolean> => {
      try {
        let times: string[] | null = null;
        if (kind === 'field') {
          const cfg = FIELD_CONFIGS[activeLayer];
          if (!fieldGrid || !cfg) return false;
          const pts = fieldGrid.points.map((p) => ({ lat: p.lat, lng: p.lng }));
          const json = await fetchFieldChunks(pts, cfg.hourlyVar, deps.fetch, {
            model: activeModel,
            range: EXTENDED_FIELD_RANGE,
          });
          const ext = parseFieldResponse(json, pts, cfg.hourlyVar);
          if (!ext || activeLayer !== layerAtStart || !fieldGrid) return false;
          const merged = mergeFieldGrids(fieldGrid, ext);
          if (!merged) return false;
          fieldGrid = merged;
          if (activeLayer === 'temperature') lastTempGrid = merged;
          else if (activeLayer === 'humidity') lastHumidityGrid = merged;
          else if (activeLayer === 'pressure') lastPressureGrid = merged;
          times = merged.times;
        } else {
          if (!windGrid) return false;
          const pts = windGrid.points.map((p) => ({ lat: p.lat, lng: p.lng }));
          const speedVar =
            windSubOption === 'rachas' ? 'wind_gusts_10m' : 'wind_speed_10m';
          const json = await fetchWindChunks(pts, speedVar, deps.fetch, {
            model: activeModel,
            range: EXTENDED_FIELD_RANGE,
          });
          const ext = parseWindResponse(json, pts, speedVar);
          if (!ext || activeLayer !== layerAtStart || !windGrid) return false;
          const merged = mergeWindGrids(windGrid, ext);
          if (!merged) return false;
          windGrid = merged;
          windTexDirty = true;
          times = merged.times;
        }
        tlFrames = framesFromTimes(times);
        const idx = fieldFrameIndex(times, keepIso, Date.now());
        applyFrame(idx >= 0 ? idx : 0);
        return true;
      } catch {
        showMsg(t.timeline_extend_failed);
        return false;
      } finally {
        extendInFlight = null;
        syncExtendButton();
      }
    })();
    extendInFlight = run;
    syncExtendButton();
    return run;
  }

  const placeCardEscHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && placeCardEl && !placeCardEl.hidden)
      closePlaceCard();
  };
  document.addEventListener('keydown', placeCardEscHandler);

  // Wide-control surfacing timers (set inside the timeline block below),
  // hoisted so destroy() can clear them before they self-clear.
  let surfaceInterval = 0;
  let surfaceTimeout = 0;
  if (features.timeline) {
    opts.els.tlPrev?.addEventListener('click', () => {
      if (tlFrames.length) {
        tlStop();
        applyFrame(frameIndex - 1);
      }
    });
    opts.els.tlNext?.addEventListener('click', () => {
      if (tlFrames.length) {
        tlStop();
        if (frameIndex >= tlFrames.length - 1 && canExtendTimeline()) {
          // Nudging past the last 2-day frame is the natural "more"
          // gesture: pull the 10-day window, then step onto it.
          void extendTimeline().then((ok) => {
            if (ok) applyFrame(frameIndex + 1);
          });
          return;
        }
        applyFrame(frameIndex + 1);
      }
    });
    tlRange?.addEventListener('input', () => {
      if (tlFrames.length) {
        tlStop();
        applyFrame(Number(tlRange.value));
      }
    });
    // Day-skip + 'Ahora' (plan P0.3 — zoom.earth has these as separate
    // ↑↓ keys for hour and day). We compute the day-stride dynamically
    // from the frame timestamps because raster-tile frames are usually
    // ~10 min apart (RainViewer) while field/wind frames are 1 h apart.
    // Time-based rather than "24 frames": once the 10-day window is
    // merged in, the frame stride changes from 1 h to 3 h past +48 h
    // (Story 15.1), so a fixed frame count would skip 3 days.
    const frameIndexShifted = (bySec: number): number => {
      const cur = tlFrames[frameIndex]?.time;
      if (typeof cur !== 'number') return frameIndex;
      const target = cur + bySec;
      let best = frameIndex;
      let bestDelta = Infinity;
      for (let i = 0; i < tlFrames.length; i++) {
        const tt = tlFrames[i]?.time;
        if (typeof tt !== 'number') continue;
        const d = Math.abs(tt - target);
        if (d < bestDelta) {
          best = i;
          bestDelta = d;
        }
      }
      return best;
    };
    const spansDays = (): boolean => {
      if (tlFrames.length < 2) return false;
      const a = tlFrames[0]?.time;
      const b = tlFrames[tlFrames.length - 1]?.time;
      return typeof a === 'number' && typeof b === 'number' && b - a >= 86400;
    };
    document.getElementById('tl-day-prev')?.addEventListener('click', () => {
      if (tlFrames.length) {
        tlStop();
        applyFrame(frameIndexShifted(-86400));
      }
    });
    document.getElementById('tl-day-next')?.addEventListener('click', () => {
      if (tlFrames.length) {
        tlStop();
        const next = frameIndexShifted(86400);
        if (next === frameIndex && canExtendTimeline()) {
          void extendTimeline().then((ok) => {
            if (ok) applyFrame(frameIndexShifted(86400));
          });
          return;
        }
        applyFrame(next);
      }
    });
    document.getElementById('tl-extend')?.addEventListener('click', () => {
      tlStop();
      void extendTimeline();
    });
    // Story 23.1 — the date-scale bar. Every seek goes through the same
    // path as the range (pause, applyFrame → range value, label, hash,
    // bar redraw), so the two stay in sync both ways.
    let barTimesSrc: RadarFrame[] | null = null;
    let barTimes: number[] = [];
    const frameTimes = (): number[] => {
      if (barTimesSrc !== tlFrames) {
        barTimesSrc = tlFrames;
        barTimes = tlFrames.map((f) => f.time);
      }
      return barTimes;
    };
    tlBar = createTimelineBar(
      { bar: opts.els.tlBar ?? null, range: tlRange },
      {
        getTimes: frameTimes,
        getIndex: () => (tlFrames.length ? frameIndex : -1),
        seek: (i) => {
          tlStop();
          applyFrame(i);
        },
        canExtend: canExtendTimeline,
        extend: () => {
          tlStop();
          return extendTimeline();
        },
        format: tickFormat,
      }
    );
    // Story 23.3 — "Saltar a fecha". The picker spans what the layer can
    // show, not only what is loaded: the satellite's 10 days and the
    // fields' +10 d come from "Ver 10 días", which a pick past the loaded
    // axis triggers before seeking (extendTimeline re-seeks the instant).
    tlJump = createTimelineJump(
      { label: tlTime, host: tlEl, range: tlRange },
      {
        getTimes: frameTimes,
        getIndex: () => (tlFrames.length ? frameIndex : -1),
        getPotential: jumpPotential,
        canExtend: canExtendTimeline,
        pause: tlStop,
        seek: (i) => {
          tlStop();
          applyFrame(i);
        },
        extendTo: (sec) => {
          tlStop();
          return extendTimeline(new Date(sec * 1000).toISOString());
        },
        format: tickFormat,
        strings: () => {
          const tt =
            ui[
              document.documentElement.getAttribute('data-lang') === 'en'
                ? 'en'
                : lang
            ];
          return { title: tt.timeline_jump };
        },
      }
    );
    document.getElementById('tl-now')?.addEventListener('click', () => {
      if (tlFrames.length) {
        tlStop();
        // Pick the frame whose timestamp is closest to "now" (Date.now()/1000).
        const now = Date.now() / 1000;
        let best = 0;
        let bestDelta = Infinity;
        for (let i = 0; i < tlFrames.length; i++) {
          const t = tlFrames[i]?.time;
          if (typeof t !== 'number') continue;
          const d = Math.abs(t - now);
          if (d < bestDelta) {
            best = i;
            bestDelta = d;
          }
        }
        applyFrame(best);
      }
    });
    // Surface the day-skip + 'Ahora' buttons once frames are available.
    const surfaceWideControls = (): void => {
      if (!tlFrames.length) return;
      const dayPrev = document.getElementById('tl-day-prev');
      const dayNext = document.getElementById('tl-day-next');
      // Day-stride buttons only when the frames span at least a day.
      const hasDays = spansDays();
      dayPrev?.classList.toggle('hidden', !hasDays);
      dayNext?.classList.toggle('hidden', !hasDays);
      // 'Ahora' is `hidden … sm:inline-flex` until frames exist; then it
      // shows on every map and viewport. Story 23.4 — on the compact
      // /mapa phone dock it is a `.tl-secondary` like ‹ ›: global.css
      // keeps it off until the Controles panel opens (chrome budget ≤ 5)
      // and shows it with the panel, where it used to stay `hidden`.
      document.getElementById('tl-now')?.classList.remove('hidden');
    };
    // The frame array is rebuilt every time activeLayer changes; we re-
    // evaluate on each tick of the visibility refresh (frame change).
    surfaceInterval = window.setInterval(surfaceWideControls, 1500);
    surfaceTimeout = window.setTimeout(
      () => window.clearInterval(surfaceInterval),
      30000
    );
  }

  // Autocomplete outside-click handler (set inside the search block
  // below), hoisted so destroy() can remove the document listener.
  let acOutsideClickHandler: ((e: MouseEvent) => void) | null = null;
  if (features.search && q) {
    // Search collapse (plan P1.7). Icon-only by default; click reveals
    // the input; ESC or blur (when empty) collapses back to icon.
    const searchToggle = document.getElementById('mw-search-toggle');
    function expandSearch(): void {
      q?.classList.remove('hidden');
      searchToggle?.setAttribute('aria-expanded', 'true');
      try {
        q?.focus();
      } catch {
        /* ignore */
      }
    }
    function collapseSearch(): void {
      if (!q || q.value.trim().length > 0) return;
      q.classList.add('hidden');
      searchToggle?.setAttribute('aria-expanded', 'false');
    }
    searchToggle?.addEventListener('click', () => {
      const isHidden = q?.classList.contains('hidden');
      if (isHidden) expandSearch();
      else collapseSearch();
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        q.value = '';
        collapseSearch();
      }
    });
    q.addEventListener('input', () => {
      window.clearTimeout(qTimer);
      const query = q.value.trim();
      if (query.length < 2) {
        hideMsg();
        closeAcList();
        return;
      }
      qTimer = window.setTimeout(async () => {
        const gen = ++searchGen;
        try {
          const results = await geocode(query, deps, 'es', undefined, base);
          if (gen !== searchGen) return;
          if (!results.length) {
            closeAcList();
            showMsg(`${t.no_results} «${query}»`);
            return;
          }
          hideMsg();
          ac?.setResults(results);
        } catch {
          if (gen !== searchGen) return;
          closeAcList();
          showMsg(t.load_error);
        }
      }, 350);
    });

    q.addEventListener('keydown', (e: KeyboardEvent) => {
      const results = ac?.getResults() ?? [];
      if (results.length === 0) {
        if (e.key === 'Escape') closeAcList();
        return;
      }
      const active = ac?.getActiveIndex() ?? -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        ac?.setActiveIndex((active + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        ac?.setActiveIndex(active <= 0 ? results.length - 1 : active - 1);
      } else if (e.key === 'Enter') {
        if (active >= 0 && active < results.length) {
          e.preventDefault();
          // Re-uses the select callback the controller was wired with
          // via setResults's click handlers — but a keyboard Enter has
          // to dispatch manually. Simulate a click on the active option.
          const li = (acList?.children[active] ?? null) as HTMLElement | null;
          li?.click();
        }
      } else if (e.key === 'Escape') {
        closeAcList();
      }
    });

    acOutsideClickHandler = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (q && acList && !q.contains(target) && !acList.contains(target)) {
        closeAcList();
      }
    };
    document.addEventListener('click', acOutsideClickHandler);
  }

  if (features.locateButton && opts.els.locate) {
    // Shared flow with the home CTA (src/lib/locate-flow.ts). Here the
    // final action is a PIN — the map never navigates away.
    opts.els.locate.addEventListener('click', () => {
      void runLocateFlow({
        onResolved: (lat, lng) => setUserPin(t.map_locate, lat, lng, 'geo'),
        onError: (reason) => showMsg(t[failureMessageKey(reason)]),
      });
    });
  }

  // ----------------------------------------------------------------
  // Story 19.2 — first-visit welcome card. Non-modal (the map stays
  // usable underneath), shown once per browser (localStorage), never on
  // embeds (features.welcome is only set by the full-page maps).
  // ----------------------------------------------------------------
  const WELCOME_KEY = 'mw:welcomed';
  const welcomeEl = features.welcome
    ? document.getElementById('mw-welcome')
    : null;
  if (welcomeEl) {
    const welcomed = ((): boolean => {
      try {
        return window.localStorage.getItem(WELCOME_KEY) === '1';
      } catch {
        return false;
      }
    })();
    const dismissWelcome = (): void => {
      welcomeEl.hidden = true;
      try {
        window.localStorage.setItem(WELCOME_KEY, '1');
      } catch {
        /* private mode — the card simply returns next time */
      }
      document.removeEventListener('keydown', welcomeEsc);
    };
    const welcomeEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !welcomeEl.hidden) dismissWelcome();
    };
    if (!welcomed) {
      welcomeEl.hidden = false;
      document
        .getElementById('mw-welcome-locate')
        ?.addEventListener('click', () => {
          dismissWelcome();
          if (opts.els.locate) opts.els.locate.click();
          else
            void runLocateFlow({
              onResolved: (lat, lng) =>
                setUserPin(t.map_locate, lat, lng, 'geo'),
              onError: (reason) => showMsg(t[failureMessageKey(reason)]),
            });
        });
      document
        .getElementById('mw-welcome-dismiss')
        ?.addEventListener('click', dismissWelcome);
      document.addEventListener('keydown', welcomeEsc);
    }
  }

  // ----------------------------------------------------------------
  // Measure tools (plan P2.1). Two modes — 'distance' (open polyline)
  // and 'area' (closed polygon). Pure math lives in
  // src/lib/map/utils/measure.ts; this block is the MapLibre wiring.
  // ESC exits the active mode.
  // Measure-ESC keydown handler (set inside the block below), hoisted
  // so destroy() can remove the document listener.
  let measureEscHandler: ((e: KeyboardEvent) => void) | null = null;
  // Story 22.3 — the active-tool pill (one for every tool: measure,
  // crosshair, snapshot) and the snapshot state it reads, hoisted so the
  // snapshot block further down can feed it and destroy() can unwire it.
  let toolPill: ToolPill | null = null;
  let compareActive = false;
  let clearCompare: (() => void) | null = null;
  let refreshToolPill = (): void => undefined;
  if (features.tools) {
    const MEASURE_SOURCE = 'mw-measure-src';
    const MEASURE_LINE_LAYER = 'mw-measure-line';
    const MEASURE_POINTS_LAYER = 'mw-measure-points';
    type MeasureMode = 'distance' | 'area' | null;
    let measureMode: MeasureMode = null;
    let measurePts: [number, number][] = [];
    // Story 18.3 — crosshair ("mira") mode: the active layer's value at
    // the map centre, for phones where hover never happens.
    const crossBtn = document.getElementById('mw-crosshair-btn');
    function setCrosshair(on: boolean): void {
      crosshair.setEnabled(on);
      crossBtn?.setAttribute('aria-pressed', String(crosshair.isEnabled()));
      refreshToolPill();
    }
    crossBtn?.addEventListener('click', () => {
      setCrosshair(!crosshair.isEnabled());
    });
    const distBtn = document.getElementById('mw-measure-distance');
    const areaBtn = document.getElementById('mw-measure-area');
    const wrap = document.getElementById('mw-measure-wrap');
    const resultEl = document.getElementById('mw-measure-result');
    function ensureMeasureLayers(): void {
      if (!map.getSource(MEASURE_SOURCE)) {
        map.addSource(MEASURE_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(MEASURE_LINE_LAYER)) {
        map.addLayer({
          id: MEASURE_LINE_LAYER,
          type: 'line',
          source: MEASURE_SOURCE,
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: {
            'line-color': '#2563eb',
            'line-width': 2.5,
            'line-dasharray': [2, 2],
          },
        });
      }
      if (!map.getLayer(MEASURE_POINTS_LAYER)) {
        map.addLayer({
          id: MEASURE_POINTS_LAYER,
          type: 'circle',
          source: MEASURE_SOURCE,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 4,
            'circle-color': '#2563eb',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        });
      }
    }
    function refreshMeasureGeometry(): void {
      ensureMeasureLayers();
      const src = map.getSource(MEASURE_SOURCE) as
        maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const features: Feature[] = measurePts.map((p) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: p },
      }));
      if (measurePts.length >= 2) {
        const coords =
          measureMode === 'area' && measurePts.length >= 3
            ? [...measurePts, measurePts[0]]
            : measurePts;
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
      src.setData({ type: 'FeatureCollection', features });
    }
    function refreshMeasureResult(): void {
      if (!resultEl) return;
      if (!measureMode || measurePts.length < 1) {
        resultEl.classList.add('hidden');
        resultEl.textContent = '';
        return;
      }
      if (measureMode === 'distance') {
        if (measurePts.length < 2) {
          resultEl.textContent = 'Toca otro punto para medir';
        } else {
          const km = measurePolylineLen(measurePts);
          const n = measurePts.length - 1;
          resultEl.textContent = `${formatDistanceKm(km, currentUnits().distance)} · ${n} ${n === 1 ? 'segmento' : 'segmentos'}`;
        }
      } else {
        if (measurePts.length < 3) {
          resultEl.textContent = `Añade ${3 - measurePts.length} punto(s) más`;
        } else {
          const km2 = measureSphArea(measurePts);
          resultEl.textContent = measureFmtArea(km2);
        }
      }
      resultEl.classList.remove('hidden');
    }
    function setMeasureMode(next: MeasureMode): void {
      measureMode = next;
      measuring = next !== null;
      measurePts = [];
      distBtn?.setAttribute('aria-pressed', String(next === 'distance'));
      areaBtn?.setAttribute('aria-pressed', String(next === 'area'));
      refreshMeasureGeometry();
      refreshMeasureResult();
      map.getCanvas().style.cursor = next ? 'crosshair' : '';
      refreshToolPill();
    }
    distBtn?.addEventListener('click', () => {
      setMeasureMode(measureMode === 'distance' ? null : 'distance');
    });
    areaBtn?.addEventListener('click', () => {
      setMeasureMode(measureMode === 'area' ? null : 'area');
    });
    map.on('click', (e) => {
      if (!measureMode) return;
      measurePts.push([e.lngLat.lng, e.lngLat.lat]);
      refreshMeasureGeometry();
      refreshMeasureResult();
    });
    measureEscHandler = (e: KeyboardEvent): void => {
      // Story 22.3 — an Escape another control already handled (the ⋯
      // menu closing, the search box) is not also an "exit measuring".
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && measureMode) {
        e.preventDefault();
        setMeasureMode(null);
      }
    };
    document.addEventListener('keydown', measureEscHandler);
    // The measure wrap (inside the ⋯ menu since Story 22.3) ships
    // [hidden] and surfaces once the style can take the measure layers.
    // Not on the first 'idle': while the boot satellite loop plays the map
    // can stay busy for 2–45 s, and the menu showed the "Medir" heading
    // over no buttons all that time.
    const revealMeasure = (): void => {
      if (wrap) wrap.hidden = false;
    };
    if (map.isStyleLoaded()) revealMeasure();
    else map.once('load', revealMeasure);
    // Story 22.3 — one pill names whatever tool is on; "Salir" turns
    // every one of them off.
    toolPill = createToolPill(
      {
        pill: document.getElementById('mw-tool-pill'),
        label: document.getElementById('mw-tool-pill-label'),
        exit: document.getElementById('mw-tool-pill-exit'),
      },
      {
        distance: t.map_tool_distance,
        area: t.map_tool_area,
        crosshair: t.map_tool_crosshair,
        compare: t.map_tool_compare,
      },
      () => {
        const hadFocus = !!document
          .getElementById('mw-tool-pill')
          ?.contains(document.activeElement);
        if (measureMode) setMeasureMode(null);
        if (crosshair.isEnabled()) setCrosshair(false);
        clearCompare?.();
        refreshToolPill();
        // The pill just hid under the focus: hand it back to the ⋯
        // button the tools came from, not to <body>.
        if (hadFocus) document.getElementById('mw-tools-btn')?.focus();
      }
    );
    refreshToolPill = (): void => {
      toolPill?.update({
        measure: measureMode,
        crosshair: crosshair.isEnabled(),
        compare: compareActive,
      });
    };
  }

  // ----------------------------------------------------------------
  // Model toggle (plan P1.1). The 5 pills at bottom-right let the user
  // override Open-Meteo's default best_match selector with a specific
  // NWP model. State is mirrored into the URL hash so #model=icon_seamless
  // round-trips. Changing model invalidates the cached grids and forces
  // a refetch via setActiveLayer.
  if (features.modelToggle) {
    // Model toggle pills (plan P1.1) — DOM wiring extracted to
    // src/lib/map/chrome/model-toggle.ts. The caller still owns the
    // activeModel variable + the cache-invalidation side-effects.
    createModelToggle(
      { wrap: document.getElementById('mw-model-toggle') },
      () => activeModel,
      (next) => {
        activeModel = next;
        // Invalidate cached grids + force re-fetch with the new model.
        fieldGrid = null;
        lastTempGrid = null;
        lastHumidityGrid = null;
        lastPressureGrid = null;
        windGrid = null;
        if (
          activeLayer !== 'base' &&
          activeLayer !== 'satellite' &&
          activeLayer !== 'radar' &&
          activeLayer !== 'sunlight'
        ) {
          void setActiveLayer(activeLayer);
        }
        syncHash();
      }
    );
  }

  // Snapshot compare (plan 3.3). Captures the WebGL canvas to an
  // <img> overlay so the user can scrub the timeline or switch
  // layers and visually diff "antes" vs "ahora". Doesn't require any
  // extra network fetches — pure client-side canvas → data URL.
  // ----------------------------------------------------------------
  if (features.tools) {
    // Snapshot compare tool — extracted to chrome/snapshot-compare.ts.
    const snapshot = createSnapshotCompare(
      {
        map,
        captureBtn: document.getElementById('mw-snapshot-capture'),
        compareBtn: document.getElementById('mw-snapshot-24h'),
        toggleBtn: document.getElementById('mw-snapshot-toggle'),
        clearBtn: document.getElementById('mw-snapshot-clear'),
        imgEl: document.getElementById(
          'mw-snapshot-img'
        ) as HTMLImageElement | null,
      },
      {
        // Story 13.5 — jump the active timeline by ±N s (nearest frame).
        shiftTime: (bySec) => {
          if (tlFrames.length < 2 || frameIndex < 0) {
            showMsg(t.map_layer_unavailable);
            window.setTimeout(hideMsg, 3000);
            return false;
          }
          tlStop();
          const target = tlFrames[frameIndex].time + bySec;
          let best = frameIndex;
          let bestDelta = Infinity;
          tlFrames.forEach((f, i) => {
            const d = Math.abs(f.time - target);
            if (d < bestDelta) {
              best = i;
              bestDelta = d;
            }
          });
          if (best === frameIndex) return false;
          applyFrame(best);
          return true;
        },
        // Story 22.3 — the active-tool pill follows the snapshot.
        onChange: (active) => {
          compareActive = active;
          refreshToolPill();
        },
      }
    );
    clearCompare = snapshot.clear;
    snapshot.refresh();
  }

  return {
    map,
    destroy(): void {
      themeObserver?.disconnect();
      sunLayer.remove(); // also stops the internal ticker
      if (windRaf) window.cancelAnimationFrame(windRaf);
      // Story 23.2 — cancels the loop's pending animation frame and
      // buffering timer; a late start() (boot autoplay) is a no-op.
      tlPlayer.destroy();
      tlBar?.dispose(); // pointer/wheel/key listeners, observer, rAF
      tlBar = null;
      tlJump?.dispose(); // label/range/document listeners + the popover
      tlJump = null;
      fieldAbort?.abort();
      fieldAbort = null;
      revokeFieldBlob(); // free the last field raster blob URL
      placePopup?.remove();
      placePopup = null;
      window.clearTimeout(hashTimer);
      window.clearTimeout(qTimer);
      if (repaintNudgeInterval) window.clearInterval(repaintNudgeInterval);
      skeleton.dispose();
      map.off('sourcedata', onFirstFrameData);
      if (surfaceInterval) window.clearInterval(surfaceInterval);
      if (surfaceTimeout) window.clearTimeout(surfaceTimeout);
      if (acOutsideClickHandler)
        document.removeEventListener('click', acOutsideClickHandler);
      if (measureEscHandler)
        document.removeEventListener('keydown', measureEscHandler);
      toolPill?.dispose();
      document.removeEventListener('keydown', placeCardEscHandler);
      closePlaceCard();
      overlayRegistry.dispose();
      shortcutsDialog?.dispose();
      railDesktopMq?.removeEventListener('change', onRailMqChange);
      try {
        map.remove();
      } catch {
        /* already removed */
      }
    },
  };
}
