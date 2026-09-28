// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUFFERING_UI_DELAY_MS, createTimelinePlayer } from './timeline-player';

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

  // Story 21.3 — the loop waits for the next frame to be cached.
  describe('canAdvance gate', () => {
    function gated(opts: { interval?: number } = {}) {
      const btn = mkPlayBtn();
      let cur = 0;
      const asked: number[] = [];
      const answers: Array<(ok: boolean) => void> = [];
      const player = createTimelinePlayer(
        { playBtn: btn },
        labels,
        () => 5,
        () => cur,
        (i) => {
          cur = i;
        },
        {
          reducedMotion: false,
          intervalMs: opts.interval ?? 100,
          canAdvance: (next) => {
            asked.push(next);
            return new Promise<boolean>((res) => answers.push(res));
          },
        }
      );
      return { btn, player, asked, answers, cur: () => cur };
    }

    it('holds the frame until the gate says yes, then keeps the cadence', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(g.asked).toEqual([1]);
      expect(g.cur()).toBe(0);
      // Waiting far longer than the cadence does not skip or re-ask.
      await vi.advanceTimersByTimeAsync(1000);
      expect(g.cur()).toBe(0);
      expect(g.asked).toEqual([1]);
      g.answers[0](true);
      await vi.advanceTimersByTimeAsync(0);
      expect(g.cur()).toBe(1);
      // Next tick one cadence after the advance.
      await vi.advanceTimersByTimeAsync(99);
      expect(g.asked).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1);
      expect(g.asked).toEqual([1, 2]);
    });

    it('shows the buffering state (aria-busy + loader glyph) only while pending past the delay', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(BUFFERING_UI_DELAY_MS - 1);
      expect(g.btn.hasAttribute('aria-busy')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(g.btn.getAttribute('aria-busy')).toBe('true');
      expect(g.btn.dataset.buffering).toBe('true');
      expect(g.btn.innerHTML).toContain('#i-loader');
      // Still "playing" for everything that reads the state.
      expect(g.btn.dataset.state).toBe('playing');
      expect(g.btn.getAttribute('aria-pressed')).toBe('true');
      g.answers[0](true);
      await vi.advanceTimersByTimeAsync(0);
      expect(g.btn.hasAttribute('aria-busy')).toBe(false);
      expect(g.btn.dataset.buffering).toBeUndefined();
      expect(g.btn.innerHTML).toContain('#i-pause');
    });

    it('a quick yes never flashes the spinner', async () => {
      const btn = mkPlayBtn();
      let cur = 0;
      let busySeen = false;
      const obs = new MutationObserver(() => {
        if (btn.hasAttribute('aria-busy')) busySeen = true;
      });
      obs.observe(btn, { attributes: true });
      const player = createTimelinePlayer(
        { playBtn: btn },
        labels,
        () => 5,
        () => cur,
        (i) => {
          cur = i;
        },
        {
          reducedMotion: false,
          intervalMs: 100,
          canAdvance: () => Promise.resolve(true),
        }
      );
      player.start();
      await vi.advanceTimersByTimeAsync(450);
      expect(cur).toBe(4);
      await Promise.resolve();
      obs.disconnect();
      expect(busySeen).toBe(false);
    });

    it('a "no" keeps the frame and asks again on the next cadence', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(100);
      g.answers[0](false);
      await vi.advanceTimersByTimeAsync(0);
      expect(g.cur()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(g.asked).toEqual([1, 1]);
      g.answers[1](true);
      await vi.advanceTimersByTimeAsync(0);
      expect(g.cur()).toBe(1);
    });

    it('stop() while waiting: the late answer is ignored and busy clears', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(100 + BUFFERING_UI_DELAY_MS);
      expect(g.btn.getAttribute('aria-busy')).toBe('true');
      g.player.stop();
      expect(g.btn.hasAttribute('aria-busy')).toBe(false);
      expect(g.btn.innerHTML).toContain('#i-play');
      g.answers[0](true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(g.cur()).toBe(0);
      expect(g.asked).toEqual([1]);
      // A restart asks afresh.
      g.player.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(g.asked).toEqual([1, 1]);
    });

    it('a rejecting gate does not freeze the loop', async () => {
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
        {
          reducedMotion: false,
          intervalMs: 100,
          canAdvance: () => Promise.reject(new Error('boom')),
        }
      );
      player.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(cur).toBe(1);
      player.stop();
    });
  });
});
