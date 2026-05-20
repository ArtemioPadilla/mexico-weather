import { describe, it, expect } from 'vitest';
import {
  viewportGrid,
  buildFieldUrl,
  parseFieldResponse,
  fieldFrameIndex,
  tempColor,
  TEMP_LEGEND,
} from './mapfields';

describe('viewportGrid', () => {
  it('returns cols*rows points spanning the bbox inclusively', () => {
    const pts = viewportGrid({ west: -100, south: 10, east: -98, north: 14 }, 3, 2);
    expect(pts).toHaveLength(6);
    expect(pts[0]).toEqual({ lng: -100, lat: 10 });
    expect(pts[pts.length - 1]).toEqual({ lng: -98, lat: 14 });
  });
  it('clamps degenerate sizes to at least 2x2', () => {
    expect(viewportGrid({ west: 0, south: 0, east: 1, north: 1 }, 1, 1)).toHaveLength(4);
  });
});

describe('buildFieldUrl', () => {
  it('builds a keyless Open-Meteo bulk URL with comma-joined coords', () => {
    const url = buildFieldUrl(
      [
        { lat: 10, lng: -100 },
        { lat: 12, lng: -99 },
      ],
      'temperature_2m',
    );
    expect(url).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=10,12&longitude=-100,-99' +
        '&hourly=temperature_2m&forecast_days=2&timezone=UTC',
    );
  });
});

describe('parseFieldResponse', () => {
  const pts = [
    { lat: 10, lng: -100 },
    { lat: 12, lng: -99 },
  ];
  const resp = [
    { hourly: { time: ['2026-05-19T00:00', '2026-05-19T01:00'], temperature_2m: [20, 21] } },
    { hourly: { time: ['2026-05-19T00:00', '2026-05-19T01:00'], temperature_2m: [18, 19] } },
  ];
  it('aligns each result to its input point by index', () => {
    const g = parseFieldResponse(resp, pts, 'temperature_2m');
    expect(g).not.toBeNull();
    expect(g!.times).toEqual(['2026-05-19T00:00', '2026-05-19T01:00']);
    expect(g!.points).toEqual([
      { lat: 10, lng: -100, values: [20, 21] },
      { lat: 12, lng: -99, values: [18, 19] },
    ]);
  });
  it('accepts a single-object response (Open-Meteo returns an object for one point)', () => {
    const g = parseFieldResponse(resp[0], [pts[0]], 'temperature_2m');
    expect(g!.points).toEqual([{ lat: 10, lng: -100, values: [20, 21] }]);
  });
  it('returns null for malformed input', () => {
    expect(parseFieldResponse(null, pts, 'temperature_2m')).toBeNull();
    expect(parseFieldResponse([{ hourly: {} }], [pts[0]], 'temperature_2m')).toBeNull();
  });
});

describe('fieldFrameIndex', () => {
  const times = ['2026-05-19T00:00', '2026-05-19T01:00', '2026-05-19T02:00'];
  it('picks the hourly step closest to the ISO', () => {
    expect(fieldFrameIndex(times, '2026-05-19T01:10:00Z', 0)).toBe(1);
  });
  it('falls back to the step nearest now when ISO is null/invalid', () => {
    const now = Date.parse('2026-05-19T02:00:00Z');
    expect(fieldFrameIndex(times, null, now)).toBe(2);
    expect(fieldFrameIndex(times, 'nope', now)).toBe(2);
  });
  it('returns -1 for an empty list', () => {
    expect(fieldFrameIndex([], null, 0)).toBe(-1);
  });
});

describe('tempColor', () => {
  it('maps cold→warm to distinct hex colors and clamps the ends', () => {
    expect(tempColor(-50)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tempColor(60)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tempColor(-50)).toBe(tempColor(-10));
    expect(tempColor(60)).toBe(tempColor(45));
    expect(tempColor(0)).not.toBe(tempColor(30));
  });
});

describe('TEMP_LEGEND', () => {
  it('is an ordered list of {label,color} stops with hex colors', () => {
    expect(TEMP_LEGEND.length).toBeGreaterThanOrEqual(4);
    for (const s of TEMP_LEGEND) {
      expect(typeof s.label).toBe('string');
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
