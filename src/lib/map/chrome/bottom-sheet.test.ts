// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBottomSheet,
  cycleDetent,
  sheetHeights,
  sheetStrings,
  snapDetent,
  stepDetent,
  SHEET_PEEK_PX,
  type BottomSheet,
  type BottomSheetOptions,
  type MediaLike,
} from './bottom-sheet';
import { ui } from '../../../i18n/ui';

describe('sheetHeights', () => {
  it('peek, half of the space and the CSS cap as full', () => {
    // 360×640 /mapa: 592 px map, 104 px dock, 7.5rem top reserve.
    expect(sheetHeights({ avail: 488, max: 368 })).toEqual({
      peek: SHEET_PEEK_PX,
      half: 244,
      full: 368,
    });
  });

  it('keeps full ≥ half ≥ peek ≥ 0 in a small box', () => {
    const h = sheetHeights({ avail: 150, max: 90 });
    expect(h.full).toBe(90);
    expect(h.peek).toBe(90);
    expect(h.half).toBe(90);
    const z = sheetHeights({ avail: -5 });
    expect(z).toEqual({ peek: 0, half: 0, full: 0 });
  });

  it('an unset max-height (NaN) caps at the available space', () => {
    expect(sheetHeights({ avail: 400, max: NaN }).full).toBe(400);
  });
});

describe('snapDetent', () => {
  const h = { peek: 120, half: 244, full: 368 };

  it('snaps to the nearest detent when released slowly', () => {
    expect(snapDetent(130, 0, h)).toBe('peek');
    expect(snapDetent(200, 0, h)).toBe('half');
    expect(snapDetent(330, 0, h)).toBe('full');
  });

  it('closes below half the peek height', () => {
    expect(snapDetent(50, 0, h)).toBe('closed');
    expect(snapDetent(70, 0, h)).toBe('peek');
    expect(snapDetent(10, 0, h, false)).toBe('peek');
  });

  it('a fling goes to the next detent in its direction', () => {
    expect(snapDetent(130, 1, h)).toBe('half');
    expect(snapDetent(250, 1, h)).toBe('full');
    expect(snapDetent(400, 1, h)).toBe('full');
    expect(snapDetent(240, -1, h)).toBe('peek');
    expect(snapDetent(118, -1, h)).toBe('closed');
    expect(snapDetent(118, -1, h, false)).toBe('peek');
  });
});

describe('stepDetent / cycleDetent', () => {
  it('steps within peek…full', () => {
    expect(stepDetent('peek', 1)).toBe('half');
    expect(stepDetent('full', 1)).toBe('full');
    expect(stepDetent('half', -1)).toBe('peek');
    expect(stepDetent('peek', -1)).toBe('peek');
  });
  it('cycles peek → half → full → peek', () => {
    expect(cycleDetent('peek')).toBe('half');
    expect(cycleDetent('half')).toBe('full');
    expect(cycleDetent('full')).toBe('peek');
  });
});

describe('sheetStrings', () => {
  it('reads ui.ts in both languages', () => {
    expect(sheetStrings('es').resize).toBe(ui.es.map_sheet_resize);
    expect(sheetStrings('en').full).toBe(ui.en.map_sheet_full);
  });
});

// ---------------------------------------------------------------------
// DOM controller
// ---------------------------------------------------------------------

function media(matches: boolean): MediaLike & { fire: (m: boolean) => void } {
  const cbs = new Set<() => void>();
  const m = {
    matches,
    addEventListener: (_: 'change', cb: () => void) => cbs.add(cb),
    removeEventListener: (_: 'change', cb: () => void) => cbs.delete(cb),
    fire: (next: boolean) => {
      m.matches = next;
      cbs.forEach((cb) => cb());
    },
    listeners: cbs,
  };
  return m;
}

const sheets: BottomSheet[] = [];

function mk() {
  document.body.innerHTML = `
    <div class="im-root" id="root">
      <button id="opener">open</button>
      <div id="s1" class="im-sheet" hidden>
        <button id="h1" data-sheet-handle>≡</button>
        <button id="in1">inside</button>
      </div>
      <div id="s2" class="im-sheet" hidden>
        <button id="h2" data-sheet-handle>≡</button>
        <button id="in2">inside</button>
      </div>
    </div>`;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return { $, root: $('root') };
}

function sheetFor(
  $: (id: string) => HTMLElement,
  root: HTMLElement,
  n: 1 | 2,
  mq: MediaLike | null,
  extra: Partial<BottomSheetOptions> = {}
) {
  const el = $(`s${n}`);
  const onDismiss = vi.fn(() => {
    el.hidden = true;
    s.hide();
  });
  const s = createBottomSheet({
    name: `s${n}`,
    sheet: el,
    handle: $(`h${n}`),
    root,
    media: mq,
    strings: sheetStrings('es'),
    measure: () => ({ avail: 488, max: 368 }),
    onDismiss,
    ...extra,
  });
  sheets.push(s);
  const open = (o?: Parameters<BottomSheet['show']>[0]) => {
    el.hidden = false;
    s.show(o);
  };
  return { s, el, open, onDismiss };
}

const key = (el: HTMLElement, k: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(e);
  return e;
};

/** jsdom has no PointerEvent: a MouseEvent carrying the fields we read. */
function pointer(
  el: HTMLElement,
  type: string,
  y: number,
  t: number,
  id = 1
): void {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: y,
  });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'timeStamp', { value: t });
  el.dispatchEvent(e);
}

describe('createBottomSheet', () => {
  afterEach(() => {
    sheets.splice(0).forEach((s) => s.dispose());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows at half, mirrors the height on the sheet and the root', () => {
    const { $, root } = mk();
    const { s, el, open } = sheetFor($, root, 1, media(true));
    expect(s.state()).toBe('closed');
    open();
    expect(s.state()).toBe('half');
    expect(el.dataset.sheetDetent).toBe('half');
    expect(el.style.getPropertyValue('--im-sheet-h')).toBe('244px');
    expect(root.dataset.sheet).toBe('s1');
    expect(root.style.getPropertyValue('--im-sheet')).toBe('244px');
    expect($('h1').getAttribute('aria-label')).toBe(
      `${ui.es.map_sheet_resize}: ${ui.es.map_sheet_half}`
    );
    s.hide();
    expect(s.state()).toBe('closed');
    expect(el.dataset.sheetDetent).toBeUndefined();
    expect(el.style.getPropertyValue('--im-sheet-h')).toBe('');
    expect(root.dataset.sheet).toBeUndefined();
    expect(root.style.getPropertyValue('--im-sheet')).toBe('');
  });

  it('a second show() keeps the detent the visitor chose', () => {
    const { $, root } = mk();
    const { s, open } = sheetFor($, root, 1, media(true));
    open();
    s.setDetent('full');
    s.show();
    expect(s.state()).toBe('full');
    s.show({ detent: 'peek' });
    expect(s.state()).toBe('peek');
  });

  it('inactive from sm: records the state, touches nothing', () => {
    const { $, root } = mk();
    const { s, el, open } = sheetFor($, root, 1, media(false));
    $('opener').focus();
    open({ focus: $('in1') });
    expect(s.isOpen()).toBe(true);
    expect(s.isActive()).toBe(false);
    expect(el.dataset.sheetDetent).toBeUndefined();
    expect(root.dataset.sheet).toBeUndefined();
    // No focus move on desktop: the panel's owner decides.
    expect(document.activeElement).toBe($('opener'));
    // Keys on the handle and Escape do nothing either.
    key($('h1'), 'ArrowUp');
    const e = key($('in1'), 'Escape');
    expect(e.defaultPrevented).toBe(false);
    expect(s.isOpen()).toBe(true);
  });

  it('follows the media query both ways', () => {
    const { $, root } = mk();
    const mq = media(false);
    const { s, el, open } = sheetFor($, root, 1, mq);
    open();
    mq.fire(true);
    expect(el.dataset.sheetDetent).toBe('half');
    expect(root.dataset.sheet).toBe('s1');
    mq.fire(false);
    expect(el.dataset.sheetDetent).toBeUndefined();
    expect(root.dataset.sheet).toBeUndefined();
    expect(s.isOpen()).toBe(true);
  });

  it('keyboard on the handle: ↑ ↓ Home End and Enter cycling', () => {
    const { $, root } = mk();
    const { s, open } = sheetFor($, root, 1, media(true));
    open();
    const h = $('h1');
    expect(key(h, 'ArrowUp').defaultPrevented).toBe(true);
    expect(s.state()).toBe('full');
    key(h, 'ArrowUp');
    expect(s.state()).toBe('full');
    key(h, 'ArrowDown');
    key(h, 'ArrowDown');
    expect(s.state()).toBe('peek');
    key(h, 'ArrowDown');
    expect(s.state()).toBe('peek');
    key(h, 'Home');
    expect(s.state()).toBe('full');
    key(h, 'End');
    expect(s.state()).toBe('peek');
    h.click();
    expect(s.state()).toBe('half');
    h.click();
    expect(s.state()).toBe('full');
    h.click();
    expect(s.state()).toBe('peek');
    expect(key(h, 'a').defaultPrevented).toBe(false);
  });

  it('focus moves in on show and back to the opener on Escape', () => {
    const { $, root } = mk();
    const { s, open, onDismiss } = sheetFor($, root, 1, media(true));
    $('opener').focus();
    open({ focus: $('in1') });
    expect(document.activeElement).toBe($('in1'));
    const e = key($('in1'), 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(s.isOpen()).toBe(false);
    expect(document.activeElement).toBe($('opener'));
  });

  it('Escape already handled inside (a search box) is left alone', () => {
    const { $, root } = mk();
    const { s, open } = sheetFor($, root, 1, media(true));
    open();
    // An Escape some control already consumed (defaultPrevented).
    const e = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    e.preventDefault();
    $('in1').dispatchEvent(e);
    expect(s.isOpen()).toBe(true);
  });

  it('hide() leaves the focus alone when it is outside the sheet', () => {
    const { $, root } = mk();
    const { s, open } = sheetFor($, root, 1, media(true));
    open({ focus: $('in1'), returnFocus: $('h2') });
    $('opener').focus();
    s.hide();
    expect(document.activeElement).toBe($('opener'));
  });

  it('one sheet per root: opening one dismisses the other', () => {
    const { $, root } = mk();
    const a = sheetFor($, root, 1, media(true));
    const b = sheetFor($, root, 2, media(true));
    a.open();
    b.open();
    expect(a.onDismiss).toHaveBeenCalledTimes(1);
    expect(a.s.isOpen()).toBe(false);
    expect($('s1').hidden).toBe(true);
    expect(root.dataset.sheet).toBe('s2');
    b.s.hide();
    expect(root.dataset.sheet).toBeUndefined();
  });

  it('a drag follows the finger, snaps on release and closes past peek', () => {
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        cb(0);
        return 1;
      });
    const { $, root } = mk();
    const { s, el, open, onDismiss } = sheetFor($, root, 1, media(true));
    open();
    const h = $('h1');
    // Up 100 px, slowly: 244 → 344, nearest is full (368).
    pointer(h, 'pointerdown', 400, 0);
    pointer(h, 'pointermove', 380, 200);
    expect(el.dataset.sheetDragging).toBe('');
    expect(el.style.getPropertyValue('--im-sheet-h')).toBe('264px');
    expect(root.style.getPropertyValue('--im-sheet')).toBe('264px');
    pointer(h, 'pointermove', 300, 400);
    pointer(h, 'pointerup', 300, 800);
    expect(el.dataset.sheetDragging).toBeUndefined();
    expect(s.state()).toBe('full');
    expect(el.style.getPropertyValue('--im-sheet-h')).toBe('368px');
    // The click that follows a drag does not cycle the detent.
    h.click();
    expect(s.state()).toBe('full');
    // A fast flick down goes one detent down.
    pointer(h, 'pointerdown', 200, 1000);
    pointer(h, 'pointermove', 240, 1010);
    pointer(h, 'pointermove', 280, 1020);
    pointer(h, 'pointerup', 280, 1030);
    expect(s.state()).toBe('half');
    // Dragged almost to the dock: dismissed through the owner.
    pointer(h, 'pointerdown', 200, 2000);
    pointer(h, 'pointermove', 420, 2300);
    pointer(h, 'pointerup', 420, 2600);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(s.isOpen()).toBe(false);
    expect(raf).toHaveBeenCalled();
  });

  it('a press without movement is a click, not a drag', () => {
    const { $, root } = mk();
    const { s, el, open } = sheetFor($, root, 1, media(true));
    open();
    const h = $('h1');
    pointer(h, 'pointerdown', 400, 0);
    pointer(h, 'pointermove', 398, 10);
    pointer(h, 'pointerup', 398, 20);
    expect(el.dataset.sheetDragging).toBeUndefined();
    expect(s.state()).toBe('half');
    h.click();
    expect(s.state()).toBe('full');
  });

  it('dispose removes every listener and the pending frame', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7);
    const removeWin = vi.spyOn(window, 'removeEventListener');
    const { $, root } = mk();
    const mq = media(true);
    const { s, el, open } = sheetFor($, root, 1, mq);
    open();
    const h = $('h1');
    pointer(h, 'pointerdown', 400, 0);
    pointer(h, 'pointermove', 300, 100); // leaves a frame pending
    s.dispose();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(removeWin).toHaveBeenCalledWith('resize', expect.any(Function));
    expect((mq as unknown as { listeners: Set<unknown> }).listeners.size).toBe(
      0
    );
    expect(root.dataset.sheet).toBeUndefined();
    expect(el.dataset.sheetDetent).toBeUndefined();
    // Nothing answers any more.
    key(h, 'ArrowUp');
    h.click();
    expect(s.state()).toBe('closed');
    const e = key($('in1'), 'Escape');
    expect(e.defaultPrevented).toBe(false);
  });

  it('without matchMedia (old browsers) the sheet stays inactive', () => {
    const { $, root } = mk();
    const { s, open } = sheetFor($, root, 1, null);
    open();
    expect(s.isActive()).toBe(false);
    expect(root.dataset.sheet).toBeUndefined();
  });
});
