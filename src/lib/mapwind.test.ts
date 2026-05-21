import { describe, it, expect } from 'vitest';
import {
  MAX_WIND_MPS,
  windUv,
  windSpeed,
  windSpeedColor,
  WIND_LEGEND,
  encodeWindGrid,
  initParticlePositions,
} from './mapwind';

describe('windUv', () => {
  it('decomposes speed + direction into u (east) and v (north) m/s', () => {
    const { u, v } = windUv(10, 0);
    expect(u).toBeCloseTo(0, 5);
    expect(v).toBeCloseTo(-10, 5);
    const e = windUv(10, 90);
    expect(e.u).toBeCloseTo(-10, 5);
    expect(e.v).toBeCloseTo(0, 5);
  });
});

describe('windSpeed', () => {
  it('is sqrt(u^2 + v^2)', () => {
    expect(windSpeed(3, 4)).toBeCloseTo(5, 5);
    expect(windSpeed(0, 0)).toBe(0);
  });
});

describe('windSpeedColor + WIND_LEGEND', () => {
  it('maps speed to a hex colour on a calm→gale ramp; clamped', () => {
    expect(windSpeedColor(-1)).toBe(windSpeedColor(0));
    expect(windSpeedColor(999)).toBe(windSpeedColor(MAX_WIND_MPS));
    expect(windSpeedColor(0)).not.toBe(windSpeedColor(MAX_WIND_MPS));
    expect(windSpeedColor(5)).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('WIND_LEGEND has >= 4 ordered {labelKey,color} stops with hex colours', () => {
    expect(WIND_LEGEND.length).toBeGreaterThanOrEqual(4);
    for (const s of WIND_LEGEND) {
      expect(typeof s.labelKey).toBe('string');
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('encodeWindGrid', () => {
  it('packs cols*rows points into an RGBA byte buffer with u in R, v in G, mask in A', () => {
    const points = [
      { lat: 10, lng: -100, u: 0, v: 0 },
      { lat: 10, lng: -99, u: MAX_WIND_MPS, v: 0 },
      { lat: 11, lng: -100, u: 0, v: -MAX_WIND_MPS },
      { lat: 11, lng: -99, u: null, v: null },
    ];
    const out = encodeWindGrid(points, 2, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data).toBeInstanceOf(Uint8Array);
    expect(out.data.length).toBe(2 * 2 * 4);
    expect(out.data[0]).toBe(128);
    expect(out.data[1]).toBe(128);
    expect(out.data[3]).toBe(255);
    expect(out.data[4]).toBe(255);
    expect(out.data[5]).toBe(128);
    expect(out.data[7]).toBe(255);
    expect(out.data[8]).toBe(128);
    expect(out.data[9]).toBe(0);
    expect(out.data[11]).toBe(255);
    expect(out.data[15]).toBe(0);
  });
});

describe('initParticlePositions', () => {
  it('returns Float32Array of length N*4 with x,y in [0,1] and age slot reset', () => {
    const buf = initParticlePositions(8, 7);
    expect(buf).toBeInstanceOf(Float32Array);
    expect(buf.length).toBe(32);
    for (let i = 0; i < 8; i++) {
      expect(buf[i * 4 + 0]).toBeGreaterThanOrEqual(0);
      expect(buf[i * 4 + 0]).toBeLessThanOrEqual(1);
      expect(buf[i * 4 + 1]).toBeGreaterThanOrEqual(0);
      expect(buf[i * 4 + 1]).toBeLessThanOrEqual(1);
      expect(buf[i * 4 + 2]).toBe(0);
      expect(buf[i * 4 + 3]).toBe(0);
    }
  });
  it('is deterministic for a given seed', () => {
    const a = initParticlePositions(16, 42);
    const b = initParticlePositions(16, 42);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
