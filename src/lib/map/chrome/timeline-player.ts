/**
 * Timeline play/pause auto-advance loop.
 *
 * Owns the play state and walks the active frame index forward at the
 * cadence of the "velocidad" setting (700 ms by default). prefers-reduced-
 * motion users get the play button disabled.
 *
 * Decoupled from the rest of the timeline: the caller passes a
 * `getFrameCount()` getter and an `advanceTo(frameIndex)` callback,
 * so this module knows nothing about radar/field/wind specifics.
 *
 * UI side-effects (play button label / aria-pressed) are handled
 * inside so the caller doesn't need to mirror them.
 *
 * Story 21.3 — an optional `canAdvance(nextIndex)` gate holds the loop
 * on the current frame until the next one is cached (60 fps or nothing:
 * never step onto an empty frame). While it is pending for longer than
 * BUFFERING_UI_DELAY_MS the play button shows a buffering state:
 * `aria-busy="true"`, `data-buffering`, and the spinning `#i-loader`
 * sprite glyph instead of pause.
 *
 * Story 23.2 — scheduled on `requestAnimationFrame` + timestamps instead
 * of a re-armed `setTimeout`. A step is due `intervalMs` after the
 * previous one (the cadence getter is read every frame, so a speed
 * change applies to the step being waited on) and is taken in the first
 * frame callback at or past that time, so the new frame's DOM and map
 * mutations land right before the browser paints. The phase is kept (a
 * step a frame late does not push every later step back: on a device
 * that renders at 10–20 fps that lateness would otherwise add up to
 * whole frames per step) but never caught up: after a stall — a hidden
 * tab, where rAF stops and the loop with it, or a long task — the loop
 * re-anchors instead of bursting through the frames it missed. While the
 * gate is pending no frame callback is requested at all.
 */

/** A gate that answers within this long never shows the spinner (a
 *  cached frame resolves in a microtask; no flicker every tick). */
export const BUFFERING_UI_DELAY_MS = 150;

/** A step at most this fraction of the cadence late keeps the loop's
 *  phase (rAF quantises the due time to a frame boundary: ≤ 16.7 ms at
 *  60 Hz, 50–150 ms on a device rendering the map at 7–20 fps); later
 *  than that is a stall and the cadence re-anchors. Half a cadence keeps
 *  two steps at least half a cadence apart — never a burst. */
export const PHASE_TOLERANCE = 0.5;

/** Frame scheduler (requestAnimationFrame / cancelAnimationFrame shape). */
export interface FrameScheduler {
  request: (cb: (ts: number) => void) => number;
  cancel: (id: number) => void;
}

/** Where the cadence counts the next step from, after a step taken at
 *  `ts` that was due at `prevDue`: `prevDue` (phase kept) when it is at
 *  most PHASE_TOLERANCE × `intervalMs` late, else `ts` (a stall
 *  re-anchors instead of catching up). */
export function nextAnchor(
  prevDue: number,
  ts: number,
  intervalMs: number
): number {
  return ts - prevDue <= intervalMs * PHASE_TOLERANCE ? prevDue : ts;
}

export interface TimelinePlayerEls {
  playBtn: HTMLButtonElement | null;
}

export interface TimelinePlayerStrings {
  play: string;
  pause: string;
}

export interface TimelinePlayer {
  start: () => void;
  stop: () => void;
  toggle: () => void;
  isPlaying: () => boolean;
  reducedMotion: () => boolean;
  /** Story 23.2 — stop for good: cancels the pending frame callback and
   *  the buffering timer, voids a gate answer still in flight, and makes
   *  any later `start()` a no-op (a boot autoplay promise resolving after
   *  the map is gone cannot restart the loop). */
  destroy: () => void;
}

export interface TimelinePlayerOpts {
  /** Frames per second feel; tune in ms. Default 700. */
  intervalMs?: number;
  /** Story 16.4 — live cadence getter (settings "velocidad"); read
   *  before every tick so a change applies mid-loop. Wins over
   *  `intervalMs` when present. */
  getIntervalMs?: () => number;
  /** Story 16.4 — inclusive [start, end] index window the loop cycles
   *  through (settings "duración del loop"). Read every tick; a frame
   *  outside the window jumps to its start on the next tick. Default:
   *  the whole axis. */
  getLoopRange?: () => [number, number];
  /** Test seam for prefers-reduced-motion. */
  reducedMotion?: boolean;
  /** Story 21.3 — resolves true when frame `nextIndex` can be shown
   *  (its tiles are cached). The tick waits for it; `false` keeps the
   *  current frame and retries on the next cadence. Absent: advance
   *  unconditionally (embeds, data saver, field/wind layers). */
  canAdvance?: (nextIndex: number) => Promise<boolean>;
  /** Story 23.2 — test seam: the frame scheduler. Default
   *  `requestAnimationFrame` (a ~16 ms `setTimeout` where there is none). */
  frames?: FrameScheduler;
  /** Story 23.2 — test seam: the clock rAF timestamps are compared with.
   *  Default `performance.now()`. */
  now?: () => number;
}

function defaultFrames(): FrameScheduler {
  if (typeof requestAnimationFrame === 'function') {
    return {
      request: (cb) => requestAnimationFrame(cb),
      cancel: (id) => cancelAnimationFrame(id),
    };
  }
  return {
    request: (cb) =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number,
    cancel: (id) => clearTimeout(id),
  };
}

export function createTimelinePlayer(
  els: TimelinePlayerEls,
  labels: TimelinePlayerStrings,
  getFrameCount: () => number,
  getCurrentIndex: () => number,
  advanceTo: (i: number) => void,
  opts: TimelinePlayerOpts = {}
): TimelinePlayer {
  let playing = false;
  let destroyed = false;
  /** Pending frame callback (0: none). */
  let rafId = 0;
  /** Timestamp the cadence counts from: the previous step (or start). */
  let anchor = 0;
  /** A canAdvance answer is awaited: no frame callbacks meanwhile. */
  let gatePending = false;
  let buffering = false;
  let busyTimer = 0;
  /** Bumped by stop()/start(): a gate answer from an older run is void. */
  let run = 0;
  const frames = opts.frames ?? defaultFrames();
  const now = opts.now ?? ((): number => performance.now());
  const intervalMs = (): number =>
    opts.getIntervalMs?.() ?? opts.intervalMs ?? 700;
  const reduced =
    opts.reducedMotion ??
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function syncBtn(): void {
    if (!els.playBtn) return;
    els.playBtn.setAttribute('aria-pressed', String(playing));
    els.playBtn.setAttribute(
      'aria-label',
      playing ? labels.pause : labels.play
    );
    // Sprite icons (IconSprite.astro); the play glyph used to be the
    // '▶' text character, which iOS renders as a coloured emoji.
    // Story 21.3 — buffering: spinner glyph (motion-safe only; reduced
    // motion never plays anyway) + aria-busy while the gate is pending.
    els.playBtn.innerHTML = !playing
      ? '<svg class="h-4 w-4" aria-hidden="true"><use href="#i-play"></use></svg>'
      : buffering
        ? '<svg class="h-4 w-4 motion-safe:animate-spin" aria-hidden="true"><use href="#i-loader"></use></svg>'
        : '<svg class="h-4 w-4" aria-hidden="true"><use href="#i-pause"></use></svg>';
    els.playBtn.dataset.state = playing ? 'playing' : 'paused';
    if (playing && buffering) {
      els.playBtn.setAttribute('aria-busy', 'true');
      els.playBtn.dataset.buffering = 'true';
    } else {
      els.playBtn.removeAttribute('aria-busy');
      delete els.playBtn.dataset.buffering;
    }
  }

  function setBuffering(on: boolean): void {
    if (busyTimer) {
      window.clearTimeout(busyTimer);
      busyTimer = 0;
    }
    if (buffering === on) return;
    buffering = on;
    syncBtn();
  }

  function requestFrame(cb: (ts: number) => void): void {
    if (rafId) frames.cancel(rafId);
    rafId = frames.request((ts) => {
      rafId = 0;
      cb(ts);
    });
  }

  function stop(): void {
    playing = false;
    run++;
    gatePending = false;
    if (rafId) {
      frames.cancel(rafId);
      rafId = 0;
    }
    if (busyTimer) {
      window.clearTimeout(busyTimer);
      busyTimer = 0;
    }
    buffering = false;
    syncBtn();
  }

  /** Index the loop steps to from the current frame (window-aware), or
   *  null when there is nothing to loop over. */
  function nextIndex(): number | null {
    const n = getFrameCount();
    if (n < 2) return null;
    let [lo, hi] = opts.getLoopRange?.() ?? [0, n - 1];
    lo = Math.max(0, Math.min(lo, n - 1));
    hi = Math.max(lo, Math.min(hi, n - 1));
    const cur = getCurrentIndex();
    return cur < lo || cur >= hi ? lo : cur + 1;
  }

  /** Frame callback while playing: waits for the step to be due. */
  function onFrame(ts: number): void {
    if (!playing || gatePending) return;
    const cadence = intervalMs();
    const due = anchor + cadence;
    if (ts < due) {
      requestFrame(onFrame);
      return;
    }
    const next = nextIndex();
    if (next === null) {
      stop();
      return;
    }
    if (!opts.canAdvance) {
      advanceTo(next);
      anchor = nextAnchor(due, ts, cadence);
      requestFrame(onFrame);
      return;
    }
    askGate(next, due, cadence);
  }

  function askGate(next: number, due: number, cadence: number): void {
    const myRun = run;
    let answered = false;
    gatePending = true;
    if (busyTimer) window.clearTimeout(busyTimer);
    busyTimer = window.setTimeout(() => {
      busyTimer = 0;
      if (!answered && myRun === run) setBuffering(true);
    }, BUFFERING_UI_DELAY_MS);
    const settle = (ok: boolean): void => {
      answered = true;
      if (myRun !== run || !playing) return;
      if (!ok) {
        // "Not yet": keep the frame (and the spinner, if it is up) and
        // ask again one cadence from now.
        gatePending = false;
        anchor = now();
        requestFrame(onFrame);
        return;
      }
      // Applied right away: a gate that answers at once (a cached
      // frame, a settled swap) resolves in the microtask checkpoint of
      // the frame callback that asked, i.e. still before that frame
      // paints. Deferring it to the next frame would add a whole frame
      // to every step — 100–150 ms where the map renders at 7–10 fps.
      gatePending = false;
      setBuffering(false);
      advanceTo(next);
      // A quick yes keeps the phase; a long wait starts a new cadence
      // from the moment the frame could finally be shown.
      anchor = nextAnchor(due, now(), cadence);
      requestFrame(onFrame);
    };
    // A throwing / rejecting gate must not freeze the loop: advance.
    let gate: Promise<boolean>;
    try {
      gate = opts.canAdvance!(next);
    } catch {
      gate = Promise.resolve(true);
    }
    gate.then(settle, () => settle(true));
  }

  function start(): void {
    if (destroyed || reduced || getFrameCount() < 2) return;
    if (playing) return;
    playing = true;
    run++;
    gatePending = false;
    anchor = now();
    syncBtn();
    requestFrame(onFrame);
  }

  // Reduced motion: disable the play button outright + leave label
  // in its initial state. The caller may still call start()/stop()
  // programmatically but the loop won't engage.
  if (els.playBtn) {
    els.playBtn.disabled = reduced;
    if (reduced) els.playBtn.title = labels.play;
    // Story 21.2 — the state is readable before the first toggle, so a
    // boot that does NOT autoplay (reduced motion, data saver) is
    // observable as `paused` rather than as a missing attribute.
    if (!els.playBtn.dataset.state) els.playBtn.dataset.state = 'paused';
  }

  return {
    start,
    stop,
    toggle: (): void => {
      if (playing) stop();
      else start();
    },
    isPlaying: (): boolean => playing,
    reducedMotion: (): boolean => reduced,
    destroy: (): void => {
      destroyed = true;
      stop();
    },
  };
}
