/**
 * Bottom sheet — Story 25.1 (plan PARIDAD_VISUAL E25, = ROADMAP 11.3).
 *
 * Below `sm` three panels of the map chrome open as a sheet that rises
 * from the timeline dock instead of floating over the map: the place card
 * (Story 15.4), the layers / overlays rail (Story 22.2, behind "Capas y
 * controles") and the ⋯ tools menu (Story 22.3). A sheet has three
 * heights (detents): `peek` (its header), `half` and `full` (up to the
 * search row), and is dismissed by dragging it down past `peek`.
 *
 *   <div id="S" class="im-sheet" hidden>
 *     <button data-sheet-handle aria-controls="S" aria-label="…">…</button>
 *     …content…
 *   </div>
 *
 * - Drag: the handle (a 44 px row at the top of the sheet) follows the
 *   pointer — touch, pen or mouse, `touch-action: none` — and snaps to the
 *   nearest detent on release, or to the next one in the direction of a
 *   fling; below half the peek height it closes.
 * - Keyboard: the handle is a button. Enter / Space cycle peek → half →
 *   full → peek, ↑ / ↓ grow / shrink one detent, Inicio / Fin jump to full
 *   / peek. Escape with the focus inside the sheet dismisses it.
 * - Focus: `show({ focus })` moves the focus into the sheet; on hide, a
 *   focus left inside the (now hidden) sheet goes back to `returnFocus`
 *   (the control that opened it by default).
 * - One sheet per map at a time: opening one dismisses the others of the
 *   same map root (through their owner's close, so every owner keeps its
 *   own state). The root carries `data-sheet="<name>"` and `--im-sheet`
 *   (the open sheet's height in px) so the controls that float above the
 *   dock (the Controles trigger, the model toggle, messages) float above
 *   the sheet instead.
 *
 * The owner keeps its open state (`hidden`, `data-controls`, …) and tells
 * the sheet with `show()` / `hide()`; the sheet asks the owner to close
 * with `onDismiss` (drag down, Escape, another sheet opening). From `sm`
 * the sheet is inactive: `show()` / `hide()` only record the state and
 * touch nothing, so the desktop panels behave exactly as before. The
 * detent heights come from the CSS (global.css, `.im-sheet`): `full` is
 * the sheet's max-height, the map's height less `--im-dock` and
 * `--im-sheet-top`, read from the same custom properties. Motion is
 * CSS too (a height transition, none under prefers-reduced-motion).
 *
 * `dispose()` removes every listener, the media-query and resize
 * listeners and the pending animation frame.
 */
import { ui } from '../../../i18n/ui';

export type SheetDetent = 'peek' | 'half' | 'full';
export type SheetState = SheetDetent | 'closed';

export const SHEET_DETENTS: readonly SheetDetent[] = ['peek', 'half', 'full'];

/** Media query under which sheets are active (Tailwind's `max-sm`). */
export const SHEET_MEDIA = '(max-width: 639.98px)';

/** Default peek height: the handle row plus a header row or two. */
export const SHEET_PEEK_PX = 120;

/** A release faster than this (px/ms) is a fling to the next detent. */
export const SHEET_FLING = 0.4;

/** Movement (px) under which a press on the handle is a click. */
export const SHEET_DRAG_SLOP = 6;

export interface SheetHeights {
  peek: number;
  half: number;
  full: number;
}

/**
 * The three detent heights (px) for a sheet with `avail` px between the
 * top of the map and the dock and a CSS `max-height` of `max` px (NaN or
 * ≤ 0: no cap). `full` ≥ `half` ≥ `peek` ≥ 0 always holds.
 */
export function sheetHeights(o: {
  avail: number;
  max?: number;
  peek?: number;
  halfRatio?: number;
}): SheetHeights {
  const avail = Math.max(0, Number.isFinite(o.avail) ? o.avail : 0);
  const cap =
    o.max !== undefined && Number.isFinite(o.max) && o.max > 0 ? o.max : avail;
  const full = Math.round(Math.min(avail, cap));
  const peek = Math.round(Math.min(Math.max(0, o.peek ?? SHEET_PEEK_PX), full));
  const half = Math.round(
    Math.min(full, Math.max(peek, avail * (o.halfRatio ?? 0.5)))
  );
  return { peek, half, full };
}

/**
 * Where a drag released at `height` px lands. `velocity` is px/ms,
 * positive while the sheet grows. A fling goes to the next stop in its
 * direction; otherwise the nearest stop wins (ties go to the taller one).
 * `closed` (height 0) is a stop only when `dismissible`.
 */
export function snapDetent(
  height: number,
  velocity: number,
  h: SheetHeights,
  dismissible = true
): SheetState {
  const stops: Array<{ s: SheetState; h: number }> = [
    ...(dismissible ? [{ s: 'closed' as const, h: 0 }] : []),
    { s: 'peek', h: h.peek },
    { s: 'half', h: h.half },
    { s: 'full', h: h.full },
  ];
  if (velocity >= SHEET_FLING) {
    return (stops.find((x) => x.h > height + 1) ?? stops[stops.length - 1]).s;
  }
  if (velocity <= -SHEET_FLING) {
    const below = stops.filter((x) => x.h < height - 1);
    return (below[below.length - 1] ?? stops[0]).s;
  }
  let best = stops[0];
  for (const x of stops) {
    if (Math.abs(x.h - height) <= Math.abs(best.h - height)) best = x;
  }
  return best.s;
}

/** One detent up (`dir` 1) or down (-1), clamped to peek…full. */
export function stepDetent(d: SheetDetent, dir: 1 | -1): SheetDetent {
  const i = SHEET_DETENTS.indexOf(d);
  const j = Math.min(SHEET_DETENTS.length - 1, Math.max(0, i + dir));
  return SHEET_DETENTS[j];
}

/** Enter / Space on the handle: peek → half → full → peek. */
export function cycleDetent(d: SheetDetent): SheetDetent {
  const i = SHEET_DETENTS.indexOf(d);
  return SHEET_DETENTS[(i + 1) % SHEET_DETENTS.length];
}

/** The handle's words (from `ui.ts`, in the document's language). */
export interface BottomSheetStrings {
  /** "Tamaño del panel" — the handle's accessible name. */
  resize: string;
  peek: string;
  half: string;
  full: string;
}

export function sheetStrings(lang: 'es' | 'en' = 'es'): BottomSheetStrings {
  const t = ui[lang] ?? ui.es;
  return {
    resize: t.map_sheet_resize,
    peek: t.map_sheet_peek,
    half: t.map_sheet_half,
    full: t.map_sheet_full,
  };
}

/** What the sheet needs of a MediaQueryList (injectable for tests). */
export interface MediaLike {
  matches: boolean;
  addEventListener: (type: 'change', cb: () => void) => void;
  removeEventListener: (type: 'change', cb: () => void) => void;
}

export interface BottomSheetOptions {
  /** Short name mirrored on the map root's `data-sheet` while open. */
  name: string;
  sheet: HTMLElement;
  /** The drag handle (a button inside the sheet); null: no drag / keys. */
  handle: HTMLElement | null;
  /** The map root (`.im-root`): the sheet group and `--im-sheet`. */
  root: HTMLElement;
  /** The owner closes its panel (and then calls `hide()`). */
  onDismiss: () => void;
  /** Detent `show()` opens on. Default `half`. */
  initial?: SheetDetent;
  /** Active while this matches. Default `matchMedia(SHEET_MEDIA)`. */
  media?: MediaLike | null;
  strings?: BottomSheetStrings;
  /** Peek height (px). Default SHEET_PEEK_PX. */
  peek?: number;
  /** Space for the sheet: px from the top of the map to the dock and the
   *  full height. Default: the root's height less its `--im-dock` and
   *  `--im-sheet-top` (px custom properties, global.css). */
  measure?: () => { avail: number; max: number };
}

export interface ShowOptions {
  detent?: SheetDetent;
  /** Focus this element once the sheet shows (active only). */
  focus?: HTMLElement | null;
  /** Where the focus goes back on hide. Default: the element focused
   *  when `show()` ran, unless it is inside the sheet. */
  returnFocus?: HTMLElement | null;
}

export interface BottomSheet {
  /** The owner has shown its panel. Idempotent: a second call while open
   *  keeps the current detent. */
  show: (o?: ShowOptions) => void;
  /** The owner has hidden its panel. */
  hide: (o?: { restoreFocus?: boolean }) => void;
  /** Move an open, active sheet to a detent. */
  setDetent: (d: SheetDetent) => void;
  /** `closed` unless open; the detent while open (also when inactive). */
  state: () => SheetState;
  isOpen: () => boolean;
  /** True below `sm` (the media query matches). */
  isActive: () => boolean;
  /** Current height in px (0 when closed or inactive). */
  height: () => number;
  dispose: () => void;
}

interface GroupMember {
  name: string;
  isOpen: () => boolean;
  isActive: () => boolean;
  dismiss: () => void;
}

const groups = new WeakMap<HTMLElement, Set<GroupMember>>();

function groupOf(root: HTMLElement): Set<GroupMember> {
  let g = groups.get(root);
  if (!g) {
    g = new Set();
    groups.set(root, g);
  }
  return g;
}

function defaultMedia(): MediaLike | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return null;
  return window.matchMedia(SHEET_MEDIA);
}

export function createBottomSheet(o: BottomSheetOptions): BottomSheet {
  const { sheet, handle, root, name } = o;
  const doc = sheet.ownerDocument;
  const win = doc.defaultView;
  const media = o.media === undefined ? defaultMedia() : o.media;
  const strings = o.strings ?? sheetStrings();
  const group = groupOf(root);

  let open = false;
  let detent: SheetDetent = o.initial ?? 'half';
  let heights: SheetHeights = { peek: 0, half: 0, full: 0 };
  let current = 0; // px, what is painted
  let returnTo: HTMLElement | null = null;
  let raf = 0;
  let pending = -1;
  let suppressClickUntil = 0;
  let drag: {
    id: number;
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    v: number;
    moved: boolean;
    h: number;
  } | null = null;

  const isActive = (): boolean => !!media?.matches;

  function measure(): { avail: number; max: number } {
    if (o.measure) return o.measure();
    // The CSS max-height is `100% - --im-dock - --im-sheet-top`; its
    // computed value stays a calc(), so rebuild it from the two px vars.
    const rootStyle = win?.getComputedStyle(root);
    const px = (name: string): number => {
      const v = parseFloat(rootStyle?.getPropertyValue(name) ?? '');
      return Number.isFinite(v) ? v : 0;
    };
    const avail = root.clientHeight - px('--im-dock');
    return { avail, max: avail - px('--im-sheet-top') };
  }

  function recompute(): void {
    const m = measure();
    heights = sheetHeights({ avail: m.avail, max: m.max, peek: o.peek });
  }

  function paint(px: number): void {
    current = Math.max(0, Math.round(px));
    sheet.style.setProperty('--im-sheet-h', `${current}px`);
    if (root.dataset.sheet === name) {
      root.style.setProperty('--im-sheet', `${current}px`);
    }
  }

  function schedulePaint(px: number): void {
    pending = px;
    if (raf || !win) {
      if (!win) paint(px);
      return;
    }
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      if (pending >= 0) paint(pending);
      pending = -1;
    });
  }

  function cancelPaint(): void {
    if (raf && win) win.cancelAnimationFrame(raf);
    raf = 0;
    pending = -1;
  }

  function labelHandle(): void {
    if (!handle) return;
    handle.setAttribute('aria-label', `${strings.resize}: ${strings[detent]}`);
  }

  /** Paint the open sheet at its detent and claim the root. */
  function apply(): void {
    if (!open || !isActive()) return;
    for (const m of group) {
      if (m !== member && m.isOpen() && m.isActive()) m.dismiss();
    }
    recompute();
    sheet.dataset.sheetDetent = detent;
    root.dataset.sheet = name;
    cancelPaint();
    paint(heights[detent]);
    labelHandle();
  }

  /** Forget every style this sheet set (closed, or from `sm` up). */
  function clear(): void {
    cancelPaint();
    drag = null;
    delete sheet.dataset.sheetDetent;
    delete sheet.dataset.sheetDragging;
    sheet.style.removeProperty('--im-sheet-h');
    current = 0;
    if (root.dataset.sheet === name) {
      delete root.dataset.sheet;
      root.style.removeProperty('--im-sheet');
    }
  }

  function dismiss(): void {
    if (!open) return;
    o.onDismiss();
    // An owner that did not call hide() still leaves a closed sheet.
    if (open) hide();
  }

  const member: GroupMember = { name, isOpen: () => open, isActive, dismiss };
  group.add(member);

  function show(so: ShowOptions = {}): void {
    if (so.detent) detent = so.detent;
    if (open) {
      if (so.detent) apply();
      return;
    }
    open = true;
    const active = doc.activeElement as HTMLElement | null;
    returnTo =
      so.returnFocus !== undefined
        ? so.returnFocus
        : active && active !== doc.body && !sheet.contains(active)
          ? active
          : null;
    if (!so.detent) detent = o.initial ?? 'half';
    if (!isActive()) return;
    apply();
    so.focus?.focus({ preventScroll: true });
  }

  function hide(ho: { restoreFocus?: boolean } = {}): void {
    if (!open) return;
    open = false;
    const wasActive = isActive() || sheet.dataset.sheetDetent !== undefined;
    const back = returnTo;
    returnTo = null;
    clear();
    if (!wasActive || ho.restoreFocus === false) return;
    const a = doc.activeElement;
    if (
      (a === null || a === doc.body || sheet.contains(a)) &&
      back?.isConnected
    ) {
      back.focus({ preventScroll: true });
    }
  }

  function setDetent(d: SheetDetent): void {
    detent = d;
    apply();
  }

  // ---- handle: click, keys, drag ------------------------------------
  const onClick = (): void => {
    if (!open || !isActive()) return;
    if (Date.now() < suppressClickUntil) return;
    setDetent(cycleDetent(detent));
  };
  const onHandleKey = (e: KeyboardEvent): void => {
    if (!open || !isActive()) return;
    let next: SheetDetent | null = null;
    if (e.key === 'ArrowUp') next = stepDetent(detent, 1);
    else if (e.key === 'ArrowDown') next = stepDetent(detent, -1);
    else if (e.key === 'Home') next = 'full';
    else if (e.key === 'End') next = 'peek';
    if (!next) return;
    e.preventDefault();
    setDetent(next);
  };
  const onDown = (e: PointerEvent): void => {
    if (!open || !isActive()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    recompute();
    drag = {
      id: e.pointerId,
      startY: e.clientY,
      startH: current,
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
      moved: false,
      h: current,
    };
    try {
      handle?.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic pointer: no capture */
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.startY - e.clientY;
    if (!drag.moved && Math.abs(dy) < SHEET_DRAG_SLOP) return;
    if (!drag.moved) {
      drag.moved = true;
      sheet.dataset.sheetDragging = '';
    }
    e.preventDefault();
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) {
      const v = (drag.lastY - e.clientY) / dt;
      drag.v = drag.v * 0.3 + v * 0.7;
    }
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    drag.h = Math.min(heights.full, Math.max(0, drag.startH + dy));
    schedulePaint(drag.h);
  };
  const finish = (e: PointerEvent, cancelled: boolean): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try {
      handle?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
    if (!d.moved) return;
    delete sheet.dataset.sheetDragging;
    suppressClickUntil = Date.now() + 400;
    // A pause before release is no fling.
    const v = e.timeStamp - d.lastT > 120 || cancelled ? 0 : d.v;
    const target = snapDetent(d.h, v, heights);
    if (target === 'closed') {
      dismiss();
      return;
    }
    setDetent(target);
  };
  const onUp = (e: PointerEvent): void => finish(e, false);
  const onCancel = (e: PointerEvent): void => finish(e, true);

  // ---- Escape inside the sheet (capture: before the panel's own
  // Escape handlers, which would only collapse part of it) ------------
  const onSheetKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!open || !isActive()) return;
    e.preventDefault();
    dismiss();
  };

  // ---- viewport changes ---------------------------------------------
  const onMedia = (): void => {
    if (isActive()) apply();
    else clear();
  };
  const onResize = (): void => {
    if (open && isActive() && !drag) apply();
  };

  handle?.addEventListener('click', onClick);
  handle?.addEventListener('keydown', onHandleKey);
  handle?.addEventListener('pointerdown', onDown);
  handle?.addEventListener('pointermove', onMove);
  handle?.addEventListener('pointerup', onUp);
  handle?.addEventListener('pointercancel', onCancel);
  sheet.addEventListener('keydown', onSheetKey, true);
  media?.addEventListener('change', onMedia);
  win?.addEventListener('resize', onResize);

  return {
    show,
    hide,
    setDetent,
    state: () => (open ? detent : 'closed'),
    isOpen: () => open,
    isActive,
    height: () => current,
    dispose: (): void => {
      handle?.removeEventListener('click', onClick);
      handle?.removeEventListener('keydown', onHandleKey);
      handle?.removeEventListener('pointerdown', onDown);
      handle?.removeEventListener('pointermove', onMove);
      handle?.removeEventListener('pointerup', onUp);
      handle?.removeEventListener('pointercancel', onCancel);
      sheet.removeEventListener('keydown', onSheetKey, true);
      media?.removeEventListener('change', onMedia);
      win?.removeEventListener('resize', onResize);
      clear();
      open = false;
      group.delete(member);
    },
  };
}
