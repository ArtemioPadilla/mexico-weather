// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeToolNames, createToolPill, NO_TOOLS } from './tool-pill';

const NAMES = {
  distance: 'Distancia',
  area: 'Área',
  crosshair: 'Mira',
  compare: 'Comparación',
};

describe('activeToolNames', () => {
  it('is empty when no tool is on', () => {
    expect(activeToolNames(NO_TOOLS, NAMES)).toEqual([]);
  });

  it('names the measure mode', () => {
    expect(
      activeToolNames({ ...NO_TOOLS, measure: 'distance' }, NAMES)
    ).toEqual(['Distancia']);
    expect(activeToolNames({ ...NO_TOOLS, measure: 'area' }, NAMES)).toEqual([
      'Área',
    ]);
  });

  it('lists every active tool in a fixed order', () => {
    expect(
      activeToolNames(
        { measure: 'area', crosshair: true, compare: true },
        NAMES
      )
    ).toEqual(['Área', 'Mira', 'Comparación']);
    expect(
      activeToolNames({ ...NO_TOOLS, compare: true, crosshair: true }, NAMES)
    ).toEqual(['Mira', 'Comparación']);
  });
});

describe('createToolPill', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mk() {
    document.body.innerHTML = `
      <div id="pill" hidden><span id="label"></span><button id="exit">Salir</button></div>`;
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    return { pill: $('pill'), label: $('label'), exit: $('exit') };
  }

  it('starts hidden, shows the active tool and hides again', () => {
    const els = mk();
    const pill = createToolPill(els, NAMES, () => undefined);
    expect(els.pill.hidden).toBe(true);
    pill.update({ ...NO_TOOLS, crosshair: true });
    expect(els.pill.hidden).toBe(false);
    expect(els.label.textContent).toBe('Mira');
    pill.update({ measure: 'distance', crosshair: true, compare: false });
    expect(els.label.textContent).toBe('Distancia · Mira');
    pill.update(NO_TOOLS);
    expect(els.pill.hidden).toBe(true);
    expect(els.label.textContent).toBe('');
  });

  it('Salir calls onExit until disposed', () => {
    const els = mk();
    const onExit = vi.fn();
    const pill = createToolPill(els, NAMES, onExit);
    els.exit.click();
    expect(onExit).toHaveBeenCalledTimes(1);
    pill.dispose();
    els.exit.click();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
