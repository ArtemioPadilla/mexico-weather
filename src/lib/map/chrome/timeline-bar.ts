/**
 * Timeline bar — Story 23.1 (plan PARIDAD_VISUAL E23).
 *
 * zoom.earth's timeline is a bar you read and drag, not a slider in a
 * pill: a date scale with hour and day ticks, the past and the future
 * shaded apart, a "now" mark and the current frame as a thumb. This module
 * draws that bar as an SVG and turns pointer drags, wheel notches and the
 * ← → Home End keys into frame seeks. The native `<input type=range>`
 * (`#tl-range`) stays the accessible control: it is visually hidden, keeps
 * the keyboard focus (clicking the bar focuses it) and carries the frame
 * index; the bar is its picture (`aria-hidden`), both kept in sync by the
 * caller's `seek()`, which moves the range too.
 *
 *   axisDomain / timeToX / xToTime / nearestFrameIndex   pure geometry
 *   pickTickSteps / buildTicks / layoutLabels            pure tick choice
 *   formatHourLabel / formatDayLabel / formatValueText   Intl, per settings
 *   wheelStep                                            pure wheel notches
 *   createTimelineBar()                                  DOM + listeners
 *
 * Time is epoch seconds throughout (the `RadarFrame.time` unit); widths
 * are CSS pixels.
 */

// ---------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------

/** The instants the bar spans, epoch seconds. */
export interface Domain {
  start: number;
  end: number;
}

/** Bar width and the inner padding that keeps the thumb inside it. */
export interface BarBox {
  width: number;
  pad: number;
}

/**
 * The span the bar draws: first to last frame, stretched to "now" when
 * now lies just past either end (≤ `slack` × the span), so the mark shows
 * where the data stops — GeoColor's newest frame is ~30 min old, and that
 * gap is worth seeing. Null without frames.
 */
export function axisDomain(
  times: readonly number[],
  now: number,
  slack = 0.25
): Domain | null {
  if (times.length === 0) return null;
  let start = times[0];
  let end = times[times.length - 1];
  const span = end - start;
  if (span > 0) {
    if (now > end && now - end <= span * slack) end = now;
    else if (now < start && start - now <= span * slack) start = now;
  }
  return { start, end };
}

function innerWidth(box: BarBox): number {
  return Math.max(0, box.width - 2 * box.pad);
}

/** Pixel x of instant `t` (not clamped: callers clip what they draw). */
export function timeToX(t: number, d: Domain, box: BarBox): number {
  const inner = innerWidth(box);
  if (d.end <= d.start) return box.pad + inner / 2;
  return box.pad + ((t - d.start) / (d.end - d.start)) * inner;
}

/** Instant under pixel `x`, clamped to the domain. */
export function xToTime(x: number, d: Domain, box: BarBox): number {
  const inner = innerWidth(box);
  if (inner <= 0 || d.end <= d.start) return d.start;
  const f = Math.min(1, Math.max(0, (x - box.pad) / inner));
  return d.start + f * (d.end - d.start);
}

/** Index of the frame closest to `t` in ascending `times` (−1 if none);
 *  a tie goes to the earlier frame. */
export function nearestFrameIndex(times: readonly number[], t: number): number {
  const n = times.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && t - times[lo - 1] <= times[lo] - t) return lo - 1;
  return lo;
}

/** Frame index under pixel `x` (−1 without frames). */
export function frameIndexAtX(
  times: readonly number[],
  x: number,
  d: Domain,
  box: BarBox
): number {
  return nearestFrameIndex(times, xToTime(x, d, box));
}

// ---------------------------------------------------------------------
// Tick choice
// ---------------------------------------------------------------------

/** Candidate spacings, in minutes, for unlabelled and labelled hour ticks
 *  (each divides a day, so ticks land on the same wall-clock times every
 *  day). Past 12 h only midnights are drawn. */
export const MINOR_STEPS_MIN = [10, 15, 30, 60, 120, 180, 360, 720] as const;
export const LABEL_STEPS_MIN = [30, 60, 120, 180, 360, 720] as const;
/** Label every k-th day when a day is too narrow for its label. */
export const DAY_LABEL_EVERY = [1, 2, 3, 5, 7] as const;

export interface TickDensity {
  /** Closest two unlabelled ticks may sit. */
  minMinorPx: number;
  /** Room one hour label ("15:00", "3 p.m.") needs. */
  minLabelPx: number;
  /** Room one day label ("mié 30") needs. */
  minDayLabelPx: number;
}

export const DEFAULT_DENSITY: TickDensity = {
  minMinorPx: 6,
  minLabelPx: 44,
  minDayLabelPx: 44,
};

export interface TickSteps {
  /** Minutes between hour ticks; null when only midnights fit. */
  minor: number | null;
  /** Minutes between labelled hour ticks; null for day labels only. */
  label: number | null;
  /** Label every k-th midnight. */
  dayEvery: number;
}

/** The densest tick spacing that still leaves the minimum room between
 *  ticks and labels, for a span of `spanSec` drawn over `innerPx`. */
export function pickTickSteps(
  spanSec: number,
  innerPx: number,
  density: TickDensity = DEFAULT_DENSITY
): TickSteps {
  if (!(spanSec > 0) || !(innerPx > 0)) {
    return { minor: null, label: null, dayEvery: 1 };
  }
  const pxPerMin = innerPx / (spanSec / 60);
  const minor =
    MINOR_STEPS_MIN.find((s) => s * pxPerMin >= density.minMinorPx) ?? null;
  const label =
    minor === null
      ? null
      : (LABEL_STEPS_MIN.find(
          (s) =>
            s >= minor && s % minor === 0 && s * pxPerMin >= density.minLabelPx
        ) ?? null);
  const dayEvery =
    DAY_LABEL_EVERY.find((k) => k * 1440 * pxPerMin >= density.minDayLabelPx) ??
    DAY_LABEL_EVERY[DAY_LABEL_EVERY.length - 1];
  return { minor, label, dayEvery };
}

/** Wall clock the ticks align to: the visitor's zone or UTC (⚙ setting). */
export type TickZone = 'local' | 'UTC';

export interface Tick {
  t: number;
  /** `day` = a midnight, `label` = a labelled hour, `minor` = the rest. */
  kind: 'day' | 'label' | 'minor';
  /** Midnights only: whether this one carries a day label. */
  labelled?: boolean;
}

/** Epoch ms of `minutes` past the wall-clock midnight starting at
 *  `dayStartMs` (DST-aware in the local zone: 02:00 is 02:00). */
function wallTime(dayStartMs: number, minutes: number, tz: TickZone): number {
  const d = new Date(dayStartMs);
  if (tz === 'UTC') d.setUTCMinutes(minutes);
  else d.setMinutes(minutes);
  return d.getTime();
}

function dayStart(ms: number, tz: TickZone): number {
  const d = new Date(ms);
  if (tz === 'UTC') d.setUTCHours(0, 0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function nextDay(dayStartMs: number, tz: TickZone): number {
  const d = new Date(dayStartMs);
  if (tz === 'UTC') d.setUTCDate(d.getUTCDate() + 1);
  else d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Every tick inside the domain, ascending, aligned to wall-clock hours
 *  in `tz`. Midnights are `day` ticks; every `dayEvery`-th one (counted
 *  from the first inside the domain) is labelled. */
export function buildTicks(d: Domain, steps: TickSteps, tz: TickZone): Tick[] {
  const out: Tick[] = [];
  if (!(d.end > d.start)) return out;
  const startMs = d.start * 1000;
  const endMs = d.end * 1000;
  let dayIdx = 0;
  const seen = new Set<number>();
  // A safety cap: the density rules never get near it (10-min ticks only
  // fit spans of a few hours), but a bogus width must not hang the tab.
  const MAX_TICKS = 2000;
  for (
    let day = dayStart(startMs, tz);
    day <= endMs && out.length < MAX_TICKS;
    day = nextDay(day, tz)
  ) {
    if (day >= startMs) {
      out.push({
        t: day / 1000,
        kind: 'day',
        labelled: dayIdx % steps.dayEvery === 0,
      });
      seen.add(day);
      dayIdx++;
    }
    if (steps.minor === null) continue;
    for (let m = steps.minor; m < 1440; m += steps.minor) {
      const ms = wallTime(day, m, tz);
      if (ms < startMs || ms > endMs || seen.has(ms)) continue;
      // A DST jump can push a wall time into the next day: skip it there.
      if (ms >= nextDay(day, tz)) continue;
      seen.add(ms);
      out.push({
        t: ms / 1000,
        kind: steps.label !== null && m % steps.label === 0 ? 'label' : 'minor',
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export interface TickFormat {
  /** BCP 47 locale for weekday / hour names ("es-MX", "en-US"). */
  locale: string;
  tz: TickZone;
  hour12: boolean;
}

function zoneOpt(f: TickFormat): Intl.DateTimeFormatOptions {
  return f.tz === 'UTC' ? { timeZone: 'UTC' } : {};
}

/** "15:00" / "3 p.m." ("15:30" / "3:30 p.m." off the hour). */
export function formatHourLabel(sec: number, f: TickFormat): string {
  const date = new Date(sec * 1000);
  const minute = f.tz === 'UTC' ? date.getUTCMinutes() : date.getMinutes();
  const opts: Intl.DateTimeFormatOptions = f.hour12
    ? {
        hour: 'numeric',
        hour12: true,
        ...(minute ? { minute: '2-digit' } : {}),
      }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return new Intl.DateTimeFormat(f.locale, { ...opts, ...zoneOpt(f) }).format(
    date
  );
}

/** "mié 30" / "Wed 30" — weekday then day, in every locale. */
export function formatDayLabel(sec: number, f: TickFormat): string {
  const parts = new Intl.DateTimeFormat(f.locale, {
    weekday: 'short',
    day: 'numeric',
    ...zoneOpt(f),
  }).formatToParts(new Date(sec * 1000));
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${wd} ${day}`.trim();
}

/** The full instant for screen readers (`aria-valuetext` of the range):
 *  "miércoles, 30 de septiembre, 15:00" (+ " UTC"). */
export function formatValueText(sec: number, f: TickFormat): string {
  const text = new Intl.DateTimeFormat(f.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: f.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(f.hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
    ...zoneOpt(f),
  }).format(new Date(sec * 1000));
  return f.tz === 'UTC' ? `${text} UTC` : text;
}

/** Rough label width at the bar's 10 px font (tabular digits, ~0.58 em). */
export function labelWidth(text: string): number {
  return Math.ceil(text.length * 5.8);
}

export interface PlacedLabel {
  x: number;
  text: string;
  kind: 'day' | 'hour';
  /** SVG text-anchor: days read from their midnight on, hours centre. */
  anchor: 'start' | 'middle';
}

const LABEL_GAP_PX = 6;

/**
 * Where the labels go: every labelled midnight gets a day label starting
 * at its tick; labelled hours are centred on theirs and dropped when they
 * would collide with a day label or leave the bar. When no day label
 * falls near the start, a "lead" day label at the left edge names the day
 * the bar opens on — the date is readable from the bar alone.
 */
export function layoutLabels(
  ticks: readonly Tick[],
  d: Domain,
  box: BarBox,
  f: TickFormat
): PlacedLabel[] {
  const days: PlacedLabel[] = [];
  for (const tk of ticks) {
    if (tk.kind === 'day' && tk.labelled) {
      days.push({
        x: timeToX(tk.t, d, box) + 3,
        text: formatDayLabel(tk.t, f),
        kind: 'day',
        anchor: 'start',
      });
    }
  }
  const lead: PlacedLabel = {
    x: box.pad,
    text: formatDayLabel(d.start, f),
    kind: 'day',
    anchor: 'start',
  };
  const leadEnd = lead.x + labelWidth(lead.text) + LABEL_GAP_PX;
  const firstDayX = days.length ? days[0].x : Infinity;
  if (firstDayX > leadEnd && d.end > d.start) days.unshift(lead);
  // Drop day labels that would overrun the next one or the right edge.
  const keptDays: PlacedLabel[] = [];
  for (let i = 0; i < days.length; i++) {
    const end = days[i].x + labelWidth(days[i].text);
    const nextX = i + 1 < days.length ? days[i + 1].x : Infinity;
    if (end + LABEL_GAP_PX > nextX) continue;
    if (end > box.width) continue;
    keptDays.push(days[i]);
  }
  const busy = keptDays.map((l) => [
    l.x - LABEL_GAP_PX,
    l.x + labelWidth(l.text) + LABEL_GAP_PX,
  ]);
  const hours: PlacedLabel[] = [];
  for (const tk of ticks) {
    if (tk.kind !== 'label') continue;
    const x = timeToX(tk.t, d, box);
    const text = formatHourLabel(tk.t, f);
    const half = labelWidth(text) / 2;
    if (x - half < 0 || x + half > box.width) continue;
    if (busy.some(([a, b]) => x + half > a && x - half < b)) continue;
    const prev = hours[hours.length - 1];
    if (prev && prev.x + labelWidth(prev.text) / 2 + LABEL_GAP_PX > x - half)
      continue;
    hours.push({ x, text, kind: 'hour', anchor: 'middle' });
  }
  return [...keptDays, ...hours].sort((a, b) => a.x - b.x);
}

// ---------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------

/** Pixels of wheel travel per frame step (one mouse notch is ~100 px in
 *  Chromium; a trackpad sends many small deltas that add up). */
export const WHEEL_STEP_PX = 40;

/** Fold one wheel delta (px, + = forward) into the running total:
 *  whole steps taken now and the remainder carried to the next event.
 *  A change of direction drops the old remainder. */
export function wheelStep(
  acc: number,
  delta: number,
  threshold = WHEEL_STEP_PX
): { steps: number; acc: number } {
  let next =
    Math.sign(acc) !== 0 && Math.sign(acc) !== Math.sign(delta)
      ? delta
      : acc + delta;
  const steps = Math.trunc(next / threshold) || 0; // never −0
  next -= steps * threshold;
  return { steps, acc: next };
}

// ---------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------

export interface TimelineBarEls {
  /** Container the SVG is drawn into (the pointer / wheel target). */
  bar: HTMLElement | null;
  /** `#tl-range`: keyboard focus and the accessible value. */
  range: HTMLInputElement | null;
}

export interface TimelineBarDeps {
  /** Frame instants, epoch seconds, ascending. */
  getTimes: () => readonly number[];
  /** Current frame index (−1 without frames). */
  getIndex: () => number;
  /** Show frame `i` — the caller pauses the loop, moves `#tl-range`,
   *  the label and the hash, and calls `update()` back. */
  seek: (i: number) => void;
  /** Whether a longer (10-day) axis can be loaded right now. */
  canExtend: () => boolean;
  /** Load it; resolves true when the axis grew. */
  extend: () => Promise<boolean>;
  /** Locale / zone / hour format, read on every redraw (⚙ applies live). */
  format: () => TickFormat;
  /** Epoch seconds; test seam. */
  now?: () => number;
}

export interface TimelineBar {
  /** Redraw: the thumb and "now" always, ticks when the axis, the width
   *  or the format changed (`force` redraws everything). */
  update: (force?: boolean) => void;
  dispose: () => void;
}

/** Height of the drawn bar, CSS px (the pill's 44 px buttons fit around). */
export const BAR_HEIGHT = 36;
/** Inner padding: the thumb's radius plus a hair. */
export const BAR_PAD = 7;
/** "Now" this close outside the drawn span still gets its mark (pinned
 *  to the edge): the span is only recomputed once a minute. */
export const NOW_SLACK_SEC = 120;
/** How far past the bar's right edge a drag must go to pull "10 días". */
export const TAIL_ARM_PX = 12;

const SVG_NS = 'http://www.w3.org/2000/svg';
const TRACK_Y = 20;
const TRACK_H = 6;
const LABEL_Y = 10;

function svgEl(
  doc: Document,
  tag: string,
  attrs: Record<string, string | number>
): SVGElement {
  const e = doc.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export function createTimelineBar(
  els: TimelineBarEls,
  deps: TimelineBarDeps
): TimelineBar {
  const bar = els.bar;
  const range = els.range;
  const nowSec = (): number => deps.now?.() ?? Date.now() / 1000;
  const doc = bar?.ownerDocument ?? document;
  const win = doc.defaultView ?? window;

  let svg: SVGSVGElement | null = null;
  let scale: SVGGElement | null = null;
  let nowLine: SVGElement | null = null;
  let thumb: SVGGElement | null = null;
  let scaleKey = '';
  let domain: Domain | null = null;
  let box: BarBox = { width: 0, pad: BAR_PAD };

  if (bar) {
    svg = svgEl(doc, 'svg', {
      class: 'tl-bar-svg',
      height: BAR_HEIGHT,
      'aria-hidden': 'true',
      focusable: 'false',
    }) as SVGSVGElement;
    scale = svgEl(doc, 'g', { 'data-part': 'scale' }) as SVGGElement;
    nowLine = svgEl(doc, 'line', {
      'data-part': 'now',
      y1: 13,
      y2: 33,
      stroke: '#fbbf24',
      'stroke-width': 2,
      'stroke-linecap': 'round',
    });
    thumb = svgEl(doc, 'g', { 'data-part': 'thumb' }) as SVGGElement;
    thumb.append(
      svgEl(doc, 'line', {
        x1: 0,
        x2: 0,
        y1: 14,
        y2: 32,
        stroke: '#fff',
        'stroke-width': 2,
      }),
      svgEl(doc, 'circle', {
        cx: 0,
        cy: TRACK_Y + TRACK_H / 2,
        r: 5.5,
        fill: '#fff',
        stroke: '#3b82f6',
        'stroke-width': 2.5,
      })
    );
    svg.append(scale, nowLine, thumb);
    bar.replaceChildren(svg);
  }

  function measureWidth(): number {
    if (!bar) return 0;
    return Math.round(bar.getBoundingClientRect().width || bar.clientWidth);
  }

  function drawScale(times: readonly number[], now: number): void {
    if (!scale || !svg) return;
    const f = deps.format();
    const d = axisDomain(times, now);
    domain = d;
    scale.replaceChildren();
    svg.setAttribute('width', String(box.width));
    svg.setAttribute('viewBox', `0 0 ${box.width} ${BAR_HEIGHT}`);
    const x0 = box.pad;
    const x1 = box.width - box.pad;
    // Track: the whole span, then past (≤ now) and future (> now) shades.
    scale.append(
      svgEl(doc, 'rect', {
        'data-part': 'track',
        x: x0,
        y: TRACK_Y,
        width: Math.max(0, x1 - x0),
        height: TRACK_H,
        rx: TRACK_H / 2,
        fill: 'currentColor',
        'fill-opacity': 0.12,
      })
    );
    if (!d) return;
    const nowX = Math.min(x1, Math.max(x0, timeToX(now, d, box)));
    if (nowX > x0) {
      scale.append(
        svgEl(doc, 'rect', {
          'data-part': 'past',
          x: x0,
          y: TRACK_Y,
          width: nowX - x0,
          height: TRACK_H,
          rx: TRACK_H / 2,
          fill: 'currentColor',
          'fill-opacity': 0.3,
        })
      );
    }
    if (nowX < x1) {
      scale.append(
        svgEl(doc, 'rect', {
          'data-part': 'future',
          x: nowX,
          y: TRACK_Y,
          width: x1 - nowX,
          height: TRACK_H,
          rx: TRACK_H / 2,
          fill: '#60a5fa',
          'fill-opacity': 0.45,
        })
      );
    }
    const steps = pickTickSteps(d.end - d.start, x1 - x0);
    const ticks = buildTicks(d, steps, f.tz);
    for (const tk of ticks) {
      const x = timeToX(tk.t, d, box);
      const top = tk.kind === 'day' ? 4 : tk.kind === 'label' ? 15 : 17;
      scale.append(
        svgEl(doc, 'line', {
          'data-part': `tick-${tk.kind}`,
          x1: x,
          x2: x,
          y1: top,
          y2: tk.kind === 'day' ? TRACK_Y + TRACK_H + 4 : TRACK_Y,
          stroke: 'currentColor',
          'stroke-opacity':
            tk.kind === 'day' ? 0.55 : tk.kind === 'label' ? 0.6 : 0.35,
          'stroke-width': 1,
        })
      );
    }
    for (const l of layoutLabels(ticks, d, box, f)) {
      const text = svgEl(doc, 'text', {
        'data-part': `label-${l.kind}`,
        x: l.x,
        y: LABEL_Y,
        'text-anchor': l.anchor,
        'dominant-baseline': 'middle',
        'font-size': 10,
        'font-weight': l.kind === 'day' ? 600 : 400,
        fill: 'currentColor',
        'fill-opacity': l.kind === 'day' ? 0.95 : 0.7,
      });
      text.textContent = l.text;
      scale.append(text);
    }
  }

  function update(force = false): void {
    if (!bar || !svg) return;
    const times = deps.getTimes();
    const width = measureWidth();
    if (width <= 0) return; // hidden (phone); the observer redraws on show
    box = { width, pad: BAR_PAD };
    const now = nowSec();
    const f = deps.format();
    const n = times.length;
    const key = [
      n,
      n ? times[0] : '',
      n ? times[n - 1] : '',
      width,
      f.locale,
      f.tz,
      f.hour12,
      // The shades and the stretch to "now" move with the clock.
      Math.floor(now / 60),
    ].join('|');
    if (force || key !== scaleKey) {
      scaleKey = key;
      drawScale(times, now);
    }
    const d = domain;
    const i = deps.getIndex();
    bar.dataset.frames = String(n);
    bar.dataset.index = String(n ? i : -1);
    if (nowLine) {
      // The scale is redrawn once a minute; in between "now" may run a
      // little past a domain that was stretched to it — pin it to the end.
      const show =
        !!d &&
        d.end > d.start &&
        now >= d.start - NOW_SLACK_SEC &&
        now <= d.end + NOW_SLACK_SEC;
      nowLine.setAttribute('visibility', show ? 'visible' : 'hidden');
      if (d && show) {
        const x = Math.min(
          box.width - box.pad,
          Math.max(box.pad, timeToX(now, d, box))
        );
        nowLine.setAttribute('x1', String(x));
        nowLine.setAttribute('x2', String(x));
      }
    }
    if (thumb) {
      const t = i >= 0 && i < n ? times[i] : null;
      thumb.setAttribute('visibility', d && t !== null ? 'visible' : 'hidden');
      if (d && t !== null)
        thumb.setAttribute('transform', `translate(${timeToX(t, d, box)} 0)`);
    }
  }

  // ---- stepping (keys, wheel) ---------------------------------------

  /** One frame forward/back; past the end, pull the 10-day axis first
   *  (like ›). Returns whether anything moved or is loading. */
  function step(delta: 1 | -1): boolean {
    const times = deps.getTimes();
    const n = times.length;
    if (n === 0) return false;
    const i = deps.getIndex();
    const next = i + delta;
    if (next > n - 1) {
      if (!deps.canExtend()) return false;
      void deps.extend().then((ok) => {
        if (!ok) return;
        const m = deps.getTimes().length;
        deps.seek(Math.min(deps.getIndex() + 1, m - 1));
      });
      return true;
    }
    if (next < 0) return false;
    deps.seek(next);
    return true;
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const n = deps.getTimes().length;
    if (n === 0) return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        step(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        step(1);
        break;
      case 'Home':
        e.preventDefault();
        if (deps.getIndex() !== 0) deps.seek(0);
        break;
      case 'End':
        e.preventDefault();
        if (deps.getIndex() !== n - 1) deps.seek(n - 1);
        break;
      default:
    }
  };

  let wheelAcc = 0;
  const onWheel = (e: WheelEvent): void => {
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (raw === 0) return;
    const scaleBy = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = raw * scaleBy;
    const n = deps.getTimes().length;
    const i = deps.getIndex();
    const dir = delta > 0 ? 1 : -1;
    // At the end the wheel goes back to the page (scroll chaining).
    const stuck =
      n === 0 ||
      (dir < 0 && i <= 0) ||
      (dir > 0 && i >= n - 1 && !deps.canExtend());
    if (stuck) {
      wheelAcc = 0;
      return;
    }
    e.preventDefault();
    const r = wheelStep(wheelAcc, delta);
    wheelAcc = r.acc;
    if (r.steps !== 0) step(r.steps > 0 ? 1 : -1);
  };

  // ---- pointer drag -------------------------------------------------

  let dragId: number | null = null;
  let extendedThisDrag = false;
  let pendingX: number | null = null;
  let raf = 0;

  function seekAtClientX(clientX: number): void {
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const x = clientX - rect.left;
    const times = deps.getTimes();
    if (times.length === 0) return;
    if (x > rect.width + TAIL_ARM_PX && deps.canExtend()) {
      // Dragged onto the dotted tail: pull the 10-day axis (once per
      // drag); the next move lands on the longer scale.
      if (!extendedThisDrag) {
        extendedThisDrag = true;
        void deps.extend().then(() => update(true));
      }
      return;
    }
    if (!domain) update(true);
    const d = domain ?? axisDomain(times, nowSec());
    if (!d) return;
    const idx = frameIndexAtX(times, x, d, { width: rect.width, pad: BAR_PAD });
    if (idx >= 0 && idx !== deps.getIndex()) deps.seek(idx);
  }

  function flush(): void {
    raf = 0;
    if (pendingX === null) return;
    const x = pendingX;
    pendingX = null;
    seekAtClientX(x);
  }

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (deps.getTimes().length === 0) return;
    e.preventDefault();
    dragId = e.pointerId;
    extendedThisDrag = false;
    try {
      bar?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    if (bar) bar.dataset.dragging = 'true';
    range?.focus({ preventScroll: true });
    seekAtClientX(e.clientX);
  };
  const onMove = (e: PointerEvent): void => {
    if (dragId === null || e.pointerId !== dragId) return;
    pendingX = e.clientX;
    // One seek per frame at most: a fast drag fires many moves per paint.
    if (!raf) raf = win.requestAnimationFrame(flush);
  };
  const onUp = (e: PointerEvent): void => {
    if (dragId === null || e.pointerId !== dragId) return;
    if (raf) {
      win.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (e.type === 'pointerup') {
      pendingX = e.clientX;
      flush();
    }
    pendingX = null;
    dragId = null;
    if (bar) delete bar.dataset.dragging;
    try {
      bar?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  bar?.addEventListener('pointerdown', onDown);
  bar?.addEventListener('pointermove', onMove);
  bar?.addEventListener('pointerup', onUp);
  bar?.addEventListener('pointercancel', onUp);
  bar?.addEventListener('wheel', onWheel, { passive: false });
  range?.addEventListener('keydown', onKey);

  let ro: ResizeObserver | null = null;
  if (bar && typeof win.ResizeObserver === 'function') {
    ro = new win.ResizeObserver(() => update());
    ro.observe(bar);
  }

  update(true);

  return {
    update,
    dispose(): void {
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      ro = null;
      bar?.removeEventListener('pointerdown', onDown);
      bar?.removeEventListener('pointermove', onMove);
      bar?.removeEventListener('pointerup', onUp);
      bar?.removeEventListener('pointercancel', onUp);
      bar?.removeEventListener('wheel', onWheel);
      range?.removeEventListener('keydown', onKey);
    },
  };
}
