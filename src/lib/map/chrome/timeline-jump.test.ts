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
  createTimelineJump,
  extendedFieldEnd,
  formatJumpRange,
  fromInputValue,
  jumpBounds,
  jumpStep,
  resolveJump,
  toInputValue,
  type TimelineJumpDeps,
} from './timeline-jump';
import type { TickFormat } from './timeline-bar';
import {
  satelliteFrames,
  satelliteFramesExtended,
  satelliteDailyFrames,
} from '../../maptimeline';

const M = 60;
const H = 3600;
const DAY = 86400;
/** 2026-09-30T00:00:00Z. */
const T0 = Date.UTC(2026, 8, 30) / 1000;
const UTC_ES: TickFormat = { locale: 'es-MX', tz: 'UTC', hour12: false };

const range = (start: number, end: number, step: number): number[] => {
  const out: number[] = [];
  for (let t = start; t <= end; t += step) out.push(t);
  return out;
};
const times = (frames: { time: number }[]): number[] =>
  frames.map((f) => f.time);

describe('wall clock ↔ epoch', () => {
  it('round-trips in UTC', () => {
    const sec = T0 + 15 * H + 10 * M;
    expect(toInputValue(sec, 'UTC')).toBe('2026-09-30T15:10');
    expect(fromInputValue('2026-09-30T15:10', 'UTC')).toBe(sec);
    // Seconds, when a browser adds them, are read too.
    expect(fromInputValue('2026-09-30T15:10:30', 'UTC')).toBe(sec + 30);
  });

  it('rejects empty, malformed and impossible dates', () => {
    for (const v of [
      '',
      'mañana',
      '2026-09-30',
      '2026-13-01T00:00',
      '2026-02-31T00:00',
      '2026-09-30T24:00',
    ]) {
      expect(fromInputValue(v, 'UTC')).toBeNull();
      expect(fromInputValue(v, 'local')).toBeNull();
    }
  });

  describe('in the local zone', () => {
    beforeAll(() => {
      vi.stubEnv('TZ', 'America/Mexico_City'); // UTC−6, no DST since 2022
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it('reads and writes the local wall clock', () => {
      expect(toInputValue(T0 + 6 * H, 'local')).toBe('2026-09-30T00:00');
      expect(fromInputValue('2026-09-30T00:00', 'local')).toBe(T0 + 6 * H);
      // The same text in UTC is six hours earlier.
      expect(fromInputValue('2026-09-30T00:00', 'UTC')).toBe(T0);
    });
  });
});

describe('jumpStep', () => {
  it('is the grid every frame sits on', () => {
    expect(jumpStep(range(T0, T0 + 2 * H, 10 * M))).toBe(600);
    // Hourly then 3-hourly (the extended fields): 1 h.
    expect(
      jumpStep([
        ...range(T0, T0 + 47 * H, H),
        ...range(T0 + 48 * H, T0 + 5 * DAY, 3 * H),
      ])
    ).toBe(3600);
    // Daily product: a day.
    expect(jumpStep(range(T0, T0 + 9 * DAY, DAY))).toBe(DAY);
    // Mixed 10 / 15 min: their common 5 min.
    expect(jumpStep([T0, T0 + 10 * M, T0 + 25 * M])).toBe(300);
  });

  it('falls back to a minute off the whole-minute grid or with one frame', () => {
    expect(jumpStep([T0, T0 + 90])).toBe(60);
    expect(jumpStep([T0])).toBe(60);
    expect(jumpStep([])).toBe(60);
  });

  it('keeps the extended axis start on the grid', () => {
    expect(jumpStep(range(T0, T0 + H, 10 * M), T0 - 7 * M)).toBe(60);
    expect(jumpStep(range(T0, T0 + H, 10 * M), T0 - 5 * H)).toBe(600);
  });
});

describe('jumpBounds', () => {
  const now = T0 + 12 * H + 3 * M;

  it('is null without frames', () => {
    expect(jumpBounds([])).toBeNull();
  });

  it('radar: its own window', () => {
    const radar = range(now - 2 * H, now + 30 * M, 10 * M);
    expect(jumpBounds(radar)).toEqual({
      min: radar[0],
      max: radar[radar.length - 1],
      step: 600,
    });
  });

  it('satellite: 10 days back on the 24 h axis, via the extended axis', () => {
    const axis = times(satelliteFrames(now));
    const ext = times(satelliteFramesExtended(now));
    const b = jumpBounds(axis, { min: ext[0], max: ext[ext.length - 1] });
    expect(b).not.toBeNull();
    expect(b!.max).toBe(axis[axis.length - 1]);
    // Ten days back, less one 10-minute step (both ends are frames).
    expect(b!.max - b!.min).toBe(10 * DAY - 10 * M);
    // In words: from the first frame of the 10-day axis to the newest.
    expect(b!.min).toBe(ext[0]);
    expect(b!.step).toBe(600);
    // Daily true colour: its 10 days, a day apart.
    const daily = times(satelliteDailyFrames(now));
    expect(jumpBounds(daily)).toMatchObject({
      min: daily[0],
      max: daily[9],
      step: DAY,
    });
  });

  it('fields: −1 d … +10 d before the 10-day axis is loaded', () => {
    const today = Math.floor(now / DAY) * DAY;
    const grid = range(today - DAY, today + 48 * H - H, H);
    const end = extendedFieldEnd(now, 10, 3 * H);
    expect(end).toBe(today + 10 * DAY - 3 * H);
    const b = jumpBounds(grid, { min: grid[0], max: end });
    expect(b).toEqual({ min: today - DAY, max: end, step: H });
  });
});

describe('resolveJump', () => {
  const axis = range(T0, T0 + DAY - 10 * M, 10 * M); // 144 frames
  const b = jumpBounds(axis, { min: T0 - 9 * DAY, max: axis[143] })!;

  it('lands on the nearest frame inside the axis', () => {
    expect(resolveJump(axis, T0 + 3 * H + 4 * M, b, true)).toEqual({
      index: 18,
      target: T0 + 3 * H + 4 * M,
      extend: false,
    });
    expect(resolveJump(axis, T0 + 3 * H + 6 * M, b, true).index).toBe(19);
  });

  it('extends for an instant past the axis, when it can', () => {
    const r = resolveJump(axis, T0 - 3 * DAY, b, true);
    expect(r).toEqual({ index: 0, target: T0 - 3 * DAY, extend: true });
    // Already extended (or radar): the nearest end frame.
    expect(resolveJump(axis, T0 - 3 * DAY, b, false)).toEqual({
      index: 0,
      target: T0 - 3 * DAY,
      extend: false,
    });
    // Within half a step of the edge is the edge, no extension.
    expect(resolveJump(axis, T0 - 4 * M, b, true).extend).toBe(false);
  });

  it('clamps to the bounds', () => {
    expect(resolveJump(axis, T0 - 30 * DAY, b, true).target).toBe(b.min);
    expect(resolveJump(axis, T0 + 30 * DAY, b, true)).toEqual({
      index: 143,
      target: b.max,
      extend: false,
    });
  });

  it('forecast fields: +5 d on the 2-day grid pulls the 10-day axis', () => {
    const grid = range(T0 - DAY, T0 + 47 * H, H);
    const fb = jumpBounds(grid, {
      min: grid[0],
      max: extendedFieldEnd(T0 + H, 10, 3 * H),
    })!;
    expect(resolveJump(grid, T0 + 5 * DAY, fb, true).extend).toBe(true);
    expect(resolveJump(grid, T0 + 47 * H + 20 * M, fb, true).extend).toBe(
      false
    );
  });
});

describe('formatJumpRange', () => {
  it('names both ends in the chosen zone', () => {
    const s = formatJumpRange({ min: T0 - 9 * DAY, max: T0 + 15 * H }, UTC_ES);
    expect(s).toMatch(/^21 sept?\.?,? 00:00 – 30 sept?\.?,? 15:00 UTC$/);
  });
});

describe('createTimelineJump', () => {
  const axis = range(T0, T0 + DAY - 10 * M, 10 * M);
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  function setup(over: Partial<TimelineJumpDeps> = {}) {
    document.body.innerHTML =
      '<div id="timeline"><span id="tl-time">—</span><input id="tl-range" type="range"></div><button id="elsewhere">x</button>';
    const label = document.getElementById('tl-time')!;
    const host = document.getElementById('timeline')!;
    const rangeEl = document.getElementById('tl-range') as HTMLInputElement;
    let idx = 143;
    const state = { times: axis as number[] };
    const deps: TimelineJumpDeps = {
      getTimes: () => state.times,
      getIndex: () => idx,
      getPotential: () => ({ min: T0 - 9 * DAY, max: axis[143] }),
      canExtend: () => state.times.length === 144,
      pause: vi.fn(),
      seek: vi.fn((i: number) => {
        idx = i;
      }),
      extendTo: vi.fn(),
      format: () => UTC_ES,
      strings: () => ({ title: 'Saltar a fecha' }),
      ...over,
    };
    const jump = createTimelineJump({ label, host, range: rangeEl }, deps);
    dispose = jump.dispose;
    const panel = () => document.getElementById('tl-jump');
    const input = () =>
      document.getElementById('tl-jump-input') as HTMLInputElement;
    return { jump, deps, label, rangeEl, panel, input, state };
  }

  const pick = (input: HTMLInputElement, v: string): void => {
    input.value = v;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('a click on the label opens a bounded datetime-local input', () => {
    const { deps, label, panel, input, rangeEl } = setup();
    expect(rangeEl.getAttribute('aria-keyshortcuts')).toBe('Enter');
    label.click();
    expect(panel()!.hidden).toBe(false);
    expect(panel()!.getAttribute('role')).toBe('dialog');
    expect(panel()!.getAttribute('aria-label')).toBe('Saltar a fecha');
    expect(input().type).toBe('datetime-local');
    expect(input().min).toBe('2026-09-21T00:00');
    expect(input().max).toBe('2026-09-30T23:50');
    expect(input().step).toBe('600');
    expect(input().value).toBe('2026-09-30T23:50');
    expect(document.activeElement).toBe(input());
    expect(deps.pause).toHaveBeenCalled();
    // A second click closes it.
    label.click();
    expect(panel()!.hidden).toBe(true);
  });

  it('picking an instant seeks the nearest frame', () => {
    const { deps, label, input } = setup();
    label.click();
    pick(input(), '2026-09-30T03:04');
    expect(deps.seek).toHaveBeenLastCalledWith(18);
    expect(deps.extendTo).not.toHaveBeenCalled();
  });

  it('an instant before the loaded axis extends first', () => {
    const { deps, label, input } = setup();
    label.click();
    pick(input(), '2026-09-25T12:00');
    expect(deps.extendTo).toHaveBeenCalledWith(T0 - 4.5 * DAY);
    expect(deps.seek).not.toHaveBeenCalled();
  });

  it('Enter on the range opens it; Enter in the input confirms and returns the focus', () => {
    const { deps, rangeEl, panel, input } = setup();
    rangeEl.focus();
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    rangeEl.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(panel()!.hidden).toBe(false);
    input().value = '2026-09-30T12:00';
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(deps.seek).toHaveBeenLastCalledWith(72);
    expect(panel()!.hidden).toBe(true);
    expect(document.activeElement).toBe(rangeEl);
  });

  it('Escape cancels back to the frame it opened on and stops there', () => {
    const { deps, label, panel, input, rangeEl } = setup();
    const docEsc = vi.fn();
    document.addEventListener('keydown', docEsc);
    label.click();
    pick(input(), '2026-09-30T12:00');
    expect(deps.seek).toHaveBeenLastCalledWith(72);
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(deps.seek).toHaveBeenLastCalledWith(143);
    expect(panel()!.hidden).toBe(true);
    expect(document.activeElement).toBe(rangeEl);
    expect(docEsc).not.toHaveBeenCalled();
    document.removeEventListener('keydown', docEsc);
  });

  it('a press outside closes it', () => {
    const { label, panel } = setup();
    label.click();
    document
      .getElementById('elsewhere')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel()!.hidden).toBe(true);
  });

  it('does nothing without frames', () => {
    const { label, panel, state } = setup();
    state.times = [];
    label.click();
    expect(panel()).toBeNull();
  });

  it('dispose() removes the popover and every listener', () => {
    const { jump, deps, label, rangeEl, panel } = setup();
    label.click();
    jump.dispose();
    dispose = null;
    expect(panel()).toBeNull();
    expect(rangeEl.hasAttribute('aria-keyshortcuts')).toBe(false);
    label.click();
    rangeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(panel()).toBeNull();
    expect(jump.open()).toBe(false);
    expect(deps.pause).toHaveBeenCalledTimes(1);
  });
});
