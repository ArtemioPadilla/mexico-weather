// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearLegendScale, paintLegendScale } from './legend-bar';
import { legendScaleFor, type LegendScale } from './legend-scale';
import { DEFAULT_UNITS } from '../../units';

function setup(): { list: HTMLElement; ramp: HTMLElement; unit: HTMLElement } {
  document.body.innerHTML = `
    <div id="legend-bar" class="im-legend">
      <span id="legend-unit"></span>
      <div><span class="im-legend-ramp"></span><ul id="legend"></ul></div>
    </div>`;
  return {
    list: document.getElementById('legend')!,
    ramp: document.querySelector<HTMLElement>('.im-legend-ramp')!,
    unit: document.getElementById('legend-unit')!,
  };
}

/** jsdom has no layout: give the bar and each label a width. */
function fakeLayout(el: HTMLElement, width: number): void {
  el.getBoundingClientRect = () =>
    ({
      width,
      height: 10,
      top: 0,
      left: 0,
      right: width,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

const temp = (temp: 'C' | 'F'): LegendScale =>
  legendScaleFor('temperature', {
    units: { ...DEFAULT_UNITS, temp },
    layer: 'temperature',
    precipSub: 'lluvia',
    radarLabel: (k) => k,
  });

describe('paintLegendScale', () => {
  let els: ReturnType<typeof setup>;
  beforeEach(() => {
    els = setup();
  });

  it('paints the gradient, the unit and one <li> per tick', () => {
    paintLegendScale(els, temp('F'));
    expect(els.ramp.style.backgroundImage).toMatch(
      /^linear-gradient\(to right, /
    );
    expect(els.unit.textContent).toBe('°F');
    const lis = [...els.list.querySelectorAll('li')];
    expect(lis.map((li) => li.textContent)).toEqual([
      '32',
      '50',
      '64',
      '77',
      '90',
      '113',
    ]);
    expect(lis[0].style.left).toBe('14.286%');
    expect(lis.every((li) => li.dataset.kind === 'edge')).toBe(true);
    // Without layout nothing is hidden.
    expect(els.list.querySelectorAll('[data-hidden]')).toHaveLength(0);
  });

  it('repaints in place when the unit changes (Story 19.3)', () => {
    paintLegendScale(els, temp('C'));
    paintLegendScale(els, temp('F'));
    expect(els.list.querySelectorAll('li')).toHaveLength(6);
    expect(els.unit.textContent).toBe('°F');
    expect(els.list.textContent).toContain('113');
  });

  it('pins the end ticks inside the bar', () => {
    const s = legendScaleFor('precipitation', {
      units: DEFAULT_UNITS,
      layer: 'precipitation',
      precipSub: 'lluvia',
      radarLabel: (k) => k,
    });
    paintLegendScale(els, s);
    expect(els.list.querySelector('li')?.dataset.align).toBe('start');
    const hum = legendScaleFor('humidity', {
      units: DEFAULT_UNITS,
      layer: 'humidity',
      precipSub: 'lluvia',
      radarLabel: (k) => k,
    });
    paintLegendScale(els, hum);
    expect(
      els.list.querySelector('li:last-child')?.getAttribute('data-align')
    ).toBe('end');
  });

  it('hides labels that would touch on a narrow bar, keeping the ticks', () => {
    fakeLayout(els.ramp, 60);
    const orig = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = orig(tag);
      if (tag === 'span') fakeLayout(el, 16);
      return el;
    }) as typeof document.createElement;
    try {
      paintLegendScale(els, temp('F'));
    } finally {
      document.createElement = orig;
    }
    expect(els.list.querySelectorAll('li')).toHaveLength(6);
    const hidden = els.list.querySelectorAll('[data-hidden]');
    expect(hidden.length).toBeGreaterThan(0);
    // The top of the scale always reads.
    expect(
      els.list.querySelector('li:last-child span')?.hasAttribute('data-hidden')
    ).toBe(false);
  });

  it('writes text, never markup', () => {
    const s: LegendScale = {
      bands: ['#000'],
      ticks: [
        { pos: 0.5, label: '<img src=x onerror=alert(1)>', kind: 'band' },
      ],
      unit: '<b>u</b>',
      gradient: 'none',
    };
    paintLegendScale(els, s);
    expect(els.list.querySelector('img')).toBeNull();
    expect(els.unit.querySelector('b')).toBeNull();
  });

  it('clears everything', () => {
    paintLegendScale(els, temp('C'));
    clearLegendScale(els);
    expect(els.list.children).toHaveLength(0);
    expect(els.unit.textContent).toBe('');
    expect(els.ramp.style.backgroundImage).toBe('');
  });
});
