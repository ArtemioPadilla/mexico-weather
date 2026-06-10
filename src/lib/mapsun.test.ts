import { describe, it, expect } from 'vitest';
import { solarPosition, terminatorPolygon } from './mapsun';

describe('solarPosition', () => {
  it('is on the equator near the equinoxes', () => {
    const eq = solarPosition(Date.UTC(2026, 2, 20, 17, 0, 0));
    expect(Math.abs(eq.lat)).toBeLessThan(1);
  });
  it('is in the northern hemisphere around the june solstice', () => {
    const jun = solarPosition(Date.UTC(2026, 5, 21, 12, 0, 0));
    expect(jun.lat).toBeGreaterThan(22);
    expect(jun.lat).toBeLessThan(24);
  });
  it('is in the southern hemisphere around the december solstice', () => {
    const dec = solarPosition(Date.UTC(2026, 11, 21, 12, 0, 0));
    expect(dec.lat).toBeLessThan(-22);
    expect(dec.lat).toBeGreaterThan(-24);
  });
  it('subsolar longitude tracks UTC noon ≈ 0°, midnight ≈ ±180°', () => {
    const noon = solarPosition(Date.UTC(2026, 2, 20, 12, 0, 0));
    expect(Math.abs(noon.lng)).toBeLessThan(5);
    const midnight = solarPosition(Date.UTC(2026, 2, 20, 0, 0, 0));
    expect(Math.abs(midnight.lng)).toBeGreaterThan(175);
  });
});

describe('terminatorPolygon', () => {
  it('returns a closed Polygon with samples+2 ring vertices around the night side', () => {
    const poly = terminatorPolygon(Date.UTC(2026, 5, 21, 12, 0, 0), 120);
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates).toHaveLength(1);
    const ring = poly.coordinates[0];
    expect(ring.length).toBe(120 + 2 + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring) {
      expect(lat).toBeGreaterThanOrEqual(-90.001);
      expect(lat).toBeLessThanOrEqual(90.001);
      expect(lng).toBeGreaterThanOrEqual(-180.001);
      expect(lng).toBeLessThanOrEqual(180.001);
    }
  });
  it('closes the ring through the pole opposite the subsolar hemisphere, south at the equinox edge', () => {
    const capLats = (ms: number): [number, number] => {
      const ring = terminatorPolygon(ms, 60).coordinates[0];
      // The two cap vertices follow the 60 sampled terminator points.
      return [ring[60][1], ring[61][1]];
    };
    // June solstice: sun north → cap at the south pole.
    expect(capLats(Date.UTC(2026, 5, 21, 12, 0, 0))).toEqual([-90, -90]);
    // December solstice: sun south → cap at the north pole.
    expect(capLats(Date.UTC(2026, 11, 21, 12, 0, 0))).toEqual([90, 90]);
    // Equinox edge: sun.lat ≈ 0 — cap must stay deterministic and match
    // the sun.lat >= 0 ? -90 : 90 convention (south pole when sun.lat is 0).
    const eqMs = Date.UTC(2026, 2, 20, 17, 0, 0);
    const expected = solarPosition(eqMs).lat >= 0 ? -90 : 90;
    expect(capLats(eqMs)).toEqual([expected, expected]);
  });
  it('returns a polygon for arbitrary distanceDeg used by the soft-terminator gradient', () => {
    const ts = Date.UTC(2026, 5, 21, 12, 0, 0);
    const inner = terminatorPolygon(ts, 60, 91.5);
    const mid = terminatorPolygon(ts, 60, 90);
    const outer = terminatorPolygon(ts, 60, 88.5);
    for (const poly of [inner, mid, outer]) {
      expect(poly.type).toBe('Polygon');
      const ring = poly.coordinates[0];
      expect(ring.length).toBe(60 + 2 + 1);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const [lng, lat] of ring) {
        expect(Number.isFinite(lng)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
        expect(lat).toBeGreaterThanOrEqual(-90.001);
        expect(lat).toBeLessThanOrEqual(90.001);
      }
    }
  });
});
