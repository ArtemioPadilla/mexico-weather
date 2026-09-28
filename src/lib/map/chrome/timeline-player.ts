/**
 * Timeline play/pause auto-advance loop.
 *
 * Owns the play state + window.setInterval that walks the active
 * frame index forward at a fixed cadence (700 ms). prefers-reduced-
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
 */

/** A gate that answers within this long never shows the spinner (a
 *  cached frame resolves in a microtask; no flicker every tick). */
export const BUFFERING_UI_DELAY_MS = 150;
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
  let timer = 0;
  let buffering = false;
  let busyTimer = 0;
  /** Bumped by stop()/start(): a gate answer from an older run is void. */
  let run = 0;
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

  function stop(): void {
    playing = false;
    run++;
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    if (busyTimer) {
      window.clearTimeout(busyTimer);
      busyTimer = 0;
    }
    buffering = false;
    syncBtn();
  }

  function tick(): void {
    if (!playing) return;
    const n = getFrameCount();
    if (n < 2) {
      stop();
      return;
    }
    let [lo, hi] = opts.getLoopRange?.() ?? [0, n - 1];
    lo = Math.max(0, Math.min(lo, n - 1));
    hi = Math.max(lo, Math.min(hi, n - 1));
    const cur = getCurrentIndex();
    const next = cur < lo || cur >= hi ? lo : cur + 1;
    timer = 0;
    if (!opts.canAdvance) {
      advanceTo(next);
      timer = window.setTimeout(tick, intervalMs());
      return;
    }
    const myRun = run;
    let answered = false;
    busyTimer = window.setTimeout(() => {
      busyTimer = 0;
      if (!answered && myRun === run) setBuffering(true);
    }, BUFFERING_UI_DELAY_MS);
    const settle = (ok: boolean): void => {
      answered = true;
      if (myRun !== run || !playing) return;
      // A "not yet" keeps the spinner up until a later tick gets a yes.
      if (ok) {
        setBuffering(false);
        advanceTo(next);
      }
      timer = window.setTimeout(tick, intervalMs());
    };
    // A throwing / rejecting gate must not freeze the loop: advance.
    let gate: Promise<boolean>;
    try {
      gate = opts.canAdvance(next);
    } catch {
      gate = Promise.resolve(true);
    }
    gate.then(settle, () => settle(true));
  }

  function start(): void {
    if (reduced || getFrameCount() < 2) return;
    if (playing) return;
    playing = true;
    run++;
    syncBtn();
    // A re-armed timeout (not setInterval) so the cadence getter is
    // honoured on every step.
    timer = window.setTimeout(tick, intervalMs());
  }

  // Reduced motion: disable the play button outright + leave label
  // in its initial state. The caller may still call start()/stop()
  // programmatically but the timer won't engage.
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
  };
}
