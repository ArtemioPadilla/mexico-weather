import { describe, expect, it } from 'vitest';
import {
  LABEL_BASE_PX,
  LABEL_HALO_BLUR,
  LABEL_HALO_WIDTH,
  LABEL_MIN_PX,
  MAP_LABEL_FONT,
  labelHalo,
  labelLayout,
  labelSize,
  labelSizeStops,
  type LabelRole,
} from './label-style';

describe('label style', () => {
  it('one fontstack the glyph host serves', () => {
    expect(MAP_LABEL_FONT).toEqual(['Open Sans Semibold']);
    for (const role of Object.keys(LABEL_BASE_PX) as LabelRole[]) {
      expect(labelLayout(role)['text-font']).toBe(MAP_LABEL_FONT);
    }
  });

  it('size grows with the zoom and never drops under the minimum', () => {
    for (const role of Object.keys(LABEL_BASE_PX) as LabelRole[]) {
      const stops = labelSizeStops(role);
      expect(stops.find(([z]) => z === 5)?.[1]).toBe(LABEL_BASE_PX[role]);
      for (let i = 1; i < stops.length; i++) {
        expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0]);
        expect(stops[i][1]).toBeGreaterThanOrEqual(stops[i - 1][1]);
      }
      expect(Math.min(...stops.map((s) => s[1]))).toBeGreaterThanOrEqual(
        LABEL_MIN_PX
      );
    }
    expect(labelSize('value')).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      3,
      10,
      5,
      12,
      8,
      14,
      11,
      16,
    ]);
  });

  it('one halo width and blur; the colour follows the text', () => {
    const light = labelHalo('light');
    const dark = labelHalo('dark');
    expect(light['text-halo-width']).toBe(LABEL_HALO_WIDTH);
    expect(dark['text-halo-width']).toBe(LABEL_HALO_WIDTH);
    expect(light['text-halo-blur']).toBe(LABEL_HALO_BLUR);
    expect(dark['text-halo-blur']).toBe(LABEL_HALO_BLUR);
    expect(light['text-halo-color']).toMatch(/^rgba\(0,0,0/);
    expect(dark['text-halo-color']).toMatch(/^rgba\(255,255,255/);
  });
});

/**
 * Sentinel: every MapLibre text label under src/lib takes its family,
 * size and halo from label-style.ts — a new overlay with its own
 * `text-font`, a fixed `text-size` or a hand-rolled halo fails here.
 */
describe('every map label uses the shared style', () => {
  const sources = import.meta.glob<string>(
    [
      '/src/lib/**/*.ts',
      '!/src/lib/**/*.test.ts',
      '!/src/lib/map/utils/label-style.ts',
    ],
    { query: '?raw', import: 'default', eager: true }
  );
  const withLabels = Object.entries(sources).filter(([, src]) =>
    /['"]text-field['"]\s*:/.test(src)
  );

  it('finds the label layers', () => {
    expect(withLabels.map(([f]) => f)).toEqual(
      expect.arrayContaining([
        '/src/lib/map/layers/isobars.ts',
        '/src/lib/map/overlays/city-values.ts',
        '/src/lib/map/overlays/tropical-storms.ts',
      ])
    );
  });

  it.each(withLabels)('%s', (_f, src) => {
    expect(src).not.toMatch(/['"]text-font['"]\s*:/);
    expect(src).not.toMatch(/['"]text-size['"]\s*:/);
    expect(src).not.toMatch(/['"]text-halo-(color|width|blur)['"]\s*:/);
    const layouts = src.match(/\.\.\.labelLayout\(/g) ?? [];
    const halos = src.match(/\.\.\.labelHalo\(/g) ?? [];
    const fields = src.match(/['"]text-field['"]\s*:/g) ?? [];
    expect(layouts.length).toBe(fields.length);
    expect(halos.length).toBe(fields.length);
  });
});
