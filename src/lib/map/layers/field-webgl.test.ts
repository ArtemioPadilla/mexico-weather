// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  FIELD_GL_LAYER_ID,
  FIELD_LUT_SIZE,
  buildRampLut,
  createFieldGlLayer,
  fieldPixelReference,
  fieldRendererFlag,
  fieldValueDomain,
  isWebGL2,
  lutIndex,
  packFieldFrame,
  pickFieldRenderer,
  type FieldGeometry,
} from './field-webgl';
import {
  bicubicValue,
  fillFieldImageData,
  hexToRgba,
  latFromMercatorY,
  mercatorY,
  rowLatitude,
} from '../../mapraster';
import {
  type FieldGrid,
  humidityColor,
  precipColor,
  pressureColor,
  tempColor,
  viewportGrid,
} from '../../mapfields';

// The production layout: 32×24 over the fixed MX field box.
const COLS = 32;
const ROWS = 24;
const BOUNDS = { west: -130, south: -5, east: -60, north: 50 };

function makeGrid(fn: (lng: number, lat: number, h: number) => number | null) {
  const pts = viewportGrid(BOUNDS, COLS, ROWS);
  const grid: FieldGrid = {
    times: ['2026-09-28T00:00', '2026-09-28T01:00'],
    points: pts.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      values: [fn(p.lng, p.lat, 0), fn(p.lng, p.lat, 1)],
    })),
  };
  return grid;
}

// Smooth synthetic fields spanning every step of each ramp.
const temperature = makeGrid(
  (lng, lat, h) =>
    18 +
    22 * Math.sin((lng + 100) / 9) * Math.cos((lat - 20) / 11) -
    0.4 * (lat - 20) +
    h * 3
);
const pressure = makeGrid(
  (lng, lat) => 1005 + 30 * Math.sin(lng / 13) * Math.sin(lat / 7)
);
const humidity = makeGrid((lng, lat) => 50 + 55 * Math.sin((lng + lat) / 10));
// Story 15.5 — dry (transparent) basins between showers, plus one hole
// of missing cells (Open-Meteo nulls) the renderer must leave empty.
const precipitation = makeGrid((lng, lat) => {
  if (lng > -101 && lng < -97 && lat > 18 && lat < 22) return null;
  return Math.max(0, 12 * Math.sin(lng / 6) * Math.cos(lat / 5));
});

interface Case {
  name: string;
  grid: FieldGrid;
  color: (v: number) => string;
  hour: number;
}
const CASES: Case[] = [
  { name: 'temperature', grid: temperature, color: tempColor, hour: 0 },
  { name: 'temperature h1', grid: temperature, color: tempColor, hour: 1 },
  { name: 'pressure', grid: pressure, color: pressureColor, hour: 0 },
  { name: 'humidity', grid: humidity, color: humidityColor, hour: 0 },
  { name: 'precipitation', grid: precipitation, color: precipColor, hour: 0 },
];

describe('Story 24.1 — shader reference vs fillFieldImageData', () => {
  // A small raster keeps the canvas pass fast; the edge fade scales with
  // it exactly as it does at 1000×700.
  const W = 250;
  const H = 175;
  const ALPHA = 200;
  const geom: FieldGeometry = {
    rows: ROWS,
    cols: COLS,
    bounds: BOUNDS,
    width: W,
    height: H,
  };

  for (const c of CASES) {
    it(`${c.name}: every sample point within 2/255 of the canvas raster`, () => {
      const img = {
        data: new Uint8ClampedArray(W * H * 4),
        width: W,
        height: H,
      };
      fillFieldImageData(
        img,
        c.grid,
        ROWS,
        COLS,
        BOUNDS,
        c.hour,
        c.color,
        ALPHA,
        { rowSpace: 'mercator' }
      );
      const packed = packFieldFrame(c.grid, c.hour);
      const domain = fieldValueDomain(c.grid);
      const lut = buildRampLut(c.color, domain);
      // Half the canvas colour bucket (0.05) plus one LUT texel.
      const eps = 0.05 + domain.step;

      let compared = 0;
      let skipped = 0;
      let transparent = 0;
      let maxDiff = 0;
      // Every 3rd pixel on both axes (≈ 4 900 points), edges included.
      const xs: number[] = [];
      for (let x = 0; x < W; x += 3) xs.push(x);
      xs.push(W - 1);
      const ys: number[] = [];
      for (let y = 0; y < H; y += 3) ys.push(y);
      ys.push(H - 1);
      for (const py of ys) {
        const lat = rowLatitude(py, H, BOUNDS, 'mercator');
        for (const px of xs) {
          const lng =
            BOUNDS.west + (px / (W - 1)) * (BOUNDS.east - BOUNDS.west);
          const v = bicubicValue(c.grid, ROWS, COLS, BOUNDS, lat, lng, c.hour);
          // The ramps are step functions: within a hair of a step both
          // renderers quantise the value (the canvas caches colours per
          // 0.1, the LUT per texel), so a point sitting on a boundary may
          // legitimately land on either side. Everywhere else they agree.
          if (v !== null && c.color(v - eps) !== c.color(v + eps)) {
            skipped++;
            continue;
          }
          const ref = fieldPixelReference(
            packed,
            geom,
            lut,
            domain,
            px,
            py,
            ALPHA
          );
          const i = (py * W + px) * 4;
          const got = [
            img.data[i],
            img.data[i + 1],
            img.data[i + 2],
            img.data[i + 3],
          ];
          compared++;
          if (got[3] === 0 && ref[3] === 0) {
            transparent++;
            continue;
          }
          for (let ch = 0; ch < 4; ch++) {
            maxDiff = Math.max(maxDiff, Math.abs(got[ch] - ref[ch]));
          }
        }
      }
      expect(maxDiff).toBeLessThanOrEqual(2);
      // Not vacuous: nearly every sample was compared, and most of them
      // carry colour.
      expect(compared).toBeGreaterThan(0.9 * (compared + skipped));
      expect(compared - transparent).toBeGreaterThan(0.3 * compared);
    });
  }

  it('precipitation: dry cells and missing data stay transparent', () => {
    const packed = packFieldFrame(precipitation, 0);
    const domain = fieldValueDomain(precipitation);
    const lut = buildRampLut(precipColor, domain);
    // Centre of the null hole (≈ -99, 20) → nothing drawn.
    const px = Math.round(((-99 - BOUNDS.west) / 70) * (W - 1));
    const yN = mercatorY(BOUNDS.north);
    const yS = mercatorY(BOUNDS.south);
    const py = Math.round(((mercatorY(20) - yN) / (yS - yN)) * (H - 1));
    expect(fieldPixelReference(packed, geom, lut, domain, px, py, 200)).toEqual(
      [0, 0, 0, 0]
    );
    // The ramp's #00000000 survives the LUT.
    expect(
      Array.from(
        lut.slice(lutIndex(0, domain) * 4, lutIndex(0, domain) * 4 + 4)
      )
    ).toEqual([0, 0, 0, 0]);
    expect(
      Array.from(
        lut.slice(lutIndex(3, domain) * 4, lutIndex(3, domain) * 4 + 4)
      )
    ).toEqual(hexToRgba(precipColor(3)));
  });

  it('the edge fade reaches 0 on the border and 1 inside, like the canvas', () => {
    const flat = makeGrid(() => 20);
    const packed = packFieldFrame(flat, 0);
    const domain = fieldValueDomain(flat);
    const lut = buildRampLut(tempColor, domain);
    expect(fieldPixelReference(packed, geom, lut, domain, 0, 80, 200)[3]).toBe(
      0
    );
    expect(
      fieldPixelReference(packed, geom, lut, domain, W / 2, H / 2, 200)[3]
    ).toBe(200);
  });
});

describe('ramp LUT', () => {
  it('holds the ramp colour of each texel centre and clamps past the domain', () => {
    const d = fieldValueDomain(temperature);
    expect(d.size).toBe(FIELD_LUT_SIZE);
    const lut = buildRampLut(tempColor, d);
    for (const k of [0, 1, 700, 1024, FIELD_LUT_SIZE - 1]) {
      const v = d.min + (k + 0.5) * d.step;
      expect(lutIndex(v, d)).toBe(k);
      expect(Array.from(lut.slice(k * 4, k * 4 + 4))).toEqual(
        hexToRgba(tempColor(v))
      );
    }
    expect(lutIndex(-1e9, d)).toBe(0);
    expect(lutIndex(1e9, d)).toBe(FIELD_LUT_SIZE - 1);
  });

  it('pads the grid range and ignores missing values', () => {
    const d = fieldValueDomain(precipitation);
    expect(d.min).toBeLessThan(0);
    expect(d.min + d.size * d.step).toBeGreaterThan(12);
    expect(fieldValueDomain(precipitation)).toBe(d); // cached per grid
  });

  it('packs (value, valid) row-major, nulls as invalid', () => {
    const buf = packFieldFrame(precipitation, 0);
    expect(buf.length).toBe(COLS * ROWS * 2);
    const hole = precipitation.points.findIndex((p) => p.values[0] === null);
    expect(hole).toBeGreaterThan(-1);
    expect(buf[hole * 2 + 1]).toBe(0);
    expect(buf[1]).toBe(1);
  });
});

describe('Mercator rows', () => {
  it('rowLatitude spans the bounds and inverts mercatorY', () => {
    expect(rowLatitude(0, 100, BOUNDS, 'mercator')).toBeCloseTo(50, 9);
    expect(rowLatitude(99, 100, BOUNDS, 'mercator')).toBeCloseTo(-5, 9);
    expect(latFromMercatorY(mercatorY(19.43))).toBeCloseTo(19.43, 9);
    // Mid-row in Mercator sits north of the mid latitude (22.5°).
    expect(rowLatitude(50, 101, BOUNDS, 'mercator')).toBeGreaterThan(23);
    expect(rowLatitude(50, 101, BOUNDS)).toBeCloseTo(22.5, 9);
  });
});

describe('Story 24.1 — renderer selection (fallback)', () => {
  const webgl2 = {
    texStorage2D: () => undefined,
    createVertexArray: () => undefined,
    texImage3D: () => undefined,
  };
  const webgl1 = { texImage2D: () => undefined, getExtension: () => null };

  it('WebGL only with a WebGL2 context', () => {
    expect(isWebGL2(webgl2)).toBe(true);
    expect(isWebGL2(webgl1)).toBe(false);
    expect(isWebGL2(null)).toBe(false);
    expect(pickFieldRenderer({ gl: webgl2 })).toBe('webgl');
    expect(pickFieldRenderer({ gl: webgl1 })).toBe('canvas');
    expect(pickFieldRenderer({ gl: null })).toBe('canvas');
  });

  it('jsdom has no WebGL2: the canvas path is picked', () => {
    const canvas = document.createElement('canvas');
    const gl: unknown = canvas.getContext('webgl2');
    expect(pickFieldRenderer({ gl, search: window.location.search })).toBe(
      'canvas'
    );
  });

  it('the flag forces canvas; the URL wins over the stored value', () => {
    expect(pickFieldRenderer({ gl: webgl2, search: '?field=canvas' })).toBe(
      'canvas'
    );
    expect(pickFieldRenderer({ gl: webgl2, stored: 'canvas' })).toBe('canvas');
    expect(
      pickFieldRenderer({
        gl: webgl2,
        search: '?e2e=1&field=webgl',
        stored: 'canvas',
      })
    ).toBe('webgl');
    // Asking for WebGL never beats a missing WebGL2 context.
    expect(pickFieldRenderer({ gl: webgl1, search: '?field=webgl' })).toBe(
      'canvas'
    );
    expect(fieldRendererFlag('?field=bogus', null)).toBeNull();
    expect(fieldRendererFlag('', ' Canvas ')).toBe('canvas');
  });
});

describe('createFieldGlLayer without a GPU', () => {
  it('is a 2d custom layer on the field id; setFrame and setOpacity repaint', () => {
    const map = { triggerRepaint: vi.fn() };
    const f = createFieldGlLayer(map);
    expect(f.layer.id).toBe(FIELD_GL_LAYER_ID);
    expect(f.layer.type).toBe('custom');
    expect(f.layer.renderingMode).toBe('2d');
    f.setFrame({
      grid: temperature,
      hourIdx: 0,
      geometry: {
        rows: ROWS,
        cols: COLS,
        bounds: BOUNDS,
        width: 1000,
        height: 700,
      },
      color: tempColor,
      alpha: 200,
    });
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    f.setOpacity(0.5);
    f.setOpacity(0.5); // unchanged: no extra repaint
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
  });

  it('reports a context without WebGL2 through onError, asynchronously', async () => {
    const onError = vi.fn();
    const f = createFieldGlLayer(
      { triggerRepaint: () => undefined },
      { onError }
    );
    f.layer.onAdd?.(
      {} as never,
      { texImage2D: () => undefined } as unknown as WebGLRenderingContext
    );
    expect(onError).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith('no WebGL2 context');
    expect(f.failed()).toBe(true);
    // A broken layer draws nothing and never throws.
    expect(() =>
      f.layer.render({} as WebGL2RenderingContext, {} as never)
    ).not.toThrow();
  });
});
