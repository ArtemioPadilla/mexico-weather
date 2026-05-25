/**
 * Map settings persisted in localStorage — wired to the ⚙ gear panel
 * on /mapa. Two-axis preference set: timezone display + hour format.
 *
 * Pure module: takes localStorage as a parameter so it's testable in
 * memory.
 */

export const SETTINGS_KEY = 'mw:settings';

export interface MapSettings {
  tz: 'local' | 'UTC';
  hourFormat: '12' | '24';
}

export const DEFAULT_SETTINGS: MapSettings = {
  tz: 'local',
  hourFormat: '24',
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Read + validate. Any failure or unknown value returns DEFAULT_SETTINGS. */
export function readSettings(
  storage: StorageLike = window.localStorage,
): MapSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MapSettings>;
    return {
      tz: parsed.tz === 'UTC' ? 'UTC' : 'local',
      hourFormat: parsed.hourFormat === '12' ? '12' : '24',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Best-effort persistence; localStorage failures are swallowed. */
export function writeSettings(
  s: MapSettings,
  storage: StorageLike = window.localStorage,
): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode or quota — ignore */
  }
}
