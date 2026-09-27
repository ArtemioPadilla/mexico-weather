/**
 * Map settings persisted in localStorage — wired to the ⚙ gear panel
 * on /mapa. Timezone display + hour format, and (Story 16.4) the
 * animation controls: loop window, playback speed, frame style and the
 * timeline label mode toggled with `J`.
 *
 * Pure module: takes localStorage as a parameter so it's testable in
 * memory. The record is additive — a stored object from an older build
 * (only tz / hourFormat) reads back with defaults for the new keys, and
 * any unknown value falls back to its default (see settings.test.ts).
 */

import {
  DEFAULT_UNITS,
  type DistanceUnit,
  type PressureUnit,
  type SpeedUnit,
  type TempUnit,
  type Units,
} from '../units';

export const SETTINGS_KEY = 'mw:settings';

export type LoopHours = 3 | 6 | 12 | 24;
export type PlaySpeed = 'slow' | 'medium' | 'fast';
export type PlayStyle = 'fast' | 'smooth';
export type TimeLabelMode = 'both' | 'clock' | 'relative';

export interface MapSettings {
  tz: 'local' | 'UTC';
  hourFormat: '12' | '24';
  /** Animation loop window: frames within ±N h of now (whole axis when
   *  fewer than two frames fall inside). */
  loopHours: LoopHours;
  playSpeed: PlaySpeed;
  /** `smooth` cross-fades raster tiles between frames (MapLibre
   *  raster-fade-duration); `fast` swaps instantly. */
  playStyle: PlayStyle;
  /** What the timeline pill shows: "07:00 · +2 h", the clock only or
   *  the relative offset only. */
  timeLabel: TimeLabelMode;
  /** Story 19.3 — display units; data stays metric underneath. */
  tempUnit: TempUnit;
  speedUnit: SpeedUnit;
  pressureUnit: PressureUnit;
  distanceUnit: DistanceUnit;
}

export const DEFAULT_SETTINGS: MapSettings = {
  tz: 'local',
  hourFormat: '24',
  loopHours: 24,
  playSpeed: 'medium',
  playStyle: 'smooth',
  timeLabel: 'both',
  tempUnit: DEFAULT_UNITS.temp,
  speedUnit: DEFAULT_UNITS.speed,
  pressureUnit: DEFAULT_UNITS.pressure,
  distanceUnit: DEFAULT_UNITS.distance,
};

export const TEMP_UNITS: readonly TempUnit[] = ['C', 'F'];
export const SPEED_UNITS: readonly SpeedUnit[] = ['kmh', 'mph', 'kt', 'ms'];
export const PRESSURE_UNITS: readonly PressureUnit[] = ['hPa', 'inHg'];
export const DISTANCE_UNITS: readonly DistanceUnit[] = ['km', 'mi'];

/** The display units a settings record resolves to. */
export function unitsOf(s: MapSettings): Units {
  return {
    temp: s.tempUnit,
    speed: s.speedUnit,
    pressure: s.pressureUnit,
    distance: s.distanceUnit,
  };
}

export const LOOP_HOURS: readonly LoopHours[] = [3, 6, 12, 24];
export const PLAY_SPEEDS: readonly PlaySpeed[] = ['slow', 'medium', 'fast'];
export const PLAY_STYLES: readonly PlayStyle[] = ['fast', 'smooth'];
export const TIME_LABEL_MODES: readonly TimeLabelMode[] = [
  'both',
  'clock',
  'relative',
];

/** Frame cadence per speed, in ms (medium is the historical 700 ms). */
export const PLAY_INTERVAL_MS: Record<PlaySpeed, number> = {
  slow: 1200,
  medium: 700,
  fast: 350,
};

/** MapLibre raster-fade-duration per style, in ms. */
export const RASTER_FADE_MS: Record<PlayStyle, number> = {
  fast: 0,
  smooth: 300,
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function pick<T>(list: readonly T[], v: unknown, fallback: T): T {
  return (list as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

/** Validate a partial/unknown record into a full MapSettings. */
export function normalizeSettings(parsed: unknown): MapSettings {
  const p = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<
    Record<keyof MapSettings, unknown>
  >;
  return {
    tz: p.tz === 'UTC' ? 'UTC' : 'local',
    hourFormat: p.hourFormat === '12' ? '12' : '24',
    loopHours: pick(
      LOOP_HOURS,
      Number(p.loopHours),
      DEFAULT_SETTINGS.loopHours
    ),
    playSpeed: pick(PLAY_SPEEDS, p.playSpeed, DEFAULT_SETTINGS.playSpeed),
    playStyle: pick(PLAY_STYLES, p.playStyle, DEFAULT_SETTINGS.playStyle),
    timeLabel: pick(TIME_LABEL_MODES, p.timeLabel, DEFAULT_SETTINGS.timeLabel),
    tempUnit: pick(TEMP_UNITS, p.tempUnit, DEFAULT_SETTINGS.tempUnit),
    speedUnit: pick(SPEED_UNITS, p.speedUnit, DEFAULT_SETTINGS.speedUnit),
    pressureUnit: pick(
      PRESSURE_UNITS,
      p.pressureUnit,
      DEFAULT_SETTINGS.pressureUnit
    ),
    distanceUnit: pick(
      DISTANCE_UNITS,
      p.distanceUnit,
      DEFAULT_SETTINGS.distanceUnit
    ),
  };
}

/** Read + validate. Any failure or unknown value returns the defaults. */
export function readSettings(
  storage: StorageLike = window.localStorage
): MapSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Best-effort persistence; localStorage failures are swallowed. */
export function writeSettings(
  s: MapSettings,
  storage: StorageLike = window.localStorage
): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode or quota — ignore */
  }
}

/** Next label mode in the `J` cycle: both → clock → relative → both. */
export function nextTimeLabelMode(m: TimeLabelMode): TimeLabelMode {
  const i = TIME_LABEL_MODES.indexOf(m);
  return TIME_LABEL_MODES[(i + 1) % TIME_LABEL_MODES.length];
}

/**
 * Index range [start, end] (inclusive) of the frames the play loop
 * should cycle through: those within ±loopHours of `nowSec`. Falls
 * back to the whole axis when fewer than two frames qualify (radar's
 * 2.5 h axis with a 3 h loop, a daily satellite axis, …).
 */
export function loopRange(
  times: readonly number[],
  loopHours: number,
  nowSec: number
): [number, number] {
  const n = times.length;
  if (n === 0) return [0, -1];
  const span = loopHours * 3600;
  let start = -1;
  let end = -1;
  for (let i = 0; i < n; i++) {
    const d = times[i] - nowSec;
    if (d >= -span && d <= span) {
      if (start === -1) start = i;
      end = i;
    }
  }
  if (start === -1 || end - start < 1) return [0, n - 1];
  return [start, end];
}
