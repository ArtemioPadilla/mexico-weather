import { describe, expect, it } from 'vitest';
import { fillFieldImageData, hexToRgb, hexToRgba } from './mapraster';
import type { FieldGrid } from './mapfields';

describe('hexToRgba', () => {
  it('reads the alpha nibble of an 8-digit hex and defaults to opaque', () => {
    expect(hexToRgba('#00000000')).toEqual([0, 0, 0, 0]);
    expect(hexToRgba('#1f6fe680')).toEqual([31, 111, 230, 128]);
    expect(hexToRgba('#1f6fe6')).toEqual([31, 111, 230, 255]);
    expect(hexToRgba('#fff')).toEqual([255, 255, 255, 255]);
    expect(hexToRgb('#1f6fe680')).toEqual([31, 111, 230]);
  });
});

describe('fillFieldImageData (Story 15.5 transparency)', () => {
  // 4×4 grid (bicubic needs a 4-neighbourhood) of a constant field.
  function grid(value: number): FieldGrid {
    const points: FieldGrid['points'] = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        points.push({ lat: r, lng: c, values: [value] });
    return { times: ['2026-09-27T00:00'], points };
  }
  const bounds = { west: 0, south: 0, east: 3, north: 3 };
  function centreAlpha(color: (v: number) => string, value: number): number {
    const W = 40;
    const H = 40;
    const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    fillFieldImageData(img, grid(value), 4, 4, bounds, 0, color, 200);
    const i = ((H / 2) * W + W / 2) * 4;
    return img.data[i + 3];
  }
  it('a transparent ramp colour yields alpha 0, an opaque one the layer alpha', () => {
    expect(centreAlpha(() => '#00000000', 0)).toBe(0);
    expect(centreAlpha(() => '#1f6fe6', 3)).toBe(200);
    expect(centreAlpha(() => '#1f6fe680', 3)).toBe(100);
  });
});
