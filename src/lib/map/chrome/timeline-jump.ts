/**
 * Timeline jump — Story 23.3 (plan PARIDAD_VISUAL E23).
 *
 * "Saltar a fecha": a click on the timeline's date label (`#tl-time`), or
 * Enter on the timeline range (`#tl-range`), opens a small popover with a
 * native `<input type="datetime-local">` bounded to what the active layer
 * can show — the satellite's 10 days of history, the forecast fields'
 * −1 d … +10 d, the radar's own window — and picking an instant lands on
 * the nearest frame. When the instant lies past the loaded axis but inside
 * what "Ver 10 días" would load (Story 15.1), the caller extends first and
 * then seeks there.
 *
 *   toInputValue / fromInputValue           wall clock ↔ epoch, per tz
 *   jumpStep / jumpBounds / resolveJump     pure bounds + nearest frame
 *   extendedFieldEnd                        last instant of the 10-d fields
 *   formatJumpRange                         the "from … to …" hint
 *   createTimelineJump()                    DOM + listeners
 *
 * `datetime-local` has no zone: its value is a wall clock, read and written
 * in the zone chosen in ⋯ → Ajustes (local or UTC), the same one the label
 * and the bar use. Time is epoch seconds throughout (`RadarFrame.time`).
 *
 * Not a button: the label stays a plain `aria-live` span, so the date is
 * not one more control over the map (the chrome budget, Story 22.5, is
 * spent) and its live announcements keep working; the keyboard route is
 * Enter on the range, which owns the timeline's focus (Story 23.1) and
 * advertises it with `aria-keyshortcuts`.
 */
import { nearestFrameIndex, type TickFormat } from './timeline-bar';

export type JumpTz = TickFormat['tz'];

/** Instants the picker allows, epoch seconds, plus its `step` (s). */
export interface JumpBounds {
  min: number;
  max: number;
  step: number;
}

/** What the active layer could show beyond its loaded frames (the axis
 *  "Ver 10 días" would load); null when nothing more can be loaded. */
export interface JumpRange {
  min: number;
  max: number;
}

export interface JumpTarget {
  /** Frame to seek to in the current axis (−1 without frames). */
  index: number;
  /** The requested instant, clamped to the bounds. */
  target: number;
  /** True when the axis must be extended first (then seek `target`). */
  extend: boolean;
}

// ---------------------------------------------------------------------
// Wall clock ↔ epoch
// ---------------------------------------------------------------------

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** `YYYY-MM-DDTHH:MM` of `sec` on the wall clock of `tz` — the format a
 *  `datetime-local` input reads and writes. */
export function toInputValue(sec: number, tz: JumpTz): string {
  const d = new Date(sec * 1000);
  const utc = tz === 'UTC';
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const mo = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const da = utc ? d.getUTCDate() : d.getDate();
  const h = utc ? d.getUTCHours() : d.getHours();
  const mi = utc ? d.getUTCMinutes() : d.getMinutes();
  return `${pad(y, 4)}-${pad(mo)}-${pad(da)}T${pad(h)}:${pad(mi)}`;
}

/** Epoch seconds of a `datetime-local` value read on the wall clock of
 *  `tz`; null for an empty, malformed or impossible date (31 Feb). */
export function fromInputValue(value: string, tz: JumpTz): number | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
      value.trim()
    );
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59)
    return null;
  let ms: number;
  if (tz === 'UTC') {
    ms = Date.UTC(y, mo - 1, d, h, mi, s);
    const back = new Date(ms);
    if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  } else {
    const local = new Date(y, mo - 1, d, h, mi, s);
    if (local.getMonth() !== mo - 1 || local.getDate() !== d) return null;
    ms = local.getTime();
  }
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// ---------------------------------------------------------------------
// Bounds and the nearest frame
// ---------------------------------------------------------------------

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * The picker's `step` in seconds: the largest whole-minute spacing every
 * frame (and the extended axis' first instant, `from`) sits on, counted
 * from the first one — 10 min on satellite and radar, 1 h on the fields
 * (hourly then 3-hourly), a day on the daily true-colour product. Capped at
 * a day; 60 when the frames are not on a whole-minute grid.
 */
export function jumpStep(times: readonly number[], from?: number): number {
  let g = 0;
  const anchor = times.length ? times[0] : 0;
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
  if (from !== undefined && times.length) deltas.push(anchor - from);
  for (const dRaw of deltas) {
    const d = Math.abs(Math.round(dRaw));
    if (d === 0) continue;
    if (d % 60 !== 0) return 60;
    g = gcd(g, d / 60);
  }
  if (g === 0) return 60;
  return Math.min(g * 60, 86400);
}

/**
 * What the picker allows: the loaded axis, widened to `potential` (the
 * axis "Ver 10 días" would load) when there is one. Null without frames.
 */
export function jumpBounds(
  times: readonly number[],
  potential: JumpRange | null = null
): JumpBounds | null {
  const n = times.length;
  if (n === 0) return null;
  let min = times[0];
  let max = times[n - 1];
  if (potential) {
    if (Number.isFinite(potential.min)) min = Math.min(min, potential.min);
    if (Number.isFinite(potential.max)) max = Math.max(max, potential.max);
  }
  return { min, max, step: jumpStep(times, min < times[0] ? min : undefined) };
}

/**
 * Where a picked instant lands: clamped to the bounds, then the nearest
 * frame of the loaded axis — unless it lies past that axis by more than
 * half a step and the axis can still grow, in which case the caller
 * extends first and seeks `target` on the longer axis.
 */
export function resolveJump(
  times: readonly number[],
  sec: number,
  bounds: JumpBounds,
  canExtend: boolean
): JumpTarget {
  const target = Math.min(bounds.max, Math.max(bounds.min, sec));
  const index = nearestFrameIndex(times, target);
  if (index < 0) return { index, target, extend: false };
  const first = times[0];
  const last = times[times.length - 1];
  const half = bounds.step / 2;
  const outside = target < first - half || target > last + half;
  return { index, target, extend: canExtend && outside };
}

/** Last instant of the extended forecast fields: Open-Meteo's
 *  `forecast_days` run from today 00:00 UTC, at `stepSec` steps. */
export function extendedFieldEnd(
  nowSec: number,
  forecastDays: number,
  stepSec: number
): number {
  const today = Math.floor(nowSec / 86400) * 86400;
  return today + forecastDays * 86400 - stepSec;
}

/** "18 sep, 15:00 – 28 sep, 15:10" in the chosen locale, zone and hour
 *  format (the hint under the input). */
export function formatJumpRange(
  b: Pick<JumpBounds, 'min' | 'max'>,
  f: TickFormat
): string {
  const fmt = new Intl.DateTimeFormat(f.locale, {
    day: 'numeric',
    month: 'short',
    hour: f.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(f.hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
    ...(f.tz === 'UTC' ? { timeZone: 'UTC' } : {}),
  });
  const text = `${fmt.format(new Date(b.min * 1000))} – ${fmt.format(
    new Date(b.max * 1000)
  )}`;
  return f.tz === 'UTC' ? `${text} UTC` : text;
}

// ---------------------------------------------------------------------
// DOM controller
// ---------------------------------------------------------------------

export interface TimelineJumpEls {
  /** The date label (`#tl-time`): a click opens the picker. */
  label: HTMLElement | null;
  /** Where the popover goes (the timeline pill, positioned). */
  host: HTMLElement | null;
  /** The timeline range: Enter on it opens the picker; focus returns to
   *  it when the picker closes from the keyboard. */
  range: HTMLInputElement | null;
}

export interface TimelineJumpStrings {
  /** Dialog name and input label ("Saltar a fecha"). */
  title: string;
}

export interface TimelineJumpDeps {
  getTimes(): readonly number[];
  getIndex(): number;
  /** The axis "Ver 10 días" would load, or null. */
  getPotential(): JumpRange | null;
  canExtend(): boolean;
  /** Pause the loop (opening the picker freezes the frame). */
  pause(): void;
  /** Pause + show frame `i` (range, label, hash, bar). */
  seek(i: number): void;
  /** Extend the axis, then seek the frame nearest `sec`. */
  extendTo(sec: number): unknown;
  format(): TickFormat;
  strings(): TimelineJumpStrings;
}

export interface TimelineJump {
  /** Open the popover; `picker` also asks the browser for its native
   *  date picker (needs the click's user activation). False without
   *  frames. */
  open(opts?: { picker?: boolean }): boolean;
  /** Close; `restoreFocus` puts the focus back on the range. */
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
  /** Remove every listener and the popover. */
  dispose(): void;
}

type PickerInput = HTMLInputElement & { showPicker?: () => void };

export function createTimelineJump(
  els: TimelineJumpEls,
  deps: TimelineJumpDeps
): TimelineJump {
  const { label, host, range } = els;
  const baseId = label?.id ? label.id.replace(/time$/, 'jump') : 'tl-jump';
  let panel: HTMLDivElement | null = null;
  let input: PickerInput | null = null;
  let hint: HTMLParagraphElement | null = null;
  let heading: HTMLLabelElement | null = null;
  let openedAt: number | null = null;
  let disposed = false;
  /** Keyboard edits of a datetime-local fire `change` once per segment
   *  (8 events for 8 digits in Chromium): seeking on each would render
   *  intermediate dates and, past the loaded axis, start the 10-day
   *  fetch. Commit once typing pauses; Enter and closing flush it. */
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const CHANGE_DEBOUNCE_MS = 500;
  function onInputChange(): void {
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      changeTimer = null;
      onChange();
    }, CHANGE_DEBOUNCE_MS);
  }
  function flushChange(): void {
    if (!changeTimer) return;
    clearTimeout(changeTimer);
    changeTimer = null;
    onChange();
  }

  function build(): boolean {
    if (panel) return true;
    if (!host) return false;
    panel = document.createElement('div');
    panel.id = baseId;
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.className =
      'tl-jump absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-xl bg-im-bg-strong p-3 text-left text-xs text-im-text shadow-lg';
    heading = document.createElement('label');
    heading.className = 'mb-1 block font-semibold';
    heading.htmlFor = `${baseId}-input`;
    input = document.createElement('input') as PickerInput;
    input.id = `${baseId}-input`;
    input.type = 'datetime-local';
    input.className =
      'block min-h-[44px] w-full rounded-md border border-white/20 bg-white/10 px-2 text-sm text-im-text [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:min-h-0 sm:py-1';
    hint = document.createElement('p');
    hint.id = `${baseId}-hint`;
    hint.className = 'mt-1 text-[11px] text-im-muted';
    input.setAttribute('aria-describedby', hint.id);
    panel.append(heading, input, hint);
    host.appendChild(panel);
    panel.addEventListener('keydown', onPanelKey);
    panel.addEventListener('focusout', onFocusOut);
    input.addEventListener('change', onInputChange);
    return true;
  }

  function isOpen(): boolean {
    return !!panel && !panel.hidden;
  }

  function currentBounds(): JumpBounds | null {
    return jumpBounds(deps.getTimes(), deps.getPotential());
  }

  function open(opts: { picker?: boolean } = {}): boolean {
    if (disposed) return false;
    const times = deps.getTimes();
    const b = currentBounds();
    if (!b || !build() || !panel || !input || !hint || !heading) return false;
    deps.pause();
    const f = deps.format();
    const s = deps.strings();
    panel.setAttribute('aria-label', s.title);
    heading.textContent = s.title;
    input.min = toInputValue(b.min, f.tz);
    input.max = toInputValue(b.max, f.tz);
    input.step = String(b.step);
    const i = deps.getIndex();
    openedAt = i >= 0 && i < times.length ? times[i] : null;
    input.value = toInputValue(openedAt ?? times[times.length - 1], f.tz);
    hint.textContent = formatJumpRange(b, f);
    panel.hidden = false;
    document.addEventListener('pointerdown', onOutside, true);
    try {
      input.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    if (opts.picker && typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        /* no user activation, or the browser has no picker: the input is
           there to type into */
      }
    }
    return true;
  }

  function close(restoreFocus = false): void {
    if (!panel || panel.hidden) return;
    flushChange();
    panel.hidden = true;
    openedAt = null;
    document.removeEventListener('pointerdown', onOutside, true);
    if (restoreFocus) {
      try {
        range?.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
  }

  function onChange(): void {
    if (!input) return;
    const sec = fromInputValue(input.value, deps.format().tz);
    if (sec === null) return;
    const times = deps.getTimes();
    const b = currentBounds();
    if (!b) return;
    const r = resolveJump(times, sec, b, deps.canExtend());
    if (r.extend) {
      void deps.extendTo(r.target);
    } else if (r.index >= 0 && r.index !== deps.getIndex()) {
      deps.seek(r.index);
    }
  }

  function onPanelKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // Cancel: back to the frame on screen when the picker opened. The
      // map's own Escape handlers (menus, measuring) must not run too.
      e.preventDefault();
      e.stopPropagation();
      const times = deps.getTimes();
      if (openedAt !== null && times.length) {
        const i = nearestFrameIndex(times, openedAt);
        if (i >= 0 && i !== deps.getIndex()) deps.seek(i);
      }
      close(true);
    } else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      e.stopPropagation();
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = null;
      onChange();
      close(true);
    }
  }

  function onFocusOut(e: FocusEvent): void {
    // Tab past the input closes; a null target is the native picker (or
    // another window) taking the focus, which must not close it.
    const to = e.relatedTarget as Node | null;
    if (to && panel && !panel.contains(to)) close(false);
  }

  function onOutside(e: Event): void {
    const t = e.target as Node | null;
    if (!t || !panel) return;
    if (panel.contains(t)) return;
    // The label toggles on its own click.
    if (label && label.contains(t)) return;
    close(false);
  }

  const onLabelClick = (): void => {
    if (isOpen()) close(false);
    else open({ picker: true });
  };
  const onRangeKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (open()) e.preventDefault();
  };
  label?.addEventListener('click', onLabelClick);
  range?.addEventListener('keydown', onRangeKey);
  range?.setAttribute('aria-keyshortcuts', 'Enter');

  return {
    open,
    close,
    isOpen,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = null;
      document.removeEventListener('pointerdown', onOutside, true);
      label?.removeEventListener('click', onLabelClick);
      range?.removeEventListener('keydown', onRangeKey);
      range?.removeAttribute('aria-keyshortcuts');
      if (panel) {
        panel.removeEventListener('keydown', onPanelKey);
        panel.removeEventListener('focusout', onFocusOut);
        input?.removeEventListener('change', onInputChange);
        panel.remove();
      }
      panel = null;
      input = null;
      hint = null;
      heading = null;
    },
  };
}
