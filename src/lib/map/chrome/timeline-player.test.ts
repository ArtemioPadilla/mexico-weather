// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimelinePlayer } from './timeline-player';

function mkPlayBtn(): HTMLButtonElement {
  return document.createElement('button');
}

const labels = { play: 'Reproducir', pause: 'Pausar' };

describe('createTimelinePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() with reducedMotion=true is a no-op', () => {
    const btn = mkPlayBtn();
    let cur = 0;
    const player = createTimelinePlayer(
      { playBtn: btn },
      labels,
      () => 5,
      () => cur,
      (i) => {
        cur = i;
      },
      { reducedMotion: true },
    );
    player.start();
    vi.advanceTimersByTime(2000);
    expect(cur).toBe(0);
    expect(btn.disabled).toBe(true);
    expect(player.isPlaying()).toBe(false);
  });

  it('start() with <2 frames is a no-op', () => {
    const btn = mkPlayBtn();
    let cur = 0;
    const player = createTimelinePlayer(
      { playBtn: btn },
      labels,
      () => 1,
      () => cur,
      (i) => {
        cur = i;
      },
      { reducedMotion: false },
    );
    player.start();
    expect(player.isPlaying()).toBe(false);
  });

  it('start() ticks forward at intervalMs, wraps at last frame', () => {
    const btn = mkPlayBtn();
    let cur = 0;
    const player = createTimelinePlayer(
      { playBtn: btn },
      labels,
      () => 3,
      () => cur,
      (i) => {
        cur = i;
      },
      { reducedMotion: false, intervalMs: 100 },
    );
    player.start();
    expect(player.isPlaying()).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('⏸');
    vi.advanceTimersByTime(100);
    expect(cur).toBe(1);
    vi.advanceTimersByTime(100);
    expect(cur).toBe(2);
    vi.advanceTimersByTime(100);
    // Wraps to 0.
    expect(cur).toBe(0);
    player.stop();
    expect(player.isPlaying()).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('▶');
  });

  it('toggle alternates between start and stop', () => {
    const btn = mkPlayBtn();
    const player = createTimelinePlayer(
      { playBtn: btn },
      labels,
      () => 3,
      () => 0,
      () => undefined,
      { reducedMotion: false, intervalMs: 100 },
    );
    player.toggle();
    expect(player.isPlaying()).toBe(true);
    player.toggle();
    expect(player.isPlaying()).toBe(false);
  });
});
