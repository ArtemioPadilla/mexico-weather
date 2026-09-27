import { describe, expect, it } from 'vitest';
import { needsWeekday, relativeFrameLabel } from './timeline-label';

const S = { now: 'Ahora' };

describe('relativeFrameLabel', () => {
  it('0 → now', () => {
    expect(relativeFrameLabel(0, S)).toBe('Ahora');
  });
  it('under an hour → minutes, signed', () => {
    expect(relativeFrameLabel(-35, S)).toBe('−35 min');
    expect(relativeFrameLabel(20, S)).toBe('+20 min');
  });
  it('under a day → hours, rounded', () => {
    expect(relativeFrameLabel(90, S)).toBe('+2 h');
    expect(relativeFrameLabel(-23 * 60, S)).toBe('−23 h');
  });
  it('a day or more → days with half-day precision', () => {
    expect(relativeFrameLabel(24 * 60, S)).toBe('+1 d');
    expect(relativeFrameLabel(60 * 60, S)).toBe('+2.5 d');
    expect(relativeFrameLabel(9 * 24 * 60 + 60, S)).toBe('+9 d');
  });
});

describe('needsWeekday', () => {
  it('only from 24 h away', () => {
    expect(needsWeekday(23 * 60)).toBe(false);
    expect(needsWeekday(24 * 60)).toBe(true);
    expect(needsWeekday(-3 * 24 * 60)).toBe(true);
  });
});
