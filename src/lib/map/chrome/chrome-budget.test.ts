import { describe, expect, it } from 'vitest';
import {
  CHROME_BUDGET,
  CHROME_EXCLUDE_SELECTOR,
  CHROME_SELECTOR,
  chromeOverMap,
  countChromeOverMap,
  rectsIntersect,
  type ChromeCandidate,
  type Rect,
} from './chrome-budget';

const MAP: Rect = { x: 0, y: 56, width: 1280, height: 744 };
const VIEWPORT: Rect = { x: 0, y: 0, width: 1280, height: 800 };

function cand(
  id: string,
  rect: Partial<Rect>,
  visible = true
): ChromeCandidate {
  return {
    id,
    rect: { x: 0, y: 0, width: 40, height: 40, ...rect },
    visible,
  };
}

describe('rectsIntersect', () => {
  it('true for a real overlap', () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 }
      )
    ).toBe(true);
  });

  it('false when boxes only touch at an edge', () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10, y: 0, width: 10, height: 10 }
      )
    ).toBe(false);
  });

  it('false for empty boxes even when they sit inside the other', () => {
    expect(
      rectsIntersect(
        { x: 5, y: 5, width: 0, height: 0 },
        { x: 0, y: 0, width: 10, height: 10 }
      )
    ).toBe(false);
    expect(rectsIntersect(MAP, { x: 10, y: 100, width: 20, height: 0 })).toBe(
      false
    );
  });

  it('is symmetric', () => {
    const a = { x: 100, y: 100, width: 50, height: 50 };
    const b = { x: 120, y: 90, width: 5, height: 500 };
    expect(rectsIntersect(a, b)).toBe(rectsIntersect(b, a));
  });
});

describe('countChromeOverMap', () => {
  it('counts visible controls overlapping the map', () => {
    const list = [
      cand('#layerbtn-base', { x: 12, y: 70 }),
      cand('#tl-play', { x: 600, y: 740 }),
      cand('#mw-search-toggle', { x: 1220, y: 70 }),
    ];
    expect(countChromeOverMap(MAP, list, VIEWPORT)).toBe(3);
  });

  it('drops hidden controls even when their box overlaps the map', () => {
    const list = [
      cand('#layerbtn-base', { x: 12, y: 70 }),
      cand('#mw-welcome-locate', { x: 500, y: 300 }, false),
    ];
    expect(countChromeOverMap(MAP, list, VIEWPORT)).toBe(1);
  });

  it('drops empty boxes (display:none, closed <details> content)', () => {
    const list = [
      cand('#mw-settings summary', { x: 1220, y: 130 }),
      cand('#mw-settings a', { x: 1220, y: 160, width: 0, height: 0 }),
    ];
    expect(countChromeOverMap(MAP, list, VIEWPORT)).toBe(1);
  });

  it('ignores controls outside the map (the site nav above it)', () => {
    const list = [
      cand('nav a', { x: 20, y: 8, height: 40 }), // ends at y=48 < map top 56
      cand('#layerbtn-base', { x: 12, y: 70 }),
    ];
    expect(countChromeOverMap(MAP, list, VIEWPORT)).toBe(1);
  });

  it('counts a control that straddles the map edge', () => {
    const list = [cand('#mw-controls-toggle', { x: 12, y: 40, height: 40 })];
    expect(countChromeOverMap(MAP, list, VIEWPORT)).toBe(1);
  });

  it('drops controls that fell off the viewport (overgrown phone rail)', () => {
    const phoneMap = { x: 0, y: 48, width: 360, height: 5000 };
    const phoneViewport = { x: 0, y: 0, width: 360, height: 640 };
    const list = [
      cand('#layerbtn-base', { x: 12, y: 70 }),
      cand('#layerbtn-wind', { x: 12, y: 700 }),
    ];
    expect(countChromeOverMap(phoneMap, list, phoneViewport)).toBe(1);
    // Without a viewport the map rect alone decides.
    expect(countChromeOverMap(phoneMap, list)).toBe(2);
  });

  it('returns 0 for no candidates', () => {
    expect(countChromeOverMap(MAP, [], VIEWPORT)).toBe(0);
  });

  it('chromeOverMap keeps the ids so the spec can log them', () => {
    const list = [
      cand('#a', { x: 12, y: 70 }),
      cand('#b', { x: 12, y: 70 }, false),
      cand('#c', { x: 12, y: 70 }),
    ];
    expect(chromeOverMap(MAP, list, VIEWPORT).map((c) => c.id)).toEqual([
      '#a',
      '#c',
    ]);
  });
});

describe('constants', () => {
  it('selector covers every interactive kind the plan names', () => {
    for (const part of [
      'button',
      'a[href]',
      'input',
      'select',
      '[role="button"]',
      'summary',
    ]) {
      expect(CHROME_SELECTOR.split(',').map((s) => s.trim())).toContain(part);
    }
  });

  it('excludes markers, popups and attribution — data and legal, not chrome', () => {
    expect(CHROME_EXCLUDE_SELECTOR).toContain('.maplibregl-marker');
    expect(CHROME_EXCLUDE_SELECTOR).toContain('.maplibregl-popup');
    expect(CHROME_EXCLUDE_SELECTOR).toContain('.maplibregl-ctrl-attrib');
  });

  it('budget matches plan §1.2 (≤ 8 desktop, ≤ 5 mobile)', () => {
    expect(CHROME_BUDGET).toEqual({ desktop: 8, mobile: 5 });
  });
});
