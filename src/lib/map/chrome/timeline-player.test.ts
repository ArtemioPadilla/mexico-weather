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

  // Story 21.2 — observable before any toggle.
  it('marks the play button paused at creation (also under reduced motion)', () => {
    const btn = mkPlayBtn();
    createTimelinePlayer(
      { playBtn: btn },
      labels,
      () => 5,
      () => 0,
      () => {},
      {
        reducedMotion: true,
      }
    );
    expect(btn.dataset.state).toBe('paused');
    const btn2 = mkPlayBtn();
    btn2.dataset.state = 'playing';
    createTimelinePlayer(
      { playBtn: btn2 },
      labels,
      () => 5,
      () => 0,
      () => {},
      {
        reducedMotion: false,
      }
    );
    // A caller-set state is left alone.
    expect(btn2.dataset.state).toBe('playing');
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
      { reducedMotion: true }
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
      { reducedMotion: false }
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
      { reducedMotion: false, intervalMs: 100 }
    );
    player.start();
    expect(player.isPlaying()).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.dataset.state).toBe('playing');
    expect(btn.querySelector('use')?.getAttribute('href')).toBe('#i-pause');
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
    expect(btn.dataset.state).toBe('paused');
    expect(btn.querySelector('use')?.getAttribute('href')).toBe('#i-play');
  });

  it('toggle alternates between start and stop', () => {
    const btn = mkPlayBtn();
    const player = createTimelinePlayer(
      { playBtn: btn },
      labels,
      () => 3,
      () => 0,
      () => undefined,
      { reducedMotion: false, intervalMs: 100 }
    );
    player.toggle();
    expect(player.isPlaying()).toBe(true);
    player.toggle();
    expect(player.isPlaying()).toBe(false);
  });

  // Story 16.4 — animation controls.
  it('honours a live cadence getter and a loop window', () => {
    const btn = mkPlayBtn();
    let cur = 0;
    let interval = 100;
    const player = createTimelinePlayer(
      { playBtn: btn },
      labels,
      () => 10,
      () => cur,
      (i) => {
        cur = i;
      },
      {
        reducedMotion: false,
        getIntervalMs: () => interval,
        getLoopRange: () => [3, 5],
      }
    );
    player.start();
    // Outside the window: first tick jumps to its start.
    vi.advanceTimersByTime(100);
    expect(cur).toBe(3);
    vi.advanceTimersByTime(200);
    expect(cur).toBe(5);
    // End of window wraps to its start, not to frame 0.
    vi.advanceTimersByTime(100);
    expect(cur).toBe(3);
    // Speed change applies to the next step without restarting.
    interval = 1000;
    vi.advanceTimersByTime(100);
    expect(cur).toBe(4);
    vi.advanceTimersByTime(500);
    expect(cur).toBe(4);
    vi.advanceTimersByTime(500);
    expect(cur).toBe(5);
    player.stop();
    vi.advanceTimersByTime(3000);
    expect(cur).toBe(5);
  });
});
