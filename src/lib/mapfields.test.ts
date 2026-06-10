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

import { humidityColor, pressureColor, HUMIDITY_LEGEND, PRESSURE_LEGEND } from './mapfields';

describe('parseFieldResponse null tolerance', () => {
  const pts = [
    { lat: 10, lng: -100 },
    { lat: 12, lng: -99 },
  ];
  it('keeps a result when its values array contains nulls (does not return null for the whole grid)', () => {
    const resp = [
      { hourly: { time: ['2026-05-19T00:00', '2026-05-19T01:00'], temperature_2m: [20, null] } },
      { hourly: { time: ['2026-05-19T00:00', '2026-05-19T01:00'], temperature_2m: [null, 19] } },
    ];
    const g = parseFieldResponse(resp, pts, 'temperature_2m');
    expect(g).not.toBeNull();
    expect(g!.points[0].values).toEqual([20, null]);
    expect(g!.points[1].values).toEqual([null, 19]);
  });
  it('still rejects when values is not an array at all', () => {
    const bad = [{ hourly: { time: ['2026-05-19T00:00'], temperature_2m: 'oops' } }];
    expect(parseFieldResponse(bad, [pts[0]], 'temperature_2m')).toBeNull();
  });
});

describe('humidityColor', () => {
  it('maps 0..100% to distinct hex colors and clamps the ends', () => {
    expect(humidityColor(-10)).toBe(humidityColor(0));
    expect(humidityColor(120)).toBe(humidityColor(100));
    expect(humidityColor(20)).not.toBe(humidityColor(80));
    for (const v of [0, 20, 40, 60, 80, 100]) {
      expect(humidityColor(v)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('pressureColor', () => {
  it('maps ~970..1040 hPa to distinct hex colors and clamps the ends', () => {
    expect(pressureColor(950)).toBe(pressureColor(970));
    expect(pressureColor(1100)).toBe(pressureColor(1040));
    expect(pressureColor(990)).not.toBe(pressureColor(1030));
    for (const v of [970, 990, 1010, 1020, 1040]) {
      expect(pressureColor(v)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('HUMIDITY_LEGEND / PRESSURE_LEGEND', () => {
  it('each is an ordered list of {label,color} stops with hex colors', () => {
    for (const L of [HUMIDITY_LEGEND, PRESSURE_LEGEND]) {
      expect(L.length).toBeGreaterThanOrEqual(4);
      for (const s of L) {
        expect(typeof s.label).toBe('string');
        expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

import { buildWindUrl, parseWindResponse } from './mapfields';

describe('buildWindUrl', () => {
  it('builds an Open-Meteo bulk URL requesting wind_speed_10m + wind_direction_10m', () => {
    const url = buildWindUrl([
      { lat: 10, lng: -100 },
      { lat: 12, lng: -99 },
    ]);
    expect(url).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=10,12&longitude=-100,-99' +
        '&hourly=wind_speed_10m,wind_direction_10m&forecast_days=2&timezone=UTC',
    );
  });
});

import { fetchFieldChunks, fetchWindChunks, FIELD_CHUNK_SIZE } from './mapfields';

describe('fetchFieldChunks / fetchWindChunks', () => {
  /** points spanning 2 chunks (FIELD_CHUNK_SIZE + 1). */
  const manyPoints = Array.from({ length: FIELD_CHUNK_SIZE + 1 }, (_, i) => ({
    lat: 10 + i * 0.01,
    lng: -100,
  }));
  const okJson = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200 });

  it('fetches chunks in parallel and merges responses in input order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: (() => void)[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => resolvers.push(r));
      inFlight -= 1;
      // Tag each chunk response by its point count so ordering is checkable.
      const n = String(url).match(/latitude=([^&]*)/)![1].split(',').length;
      return okJson(Array.from({ length: n }, (_, i) => ({ chunkSize: n, i })));
    }) as unknown as typeof fetch;
    const p = fetchFieldChunks(manyPoints, 'temperature_2m', fetchImpl);
    // Both chunk requests must be in flight before any resolve (parallel).
    await Promise.resolve();
    expect(resolvers.length).toBe(2);
    // Resolve out of order; merged output must still follow input order.
    resolvers[1]();
    resolvers[0]();
    const out = (await p) as { chunkSize: number }[];
    expect(maxInFlight).toBe(2);
    expect(out).toHaveLength(FIELD_CHUNK_SIZE + 1);
    expect(out[0].chunkSize).toBe(FIELD_CHUNK_SIZE);
    expect(out[out.length - 1].chunkSize).toBe(1);
  });

  it('throws an Error carrying the HTTP status when a chunk fails', async () => {
    const fetchImpl = (async () =>
      new Response('boom', { status: 503 })) as unknown as typeof fetch;
    await expect(
      fetchFieldChunks(manyPoints.slice(0, 2), 'temperature_2m', fetchImpl),
    ).rejects.toThrow('field chunk 0 failed: HTTP 503');
    await expect(
      fetchWindChunks(manyPoints.slice(0, 2), 'wind_speed_10m', fetchImpl),
    ).rejects.toThrow('wind chunk 0 failed: HTTP 503');
  });

  it('rejects with AbortError without fetching when the signal is already aborted', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return okJson([]);
    }) as unknown as typeof fetch;
    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchFieldChunks(manyPoints, 'temperature_2m', fetchImpl, {
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      fetchWindChunks(manyPoints, 'wind_speed_10m', fetchImpl, {
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
  });
});

describe('parseWindResponse', () => {
  const pts = [
    { lat: 10, lng: -100 },
    { lat: 12, lng: -99 },
  ];
  const resp = [
    {
      hourly: {
        time: ['2026-05-19T00:00', '2026-05-19T01:00'],
        wind_speed_10m: [10, 5],
        wind_direction_10m: [0, 90],
      },
    },
    {
      hourly: {
        time: ['2026-05-19T00:00', '2026-05-19T01:00'],
        wind_speed_10m: [null, 8],
        wind_direction_10m: [null, 180],
      },
    },
  ];
  it('decomposes speed+direction into u/v per point per hour, preserving nulls', () => {
    const g = parseWindResponse(resp, pts);
    expect(g).not.toBeNull();
    expect(g!.times).toEqual(['2026-05-19T00:00', '2026-05-19T01:00']);
    expect(g!.points[0].u[0]).toBeCloseTo(0, 5);
    expect(g!.points[0].v[0]).toBeCloseTo(-10, 5);
    expect(g!.points[0].u[1]).toBeCloseTo(-5, 5);
    expect(g!.points[0].v[1]).toBeCloseTo(0, 5);
    expect(g!.points[1].u[0]).toBeNull();
    expect(g!.points[1].v[0]).toBeNull();
    expect(g!.points[1].u[1]).toBeCloseTo(0, 5);
    expect(g!.points[1].v[1]).toBeCloseTo(8, 5);
  });
  it('returns null for malformed input', () => {
    expect(parseWindResponse(null, pts)).toBeNull();
    expect(parseWindResponse([{ hourly: {} }, { hourly: {} }], pts)).toBeNull();
  });
});
