import { describe, expect, it } from 'vitest';
import {
  bearingToArrow,
  bearingToCardinal16,
  bearingToCardinal4,
  formatLatDM,
  formatLatLngDM,
  formatLngDM,
} from './geo-format';

describe('formatLatDM', () => {
  it('formats positive latitude with N', () => {
    expect(formatLatDM(19.43)).toBe('19°25′N');
  });

  it('formats negative latitude with S', () => {
    expect(formatLatDM(-19.43)).toBe('19°25′S');
  });

  it('zero is N (boundary convention)', () => {
    expect(formatLatDM(0)).toBe('0°00′N');
  });

  it('handles whole degrees', () => {
    expect(formatLatDM(20)).toBe('20°00′N');
  });

  it('handles values close to a degree boundary', () => {
    // 19.999° = 19°59.94′ → floor 59
    expect(formatLatDM(19.999)).toBe('19°59′N');
  });
});

describe('formatLngDM', () => {
  it('formats negative longitude with O (Oeste)', () => {
    expect(formatLngDM(-99.13)).toBe('99°07′O');
  });

  it('formats positive longitude with E', () => {
    expect(formatLngDM(99.13)).toBe('99°07′E');
  });

  it('handles longitudes near 180', () => {
    expect(formatLngDM(-179.999)).toBe('179°59′O');
  });
});

describe('formatLatLngDM', () => {
  it('joins lat and lng with a space', () => {
    expect(formatLatLngDM(19.43, -99.13)).toBe('19°25′N 99°07′O');
  });
});

describe('bearingToCardinal16', () => {
  it('maps cardinal directions', () => {
    expect(bearingToCardinal16(0)).toBe('N');
    expect(bearingToCardinal16(90)).toBe('E');
    expect(bearingToCardinal16(180)).toBe('S');
    expect(bearingToCardinal16(270)).toBe('O');
  });

  it('maps intercardinal directions', () => {
    expect(bearingToCardinal16(45)).toBe('NE');
    expect(bearingToCardinal16(135)).toBe('SE');
    expect(bearingToCardinal16(225)).toBe('SO');
    expect(bearingToCardinal16(315)).toBe('NO');
  });

  it('rounds to nearest 22.5° boundary (11.25° boundary)', () => {
    expect(bearingToCardinal16(11)).toBe('N');
    expect(bearingToCardinal16(12)).toBe('NNE');
  });

  it('handles values >= 360 and negative', () => {
    expect(bearingToCardinal16(360)).toBe('N');
    expect(bearingToCardinal16(720)).toBe('N');
    expect(bearingToCardinal16(-90)).toBe('O');
  });
});

describe('bearingToCardinal4', () => {
  it('maps to N/E/S/O', () => {
    expect(bearingToCardinal4(0)).toBe('N');
    expect(bearingToCardinal4(90)).toBe('E');
    expect(bearingToCardinal4(180)).toBe('S');
    expect(bearingToCardinal4(270)).toBe('O');
  });

  it('rounds at midpoints', () => {
    expect(bearingToCardinal4(44)).toBe('N');
    expect(bearingToCardinal4(46)).toBe('E');
  });
});

describe('bearingToArrow', () => {
  it('maps cardinal bearings to arrows pointing where the wind blows', () => {
    // 0° = wind FROM the north, blowing southward → ↓
    expect(bearingToArrow(0)).toBe('↓');
    expect(bearingToArrow(90)).toBe('←');
    expect(bearingToArrow(180)).toBe('↑');
    expect(bearingToArrow(270)).toBe('→');
  });
});
