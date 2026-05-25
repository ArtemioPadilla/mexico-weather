import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  readSettings,
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
    writeSettings({ tz: 'UTC', hourFormat: '12' }, s);
    expect(readSettings(s)).toEqual({ tz: 'UTC', hourFormat: '12' });
  });
});
