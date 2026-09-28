import { afterEach, describe, expect, it } from 'vitest';
import {
  bandGradient,
  categoryScale,
  cssPercent,
  fitTickLabels,
  formatTickNumber,
  legendScaleFor,
  steppedScale,
  thresholdScale,
  type LegendContext,
  type LegendKind,
  type LegendScale,
} from './legend-scale';
import {
  humidityColor,
  precipColor,
  precipProbColor,
  pressureColor,
  setColorBlindMode,
  snowColor,
  spreadColorFor,
  tempColor,
  PRECIP_TRANSPARENT,
} from '../../mapfields';
import { windSpeedColor } from '../../mapwind';
import { DEFAULT_UNITS, type Units } from '../../units';

function ctx(over: Partial<LegendContext> = {}): LegendContext {
  return {
    units: DEFAULT_UNITS,
    layer: 'temperature',
    precipSub: 'lluvia',
    radarLabel: (k) => `<${k}>`,
    ...over,
  };
}
const units = (u: Partial<Units>): Units => ({ ...DEFAULT_UNITS, ...u });
const labels = (s: LegendScale): string[] => s.ticks.map((t) => t.label);

afterEach(() => setColorBlindMode(false));

describe('bandGradient', () => {
  it('is one gradient with a hard stop at every band edge', () => {
    expect(bandGradient(['#111', '#222', '#333', '#444'])).toBe(
      'linear-gradient(to right, #111 0% 25%, #222 25% 50%, #333 50% 75%, #444 75% 100%)'
    );
    expect(bandGradient(['#abc'])).toBe(
      'linear-gradient(to right, #abc, #abc)'
    );
    expect(bandGradient([])).toBe('none');
  });
  it('rounds positions to three decimals', () => {
    expect(cssPercent(1 / 7)).toBe('14.286%');
    expect(cssPercent(1)).toBe('100%');
  });
});

describe('scale builders', () => {
  const stops: [number, string][] = [
    [0, '#a'],
    [10, '#b'],
    [20, '#c'],
  ];
  it('stepped ramp: a band per colour, ticks on the inner edges', () => {
    const s = steppedScale(stops, String, 'u');
    expect(s.bands).toEqual(['#a', '#b', '#c']);
    expect(s.ticks).toEqual([
      { pos: 1 / 3, label: '10', kind: 'edge' },
      { pos: 2 / 3, label: '20', kind: 'edge' },
    ]);
    expect(s.unit).toBe('u');
  });
  it('stepped ramp with a closed top ends on its last threshold', () => {
    const s = steppedScale(stops, String, 'u', true);
    expect(s.bands).toEqual(['#a', '#b']);
    expect(s.ticks.map((t) => t.pos)).toEqual([0.5, 1]);
  });
  it('threshold ramp starts at its first bound', () => {
    const s = thresholdScale(stops, String, 'u');
    expect(s.ticks.map((t) => [t.pos, t.label])).toEqual([
      [0, '0'],
      [1 / 3, '10'],
      [2 / 3, '20'],
    ]);
  });
  it('categories are named in the middle of their band', () => {
    const s = categoryScale(
      [
        { label: 'x', color: '#1' },
        { label: 'y', color: '#2' },
      ],
      ''
    );
    expect(s.ticks).toEqual([
      { pos: 0.25, label: 'x', kind: 'band' },
      { pos: 0.75, label: 'y', kind: 'band' },
    ]);
  });
  it('formats tick numbers without trailing zeros', () => {
    expect(formatTickNumber(0.1)).toBe('0.1');
    expect(formatTickNumber(2.5)).toBe('2.5');
    expect(formatTickNumber(10)).toBe('10');
    expect(formatTickNumber(-0.01)).toBe('0');
  });
});

/**
 * The bar must show the colours the field paints: a value just inside
 * each band (between two ticks, or past the last one) has the band's
 * colour in the renderer's own ramp function.
 */
function expectBandsMatch(
  s: LegendScale,
  thresholds: number[],
  color: (v: number) => string,
  firstBandBelow: boolean
): void {
  const probes = firstBandBelow
    ? [thresholds[0] - 1, ...thresholds.map((t) => t + 1e-6)]
    : thresholds.map((t) => t + 1e-6);
  expect(s.bands.length).toBe(probes.length);
  probes.forEach((v, i) => expect(s.bands[i]).toBe(color(v)));
}

describe('legendScaleFor — the bands are the renderer ramps', () => {
  it('temperature (both palettes), ticks on 0 10 18 25 32 45 °C', () => {
    const s = legendScaleFor('temperature', ctx());
    expect(labels(s)).toEqual(['0', '10', '18', '25', '32', '45']);
    expect(s.unit).toBe('°C');
    expectBandsMatch(s, [0, 10, 18, 25, 32, 45], tempColor, true);
    setColorBlindMode(true);
    const cb = legendScaleFor('temperature', ctx());
    expect(cb.bands).not.toEqual(s.bands);
    expectBandsMatch(cb, [0, 10, 18, 25, 32, 45], tempColor, true);
  });
  it('temperature converts to °F (Story 19.3)', () => {
    const s = legendScaleFor(
      'temperature',
      ctx({ units: units({ temp: 'F' }) })
    );
    expect(s.unit).toBe('°F');
    expect(labels(s)).toEqual(['32', '50', '64', '77', '90', '113']);
  });
  it('humidity ends on 100 %', () => {
    const s = legendScaleFor('humidity', ctx({ layer: 'humidity' }));
    expect(labels(s)).toEqual(['20', '40', '60', '80', '100']);
    expect(s.ticks.at(-1)?.pos).toBe(1);
    expect(s.unit).toBe('%');
    expectBandsMatch(s, [20, 40, 60, 80], humidityColor, true);
  });
  it('pressure in hPa and inHg', () => {
    const s = legendScaleFor('pressure', ctx({ layer: 'pressure' }));
    expect(labels(s)).toEqual(['990', '1005', '1015', '1025', '1040']);
    expect(s.unit).toBe('hPa');
    expectBandsMatch(s, [990, 1005, 1015, 1025, 1040], pressureColor, true);
    const inHg = legendScaleFor(
      'pressure',
      ctx({ layer: 'pressure', units: units({ pressure: 'inHg' }) })
    );
    expect(inHg.unit).toBe('inHg');
    expect(labels(inHg)).toEqual(['29.2', '29.7', '30.0', '30.3', '30.7']);
  });
  it('precipitation: rain, snow and probability, from their first bound', () => {
    const rain = legendScaleFor(
      'precipitation',
      ctx({ layer: 'precipitation' })
    );
    expect(labels(rain)).toEqual(['0.1', '0.5', '1', '2.5', '5', '10']);
    expect(rain.ticks[0].pos).toBe(0);
    expect(rain.unit).toBe('mm/h');
    expectBandsMatch(rain, [0.1, 0.5, 1, 2.5, 5, 10], precipColor, false);
    expect(rain.bands).not.toContain(PRECIP_TRANSPARENT);
    const snow = legendScaleFor(
      'precipitation',
      ctx({ layer: 'precipitation', precipSub: 'nieve' })
    );
    expect(snow.unit).toBe('cm/h');
    expectBandsMatch(snow, [0.1, 0.5, 1, 2.5, 5], snowColor, false);
    const prob = legendScaleFor(
      'precipitation',
      ctx({ layer: 'precipitation', precipSub: 'probabilidad' })
    );
    expect(prob.unit).toBe('%');
    expect(labels(prob)).toEqual(['10', '30', '50', '70', '90']);
    expectBandsMatch(prob, [10, 30, 50, 70, 90], precipProbColor, false);
  });
  it('confidence follows the layer steps, in its metric unit', () => {
    const s = legendScaleFor('confidence', ctx({ layer: 'humidity' }));
    expect(labels(s)).toEqual(['5', '10', '20', '30']);
    expect(s.unit).toBe('± %');
    expectBandsMatch(s, [5, 10, 20, 30], spreadColorFor('humidity'), true);
    const t = legendScaleFor(
      'confidence',
      ctx({ layer: 'temperature', units: units({ temp: 'F' }) })
    );
    expect(t.unit).toBe('± °C');
    expect(
      legendScaleFor(
        'confidence',
        ctx({ layer: 'precipitation', precipSub: 'nieve' })
      ).unit
    ).toBe('± cm/h');
  });
  it('wind speed in every speed unit', () => {
    const kmh = legendScaleFor('wind', ctx());
    expect(kmh.unit).toBe('km/h');
    expect(labels(kmh)).toEqual(['18', '36', '54', '90', '144']);
    expectBandsMatch(kmh, [5, 10, 15, 25, 40], windSpeedColor, true);
    const ms = legendScaleFor('wind', ctx({ units: units({ speed: 'ms' }) }));
    expect(ms.unit).toBe('m/s');
    expect(labels(ms)).toEqual(['5', '10', '15', '25', '40']);
    expect(
      labels(legendScaleFor('wind', ctx({ units: units({ speed: 'kt' }) })))
    ).toEqual(['10', '19', '29', '49', '78']);
    expect(
      labels(legendScaleFor('wind', ctx({ units: units({ speed: 'mph' }) })))
    ).toEqual(['11', '22', '34', '56', '89']);
  });
  it('radar keeps its four named categories', () => {
    const s = legendScaleFor('radar', ctx());
    expect(labels(s)).toEqual([
      '<legend_light>',
      '<legend_moderate>',
      '<legend_heavy>',
      '<legend_snow>',
    ]);
    expect(s.ticks.every((t) => t.kind === 'band')).toBe(true);
    expect(s.unit).toBe('mm/h');
  });
  it('every kind has ≥ 3 ticks and a gradient', () => {
    const kinds: LegendKind[] = [
      'radar',
      'temperature',
      'humidity',
      'pressure',
      'precipitation',
      'confidence',
      'wind',
    ];
    for (const k of kinds) {
      const s = legendScaleFor(k, ctx());
      expect(s.ticks.length).toBeGreaterThanOrEqual(3);
      expect(s.gradient).toMatch(/^linear-gradient\(to right, /);
      for (const t of s.ticks) {
        expect(t.pos).toBeGreaterThanOrEqual(0);
        expect(t.pos).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('fitTickLabels', () => {
  const tick = (pos: number, label: string) => ({
    pos,
    label,
    kind: 'edge' as const,
  });
  it('shows every label when there is room', () => {
    const s = legendScaleFor(
      'temperature',
      ctx({ units: units({ temp: 'F' }) })
    );
    // The phone bar (w-48 = 192 px) keeps all six °F labels.
    expect(fitTickLabels(s.ticks, 192)).toEqual(s.ticks.map(() => true));
    const radar = legendScaleFor('radar', {
      ...ctx(),
      radarLabel: (k) =>
        ({
          legend_light: 'Ligera',
          legend_moderate: 'Moderada',
          legend_heavy: 'Intensa',
          legend_snow: 'Nieve',
        })[k] ?? k,
    });
    // Widths measured in Chromium, Open Sans Semibold 10 px.
    const px: Record<string, number> = {
      Ligera: 29.7,
      Moderada: 49.5,
      Intensa: 36.2,
      Nieve: 27.5,
    };
    expect(fitTickLabels(radar.ticks, 192, { measure: (l) => px[l] })).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
  it('drops colliding labels but always keeps the last one', () => {
    const ticks = [
      tick(0.1, '1000'),
      tick(0.15, '1001'),
      tick(0.2, '1002'),
      tick(0.25, '1003'),
    ];
    expect(fitTickLabels(ticks, 200)).toEqual([true, false, false, true]);
  });
  it('pins labels inside the bar at its ends', () => {
    const ticks = [tick(0, 'aaaa'), tick(1, 'bbbb')];
    // 24 px each, pinned inside a 50 px bar: 2 px apart < 4 px gap.
    expect(fitTickLabels(ticks, 50)).toEqual([false, true]);
    expect(fitTickLabels(ticks, 60)).toEqual([true, true]);
  });
  it('handles no ticks', () => {
    expect(fitTickLabels([], 100)).toEqual([]);
  });
});
