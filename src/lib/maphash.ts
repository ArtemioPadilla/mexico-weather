// Pure, DOM-free encode/decode + validation for the /mapa shareable URL hash.
// Format: #view=<lat>,<lng>,<zoom>z&layer=<id>[&t=<ISO>][&model=<id>][&mode=precip]

import { LAYER_IDS } from './maplayers';

export interface MapHashState {
  lat: number;
  lng: number;
  zoom: number;
  /** Active layer id. `null` when the hash carries no `layer=` (or no
   *  usable state at all): the page's own default applies — satellite
   *  on /mapa, radar on the home embed, each layer page its own (Story
   *  21.2). `buildMapHash` writes such a state as `layer=base`. */
  layer: string | null;
  t: string | null;
  /** Optional Open-Meteo NWP model id; null/undefined → 'best_match'. */
  model?: string | null;
  /** Story 13.2 — combined "precipitación" mode (satellite + clouds +
   *  radar together); only 'precip' is defined. */
  mode?: 'precip' | null;
}

/** Valid Open-Meteo model ids accepted in the URL hash. */
export const MODEL_IDS = [
  'best_match',
  'icon_seamless',
  'gfs_seamless',
  'ecmwf_ifs04',
  'jma_seamless',
] as const;

/** Default view: centred on Mexico, country-level zoom, no layer
 *  opinion (the page default wins — see `MapHashState.layer`). */
export const DEFAULT_VIEW: MapHashState = {
  lat: 23.6,
  lng: -102.5,
  zoom: 4.5,
  layer: null,
  t: null,
  model: null,
};

function inRange(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

export function parseMapHash(hash: string): MapHashState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const view = params.get('view');
  if (!view) return { ...DEFAULT_VIEW };

  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)z$/.exec(
    view
  );
  if (!m) return { ...DEFAULT_VIEW };

  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const zoom = Number(m[3]);
  if (
    !inRange(lat, -90, 90) ||
    !inRange(lng, -180, 180) ||
    !inRange(zoom, 0, 22)
  ) {
    return { ...DEFAULT_VIEW };
  }

  // Absent → null (page default applies); present but unknown → 'base'.
  const rawLayer = params.get('layer');
  const layer =
    rawLayer === null
      ? null
      : (LAYER_IDS as readonly string[]).includes(rawLayer)
        ? rawLayer
        : 'base';

  const t = params.get('t');
  const rawModel = params.get('model');
  const model =
    rawModel && (MODEL_IDS as readonly string[]).includes(rawModel)
      ? rawModel
      : null;
  return {
    lat,
    lng,
    zoom,
    layer,
    t: t && t.length > 0 ? t : null,
    model,
    // Only present when set, so older callers comparing whole objects
    // keep working (Story 13.2).
    ...(params.get('mode') === 'precip' ? { mode: 'precip' as const } : {}),
  };
}

export function buildMapHash(state: MapHashState): string {
  const lat = Number(state.lat.toFixed(4));
  const lng = Number(state.lng.toFixed(4));
  const zoom = Number(state.zoom.toFixed(2));
  let s = `#view=${lat},${lng},${zoom}z&layer=${state.layer ?? 'base'}`;
  if (state.t) s += `&t=${state.t}`;
  if (state.model && state.model !== 'best_match') s += `&model=${state.model}`;
  if (state.mode === 'precip') s += '&mode=precip';
  return s;
}
