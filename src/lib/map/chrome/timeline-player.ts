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
 */
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
  /** Test seam for prefers-reduced-motion. */
  reducedMotion?: boolean;
}

export function createTimelinePlayer(
  els: TimelinePlayerEls,
  labels: TimelinePlayerStrings,
  getFrameCount: () => number,
  getCurrentIndex: () => number,
  advanceTo: (i: number) => void,
  opts: TimelinePlayerOpts = {},
): TimelinePlayer {
  let playing = false;
  let timer = 0;
  const intervalMs = opts.intervalMs ?? 700;
  const reduced =
    opts.reducedMotion ??
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function syncBtn(): void {
    if (!els.playBtn) return;
    els.playBtn.setAttribute('aria-pressed', String(playing));
    els.playBtn.setAttribute('aria-label', playing ? labels.pause : labels.play);
    els.playBtn.textContent = playing ? '⏸' : '▶';
  }

  function stop(): void {
    playing = false;
    if (timer) {
      window.clearInterval(timer);
      timer = 0;
    }
    syncBtn();
  }

  function start(): void {
    if (reduced || getFrameCount() < 2) return;
    playing = true;
    syncBtn();
    timer = window.setInterval(() => {
      const n = getFrameCount();
      if (n < 2) {
        stop();
        return;
      }
      const cur = getCurrentIndex();
      const next = cur + 1 >= n ? 0 : cur + 1;
      advanceTo(next);
    }, intervalMs);
  }

  // Reduced motion: disable the play button outright + leave label
  // in its initial state. The caller may still call start()/stop()
  // programmatically but the timer won't engage.
  if (els.playBtn) {
    els.playBtn.disabled = reduced;
    if (reduced) els.playBtn.title = labels.play;
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
