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
  gibsLatestTime,
  gibsTileUrl,
  gibsTimeParam,
} from '../sources/nasa-gibs';
import {
  rainviewerTileUrl,
  type RadarFrame,
  type RainviewerData,
} from '../../maplayers';

const RV_SOURCE = 'wx-raster';
const RV_LAYER = 'wx-raster-layer';
// Story 21.3 — the second slot of the A/B pair. Slot A keeps the
// historical ids (the boot autoplay waits on `wx-raster`, e2e and the
// cold-load check look for `wx-raster-layer`); B only exists once a
// second frame has been shown.
const RV_SOURCE_B = 'wx-raster-b';
const RV_LAYER_B = 'wx-raster-layer-b';
const DIM_SOURCE = 'wx-rv-dim-src';
const DIM_LAYER = 'wx-rv-dim-layer';

/** Public layer + source ids — exported so the existing setActiveLayer
 *  cold-load verification (which checks getLayer(RV_LAYER)) keeps
 *  working without duplicating the constant. */
export const WEATHER_RASTER_LAYER_ID = RV_LAYER;
export const WEATHER_RASTER_SOURCE_ID = RV_SOURCE;
export const WEATHER_RASTER_LAYER_B_ID = RV_LAYER_B;
export const WEATHER_RASTER_SOURCE_B_ID = RV_SOURCE_B;

/** Story 21.3 — how long a frame swap waits for the incoming slot's
 *  tiles before cross-fading anyway (a tile that never answers must not
 *  freeze the picture on the old frame). */
export const SWAP_TIMEOUT_MS = 2000;

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

/** Tile template + raster-source parameters for one frame of a weather
 *  raster product. Single source of truth for the URLs MapLibre asks
 *  for and the ones the frame prefetcher (Story 21.3) warms. */
export interface WeatherRasterTileSpec {
  /** `{z}/{x}/{y}` template (GIBS orders it `{z}/{y}/{x}`). */
  url: string;
  tileSize: number;
  maxzoom: number;
  attribution: string;
  /** Same product (layer + variant + tile pyramid): frames of one
   *  product swap through the A/B pair; a new product rebuilds. */
  productKey: string;
}

export function weatherRasterTileSpec(
  layerId: 'radar' | 'satellite',
  frame: RadarFrame | null,
  ctx: {
    rvData: RainviewerData | null;
    satelliteSubOption: SatelliteSubOption;
  }
): WeatherRasterTileSpec | null {
  if (layerId === 'satellite') {
    const gibsLayer = pickGibsLayer(ctx.satelliteSubOption);
    return {
      // Story 16.1 — the timeline frame picks the TIME; without a
      // frame fall back to the newest instant GIBS is likely to have.
      url: gibsTileUrl(
        gibsLayer,
        frame ? gibsTimeParam(gibsLayer, frame.time * 1000) : gibsLatestTime()
      ),
      tileSize: 256,
      maxzoom: gibsLayer.maxZoom,
      attribution: ATTRIBUTION_GIBS,
      productKey: `satellite|${gibsLayer.id}`,
    };
  }
  // Radar from RainViewer.
  // 256px pyramid maxes at ~z8 → server returns "Zoom Level Not
  // Supported" placeholder at higher zoom. 512px pyramid covers
  // through z10. tileSize:512 keeps visual density equivalent.
  if (!ctx.rvData || !frame) return null;
  return {
    url: rainviewerTileUrl(ctx.rvData.host, frame, { size: 512 }),
    tileSize: 512,
    maxzoom: 10,
    attribution: '© RainViewer',
    productKey: `radar|${ctx.rvData.host}`,
  };
}

export interface WeatherRasterDeps {
  /** Show a transient toast — the factory calls this when satellite
   *  is requested above the GIBS-product max zoom (i.e. user is
   *  zoomed in past where the imagery has usable detail). */
  showMsg?: (text: string) => void;
  hideMsg?: () => void;
  /** Story 16.4 — raster-fade-duration (ms) for the tile layer; read
   *  when the layer is (re)added and on every frame swap, where it is
   *  also the A/B cross-fade length (Story 21.3). 300 when absent
   *  (MapLibre default); 0 swaps instantly. */
  getFadeMs?: () => number;
  /** Story 21.1 — layer id the weather raster (and its dim backdrop and
   *  radar companion) is inserted BENEATH, so the basemap reference
   *  (labels + boundaries) stays readable on top of clouds and echoes.
   *  Ignored when that layer is absent (appended on top, legacy order). */
  beforeLayerId?: string;
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
    }
  ) => void;
  /** Tear down the active raster + the dim backdrop. */
  remove: () => void;
  /** Set raster-opacity on the visible slot (and the incoming one while
   *  it fades in). Called by the global opacity slider. */
  setOpacity: (opacity: number) => void;
  /** Story 16.4 — apply the play style's cross-fade live. */
  setFadeMs: (ms: number) => void;
  /** Story 13.2 — radar frame over the satellite raster (combined
   *  precipitation mode); null frame or no manifest removes it. */
  showRadarCompanion: (
    frame: RadarFrame | null,
    ctx: { rvData: RainviewerData | null; opacity: number }
  ) => void;
  removeRadarCompanion: () => void;
  /** Resolves once the last frame `show` asked for is on screen with its
   *  tiles loaded (no swap in flight, visible slot's source loaded), or
   *  after `timeoutMs`. The timeline gate for satellite: GIBS tiles are
   *  `no-store`, so they cannot be prefetched into the HTTP cache — the
   *  loop waits on the A/B swap itself instead of outrunning what is
   *  drawn. */
  swapSettled: (timeoutMs: number) => Promise<void>;
}

export function createWeatherRaster(
  map: maplibregl.Map,
  deps: WeatherRasterDeps = {}
): WeatherRasterFactory {
  /** Story 21.1 — beforeId for every layer this factory adds: the labels
   *  layer when the caller named one and it exists, else undefined
   *  (append on top). Resolved per call because the basemap style can
   *  be rebuilt underneath us. */
  function belowLabels(): string | undefined {
    return deps.beforeLayerId && map.getLayer(deps.beforeLayerId)
      ? deps.beforeLayerId
      : undefined;
  }

  function addDim(): void {
    if (map.getLayer(DIM_LAYER)) return;
    if (!map.getSource(DIM_SOURCE)) {
      map.addSource(DIM_SOURCE, { type: 'geojson', data: WORLD_RECT_FC });
    }
    const beneath = map.getLayer(RV_LAYER) ? RV_LAYER : belowLabels();
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
      beneath
    );
  }

  function removeDim(): void {
    if (map.getLayer(DIM_LAYER)) map.removeLayer(DIM_LAYER);
    if (map.getSource(DIM_SOURCE)) map.removeSource(DIM_SOURCE);
  }

  // Story 13.2 — radar tiles drawn ON TOP of the satellite raster in the
  // combined precipitation mode. Own source/layer so the satellite
  // frame swap (A/B, Story 21.3) cannot bury it.
  const COMPANION_SOURCE = 'wx-radar-companion-src';
  const COMPANION_LAYER = 'wx-radar-companion';

  function removeCompanion(): void {
    if (map.getLayer(COMPANION_LAYER)) map.removeLayer(COMPANION_LAYER);
    if (map.getSource(COMPANION_SOURCE)) map.removeSource(COMPANION_SOURCE);
  }

  const fadeMs = (): number => deps.getFadeMs?.() ?? 300;

  // ------------------------------------------------------------------
  // Story 21.3 — A/B frame pair. Frames of one product no longer tear
  // the source down: the hidden slot gets the next frame's tiles
  // (`setTiles`, straight from the HTTP cache the prefetcher warmed),
  // and once they are in it moves on top and fades in over the visible
  // slot for `raster-fade-duration` ms; only then does the old slot drop
  // to 0. The picture is never empty between frames.
  // ------------------------------------------------------------------
  type Slot = 'A' | 'B';
  const SLOT_SOURCE: Record<Slot, string> = { A: RV_SOURCE, B: RV_SOURCE_B };
  const SLOT_LAYER: Record<Slot, string> = { A: RV_LAYER, B: RV_LAYER_B };
  const otherSlot = (s: Slot): Slot => (s === 'A' ? 'B' : 'A');

  let product: string | null = null;
  let front: Slot = 'A';
  let frontUrl: string | null = null;
  /** Template loading into the hidden slot, awaiting its cross-fade. */
  let incomingUrl: string | null = null;
  let opacity = 1;
  let stopWaiting: (() => void) | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeDone: (() => void) | null = null;
  /** `swapSettled` callers: each re-checks when a swap lands/aborts. */
  let settleWaiters: Array<() => void> = [];

  /** The last frame `show` asked for is on screen and its tiles are in:
   *  no swap in flight, and the visible slot's source reports loaded
   *  (every in-view tile loaded or errored). A swap that cross-faded on
   *  SWAP_TIMEOUT_MS is on screen but not settled until its tiles land. */
  function isSettled(): boolean {
    if (incomingUrl !== null) return false;
    const src = SLOT_SOURCE[front];
    return !map.getSource(src) || map.isSourceLoaded(src);
  }

  function flushSettled(): void {
    for (const w of settleWaiters.slice()) w();
  }

  function swapSettled(timeoutMs: number): Promise<void> {
    if (isSettled()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        map.off('sourcedata', onData);
        map.off('error', onData);
        settleWaiters = settleWaiters.filter((w) => w !== check);
        resolve();
      };
      const check = (): void => {
        if (isSettled()) finish();
      };
      // Deferred for the same reason as in awaitIncoming.
      const onData = (e: { sourceId?: string }): void => {
        if (e.sourceId === SLOT_SOURCE[front]) queueMicrotask(check);
      };
      const timer = setTimeout(finish, timeoutMs);
      map.on('sourcedata', onData);
      map.on('error', onData);
      settleWaiters.push(check);
    });
  }

  function addSlot(
    slot: Slot,
    spec: WeatherRasterTileSpec,
    slotOpacity: number,
    beforeId: string | undefined
  ): void {
    if (!map.getSource(SLOT_SOURCE[slot])) {
      map.addSource(SLOT_SOURCE[slot], {
        type: 'raster',
        tiles: [spec.url],
        tileSize: spec.tileSize,
        maxzoom: spec.maxzoom,
        attribution: spec.attribution,
      });
    }
    map.addLayer(
      {
        id: SLOT_LAYER[slot],
        type: 'raster',
        source: SLOT_SOURCE[slot],
        paint: {
          'raster-opacity': slotOpacity,
          'raster-resampling': 'linear',
          'raster-fade-duration': fadeMs(),
        },
      },
      beforeId
    );
  }

  function setSlotOpacity(slot: Slot, value: number, durationMs: number): void {
    const id = SLOT_LAYER[slot];
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, 'raster-opacity-transition', {
      duration: durationMs,
      delay: 0,
    });
    map.setPaintProperty(id, 'raster-opacity', value);
  }

  /** Top of the weather rasters: under the radar companion when it is
   *  there, else under the labels (Story 21.1). */
  function topOfRasters(): string | undefined {
    return map.getLayer(COMPANION_LAYER) ? COMPANION_LAYER : belowLabels();
  }

  /** Opacity 0 still counts as "used" for MapLibre (Style._updateSources
   *  only checks visibility and zoom range), so a faded-out slot would
   *  keep requesting its frame's tiles on every pan and zoom — twice the
   *  weather tiles, each a full download on GIBS (no-store). A slot that
   *  is not on screen is taken out of the render instead. */
  function setSlotVisible(slot: Slot, on: boolean): void {
    const id = SLOT_LAYER[slot];
    if (map.getLayer(id))
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  function abortSwap(): void {
    stopWaiting?.();
    stopWaiting = null;
    incomingUrl = null;
    setSlotVisible(otherSlot(front), false);
    flushSettled();
  }

  /** Complete a running cross-fade now (the outgoing slot drops to 0). */
  function finishFade(): void {
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = null;
    const done = fadeDone;
    fadeDone = null;
    done?.();
  }

  function crossfade(): void {
    stopWaiting?.();
    stopWaiting = null;
    const inSlot = otherSlot(front);
    const outSlot = front;
    const url = incomingUrl;
    incomingUrl = null;
    if (!map.getLayer(SLOT_LAYER[inSlot])) {
      flushSettled();
      return;
    }
    const ms = fadeMs();
    map.moveLayer(SLOT_LAYER[inSlot], topOfRasters());
    setSlotOpacity(inSlot, opacity, ms);
    front = inSlot;
    frontUrl = url;
    // After `front` moved: waiters now check the slot just brought up.
    flushSettled();
    const hideOut = (): void => {
      setSlotOpacity(outSlot, 0, 0);
      setSlotVisible(outSlot, false);
    };
    if (ms <= 0) {
      hideOut();
      return;
    }
    fadeDone = hideOut;
    fadeTimer = setTimeout(finishFade, ms);
  }

  /** Cross-fade once the hidden slot's source reports loaded (every
   *  in-view tile loaded or errored), capped at SWAP_TIMEOUT_MS. */
  function awaitIncoming(): void {
    stopWaiting?.();
    const src = SLOT_SOURCE[otherSlot(front)];
    let done = false;
    const check = (): void => {
      if (done || !map.getSource(src)) return;
      if (map.isSourceLoaded(src)) crossfade();
    };
    // Deferred: `setTiles` fires `metadata` then `content` back to back
    // and the tiles only turn stale on `content`; a check in between
    // would see the previous frame's tiles as "loaded".
    const onData = (e: maplibregl.MapSourceDataEvent): void => {
      if (e.sourceId !== src || e.sourceDataType === 'metadata') return;
      queueMicrotask(check);
    };
    // The last tile can error instead of loading (no `sourcedata`).
    const onError = (e: { sourceId?: string }): void => {
      if (e.sourceId === src) queueMicrotask(check);
    };
    map.on('sourcedata', onData);
    map.on('error', onError);
    const timer = setTimeout(() => {
      if (!done) crossfade();
    }, SWAP_TIMEOUT_MS);
    stopWaiting = (): void => {
      done = true;
      map.off('sourcedata', onData);
      map.off('error', onError);
      clearTimeout(timer);
    };
  }

  function teardownRaster(): void {
    abortSwap();
    fadeDone = null;
    finishFade();
    for (const slot of ['A', 'B'] as const) {
      if (map.getLayer(SLOT_LAYER[slot])) map.removeLayer(SLOT_LAYER[slot]);
      if (map.getSource(SLOT_SOURCE[slot])) {
        map.removeSource(SLOT_SOURCE[slot]);
      }
    }
    removeCompanion();
    removeDim();
    product = null;
    front = 'A';
    frontUrl = null;
    flushSettled();
  }

  return {
    show: (layerId, frame, ctx): void => {
      const prevOpacity = opacity;
      opacity = ctx.opacity;
      const spec = weatherRasterTileSpec(layerId, frame, ctx);
      if (!spec) {
        // Radar without a manifest/frame: dim only (defensive, as before).
        teardownRaster();
        addDim();
        return;
      }
      const intact =
        product === spec.productKey &&
        !!map.getLayer(SLOT_LAYER[front]) &&
        !!map.getSource(SLOT_SOURCE[front]);
      if (!intact) {
        // New product (layer, satellite variant, radar host) or a style
        // rebuilt underneath us: start over on slot A.
        teardownRaster();
        addDim();
        addSlot('A', spec, opacity, belowLabels());
        product = spec.productKey;
        front = 'A';
        frontUrl = spec.url;
        const maxZoom = spec.maxzoom;
        if (
          layerId === 'satellite' &&
          ctx.currentZoom > maxZoom + 1 &&
          deps.showMsg
        ) {
          deps.showMsg(
            `Satélite limitado a zoom z${maxZoom} (NASA GIBS). Acercando más solo aparece la mancha del basemap.`
          );
          if (deps.hideMsg) window.setTimeout(deps.hideMsg, 5000);
        }
        return;
      }
      if (prevOpacity !== opacity && map.getLayer(SLOT_LAYER[front])) {
        map.setPaintProperty(SLOT_LAYER[front], 'raster-opacity', opacity);
      }
      if (spec.url === frontUrl) {
        // Back to the frame on screen (scrub): drop the swap in flight.
        abortSwap();
        return;
      }
      if (spec.url === incomingUrl) return;
      // A cross-fade still running completes now; its old slot is the
      // one the new frame loads into.
      finishFade();
      const back = otherSlot(front);
      const backSource = map.getSource(SLOT_SOURCE[back]) as
        | (maplibregl.RasterTileSource & { setTiles?: (t: string[]) => void })
        | undefined;
      if (map.getLayer(SLOT_LAYER[back]) && backSource?.setTiles) {
        setSlotOpacity(back, 0, 0);
        // Back in the render so its tiles load (invisible at opacity 0).
        setSlotVisible(back, true);
        backSource.setTiles([spec.url]);
      } else {
        if (map.getLayer(SLOT_LAYER[back])) map.removeLayer(SLOT_LAYER[back]);
        if (backSource) map.removeSource(SLOT_SOURCE[back]);
        addSlot(back, spec, 0, topOfRasters());
      }
      incomingUrl = spec.url;
      awaitIncoming();
    },
    remove: teardownRaster,
    swapSettled,
    showRadarCompanion: (frame, ctx): void => {
      removeCompanion();
      if (!frame || !ctx.rvData) return;
      map.addSource(COMPANION_SOURCE, {
        type: 'raster',
        tiles: [rainviewerTileUrl(ctx.rvData.host, frame, { size: 512 })],
        tileSize: 512,
        maxzoom: 10,
        attribution: '© RainViewer',
      });
      // Below the labels too, but above the satellite raster (which was
      // inserted before the same anchor a moment earlier).
      map.addLayer(
        {
          id: COMPANION_LAYER,
          type: 'raster',
          source: COMPANION_SOURCE,
          paint: {
            'raster-opacity': ctx.opacity,
            'raster-resampling': 'linear',
            'raster-fade-duration': fadeMs(),
          },
        },
        belowLabels()
      );
    },
    removeRadarCompanion: removeCompanion,
    setFadeMs: (ms: number): void => {
      for (const slot of ['A', 'B'] as const) {
        if (map.getLayer(SLOT_LAYER[slot])) {
          map.setPaintProperty(SLOT_LAYER[slot], 'raster-fade-duration', ms);
        }
      }
    },
    setOpacity: (value: number): void => {
      opacity = value;
      if (map.getLayer(SLOT_LAYER[front])) {
        map.setPaintProperty(SLOT_LAYER[front], 'raster-opacity', value);
      }
    },
  };
}
