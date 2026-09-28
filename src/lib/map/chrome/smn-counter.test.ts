// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { SmnAviso, SmnByStateDoc } from '../../smn-avisos';
import {
  applySmnCounter,
  smnCounterLabel,
  smnCounterState,
  wireSmnCounter as wire,
  type SmnCounter,
} from './smn-counter';

const counters: SmnCounter[] = [];
const wireSmnCounter = (els: Parameters<typeof wire>[0]): SmnCounter => {
  const c = wire(els);
  counters.push(c);
  return c;
};
afterEach(() => {
  while (counters.length) counters.pop()!.dispose();
});

const aviso = (link: string, severity: SmnAviso['severity']): SmnAviso => ({
  title: link,
  link,
  pubDate: 'Sun, 27 Sep 2026 12:00:00 -0600',
  category: 'Aviso',
  severity,
});

describe('smnCounterState', () => {
  it('counts every aviso once across states and the global bucket', () => {
    const doc: SmnByStateDoc = {
      byState: {
        sonora: [aviso('a', 'info'), aviso('b', 'warn')],
        sinaloa: [aviso('b', 'warn')],
      },
      global: [aviso('c', 'info')],
    };
    expect(smnCounterState(doc)).toEqual({ count: 3, severity: 'warn' });
  });

  it('reports the highest severity', () => {
    const doc: SmnByStateDoc = {
      byState: { oaxaca: [aviso('a', 'info')] },
      global: [aviso('b', 'critical'), aviso('c', 'warn')],
    };
    expect(smnCounterState(doc).severity).toBe('critical');
  });

  it('is 0 / null with no feed or an empty one', () => {
    expect(smnCounterState(null)).toEqual({ count: 0, severity: null });
    expect(smnCounterState({ byState: {}, global: [] })).toEqual({
      count: 0,
      severity: null,
    });
  });
});

describe('smnCounterLabel', () => {
  it('pluralises in both languages', () => {
    expect(smnCounterLabel(1, 'es')).toBe('1 aviso SMN');
    expect(smnCounterLabel(7, 'es')).toBe('7 avisos SMN');
    expect(smnCounterLabel(1, 'en')).toBe('1 SMN alert');
    expect(smnCounterLabel(7, 'en')).toBe('7 SMN alerts');
  });
});

function mk() {
  document.body.innerHTML = `
    <button id="outside">map</button>
    <button id="btn" hidden aria-controls="panel"><span id="n"></span></button>
    <div id="panel" role="dialog" tabindex="-1" hidden><a id="link" href="#">aviso</a></div>`;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return { $, button: $('btn'), panel: $('panel'), countEl: $('n') };
}

const esc = (): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(e);
  return e;
};

describe('applySmnCounter', () => {
  it('shows the count, its name and severity when there are avisos', () => {
    const els = mk();
    applySmnCounter(els, { count: 7, severity: 'critical' }, 'es');
    expect(els.button.hidden).toBe(false);
    expect(els.countEl.textContent).toBe('7');
    expect(els.button.getAttribute('aria-label')).toBe('7 avisos SMN');
    expect(els.button.getAttribute('title')).toBe('7 avisos SMN');
    expect(els.button.dataset.severity).toBe('critical');
  });

  it('hides the counter and closes the panel at 0', () => {
    const els = mk();
    applySmnCounter(els, { count: 2, severity: 'info' }, 'en');
    expect(els.button.getAttribute('aria-label')).toBe('2 SMN alerts');
    els.panel.hidden = false;
    applySmnCounter(els, { count: 0, severity: null }, 'en');
    expect(els.button.hidden).toBe(true);
    expect(els.panel.hidden).toBe(true);
    expect(els.button.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('wireSmnCounter', () => {
  it('toggles the panel from the button and mirrors aria-expanded', () => {
    const els = mk();
    els.button.hidden = false;
    const c = wireSmnCounter(els);
    expect(els.button.getAttribute('aria-expanded')).toBe('false');
    els.button.click();
    expect(c.isOpen()).toBe(true);
    expect(els.panel.hidden).toBe(false);
    expect(els.button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(els.panel);
    els.button.click();
    expect(c.isOpen()).toBe(false);
    expect(els.button.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes it, returns focus and consumes the key', () => {
    const els = mk();
    const c = wireSmnCounter(els);
    c.open();
    const e = esc();
    expect(c.isOpen()).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(els.button);
    // Closed: Escape is left for the next control (measure exit, …).
    expect(esc().defaultPrevented).toBe(false);
  });

  it('leaves an Escape another control already consumed', () => {
    const els = mk();
    const c = wireSmnCounter(els);
    c.open();
    const e = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(c.isOpen()).toBe(true);
  });

  it('a press outside closes it; a press inside does not', () => {
    const els = mk();
    const c = wireSmnCounter(els);
    c.open();
    els.$('link').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(c.isOpen()).toBe(true);
    els.$('outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(c.isOpen()).toBe(false);
  });

  it('dispose removes the listeners', () => {
    const els = mk();
    const c = wire(els);
    c.dispose();
    els.button.click();
    expect(els.panel.hidden).toBe(true);
  });
});
