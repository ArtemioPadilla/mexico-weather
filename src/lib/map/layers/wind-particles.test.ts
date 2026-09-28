import { describe, expect, it } from 'vitest';
import {
  MAX_WIND_MPS,
  WIND_LEGEND,
  WIND_SPEED_STOPS,
  initParticlePositions,
  windSpeedColor,
} from '../../mapwind';
import { hexToRgba, mercatorY } from '../../mapraster';
import type { WindGrid } from '../../mapfields';
import { viewportGrid } from '../../mapfields';
import {
  WIND_ARROW_SIZE,
  WIND_DENSITY_STOPS,
  WIND_LUT_SIZE,
  WIND_PARTICLE_MAX,
  WIND_PARTICLE_MIN,
  WIND_TRAIL_FADE,
  WIND_TRAIL_MAX_DPR,
  WIND_TRAIL_MAX_PIXELS,
  WIND_TRAIL_WIDTH,
  packParticlePositions,
  screenFractionToLngLat,
  screenMercator,
  trailFade,
  trailTextureSize,
  unpackParticlePosition,
  windArrowCollection,
  windArrowScale,
  windArrowSdf,
  windBearing,
  windColorLut,
  windDropRate,
  windGridBounds,
  windGridTexCoord,
  windLutSpeed,
  windParticleAlpha,
  windParticleCount,
  windParticleDensity,
  windScreenBasis,
  windTrailWidth,
} from './wind-particles';

/** 8×6 grid over `b`, every point blowing (u, v) at hour 0. */
function grid(
  b = { west: -110, south: 15, east: -90, north: 30 },
  uv: (i: number) => [number | null, number | null] = () => [3, 4]
): WindGrid {
  const pts = viewportGrid(b, 8, 6);
  return {
    times: ['2026-09-28T00:00'],
    points: pts.map((p, i) => {
      const [u, v] = uv(i);
      return { lat: p.lat, lng: p.lng, u: [u], v: [v] };
    }),
  };
}

describe('density by zoom', () => {
  it('follows the stops, linear in between and clamped outside', () => {
    const [first] = WIND_DENSITY_STOPS;
    const last = WIND_DENSITY_STOPS[WIND_DENSITY_STOPS.length - 1];
    expect(windParticleDensity(0)).toBe(first[1]);
    expect(windParticleDensity(first[0])).toBe(first[1]);
    expect(windParticleDensity(22)).toBe(last[1]);
    expect(windParticleDensity(NaN)).toBe(first[1]);
    const [a, b] = WIND_DENSITY_STOPS;
    expect(windParticleDensity((a[0] + b[0]) / 2)).toBeCloseTo(
      (a[1] + b[1]) / 2
    );
  });

  it('never grows as you zoom in', () => {
    let prev = Infinity;
    for (let z = 0; z <= 14; z += 0.25) {
      const d = windParticleDensity(z);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
    expect(windParticleDensity(9)).toBeLessThan(windParticleDensity(3));
  });

  it('scales the count with the map area and clamps it', () => {
    const desk = windParticleCount(5, 1280, 800);
    const phone = windParticleCount(5, 360, 640);
    expect(desk).toBe(Math.round((windParticleDensity(5) * 1280 * 800) / 1e5));
    expect(phone).toBeLessThan(desk);
    expect(phone / desk).toBeCloseTo((360 * 640) / (1280 * 800), 2);
    // Closer in, fewer particles on the same screen.
    expect(windParticleCount(8, 1280, 800)).toBeLessThan(desk);
    expect(windParticleCount(3, 10_000, 10_000)).toBe(WIND_PARTICLE_MAX);
    expect(windParticleCount(12, 50, 50)).toBe(WIND_PARTICLE_MIN);
    expect(windParticleCount(3, 0, 0)).toBe(WIND_PARTICLE_MIN);
    expect(windParticleCount(3, 4000, 4000, 1000)).toBe(1000);
  });
});

describe('trails', () => {
  it('fades by WIND_TRAIL_FADE per 60 Hz frame, independent of the frame rate', () => {
    expect(trailFade(1000 / 60)).toBeCloseTo(WIND_TRAIL_FADE, 10);
    expect(trailFade(1000 / 30)).toBeCloseTo(WIND_TRAIL_FADE ** 2, 10);
    // Two 30 Hz frames keep what four 60 Hz ones do.
    expect(trailFade(1000 / 30) ** 2).toBeCloseTo(
      trailFade(1000 / 60) ** 4,
      10
    );
    expect(trailFade(0)).toBe(1);
  });

  it('caps a stall so a background tab does not wipe the trails', () => {
    expect(trailFade(5000)).toBe(trailFade(100));
    expect(trailFade(-10)).toBe(1);
    expect(trailFade(NaN)).toBe(1);
  });

  it('re-seeds more often in a gale and after a longer frame', () => {
    expect(windDropRate(1000 / 60, MAX_WIND_MPS)).toBeGreaterThan(
      windDropRate(1000 / 60, 0)
    );
    expect(windDropRate(1000 / 30, 5)).toBeGreaterThan(
      windDropRate(1000 / 60, 5)
    );
    expect(windDropRate(0, 10)).toBe(0);
  });

  it('sizes the trail texture to the device, capped in dpr and texels', () => {
    expect(trailTextureSize(1280, 800, 1)).toEqual({
      width: 1280,
      height: 800,
    });
    expect(trailTextureSize(360, 640, 3)).toEqual({
      width: 360 * WIND_TRAIL_MAX_DPR,
      height: 640 * WIND_TRAIL_MAX_DPR,
    });
    const big = trailTextureSize(3840, 2160, 2);
    expect(big.width * big.height).toBeLessThanOrEqual(WIND_TRAIL_MAX_PIXELS);
    expect(big.width / big.height).toBeCloseTo(3840 / 2160, 2);
    expect(trailTextureSize(0, 0, NaN)).toEqual({ width: 1, height: 1 });
  });
});

describe('colour by speed', () => {
  const lut = windColorLut();

  it('paints every LUT texel in the legend bar colour of its speed', () => {
    expect(lut.length).toBe(WIND_LUT_SIZE * 4);
    for (let i = 0; i < WIND_LUT_SIZE; i++) {
      const [r, g, b] = hexToRgba(windSpeedColor(windLutSpeed(i)));
      expect([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]).toEqual([r, g, b]);
    }
  });

  it('uses every band of the legend ramp, calm first and gale last', () => {
    const seen: string[] = [];
    for (let i = 0; i < WIND_LUT_SIZE; i++) {
      const hex = windSpeedColor(windLutSpeed(i));
      if (seen[seen.length - 1] !== hex) seen.push(hex);
    }
    // One run per band below the cap (the last stop is the clamp colour).
    expect(seen).toEqual(WIND_SPEED_STOPS.slice(0, -1).map(([, c]) => c));
    // The four named WIND_LEGEND classes sit on that ramp, in order.
    const idx = WIND_LEGEND.map((l) =>
      WIND_SPEED_STOPS.findIndex(([, c]) => c === l.color)
    );
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(windSpeedColor(0)).toBe(WIND_LEGEND[0].color);
    expect(windSpeedColor(MAX_WIND_MPS)).toBe(
      WIND_LEGEND[WIND_LEGEND.length - 1].color
    );
  });

  it('makes a calm faint and thin and a gale solid and wide', () => {
    expect(windParticleAlpha(0)).toBeCloseTo(0.45);
    expect(windParticleAlpha(30)).toBe(1);
    let prev = 0;
    for (let s = 0; s <= MAX_WIND_MPS; s += 0.5) {
      const a = windParticleAlpha(s);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(lut[3]).toBeLessThan(lut[(WIND_LUT_SIZE - 1) * 4 + 3]);
    expect(windTrailWidth(0)).toBe(WIND_TRAIL_WIDTH[0]);
    expect(windTrailWidth(100)).toBe(WIND_TRAIL_WIDTH[1]);
    expect(windTrailWidth(10)).toBeGreaterThan(windTrailWidth(2));
  });
});

describe('particle state packing', () => {
  it('round-trips positions to 16-bit precision', () => {
    const n = 500;
    const pos = initParticlePositions(n, 7);
    const bytes = packParticlePositions(pos, n);
    for (let i = 0; i < n; i++) {
      const [x, y] = unpackParticlePosition(bytes, i);
      expect(Math.abs(x - pos[i * 4])).toBeLessThan(1 / 255 / 255 + 1e-9);
      expect(Math.abs(y - pos[i * 4 + 1])).toBeLessThan(1 / 255 / 255 + 1e-9);
    }
  });

  it('keeps the edges and clamps out-of-range input', () => {
    const pos = new Float32Array([0, 1, 0, 0, -3, 7, 0, 0]);
    const bytes = packParticlePositions(pos, 2);
    expect(unpackParticlePosition(bytes, 0)).toEqual([0, 1]);
    expect(unpackParticlePosition(bytes, 1)).toEqual([0, 1]);
  });
});

describe('grid lookup (what the shaders sample)', () => {
  const b = windGridBounds(grid())!;

  it('reads the extent and shape from the grid points', () => {
    expect(b).toEqual({
      west: -110,
      south: 15,
      east: -90,
      north: 30,
      cols: 8,
      rows: 6,
    });
    expect(windGridBounds(null)).toBeNull();
    expect(windGridBounds({ times: [], points: [] })).toBeNull();
  });

  it('puts grid points on texel centres, row 0 at the south edge', () => {
    expect(windGridTexCoord(-110, 15, b)).toEqual([0.5 / 8, 0.5 / 6]);
    expect(windGridTexCoord(-90, 30, b)).toEqual([7.5 / 8, 5.5 / 6]);
    // The point in column 3, row 2 of the grid, and its texel centre.
    const g = grid();
    const p = g.points[2 * 8 + 3];
    const [s, t] = windGridTexCoord(p.lng, p.lat, b)!;
    expect(s).toBeCloseTo(3.5 / 8, 3);
    expect(t).toBeCloseTo(2.5 / 6, 3);
    expect(windGridTexCoord(-111, 20, b)).toBeNull();
    expect(windGridTexCoord(-100, 31, b)).toBeNull();
  });

  it('maps a screen fraction to lng/lat through the corners in Mercator', () => {
    const corners = screenMercator(
      { lng: -120, lat: 35 },
      { lng: -80, lat: 35 },
      { lng: -120, lat: 5 }
    );
    const [lng0, lat0] = screenFractionToLngLat(0, 0, corners);
    expect(lng0).toBeCloseTo(-120, 6);
    expect(lat0).toBeCloseTo(35, 6);
    const [lng1, lat1] = screenFractionToLngLat(1, 1, corners);
    expect(lng1).toBeCloseTo(-80, 6);
    expect(lat1).toBeCloseTo(5, 6);
    // Half way down the screen is half way in Mercator, not in latitude.
    const [, latMid] = screenFractionToLngLat(0.5, 0.5, corners);
    expect(mercatorY(latMid)).toBeCloseTo(
      (mercatorY(35) + mercatorY(5)) / 2,
      9
    );
    expect(latMid).not.toBeCloseTo(20, 1);
  });

  it('turns east and north with the map bearing', () => {
    const up = windScreenBasis(0);
    expect(up.east[0]).toBeCloseTo(1);
    expect(up.east[1]).toBeCloseTo(0);
    expect(up.north[0]).toBeCloseTo(0);
    expect(up.north[1]).toBeCloseTo(-1); // y grows downwards
    const east = windScreenBasis(90); // the top of the screen faces east
    expect(east.east[0]).toBeCloseTo(0);
    expect(east.east[1]).toBeCloseTo(-1);
    expect(east.north[0]).toBeCloseTo(-1);
    expect(east.north[1]).toBeCloseTo(0);
  });
});

describe('reduced motion: static arrows', () => {
  it('points each arrow where the wind blows to', () => {
    expect(windBearing(0, 5)).toBeCloseTo(0); // southerly wind → north
    expect(windBearing(5, 0)).toBeCloseTo(90);
    expect(windBearing(0, -5)).toBeCloseTo(180);
    expect(windBearing(-5, 0)).toBeCloseTo(270);
  });

  it('one arrow per point with data, coloured and sized by speed', () => {
    const g = grid(undefined, (i) =>
      i === 0 ? [null, null] : i === 1 ? [0, 30] : [3, 4]
    );
    const fc = windArrowCollection(g, 0);
    expect(fc.features).toHaveLength(47);
    const [gale, calm] = fc.features;
    expect(gale.properties).toMatchObject({
      color: windSpeedColor(30),
      bearing: 0,
      speed: 30,
    });
    expect(calm.properties).toMatchObject({
      color: windSpeedColor(5),
      bearing: 37,
      speed: 5,
    });
    expect(gale.geometry).toEqual({
      type: 'Point',
      coordinates: [g.points[1].lng, g.points[1].lat],
    });
    expect(windArrowScale(30)).toBeGreaterThan(windArrowScale(5));
    expect(windArrowScale(0)).toBeCloseTo(0.6);
    expect(windArrowScale(99)).toBeCloseTo(1.2);
  });

  it('draws the arrow as an SDF (0.75 on the outline, solid inside)', () => {
    const img = windArrowSdf();
    expect(img.width).toBe(WIND_ARROW_SIZE);
    expect(img.height).toBe(WIND_ARROW_SIZE);
    expect(img.data).toHaveLength(WIND_ARROW_SIZE * WIND_ARROW_SIZE * 4);
    const alpha = (x: number, y: number): number =>
      img.data[(y * WIND_ARROW_SIZE + x) * 4 + 3] / 255;
    expect(alpha(24, 30)).toBeGreaterThan(0.75); // shaft
    expect(alpha(24, 12)).toBeGreaterThan(0.75); // head
    expect(alpha(2, 2)).toBe(0); // corner
    expect(alpha(8, 40)).toBeLessThan(0.75); // beside the shaft
    // Pointing up: the head is wider than the shaft.
    const inside = (y: number): number => {
      let n = 0;
      for (let x = 0; x < WIND_ARROW_SIZE; x++) if (alpha(x, y) > 0.75) n++;
      return n;
    };
    expect(inside(20)).toBeGreaterThan(inside(35));
  });
});
