// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireToolsMenu as wire, type ToolsMenu } from './tools-menu';

// Menus listen on document: dispose each one so a menu left open by one
// test never answers another test's Escape.
const menus: ToolsMenu[] = [];
const wireToolsMenu = (els: Parameters<typeof wire>[0]): ToolsMenu => {
  const m = wire(els);
  menus.push(m);
  return m;
};

function mk() {
  document.body.innerHTML = `
    <button id="outside">map</button>
    <div id="wrap">
      <button id="btn" aria-expanded="false" aria-controls="panel">⋯</button>
      <div id="panel" role="dialog" hidden>
        <div role="tablist">
          <button role="tab" id="t-tools" data-rail-tab-btn="tools" aria-controls="p-tools" aria-selected="true">Herramientas</button>
          <button role="tab" id="t-settings" data-rail-tab-btn="settings" aria-controls="p-settings" aria-selected="false">Ajustes</button>
          <button role="tab" id="t-info" data-rail-tab-btn="info" aria-controls="p-info" aria-selected="false">Info</button>
        </div>
        <div id="p-tools" role="tabpanel">
          <button id="dist" data-tools-close>Distancia</button>
        </div>
        <div id="p-settings" role="tabpanel"><button id="unit">°C</button></div>
        <div id="p-info" role="tabpanel">fuentes</div>
      </div>
    </div>`;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return { $, button: $('btn'), panel: $('panel') };
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

describe('wireToolsMenu', () => {
  afterEach(() => {
    menus.splice(0).forEach((m) => m.dispose());
    document.body.innerHTML = '';
  });

  it('the button toggles the popover and aria-expanded', () => {
    const { button, panel, $ } = mk();
    const menu = wireToolsMenu({ button, panel });
    expect(menu.isOpen()).toBe(false);
    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // Opening moves the focus to the selected tab.
    expect(document.activeElement).toBe($('t-tools'));
    button.click();
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows one tab panel at a time and can open on a given tab', () => {
    const { button, panel, $ } = mk();
    const menu = wireToolsMenu({ button, panel });
    expect($('p-tools').hidden).toBe(false);
    expect($('p-settings').hidden).toBe(true);
    expect($('p-info').hidden).toBe(true);
    menu.open('settings');
    expect($('p-settings').hidden).toBe(false);
    expect($('p-tools').hidden).toBe(true);
    expect($('t-settings').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe($('t-settings'));
    $('t-info').click();
    expect($('p-info').hidden).toBe(false);
    expect($('p-settings').hidden).toBe(true);
  });

  it('Escape closes it and returns focus to the button', () => {
    const { button, panel } = mk();
    wireToolsMenu({ button, panel });
    button.click();
    const e = esc();
    expect(e.defaultPrevented).toBe(true);
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    // Closed: Escape is left alone for the other handlers.
    expect(esc().defaultPrevented).toBe(false);
  });

  it('leaves an Escape another control already consumed', () => {
    const { button, panel } = mk();
    wireToolsMenu({ button, panel });
    button.click();
    const e = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(panel.hidden).toBe(false);
  });

  it('a press outside closes it; a press inside does not', () => {
    const { button, panel, $ } = mk();
    wireToolsMenu({ button, panel });
    button.click();
    $('unit').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(false);
    $('outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a tool click runs the tool, then closes the menu', () => {
    const { button, panel, $ } = mk();
    wireToolsMenu({ button, panel });
    const tool = vi.fn(() => {
      // The tool's own handler still sees the menu open.
      expect(panel.hidden).toBe(false);
    });
    $('dist').addEventListener('click', tool);
    button.click();
    $('dist').click();
    expect(tool).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    // A control without data-tools-close (a setting) keeps it open.
    button.click();
    $('unit').click();
    expect(panel.hidden).toBe(false);
  });

  it('Story 25.1 — onToggle hears every open and close once', () => {
    const { button, panel, $ } = mk();
    const seen: boolean[] = [];
    const menu = wireToolsMenu({
      button,
      panel,
      onToggle: (open) => {
        // Told after the panel changed, before the tab gets the focus.
        expect(panel.hidden).toBe(!open);
        seen.push(open);
      },
    });
    button.click();
    menu.open('settings'); // already open: a tab switch, not a toggle
    expect(document.activeElement).toBe($('t-settings'));
    menu.close(true);
    menu.close(); // already closed
    expect(seen).toEqual([true, false]);
  });

  it('Story 25.1 — keepOpenOn exempts a target from the outside press', () => {
    const { button, panel, $ } = mk();
    wireToolsMenu({
      button,
      panel,
      keepOpenOn: (t) => t === $('outside'),
    });
    button.click();
    $('outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it('dispose removes the listeners', () => {
    const { button, panel } = mk();
    const menu = wireToolsMenu({ button, panel });
    menu.dispose();
    button.click();
    expect(panel.hidden).toBe(true);
  });
});
