/**
 * Story 21.2 — is NASA GIBS reachable right now?
 *
 * /mapa boots on the GeoColor satellite layer, and the satellite axis is
 * synthetic (any 10-minute instant is a valid TIME), so the old
 * "Capa no disponible" path for satellite could never trigger: with GIBS
 * down the visitor got a dark canvas and nothing else. Before the boot
 * activation we fetch ONE GeoColor tile over central Mexico for the
 * newest frame; a network failure or an HTTP error means "GIBS is
 * unavailable" and the boot falls back to radar (RainViewer manifest
 * present) or base, with the existing toast. A slow answer (timeout) is
 * `unknown` and keeps satellite: tiles that arrive late are still
 * better than a fallback flicker.
 *
 * Only the boot path probes. Clicking satellite later behaves as before.
 */
import {
  GIBS_LAYERS,
  gibsLatestTime,
  gibsTileUrl,
  type GibsLayerDef,
} from './nasa-gibs';

/** z0: the single world tile, the smallest GeoColor request. GIBS
 *  answers no-store, so the probe never warms a cache; it only has to
 *  be cheap. */
export const GIBS_PROBE_TILE = { z: 0, y: 0, x: 0 } as const;

/** Longer than a healthy tile round-trip, short enough that the boot
 *  (which waits on it) is not held back; a timeout keeps satellite. */
export const GIBS_PROBE_TIMEOUT_MS = 2500;

export type GibsProbeResult = 'ok' | 'down' | 'unknown';

/** GeoColor URL of the probe tile at the newest frame the map would
 *  show — same host, product and TIME as the real tiles. */
export function gibsProbeUrl(
  layer: GibsLayerDef = GIBS_LAYERS.goesGeocolor,
  now: Date = new Date()
): string {
  return gibsTileUrl(layer, gibsLatestTime(now))
    .replace('{z}', String(GIBS_PROBE_TILE.z))
    .replace('{y}', String(GIBS_PROBE_TILE.y))
    .replace('{x}', String(GIBS_PROBE_TILE.x));
}

export interface ProbeGibsOpts {
  url?: string;
  timeoutMs?: number;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

/** Never rejects. `ok` on any 2xx, `down` on an HTTP error or a failed
 *  fetch, `unknown` when the request did not finish in time. */
export async function probeGibs(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  opts: ProbeGibsOpts = {}
): Promise<GibsProbeResult> {
  const url = opts.url ?? gibsProbeUrl();
  const timeoutMs = opts.timeoutMs ?? GIBS_PROBE_TIMEOUT_MS;
  const setT = opts.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((id) => window.clearTimeout(id));
  const ac =
    typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  const timer = setT(() => {
    timedOut = true;
    ac?.abort();
  }, timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      mode: 'cors',
      ...(ac ? { signal: ac.signal } : {}),
    });
    return res.ok ? 'ok' : 'down';
  } catch {
    return timedOut ? 'unknown' : 'down';
  } finally {
    clearT(timer);
  }
}

/**
 * Layer to activate at boot once the probe answered. Anything but
 * satellite passes through untouched; satellite survives `ok` and
 * `unknown`, and on `down` falls to radar when RainViewer answered, else
 * base (the caller shows the toast when the result differs).
 */
export function bootLayerAfterProbe(
  wanted: string | null,
  probe: GibsProbeResult,
  hasRadar: boolean
): string | null {
  if (wanted !== 'satellite') return wanted;
  if (probe !== 'down') return 'satellite';
  return hasRadar ? 'radar' : 'base';
}
