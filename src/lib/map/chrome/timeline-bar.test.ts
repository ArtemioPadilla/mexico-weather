// @vitest-environment jsdom
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  BAR_PAD,
  TAIL_ARM_PX,
  WHEEL_STEP_PX,
  axisDomain,
  buildTicks,
  createTimelineBar,
  formatDayLabel,
  formatHourLabel,
  formatValueText,
  frameIndexAtX,
  labelWidth,
  layoutLabels,
  nearestFrameIndex,
  pickTickSteps,
  timeToX,
  wheelStep,
  xToTime,
  type BarBox,
  type Domain,
  type TickFormat,
} from './timeline-bar';

const H = 3600;
const DAY = 86400;
/** 2026-09-30T00:00:00Z, a Wednesday. */
const T0 = Date.UTC(2026, 8, 30) / 1000;
const UTC_ES: TickFormat = { locale: 'es-MX', tz: 'UTC', hour12: false };
const UTC_EN: TickFormat = { locale: 'en-US', tz: 'UTC', hour12: false };
/** Intl puts U+202F / U+00A0 in "3 p.m."; compare on plain spaces. */
const plain = (s: string): string => s.replace(/[\u202f\u00a0]/g, ' ');

const range = (from: number, to: number, stepSec: number): number[] => {
  const out: number[] = [];
  for (let t = from; t <= to; t += stepSec) out.push(t);
  return out;
};

describe('geometry: time ↔ px', () => {
  const d: Domain = { start: T0, end: T0 + 24 * H };
  const box: BarBox = { width: 300, pad: 10 };

  it('maps the ends of the domain to the padded edges', () => {
    expect(timeToX(d.start, d, box)).toBe(10);
    expect(timeToX(d.end, d, box)).toBe(290);
    expect(timeToX(T0 + 12 * H, d, box)).toBe(150);
  });

  it('round-trips an instant through its pixel', () => {
    for (const t of [T0, T0 + 3 * H, T0 + 17.5 * H, d.end]) {
      expect(xToTime(timeToX(t, d, box), d, box)).toBeCloseTo(t, 6);
    }
  });

  it('clamps pixels outside the bar to the domain', () => {
    expect(xToTime(-50, d, box)).toBe(d.start);
    expect(xToTime(5, d, box)).toBe(d.start);
    expect(xToTime(500, d, box)).toBe(d.end);
  });

  it('centres a single-instant domain and never divides by zero', () => {
    const one: Domain = { start: T0, end: T0 };
    expect(timeToX(T0, one, box)).toBe(150);
    expect(xToTime(42, one, box)).toBe(T0);
    expect(xToTime(42, d, { width: 10, pad: 10 })).toBe(d.start);
  });

  it('finds the nearest frame, ties to the earlier one', () => {
    const times = [0, 600, 1200, 3600, 7200];
    expect(nearestFrameIndex([], 5)).toBe(-1);
    expect(nearestFrameIndex(times, -100)).toBe(0);
    expect(nearestFrameIndex(times, 299)).toBe(0);
    expect(nearestFrameIndex(times, 300)).toBe(0);
    expect(nearestFrameIndex(times, 301)).toBe(1);
    expect(nearestFrameIndex(times, 2500)).toBe(3);
    expect(nearestFrameIndex(times, 99999)).toBe(4);
  });

  it('picks the frame under a pixel on an uneven (hourly + 3-hourly) axis', () => {
    // 48 hourly frames then 3-hourly to +10 d (the Story 15.1 merge).
    const times = [
      ...range(T0, T0 + 47 * H, H),
      ...range(T0 + 48 * H, T0 + 240 * H, 3 * H),
    ];
    const dd = axisDomain(times, T0) as Domain;
    const bx: BarBox = { width: 480, pad: 0 };
    expect(frameIndexAtX(times, 0, dd, bx)).toBe(0);
    expect(frameIndexAtX(times, 480, dd, bx)).toBe(times.length - 1);
    // 1/5 of 240 h = 48 h → the first 3-hourly frame.
    expect(times[frameIndexAtX(times, 96, dd, bx)]).toBe(T0 + 48 * H);
  });

  it('stretches the domain to a nearby "now" only', () => {
    const times = range(T0, T0 + 24 * H, 600);
    expect(axisDomain([], T0)).toBeNull();
    // GeoColor lags ~30 min: the bar runs on to now.
    expect(axisDomain(times, T0 + 24.5 * H)).toEqual({
      start: T0,
      end: T0 + 24.5 * H,
    });
    expect(axisDomain(times, T0 - H)).toEqual({
      start: T0 - H,
      end: T0 + 24 * H,
    });
    // A stale page (now far past the data) keeps the data span.
    expect(axisDomain(times, T0 + 40 * H)).toEqual({
      start: T0,
      end: T0 + 24 * H,
    });
    expect(axisDomain(times, T0 + 5 * H)).toEqual({
      start: T0,
      end: T0 + 24 * H,
    });
  });
});

describe('tick choice by range', () => {
  it('3 h over 240 px: 10-min ticks, hourly labels', () => {
    expect(pickTickSteps(3 * H, 240)).toEqual({
      minor: 10,
      label: 60,
      dayEvery: 1,
    });
  });

  it('24 h over 240 px: hourly ticks, a label every 6 h', () => {
    expect(pickTickSteps(24 * H, 240)).toEqual({
      minor: 60,
      label: 360,
      dayEvery: 1,
    });
  });

  it('10 d over 288 px: 6-hourly ticks, no hour labels, every other day', () => {
    expect(pickTickSteps(11 * DAY, 288)).toEqual({
      minor: 360,
      label: null,
      dayEvery: 2,
    });
  });

  it('gets denser on a wider bar and handles degenerate input', () => {
    expect(pickTickSteps(24 * H, 960)).toEqual({
      minor: 10,
      label: 120,
      dayEvery: 1,
    });
    expect(pickTickSteps(0, 300)).toEqual({
      minor: null,
      label: null,
      dayEvery: 1,
    });
    expect(pickTickSteps(DAY, 0).minor).toBeNull();
    // A month on a tiny bar: midnights only, labels weekly.
    expect(pickTickSteps(30 * DAY, 100)).toEqual({
      minor: null,
      label: null,
      dayEvery: 7,
    });
  });

  it('builds the 3 h ticks on the wall clock', () => {
    const d: Domain = {
      start: T0 + 12 * H + 5 * 60,
      end: T0 + 15 * H + 5 * 60,
    };
    const ticks = buildTicks(d, pickTickSteps(3 * H, 240), 'UTC');
    // 12:10 … 15:00 every 10 min = 18 ticks; 13:00, 14:00, 15:00 labelled.
    expect(ticks).toHaveLength(18);
    expect(ticks[0].t).toBe(T0 + 12 * H + 10 * 60);
    expect(ticks.filter((t) => t.kind === 'label').map((t) => t.t)).toEqual([
      T0 + 13 * H,
      T0 + 14 * H,
      T0 + 15 * H,
    ]);
    expect(ticks.some((t) => t.kind === 'day')).toBe(false);
    // Ascending, no duplicates.
    for (let i = 1; i < ticks.length; i++)
      expect(ticks[i].t).toBeGreaterThan(ticks[i - 1].t);
  });

  it('builds the 24 h ticks with the midnight as a labelled day tick', () => {
    const d: Domain = { start: T0 - 12 * H, end: T0 + 12 * H };
    const ticks = buildTicks(d, pickTickSteps(24 * H, 240), 'UTC');
    expect(ticks).toHaveLength(25);
    const days = ticks.filter((t) => t.kind === 'day');
    expect(days).toEqual([{ t: T0, kind: 'day', labelled: true }]);
    expect(ticks.filter((t) => t.kind === 'label').map((t) => t.t)).toEqual([
      T0 - 12 * H,
      T0 - 6 * H,
      T0 + 6 * H,
      T0 + 12 * H,
    ]);
  });

  it('builds the 10 d ticks: 11 midnights, every other one labelled', () => {
    const d: Domain = { start: T0 - 12 * H, end: T0 + 10 * DAY + 12 * H };
    const ticks = buildTicks(d, pickTickSteps(11 * DAY, 288), 'UTC');
    const days = ticks.filter((t) => t.kind === 'day');
    expect(days).toHaveLength(11);
    expect(days.filter((t) => t.labelled).map((t) => t.t)).toEqual(
      [0, 2, 4, 6, 8, 10].map((k) => T0 + k * DAY)
    );
    expect(ticks.some((t) => t.kind === 'label')).toBe(false);
    // Six-hourly: 12:00 and 18:00 on day −1, 4 a day for 10 days, then
    // 00:00, 06:00 and 12:00 on day 10.
    expect(ticks).toHaveLength(2 + 40 + 3);
  });

  describe('in the local zone', () => {
    beforeAll(() => {
      vi.stubEnv('TZ', 'America/Mexico_City'); // UTC−6, no DST since 2022
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it('aligns midnights and labels to the local wall clock', () => {
      const d: Domain = { start: T0, end: T0 + DAY };
      const ticks = buildTicks(d, pickTickSteps(DAY, 240), 'local');
      const days = ticks.filter((t) => t.kind === 'day');
      // Local midnight of 30 sep is 06:00 UTC.
      expect(days.map((t) => t.t)).toEqual([T0 + 6 * H]);
      expect(formatHourLabel(T0 + 6 * H, { ...UTC_ES, tz: 'local' })).toBe(
        '00:00'
      );
    });
  });
});

describe('labels', () => {
  it('formats hours per settings (24 h, 12 h, off the hour)', () => {
    expect(formatHourLabel(T0 + 15 * H, UTC_ES)).toBe('15:00');
    expect(
      plain(formatHourLabel(T0 + 15 * H, { ...UTC_ES, hour12: true }))
    ).toBe('3 p.m.');
    expect(
      plain(formatHourLabel(T0 + 15 * H, { ...UTC_EN, hour12: true }))
    ).toBe('3 PM');
    expect(
      plain(formatHourLabel(T0 + 15.5 * H, { ...UTC_EN, hour12: true }))
    ).toBe('3:30 PM');
  });

  it('formats days weekday-first in both languages', () => {
    expect(formatDayLabel(T0, UTC_ES)).toBe('mié 30');
    expect(formatDayLabel(T0, UTC_EN)).toBe('Wed 30');
  });

  it('spells the full instant for screen readers, with UTC when set', () => {
    expect(formatValueText(T0 + 15 * H, UTC_ES)).toBe(
      'miércoles, 30 de septiembre, 15:00 UTC'
    );
    expect(formatValueText(T0 + 15 * H, UTC_EN)).toMatch(
      /^Wednesday, September 30.*15:00 UTC$/
    );
  });

  it('lays labels out without overlaps and names the opening day', () => {
    const box: BarBox = { width: 254, pad: BAR_PAD };
    const d: Domain = { start: T0 - 12 * H, end: T0 + 12 * H };
    const ticks = buildTicks(d, pickTickSteps(24 * H, 240), 'UTC');
    const labels = layoutLabels(ticks, d, box, UTC_ES);
    const texts = labels.map((l) => l.text);
    // Lead day (tue 29) at the left edge, then the 30th at its midnight.
    expect(texts[0]).toBe('mar 29');
    expect(texts).toContain('mié 30');
    // 18:00 fits between; 00:00 is the day label's spot; 06:00 fits.
    expect(texts).toContain('18:00');
    expect(texts).toContain('06:00');
    expect(texts).not.toContain('00:00');
    const spans = labels.map((l) =>
      l.anchor === 'start'
        ? [l.x, l.x + labelWidth(l.text)]
        : [l.x - labelWidth(l.text) / 2, l.x + labelWidth(l.text) / 2]
    );
    for (let i = 1; i < spans.length; i++)
      expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    for (const [a, b] of spans) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(box.width);
    }
  });

  it('drops the lead label when a midnight sits right at the start', () => {
    const box: BarBox = { width: 254, pad: BAR_PAD };
    const d: Domain = { start: T0 - 10 * 60, end: T0 + 24 * H };
    const ticks = buildTicks(d, pickTickSteps(d.end - d.start, 240), 'UTC');
    const days = layoutLabels(ticks, d, box, UTC_ES).filter(
      (l) => l.kind === 'day'
    );
    expect(days.map((l) => l.text)).toEqual(['mié 30']);
  });
});

describe('wheelStep', () => {
  it('turns a mouse notch into one step and carries trackpad crumbs', () => {
    expect(wheelStep(0, 100)).toEqual({
      steps: 2,
      acc: 100 - 2 * WHEEL_STEP_PX,
    });
    let r = wheelStep(0, 15);
    expect(r).toEqual({ steps: 0, acc: 15 });
    r = wheelStep(r.acc, 15);
    r = wheelStep(r.acc, 15);
    expect(r).toEqual({ steps: 1, acc: 5 });
  });

  it('drops the remainder when the direction flips', () => {
    expect(wheelStep(30, -20)).toEqual({ steps: 0, acc: -20 });
    expect(wheelStep(-30, -20)).toEqual({ steps: -1, acc: -10 });
  });
});

describe('createTimelineBar', () => {
  const WIDTH = 214; // inner 200 px
  let bar: HTMLDivElement;
  let rangeEl: HTMLInputElement;
  let times: number[];
  let index: number;
  let extendable: boolean;
  const seek = vi.fn((i: number) => {
    index = i;
  });
  const extend = vi.fn(async () => {
    times = range(T0, T0 + 20 * H, H);
    extendable = false;
    return true;
  });

  function setup(nowSec = T0 + 10 * H) {
    document.body.innerHTML =
      '<input id="tl-range" type="range"><div id="tl-bar"></div>';
    bar = document.getElementById('tl-bar') as HTMLDivElement;
    rangeEl = document.getElementById('tl-range') as HTMLInputElement;
    bar.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 0,
        width: WIDTH,
        height: 36,
        right: 100 + WIDTH,
        bottom: 36,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    times = range(T0, T0 + 10 * H, H); // 11 hourly frames
    index = 5;
    extendable = true;
    seek.mockClear();
    extend.mockClear();
    return createTimelineBar(
      { bar, range: rangeEl },
      {
        getTimes: () => times,
        getIndex: () => index,
        seek,
        canExtend: () => extendable,
        extend,
        format: () => UTC_ES,
        now: () => nowSec,
      }
    );
  }

  const pointer = (type: string, clientX: number, extra = {}) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      ...extra,
    });

  beforeAll(() => {
    // jsdom lacks PointerEvent; MouseEvent carries clientX / button.
    if (typeof window.PointerEvent === 'undefined') {
      class PE extends MouseEvent {
        pointerId: number;
        pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
          this.pointerType = init.pointerType ?? '';
        }
      }
      (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
      (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PE;
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('draws the scale, the shades, "now" and the thumb (aria-hidden)', () => {
    const b = setup();
    const svg = bar.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe(String(WIDTH));
    expect(bar.querySelector('[data-part="past"]')).not.toBeNull();
    // now == last frame: no future stretch.
    expect(bar.querySelector('[data-part="future"]')).toBeNull();
    expect(bar.querySelectorAll('[data-part^="tick-"]').length).toBeGreaterThan(
      5
    );
    expect(bar.querySelector('[data-part="label-day"]')?.textContent).toBe(
      'mié 30'
    );
    const thumb = bar.querySelector('[data-part="thumb"]')!;
    // Frame 5 of 0..10 → the middle of the 200 px inner width.
    expect(thumb.getAttribute('transform')).toBe(
      `translate(${BAR_PAD + 100} 0)`
    );
    expect(bar.dataset.index).toBe('5');
    index = 10;
    b.update();
    expect(thumb.getAttribute('transform')).toBe(
      `translate(${BAR_PAD + 200} 0)`
    );
    b.dispose();
  });

  it('shades the future past "now"', () => {
    const b = setup(T0 + 4 * H);
    const future = bar.querySelector('[data-part="future"]')!;
    expect(Number(future.getAttribute('x'))).toBeCloseTo(BAR_PAD + 80, 5);
    const now = bar.querySelector('[data-part="now"]')!;
    expect(now.getAttribute('visibility')).toBe('visible');
    expect(Number(now.getAttribute('x1'))).toBeCloseTo(BAR_PAD + 80, 5);
    b.dispose();
  });

  it('seeks on press and keeps seeking while dragging, before release', () => {
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafs.push(cb);
      return rafs.length;
    });
    const b = setup();
    // x = 100 (left) + 7 (pad) + 20 px per hour × 2 → frame 2.
    bar.dispatchEvent(pointer('pointerdown', 100 + BAR_PAD + 40));
    expect(seek).toHaveBeenLastCalledWith(2);
    expect(document.activeElement).toBe(rangeEl);
    expect(bar.dataset.dragging).toBe('true');
    bar.dispatchEvent(pointer('pointermove', 100 + BAR_PAD + 158));
    bar.dispatchEvent(pointer('pointermove', 100 + BAR_PAD + 160));
    expect(rafs).toHaveLength(1); // coalesced into one frame
    rafs.shift()!(0);
    expect(seek).toHaveBeenLastCalledWith(8);
    bar.dispatchEvent(pointer('pointerup', 100 + BAR_PAD + 180));
    expect(seek).toHaveBeenLastCalledWith(9);
    expect(bar.dataset.dragging).toBeUndefined();
    // Moves after release do nothing.
    const calls = seek.mock.calls.length;
    bar.dispatchEvent(pointer('pointermove', 100));
    expect(rafs).toHaveLength(0);
    expect(seek.mock.calls.length).toBe(calls);
    b.dispose();
  });

  it('ignores a right click', () => {
    const b = setup();
    bar.dispatchEvent(pointer('pointerdown', 110, { button: 2 }));
    expect(seek).not.toHaveBeenCalled();
    b.dispose();
  });

  it('dragging onto the dotted tail pulls the 10-day axis once', async () => {
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafs.push(cb);
      return rafs.length;
    });
    const move = (x: number) => {
      bar.dispatchEvent(pointer('pointermove', x));
      rafs.shift()?.(0);
    };
    const b = setup();
    bar.dispatchEvent(pointer('pointerdown', 150));
    move(100 + WIDTH + TAIL_ARM_PX + 5);
    move(100 + WIDTH + TAIL_ARM_PX + 20);
    expect(extend).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    // The redraw ran on the 20 h axis.
    expect(bar.dataset.frames).toBe('21');
    // Past the edge without a tail to pull: clamps to the last frame.
    move(100 + WIDTH + TAIL_ARM_PX + 30);
    expect(seek).toHaveBeenLastCalledWith(20);
    bar.dispatchEvent(pointer('pointerup', 100 + WIDTH + TAIL_ARM_PX + 30));
    b.dispose();
  });

  it('steps with ← → Home End on the range, and → at the end extends', async () => {
    const b = setup();
    const key = (k: string) => {
      const e = new KeyboardEvent('keydown', { key: k, cancelable: true });
      rangeEl.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(key('ArrowRight')).toBe(true);
    expect(index).toBe(6);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(index).toBe(4);
    key('Home');
    expect(index).toBe(0);
    key('ArrowLeft'); // stays at 0
    expect(index).toBe(0);
    key('End');
    expect(index).toBe(10);
    key('ArrowRight');
    expect(extend).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(index).toBe(11);
    // Other keys stay native (↑ ↓ PageUp …), and so do modified ones.
    expect(key('ArrowUp')).toBe(false);
    const e = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      altKey: true,
      cancelable: true,
    });
    rangeEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    b.dispose();
  });

  it('steps with the wheel and hands it back to the page at the ends', () => {
    const b = setup();
    const wheel = (deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaY, cancelable: true });
      bar.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(wheel(100)).toBe(true);
    expect(index).toBe(6);
    expect(wheel(-100)).toBe(true);
    expect(index).toBe(5);
    index = 0;
    expect(wheel(-100)).toBe(false);
    expect(index).toBe(0);
    index = 10;
    extendable = false;
    expect(wheel(100)).toBe(false);
    b.dispose();
  });

  it('draws nothing while hidden and cleans every listener up', () => {
    const b = setup();
    bar.getBoundingClientRect = () => ({ width: 0, left: 0 }) as DOMRect;
    index = 1;
    b.update();
    expect(bar.dataset.index).toBe('5'); // untouched while hidden
    b.dispose();
    seek.mockClear();
    bar.dispatchEvent(pointer('pointerdown', 150));
    rangeEl.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', cancelable: true })
    );
    expect(seek).not.toHaveBeenCalled();
  });

  it('is a no-op without its elements', () => {
    const b = createTimelineBar(
      { bar: null, range: null },
      {
        getTimes: () => [],
        getIndex: () => -1,
        seek,
        canExtend: () => false,
        extend,
        format: () => UTC_ES,
      }
    );
    expect(() => b.update(true)).not.toThrow();
    b.dispose();
  });
});
