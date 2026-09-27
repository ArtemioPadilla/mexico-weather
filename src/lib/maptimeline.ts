// Pure, DOM-free timeline frame-selection helpers for the /mapa scrubber.
import type { RadarFrame, RainviewerData } from './maplayers';

/** Frames backing the timeline for the active layer (empty for base/no data). */
export function framesForLayer(
  rv: RainviewerData | null,
  layerId: string
): RadarFrame[] {
  if (!rv) return [];
  if (layerId === 'radar') return rv.frames;
  if (layerId === 'satellite') return rv.satelliteFrames;
  return [];
}

/** Story 16.1 — satellite frames are generated, not read from a
 *  manifest: GIBS serves any 10-minute instant in its retention window,
 *  so the timeline is a synthetic axis ending at now − lag.
 *
 *  Default window: the last 24 h at 10-minute steps (144 frames).
 *  Extended window ("Ver 10 días"): hourly for days 2–10, then the
 *  10-minute tail — the same fine-near/coarse-far shape the forecast
 *  fields use, so the axis stays scrubbable (≈ 360 frames). */
export const SAT_STEP_SEC = 600;
export const SAT_LAG_SEC = 30 * 60;
export const SAT_DEFAULT_HOURS = 24;
export const SAT_EXTENDED_DAYS = 10;

function floorTo(sec: number, step: number): number {
  return Math.floor(sec / step) * step;
}

export function satelliteFrames(
  nowSec: number,
  opts: { hours?: number; stepSec?: number; lagSec?: number } = {}
): RadarFrame[] {
  const step = opts.stepSec ?? SAT_STEP_SEC;
  const hours = opts.hours ?? SAT_DEFAULT_HOURS;
  const end = floorTo(nowSec - (opts.lagSec ?? SAT_LAG_SEC), step);
  const start = end - hours * 3600 + step;
  const out: RadarFrame[] = [];
  for (let t = start; t <= end; t += step) out.push({ time: t, path: '' });
  return out;
}

export function satelliteFramesExtended(
  nowSec: number,
  opts: { days?: number; lagSec?: number } = {}
): RadarFrame[] {
  const days = opts.days ?? SAT_EXTENDED_DAYS;
  const tail = satelliteFrames(nowSec, { lagSec: opts.lagSec });
  if (tail.length === 0) return tail;
  const tailStart = tail[0].time;
  const coarse: RadarFrame[] = [];
  // Hourly steps on the tail's own 10-min grid (any such instant is a
  // valid GIBS TIME), so the count is exactly (days·24 − 24) frames.
  const start = tailStart - (days * 24 - SAT_DEFAULT_HOURS) * 3600;
  for (let t = start; t < tailStart; t += 3600)
    coarse.push({ time: t, path: '' });
  return [...coarse, ...tail];
}

/** Daily products (MODIS true colour): one frame per day at 18:00Z
 *  (≈ local noon over Mexico, the Terra overpass), newest = today. */
export function satelliteDailyFrames(
  nowSec: number,
  days = SAT_EXTENDED_DAYS
): RadarFrame[] {
  const today = floorTo(nowSec, 86400);
  const out: RadarFrame[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push({ time: today - i * 86400 + 18 * 3600, path: '' });
  }
  return out;
}

/** Clamp `i` into [0, len-1]; -1 when there are no frames. */
export function clampIndex(i: number, len: number): number {
  if (len <= 0) return -1;
  if (i < 0) return 0;
  if (i > len - 1) return len - 1;
  return i;
}

/** Index of the newest frame at or before `nowSeconds`; 0 if all future; -1 if empty. */
export function defaultFrameIndex(
  frames: RadarFrame[],
  nowSeconds: number
): number {
  if (frames.length === 0) return -1;
  let best = -1;
  for (let i = 0; i < frames.length; i++) {
    if (
      frames[i].time <= nowSeconds &&
      (best === -1 || frames[i].time > frames[best].time)
    ) {
      best = i;
    }
  }
  return best === -1 ? 0 : best;
}

/** Signed, rounded minutes between a frame and `nowSeconds` (0 == now). */
export function frameOffsetMinutes(
  frame: RadarFrame,
  nowSeconds: number
): number {
  return Math.round((frame.time - nowSeconds) / 60);
}

/**
 * Index of the frame closest to `iso`. Falls back to `defaultFrameIndex`
 * when `iso` is null/empty/unparseable. -1 for an empty list.
 */
export function seekIndexForIso(
  frames: RadarFrame[],
  iso: string | null,
  nowSeconds: number
): number {
  if (frames.length === 0) return -1;
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return defaultFrameIndex(frames, nowSeconds);
  const target = ms / 1000;
  let best = 0;
  let bestDelta = Math.abs(frames[0].time - target);
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(frames[i].time - target);
    if (d < bestDelta) {
      best = i;
      bestDelta = d;
    }
  }
  return best;
}

/** Story 13.2 — the frame closest to `timeSec` when it is within
 *  `toleranceSec`; null otherwise (e.g. the radar archive only covers
 *  −2 h … +30 min while the satellite axis spans 24 h). */
export function nearestFrame(
  frames: readonly RadarFrame[],
  timeSec: number,
  toleranceSec: number
): RadarFrame | null {
  let best: RadarFrame | null = null;
  let bestDelta = Infinity;
  for (const f of frames) {
    const d = Math.abs(f.time - timeSec);
    if (d < bestDelta) {
      best = f;
      bestDelta = d;
    }
  }
  return best && bestDelta <= toleranceSec ? best : null;
}
