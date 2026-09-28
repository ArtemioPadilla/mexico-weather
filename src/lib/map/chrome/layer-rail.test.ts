import { describe, expect, it } from 'vitest';
import {
  PINNED_OVERLAYS,
  activeBlockAnchor,
  normalizeQuery,
  orderOverlays,
  overlayMatches,
  railRowCount,
} from './layer-rail';

describe('activeBlockAnchor', () => {
  it('anchors after the last tile of the active row (3 columns)', () => {
    // 9 tiles → rows [0,1,2] [3,4,5] [6,7,8]
    expect(activeBlockAnchor(9, 0, 3)).toBe(2);
    expect(activeBlockAnchor(9, 2, 3)).toBe(2);
    expect(activeBlockAnchor(9, 3, 3)).toBe(5);
    expect(activeBlockAnchor(9, 8, 3)).toBe(8);
  });

  it('clamps a short last row to the last tile', () => {
    // 5 tiles (home embed) → rows [0,1,2] [3,4]
    expect(activeBlockAnchor(5, 3, 3)).toBe(4);
    expect(activeBlockAnchor(5, 4, 3)).toBe(4);
  });

  it('one column puts the block right after the active tile', () => {
    expect(activeBlockAnchor(9, 0, 1)).toBe(0);
    expect(activeBlockAnchor(9, 5, 1)).toBe(5);
  });

  it('returns -1 without an active tile', () => {
    expect(activeBlockAnchor(9, -1, 3)).toBe(-1);
    expect(activeBlockAnchor(9, 9, 3)).toBe(-1);
    expect(activeBlockAnchor(0, 0, 3)).toBe(-1);
  });

  it('treats a nonsense column count as one column', () => {
    expect(activeBlockAnchor(4, 2, 0)).toBe(2);
  });
});

describe('orderOverlays', () => {
  const defs = [
    { id: 'tropical', label: 'Sistemas tropicales' },
    { id: 'graticule', label: 'Retícula' },
    { id: 'precipMode', label: 'Modo precipitación' },
    { id: 'clouds', label: 'Nubes' },
    { id: 'windOverlay', label: 'Animación de viento' },
    { id: 'aqi', label: 'Calidad del aire' },
  ];

  it('puts the pinned ids first, in pinned order, the rest in declared order', () => {
    const { pinned, rest } = orderOverlays(defs, PINNED_OVERLAYS);
    expect(pinned.map((d) => d.id)).toEqual([
      'tropical',
      'clouds',
      'precipMode',
      'windOverlay',
    ]);
    expect(rest.map((d) => d.id)).toEqual(['graticule', 'aqi']);
  });

  it('never drops or duplicates an entry, and skips unknown pinned ids', () => {
    const { pinned, rest } = orderOverlays(defs, ['clouds', 'nope', 'clouds']);
    expect(pinned.map((d) => d.id)).toEqual(['clouds']);
    expect([...pinned, ...rest].map((d) => d.id).sort()).toEqual(
      defs.map((d) => d.id).sort()
    );
  });
});

describe('overlay filter', () => {
  it('normalizes case and accents', () => {
    expect(normalizeQuery('  Satélite ')).toBe('satelite');
  });

  it('matches every word, in any order, accent-insensitive', () => {
    const label = 'Modo precipitación (satélite + nubes + radar)';
    expect(overlayMatches(label, '')).toBe(true);
    expect(overlayMatches(label, 'precipitacion')).toBe(true);
    expect(overlayMatches(label, 'nubes SAT')).toBe(true);
    expect(overlayMatches(label, 'nubes volcan')).toBe(false);
  });
});

describe('railRowCount', () => {
  it('groups boxes whose centres share a row', () => {
    const rects = [
      { y: 10, height: 20, width: 50 }, // centre 20
      { y: 11, height: 18, width: 50 }, // centre 20
      { y: 40, height: 20, width: 50 }, // centre 50
      { y: 70, height: 24, width: 50 }, // centre 82
    ];
    expect(railRowCount(rects)).toBe(3);
  });

  it('ignores zero-size boxes', () => {
    expect(
      railRowCount([
        { y: 0, height: 0, width: 10 },
        { y: 10, height: 10, width: 0 },
      ])
    ).toBe(0);
  });
});
