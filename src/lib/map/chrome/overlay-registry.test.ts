// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createOverlayRegistry, type OverlayDef } from './overlay-registry';

function mkDefs(): OverlayDef[] {
  const state: Record<string, boolean> = { tropical: true };
  const def = (id: string, label: string, shortcut = ''): OverlayDef => ({
    id,
    label,
    shortcut,
    isEnabled: () => !!state[id],
    setEnabled: (on) => {
      state[id] = on;
    },
  });
  return [
    def('tropical', 'Sistemas tropicales', 'T'),
    def('graticule', 'Retícula', 'X'),
    def('precipMode', 'Modo precipitación (satélite + nubes + radar)'),
    def('clouds', 'Nubes', 'U'),
    def('windOverlay', 'Animación de viento', 'C'),
    def('volcanoes', 'Volcanes activos', 'J'),
  ];
}

const STRINGS = {
  pinned: 'Más usadas',
  all: 'Todas',
  empty: 'Sin coincidencias',
};

function setup() {
  document.body.innerHTML = `
    <span id="count"></span>
    <input id="filter" type="search" />
    <div id="wrap"></div>`;
  const wrap = document.getElementById('wrap') as HTMLElement;
  const filter = document.getElementById('filter') as HTMLInputElement;
  const count = document.getElementById('count') as HTMLElement;
  const defs = mkDefs();
  const reg = createOverlayRegistry({ wrap, filter, count }, defs, {
    pinned: ['tropical', 'clouds', 'precipMode', 'windOverlay'],
    strings: STRINGS,
  });
  reg.build();
  return { wrap, filter, count, defs, reg };
}

const rowIds = (wrap: HTMLElement, visibleOnly = false): string[] =>
  Array.from(wrap.querySelectorAll<HTMLElement>('[data-overlay-row]'))
    .filter(
      (r) =>
        !visibleOnly || (!r.hidden && !(r.parentElement as HTMLElement).hidden)
    )
    .map((r) => r.dataset.overlayRow as string);

describe('createOverlayRegistry (Story 22.2)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('pins the four most used first, then the rest in declared order', () => {
    const { wrap } = setup();
    expect(rowIds(wrap)).toEqual([
      'tropical',
      'clouds',
      'precipMode',
      'windOverlay',
      'graticule',
      'volcanoes',
    ]);
    const headings = Array.from(
      wrap.querySelectorAll('[data-overlay-heading]')
    ).map((h) => h.textContent);
    expect(headings).toEqual(['Más usadas', 'Todas']);
  });

  it('keeps every checkbox id and moves the letter from a chip to the title', () => {
    const { wrap, defs } = setup();
    for (const d of defs) {
      expect(document.getElementById(`overlay-${d.id}`)).not.toBeNull();
    }
    expect(wrap.querySelector('kbd')).toBeNull();
    const tropical = wrap.querySelector<HTMLElement>(
      '[data-overlay-row="tropical"]'
    );
    expect(tropical?.title).toBe('Sistemas tropicales (T)');
    const precip = wrap.querySelector<HTMLElement>(
      '[data-overlay-row="precipMode"]'
    );
    expect(precip?.title).toBe('');
  });

  it('titles only a letter the handler honours (Story 22.5)', () => {
    document.body.innerHTML = '<div id="wrap"></div>';
    const wrap = document.getElementById('wrap') as HTMLElement;
    // A layer owns T: Sistemas tropicales has no key of its own.
    const reg = createOverlayRegistry({ wrap }, mkDefs(), {
      layers: [{ shortcut: 'T', id: 'temperature' }],
    });
    reg.build();
    expect(
      wrap.querySelector<HTMLElement>('[data-overlay-row="tropical"]')?.title
    ).toBe('');
    expect(
      wrap.querySelector<HTMLElement>('[data-overlay-row="graticule"]')?.title
    ).toBe('Retícula (X)');
    reg.dispose();
  });

  it('filters rows accent-insensitively and hides empty groups', () => {
    const { wrap, filter } = setup();
    filter.value = 'reticula';
    filter.dispatchEvent(new Event('input'));
    expect(rowIds(wrap, true)).toEqual(['graticule']);
    const pinnedBox = wrap.querySelector<HTMLElement>(
      '[data-overlay-group="pinned"]'
    );
    expect(pinnedBox?.hidden).toBe(true);
    const empty = wrap.querySelector<HTMLElement>('[data-overlay-empty]');
    expect(empty?.hidden).toBe(true);

    filter.value = 'zzz';
    filter.dispatchEvent(new Event('input'));
    expect(rowIds(wrap, true)).toEqual([]);
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe('Sin coincidencias');
  });

  it('Escape clears a non-empty filter', () => {
    const { wrap, filter } = setup();
    filter.value = 'nubes';
    filter.dispatchEvent(new Event('input'));
    expect(rowIds(wrap, true)).toEqual(['clouds', 'precipMode']);
    const esc = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    filter.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(filter.value).toBe('');
    expect(rowIds(wrap, true)).toHaveLength(6);
  });

  it('the tab badge counts the overlays switched on', () => {
    const { count } = setup();
    expect(count.textContent).toBe('1');
    expect(count.hidden).toBe(false);
    const cb = document.getElementById('overlay-clouds') as HTMLInputElement;
    cb.click();
    expect(count.textContent).toBe('2');
    (document.getElementById('overlay-clouds') as HTMLInputElement).click();
    (document.getElementById('overlay-tropical') as HTMLInputElement).click();
    expect(count.textContent).toBe('');
    expect(count.hidden).toBe(true);
  });

  it('dispose() unbinds the filter', () => {
    const { wrap, filter, reg } = setup();
    reg.dispose();
    filter.value = 'reticula';
    filter.dispatchEvent(new Event('input'));
    expect(rowIds(wrap, true)).toHaveLength(6);
  });
});
