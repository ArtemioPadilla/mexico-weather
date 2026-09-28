// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderShortcutSections,
  wireShortcutsDialog as wire,
  type ShortcutsDialog,
} from './shortcuts-dialog';
import type { ShortcutSection } from './shortcuts';

const dialogs: ShortcutsDialog[] = [];
const wireShortcutsDialog = (
  ...args: Parameters<typeof wire>
): ShortcutsDialog => {
  const d = wire(...args);
  dialogs.push(d);
  return d;
};

const SECTIONS: ShortcutSection[] = [
  {
    id: 'general',
    title: 'General',
    rows: [{ target: 'help', keys: ['?'], label: 'Ayuda' }],
  },
  {
    id: 'layers',
    title: 'Capas',
    rows: [
      { target: 'layer:radar', keys: ['R'], label: 'Radar' },
      { target: 'layer:precipitation', keys: [], label: 'Precipitación' },
    ],
  },
];

function mk() {
  document.body.innerHTML = `
    <button id="before">mapa</button>
    <input id="field" />
    <div id="menu"><button id="entry" data-shortcuts-open>Atajos</button></div>
    <button id="fallback">⋯</button>
    <dialog id="dlg">
      <button data-shortcuts-close id="close">×</button>
      <div data-shortcuts-body id="body"></div>
    </dialog>`;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return { $, dialog: $('dlg') };
}

const key = (
  target: EventTarget,
  k: string,
  init: KeyboardEventInit = {}
): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
};

describe('renderShortcutSections', () => {
  it('renders one headed list per section, kbd per key, a dash for none', () => {
    const { $ } = mk();
    renderShortcutSections($('body'), SECTIONS);
    const sections = $('body').querySelectorAll('section');
    expect(sections).toHaveLength(2);
    expect(sections[1].getAttribute('aria-labelledby')).toBe(
      'mw-shortcuts-h-layers'
    );
    const radar = $('body').querySelector('[data-shortcut="layer:radar"]');
    expect(radar?.querySelector('dt kbd')?.textContent).toBe('R');
    expect(radar?.querySelector('dd')?.textContent).toBe('Radar');
    const precip = $('body').querySelector(
      '[data-shortcut="layer:precipitation"]'
    );
    expect(precip?.querySelectorAll('kbd')).toHaveLength(0);
    expect(precip?.querySelector('dt')?.textContent).toBe('—');
    // Idempotent: a re-render replaces, never appends.
    renderShortcutSections($('body'), SECTIONS);
    expect($('body').querySelectorAll('section')).toHaveLength(2);
  });
});

describe('wireShortcutsDialog (Story 22.5)', () => {
  afterEach(() => {
    dialogs.splice(0).forEach((d) => d.dispose());
    document.body.innerHTML = '';
  });

  it('`?` opens it with the focus inside; Escape closes and restores focus', () => {
    const { $, dialog } = mk();
    const d = wireShortcutsDialog({ dialog }, SECTIONS);
    expect($('body').querySelectorAll('section')).toHaveLength(2);
    $('before').focus();
    const e = key($('before'), '?', { shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(d.isOpen()).toBe(true);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe($('close'));

    const esc = key($('close'), 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(d.isOpen()).toBe(false);
    expect(document.activeElement).toBe($('before'));
  });

  it('ignores `?` typed in a field', () => {
    const { $, dialog } = mk();
    const d = wireShortcutsDialog({ dialog }, SECTIONS);
    $('field').focus();
    key($('field'), '?');
    expect(d.isOpen()).toBe(false);
  });

  it('keys inside never reach the page (the map letters stay put)', () => {
    const { $, dialog } = mk();
    const d = wireShortcutsDialog({ dialog }, SECTIONS);
    const onDoc = vi.fn();
    const onWin = vi.fn();
    document.addEventListener('keydown', onDoc);
    window.addEventListener('keydown', onWin);
    d.open();
    key($('close'), 'r');
    key($('close'), 'Escape');
    expect(onDoc).not.toHaveBeenCalled();
    expect(onWin).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onDoc);
    window.removeEventListener('keydown', onWin);
  });

  it('`?` again, the close button and the backdrop close it', () => {
    const { $, dialog } = mk();
    const d = wireShortcutsDialog({ dialog }, SECTIONS);
    d.open();
    key($('close'), '?', { shiftKey: true });
    expect(d.isOpen()).toBe(false);
    d.open();
    $('close').click();
    expect(d.isOpen()).toBe(false);
    d.open();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(d.isOpen()).toBe(false);
  });

  it('a [data-shortcuts-open] entry opens it; focus falls back when the entry is gone', () => {
    const { $, dialog } = mk();
    const d = wireShortcutsDialog(
      { dialog, fallbackFocus: $('fallback') },
      SECTIONS
    );
    $('entry').focus();
    $('entry').click();
    expect(d.isOpen()).toBe(true);
    // The ⋯ menu closed behind the dialog: the entry is hidden now.
    $('menu').hidden = true;
    d.close();
    expect(document.activeElement).toBe($('fallback'));
  });

  it('the browser close request (cancel) goes through the same close', () => {
    const { $, dialog } = mk();
    const d = wireShortcutsDialog({ dialog }, SECTIONS);
    $('before').focus();
    d.open();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(d.isOpen()).toBe(false);
    expect(document.activeElement).toBe($('before'));
  });

  it('dispose removes the page listeners', () => {
    const { $, dialog } = mk();
    const d = wireShortcutsDialog({ dialog }, SECTIONS);
    d.dispose();
    key($('before'), '?');
    expect(d.isOpen()).toBe(false);
    $('entry').click();
    expect(d.isOpen()).toBe(false);
  });
});
