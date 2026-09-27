/**
 * Story 21.2 — one-shot autoplay when /mapa boots on satellite.
 *
 * zoom.earth opens on moving clouds; we used to open on a static base
 * canvas. This module holds the pure decisions behind the boot loop so
 * interactive-map.ts only wires them:
 *
 *  - {@link shouldBootAutoplay}: play only for the satellite layer, with
 *    ≥ 2 frames, when the visitor did not ask for a specific instant
 *    (`t=` in the hash), does not prefer reduced motion and is not on a
 *    data-saver connection.
 *  - {@link bootLoopHours}: the boot loop covers the last 3 h — unless
 *    the visitor already chose a loop window in ⚙ (stored settings),
 *    which always wins. The setting itself is never written: the
 *    override lives only until the first user interaction with the
 *    timeline pauses the loop, exactly as a manual ▶ does today.
 *  - {@link whenSourceLoaded}: resolves once the raster source has its
 *    first frame's tiles decoded (or after a cap), so the loop starts on
 *    a painted frame instead of a blank one.
 */
import { LOOP_HOURS, type LoopHours } from '../settings';

/** Loop window the boot autoplay uses when the visitor has no stored
 *  preference (plan PARIDAD_VISUAL Story 21.2: "las últimas 3 h"). */
export const BOOT_LOOP_HOURS: LoopHours = 3;

/** Longest we wait for the first satellite frame's tiles before starting
 *  the loop anyway (a slow CDN must not keep the map static forever). */
export const BOOT_AUTOPLAY_TILE_WAIT_MS = 4000;

/** Only this layer autoplays at boot: the story is about GeoColor; the
 *  radar fallback and the field layers keep today's static first frame. */
export const BOOT_AUTOPLAY_LAYER = 'satellite';

export interface BootAutoplayEnv {
  /** Layer that ended up active after the boot activation (+ fallback). */
  layerId: string | null;
  /** Frames on the timeline for that layer. */
  frameCount: number;
  /** `t=` from the URL hash: a shared instant must stay put. */
  seekIso: string | null;
  /** `prefers-reduced-motion: reduce` (the player also refuses to start). */
  reducedMotion: boolean;
  /** `navigator.connection.saveData` — the visitor asked for less data. */
  saveData: boolean;
}

/** Pure: should the timeline start playing on its own after boot? */
export function shouldBootAutoplay(env: BootAutoplayEnv): boolean {
  if (env.layerId !== BOOT_AUTOPLAY_LAYER) return false;
  if (env.frameCount < 2) return false;
  if (env.seekIso) return false;
  if (env.reducedMotion) return false;
  if (env.saveData) return false;
  return true;
}

/** `navigator.connection.saveData === true` (Network Information API;
 *  Chromium only — absent elsewhere, which reads as "no preference"). */
export function readSaveData(nav: unknown): boolean {
  const conn = (nav as { connection?: { saveData?: unknown } } | null)
    ?.connection;
  return conn?.saveData === true;
}

/** Loop window for the boot autoplay: the visitor's stored `loopHours`
 *  when they ever set one (raw `mw:settings` JSON), else 3 h. Reads the
 *  raw record rather than `readSettings()` because that one fills the
 *  24 h default in, and "default" is exactly the case we override. */
export function bootLoopHours(rawStoredSettings: string | null): LoopHours {
  if (!rawStoredSettings) return BOOT_LOOP_HOURS;
  try {
    const parsed = JSON.parse(rawStoredSettings) as unknown;
    const v =
      parsed && typeof parsed === 'object'
        ? Number((parsed as { loopHours?: unknown }).loopHours)
        : NaN;
    return (LOOP_HOURS as readonly number[]).includes(v)
      ? (v as LoopHours)
      : BOOT_LOOP_HOURS;
  } catch {
    return BOOT_LOOP_HOURS;
  }
}

export interface SourceDataEventLike {
  isSourceLoaded?: boolean;
  sourceId?: string;
}

/** The slice of maplibregl.Map this module needs. */
export interface SourceLoadWatchable {
  on: (type: 'sourcedata', fn: (e: SourceDataEventLike) => void) => unknown;
  off: (type: 'sourcedata', fn: (e: SourceDataEventLike) => void) => unknown;
  getSource: (id: string) => unknown;
  isSourceLoaded: (id: string) => boolean;
}

export interface WhenSourceLoadedOpts {
  capMs?: number;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

/**
 * Resolves `'loaded'` on the first `sourcedata` that reports `sourceId`
 * fully loaded (or right away when it already is), `'timeout'` after
 * `capMs`. Never rejects; always detaches its listener.
 */
export function whenSourceLoaded(
  map: SourceLoadWatchable,
  sourceId: string,
  opts: WhenSourceLoadedOpts = {}
): Promise<'loaded' | 'timeout'> {
  const capMs = opts.capMs ?? BOOT_AUTOPLAY_TILE_WAIT_MS;
  const setT = opts.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((id) => window.clearTimeout(id));
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = (how: 'loaded' | 'timeout'): void => {
      if (done) return;
      done = true;
      map.off('sourcedata', onData);
      if (timer) clearT(timer);
      resolve(how);
    };
    const onData = (e: SourceDataEventLike): void => {
      if (e.sourceId === sourceId && e.isSourceLoaded) finish('loaded');
    };
    const alreadyLoaded = (): boolean => {
      try {
        return !!map.getSource(sourceId) && map.isSourceLoaded(sourceId);
      } catch {
        return false;
      }
    };
    if (alreadyLoaded()) {
      resolve('loaded');
      done = true;
      return;
    }
    map.on('sourcedata', onData);
    timer = setT(() => finish('timeout'), capMs);
  });
}
