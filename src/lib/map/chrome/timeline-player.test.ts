// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUFFERING_UI_DELAY_MS,
  PHASE_TOLERANCE,
  createTimelinePlayer,
  nextAnchor,
} from './timeline-player';
import type { FrameScheduler } from './timeline-player';

function mkPlayBtn(): HTMLButtonElement {
  return document.createElement('button');
}

const labels = { play: 'Reproducir', pause: 'Pausar' };

/** Vitest's fake requestAnimationFrame fires every 16 ms (timestamps on
 *  the same clock as the faked performance.now()); cadences below are
 *  multiples of 16 so a step lands exactly on its due frame. */
const FRAME = 16;
const STEP = 160;

/** Hand-driven frame scheduler: `frame(ts)` runs what is queued. */
function manualFrames(): FrameScheduler & {
  frame: (ts: number) => void;
  pending: () => number;
  requests: () => number;
} {
  let id = 0;
  let requests = 0;
  const queue = new Map<number, (ts: number) => void>();
  return {
    request: (cb) => {
      requests++;
      queue.set(++id, cb);
      return id;
    },
    cancel: (i) => {
      queue.delete(i);
    },
    frame: (ts) => {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(ts);
    },
    pending: () => queue.size,
    requests: () => requests,
  };
}

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
      { reducedMotion: false, intervalMs: STEP }
    );
    player.start();
    expect(player.isPlaying()).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.dataset.state).toBe('playing');
    expect(btn.querySelector('use')?.getAttribute('href')).toBe('#i-pause');
    vi.advanceTimersByTime(STEP);
    expect(cur).toBe(1);
    vi.advanceTimersByTime(STEP);
    expect(cur).toBe(2);
    vi.advanceTimersByTime(STEP);
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
    let interval = STEP;
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
    vi.advanceTimersByTime(STEP);
    expect(cur).toBe(3);
    vi.advanceTimersByTime(2 * STEP);
    expect(cur).toBe(5);
    // End of window wraps to its start, not to frame 0.
    vi.advanceTimersByTime(STEP);
    expect(cur).toBe(3);
    // Story 23.2 — the cadence is read every frame, so a speed change
    // applies to the step already being waited on, without a restart.
    vi.advanceTimersByTime(STEP / 2);
    interval = 10 * STEP;
    vi.advanceTimersByTime(STEP / 2);
    expect(cur).toBe(3);
    vi.advanceTimersByTime(9 * STEP - FRAME);
    expect(cur).toBe(3);
    vi.advanceTimersByTime(FRAME);
    expect(cur).toBe(4);
    player.stop();
    vi.advanceTimersByTime(30 * STEP);
    expect(cur).toBe(4);
  });

  // Story 21.3 — the loop waits for the next frame to be cached.
  describe('canAdvance gate', () => {
    function gated() {
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
          intervalMs: STEP,
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
      await vi.advanceTimersByTimeAsync(STEP);
      expect(g.asked).toEqual([1]);
      expect(g.cur()).toBe(0);
      // Waiting far longer than the cadence does not skip or re-ask.
      await vi.advanceTimersByTimeAsync(1000);
      expect(g.cur()).toBe(0);
      expect(g.asked).toEqual([1]);
      g.answers[0](true);
      await vi.advanceTimersByTimeAsync(0);
      expect(g.cur()).toBe(1);
      // Story 23.2 — a long wait re-anchors: the next ask comes one
      // cadence after the advance (the first frame at or past it).
      await vi.advanceTimersByTimeAsync(STEP - 1);
      expect(g.asked).toEqual([1]);
      await vi.advanceTimersByTimeAsync(FRAME);
      expect(g.asked).toEqual([1, 2]);
    });

    it('shows the buffering state (aria-busy + loader glyph) only while pending past the delay', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(STEP);
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

    it('a quick yes never flashes the spinner and keeps the cadence', async () => {
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
          intervalMs: STEP,
          canAdvance: () => Promise.resolve(true),
        }
      );
      player.start();
      // An immediate yes steps in the frame that asked: 4 cadences, 4 steps.
      await vi.advanceTimersByTimeAsync(4 * STEP);
      expect(cur).toBe(4);
      await Promise.resolve();
      obs.disconnect();
      expect(busySeen).toBe(false);
      player.stop();
    });

    it('a "no" keeps the frame and asks again on the next cadence', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(STEP);
      g.answers[0](false);
      await vi.advanceTimersByTimeAsync(0);
      expect(g.cur()).toBe(0);
      await vi.advanceTimersByTimeAsync(STEP);
      expect(g.asked).toEqual([1, 1]);
      g.answers[1](true);
      await vi.advanceTimersByTimeAsync(0);
      expect(g.cur()).toBe(1);
    });

    it('stop() while waiting: the late answer is ignored and busy clears', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(STEP + BUFFERING_UI_DELAY_MS);
      expect(g.btn.getAttribute('aria-busy')).toBe('true');
      g.player.stop();
      expect(g.btn.hasAttribute('aria-busy')).toBe(false);
      expect(g.btn.innerHTML).toContain('#i-play');
      g.answers[0](true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(g.cur()).toBe(0);
      expect(g.asked).toEqual([1]);
      // A restart asks afresh (one cadence later, on the next frame: the
      // restart is off the 16 ms frame grid here).
      g.player.start();
      await vi.advanceTimersByTimeAsync(STEP + FRAME);
      expect(g.asked).toEqual([1, 1]);
    });

    it('stop() before a late yes: the step is dropped and nothing is left scheduled', async () => {
      const g = gated();
      g.player.start();
      await vi.advanceTimersByTimeAsync(STEP);
      g.player.stop();
      g.answers[0](true);
      await vi.advanceTimersByTimeAsync(10 * STEP);
      expect(g.cur()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
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
          intervalMs: STEP,
          canAdvance: () => Promise.reject(new Error('boom')),
        }
      );
      player.start();
      await vi.advanceTimersByTimeAsync(STEP);
      expect(cur).toBe(1);
      player.stop();
    });

    it('requests no animation frame while the gate is pending', async () => {
      const frames = manualFrames();
      let answer: ((ok: boolean) => void) | null = null;
      let cur = 0;
      const player = createTimelinePlayer(
        { playBtn: mkPlayBtn() },
        labels,
        () => 5,
        () => cur,
        (i) => {
          cur = i;
        },
        {
          reducedMotion: false,
          intervalMs: 700,
          frames,
          now: () => 0,
          canAdvance: () =>
            new Promise<boolean>((res) => {
              answer = res;
            }),
        }
      );
      player.start();
      frames.frame(700);
      expect(answer).not.toBeNull();
      expect(frames.pending()).toBe(0);
      const before = frames.requests();
      await vi.advanceTimersByTimeAsync(2000);
      expect(frames.requests()).toBe(before);
      answer!(true);
      await Promise.resolve();
      expect(cur).toBe(1);
      // Frame callbacks resume with the step.
      expect(frames.pending()).toBe(1);
      player.destroy();
    });
  });

  // Story 23.2 — requestAnimationFrame + timestamps.
  describe('frame scheduling', () => {
    function plain(frames: ReturnType<typeof manualFrames>, t0 = 0) {
      let cur = 0;
      const steps: number[] = [];
      let clock = t0;
      const player = createTimelinePlayer(
        { playBtn: mkPlayBtn() },
        labels,
        () => 100,
        () => cur,
        (i) => {
          cur = i;
          steps.push(clock);
        },
        { reducedMotion: false, intervalMs: 700, frames, now: () => t0 }
      );
      const at = (ts: number): void => {
        clock = ts;
        frames.frame(ts);
      };
      return { player, steps, at, cur: () => cur };
    }

    it('steps on the first frame at or past the due time, never before', () => {
      const f = manualFrames();
      const p = plain(f, 1000);
      p.player.start();
      expect(f.pending()).toBe(1);
      p.at(1016);
      p.at(1699);
      expect(p.steps).toEqual([]);
      p.at(1700);
      expect(p.steps).toEqual([1700]);
      expect(f.pending()).toBe(1);
    });

    it('keeps the phase when frames land a little late (no drift)', () => {
      const f = manualFrames();
      const p = plain(f);
      p.player.start();
      // Every step lands 12 ms late (a 60 Hz frame boundary after due).
      for (let k = 1; k <= 10; k++) {
        p.at(k * 700 - 5);
        p.at(k * 700 + 12);
      }
      expect(p.steps).toEqual(
        Array.from({ length: 10 }, (_, k) => (k + 1) * 700 + 12)
      );
    });

    it('keeps the phase on a slow renderer too (frames every 150 ms)', () => {
      const f = manualFrames();
      const p = plain(f);
      p.player.start();
      for (let ts = 150; ts <= 7_050; ts += 150) p.at(ts);
      // Due at 700, 1400, 2100…; taken on the first 150 ms frame past
      // each: 10 steps in 7 s, not 7 s / (700 + ~75 ms).
      expect(p.steps).toEqual([
        750, 1_500, 2_100, 2_850, 3_600, 4_200, 4_950, 5_700, 6_300, 7_050,
      ]);
    });

    it('re-anchors after a stall instead of bursting through missed steps', () => {
      const f = manualFrames();
      const p = plain(f);
      p.player.start();
      p.at(700);
      // Hidden tab: no frames for 10 s, then one frame.
      p.at(10_700 + 700 * PHASE_TOLERANCE + 1);
      expect(p.steps).toHaveLength(2);
      // The next frames do not catch up the ~14 skipped steps.
      p.at(11_200);
      p.at(11_700);
      expect(p.steps).toHaveLength(2);
      p.at(11_051 + 700);
      expect(p.steps).toHaveLength(3);
    });

    it('stop() and destroy() cancel the pending frame; destroy() is final', () => {
      const f = manualFrames();
      const p = plain(f);
      p.player.start();
      expect(f.pending()).toBe(1);
      p.player.stop();
      expect(f.pending()).toBe(0);
      p.player.start();
      expect(f.pending()).toBe(1);
      p.player.destroy();
      expect(f.pending()).toBe(0);
      expect(p.player.isPlaying()).toBe(false);
      p.player.start();
      p.player.toggle();
      expect(p.player.isPlaying()).toBe(false);
      expect(f.pending()).toBe(0);
    });

    it('drives the loop on requestAnimationFrame, not on setTimeout', () => {
      const raf = vi.spyOn(window, 'requestAnimationFrame');
      const timeout = vi.spyOn(window, 'setTimeout');
      let cur = 0;
      const player = createTimelinePlayer(
        { playBtn: mkPlayBtn() },
        labels,
        () => 3,
        () => cur,
        (i) => {
          cur = i;
        },
        { reducedMotion: false, intervalMs: STEP }
      );
      player.start();
      vi.advanceTimersByTime(3 * STEP);
      expect(cur).toBe(0); // wrapped: 1, 2, 0
      expect(raf).toHaveBeenCalled();
      expect(timeout).not.toHaveBeenCalled();
      player.destroy();
      expect(vi.getTimerCount()).toBe(0);
      raf.mockRestore();
      timeout.mockRestore();
    });
  });
});

describe('nextAnchor', () => {
  it('keeps the due time for a step up to half a cadence late', () => {
    expect(PHASE_TOLERANCE).toBe(0.5);
    expect(nextAnchor(700, 700, 700)).toBe(700);
    expect(nextAnchor(700, 716, 700)).toBe(700);
    expect(nextAnchor(700, 1_050, 700)).toBe(700);
  });
  it('re-anchors on the step time after a stall', () => {
    expect(nextAnchor(700, 1_051, 700)).toBe(1_051);
    expect(nextAnchor(700, 10_000, 700)).toBe(10_000);
    // The tolerance scales with the cadence (fast speed: 350 ms).
    expect(nextAnchor(350, 600, 350)).toBe(600);
  });
});
