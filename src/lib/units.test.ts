import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNITS,
  convertLegendLabel,
  convertLegendStops,
  convertPressure,
  convertSpeed,
  convertTemp,
  formatDistanceKm,
  formatPressure,
  formatSpeed,
  formatTemp,
} from './units';

describe('units (Story 19.3)', () => {
  it('temperature: °C passthrough, °F conversion, degree-only formatting', () => {
    expect(convertTemp(0, 'F')).toBe(32);
    expect(convertTemp(100, 'F')).toBe(212);
    expect(convertTemp(24, 'C')).toBe(24);
    expect(formatTemp(23.6, 'C')).toBe('24°');
    expect(formatTemp(23.6, 'F')).toBe('74°');
  });

  it('speed: km/h, mph, kt and m/s', () => {
    expect(convertSpeed(100, 'mph')).toBeCloseTo(62.14, 2);
    expect(convertSpeed(100, 'kt')).toBeCloseTo(53.996, 2);
    expect(convertSpeed(36, 'ms')).toBe(10);
    expect(formatSpeed(12, 'kmh')).toBe('12 km/h');
    expect(formatSpeed(12, 'mph')).toBe('7 mph');
    expect(formatSpeed(12, 'kt')).toBe('6 kt');
    expect(formatSpeed(12, 'ms')).toBe('3.3 m/s');
  });

  it('pressure: hPa and inHg', () => {
    expect(convertPressure(1013.25, 'inHg')).toBeCloseTo(29.92, 2);
    expect(formatPressure(1013.6, 'hPa')).toBe('1014 hPa');
    expect(formatPressure(1013.25, 'inHg')).toBe('29.92 inHg');
  });

  it('distance: km keeps the measure formatter, miles mirror it', () => {
    expect(formatDistanceKm(0.5, 'km')).toBe('500 m');
    expect(formatDistanceKm(12.34, 'km')).toBe('12.3 km');
    expect(formatDistanceKm(0.05, 'mi')).toBe('164 ft');
    expect(formatDistanceKm(12.34, 'mi')).toBe('7.7 mi');
    expect(formatDistanceKm(2000, 'mi')).toBe('1,243 mi');
  });

  it('legend labels convert their number and unit suffix', () => {
    const f = { ...DEFAULT_UNITS, temp: 'F' as const };
    expect(convertLegendLabel('≤0°', 'temperature', f)).toBe('≤32°');
    expect(convertLegendLabel('≥45°', 'temperature', f)).toBe('≥113°');
    expect(convertLegendLabel('25°', 'temperature', DEFAULT_UNITS)).toBe('25°');
    const inhg = { ...DEFAULT_UNITS, pressure: 'inHg' as const };
    expect(convertLegendLabel('≥1040 hPa', 'pressure', inhg)).toBe(
      '≥30.7 inHg'
    );
    expect(convertLegendLabel('990', 'pressure', inhg)).toBe('29.2');
    expect(convertLegendLabel('60%', 'humidity', f)).toBe('60%');
    expect(
      convertLegendStops([{ label: '10°', color: '#000' }], 'temperature', f)[0]
        .label
    ).toBe('50°');
    expect(
      convertLegendStops([{ label: '10%', color: '#000' }], 'humidity', f)[0]
        .label
    ).toBe('10%');
  });
});
