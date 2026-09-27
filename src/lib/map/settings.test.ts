import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loopRange,
  nextTimeLabelMode,
  normalizeSettings,
  readSettings,
  unitsOf,
  writeSettings,
} from './settings';

function mkStore(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
} {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

describe('settings', () => {
  it('readSettings returns defaults when storage is empty', () => {
    expect(readSettings(mkStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('readSettings normalises unknown values', () => {
    const s = mkStore();
    s.setItem(SETTINGS_KEY, JSON.stringify({ tz: 'PST', hourFormat: '36' }));
    expect(readSettings(s)).toEqual(DEFAULT_SETTINGS);
  });

  it('readSettings tolerates corrupt JSON', () => {
    const s = mkStore();
    s.setItem(SETTINGS_KEY, '{not json');
    expect(readSettings(s)).toEqual(DEFAULT_SETTINGS);
  });

  it('writeSettings + readSettings roundtrips', () => {
    const s = mkStore();
    const full = {
      ...DEFAULT_SETTINGS,
      tz: 'UTC' as const,
      hourFormat: '12' as const,
      loopHours: 6 as const,
      playSpeed: 'fast' as const,
      playStyle: 'fast' as const,
      timeLabel: 'clock' as const,
    };
    writeSettings(full, s);
    expect(readSettings(s)).toEqual(full);
  });

  // Story 16.4 — animation controls.
  it('migrates a pre-16.4 record: old keys kept, new keys default', () => {
    const s = mkStore();
    s.setItem(SETTINGS_KEY, JSON.stringify({ tz: 'UTC', hourFormat: '12' }));
    expect(readSettings(s)).toEqual({
      ...DEFAULT_SETTINGS,
      tz: 'UTC',
      hourFormat: '12',
    });
  });

  it('normalizeSettings rejects unknown animation values one by one', () => {
    expect(
      normalizeSettings({
        loopHours: 5,
        playSpeed: 'ludicrous',
        playStyle: 'crossfade',
        timeLabel: 'none',
      })
    ).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ loopHours: '12' }).loopHours).toBe(12);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  // Story 19.3 — units.
  it('unit settings validate per key and resolve to a Units record', () => {
    expect(
      normalizeSettings({
        tempUnit: 'F',
        speedUnit: 'kt',
        pressureUnit: 'inHg',
        distanceUnit: 'mi',
      })
    ).toMatchObject({
      tempUnit: 'F',
      speedUnit: 'kt',
      pressureUnit: 'inHg',
      distanceUnit: 'mi',
    });
    expect(
      normalizeSettings({ tempUnit: 'K', speedUnit: 'furlongs' })
    ).toMatchObject({
      tempUnit: 'C',
      speedUnit: 'kmh',
    });
    expect(unitsOf(DEFAULT_SETTINGS)).toEqual({
      temp: 'C',
      speed: 'kmh',
      pressure: 'hPa',
      distance: 'km',
    });
  });

  it('nextTimeLabelMode cycles both → clock → relative → both', () => {
    expect(nextTimeLabelMode('both')).toBe('clock');
    expect(nextTimeLabelMode('clock')).toBe('relative');
    expect(nextTimeLabelMode('relative')).toBe('both');
  });

  it('loopRange keeps frames within ±N h of now, whole axis otherwise', () => {
    const now = 1_000_000;
    // Hourly axis from −24 h to +48 h.
    const times = Array.from({ length: 73 }, (_, i) => now + (i - 24) * 3600);
    expect(loopRange(times, 6, now)).toEqual([18, 30]);
    expect(loopRange(times, 24, now)).toEqual([0, 48]);
    // Radar-like 2.5 h axis: 3 h loop covers it all.
    const radar = Array.from({ length: 16 }, (_, i) => now + (i - 12) * 600);
    expect(loopRange(radar, 3, now)).toEqual([0, 15]);
    // Daily axis (one frame per day): fewer than two inside → whole axis.
    const daily = Array.from(
      { length: 10 },
      (_, i) => now - i * 86400
    ).reverse();
    expect(loopRange(daily, 3, now)).toEqual([0, 9]);
    expect(loopRange([], 3, now)).toEqual([0, -1]);
  });
});
