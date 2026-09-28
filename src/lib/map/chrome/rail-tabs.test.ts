// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { wireRailTabs } from './rail-tabs';

function mkRail(): HTMLElement {
  document.body.innerHTML = `
    <div class="im-rail" id="rail">
      <div role="tablist">
        <button role="tab" id="t1" data-rail-tab-btn="layers" aria-controls="p1" aria-selected="true">Capas</button>
        <button role="tab" id="t2" data-rail-tab-btn="overlays" aria-controls="p2" aria-selected="false">Superposiciones</button>
      </div>
      <div id="p1" role="tabpanel">layers</div>
      <div id="p2" role="tabpanel">overlays</div>
    </div>`;
  return document.getElementById('rail') as HTMLElement;
}

const $ = (id: string): HTMLElement =>
  document.getElementById(id) as HTMLElement;

describe('wireRailTabs', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts on the tab marked selected and hides the other panel', () => {
    const rail = mkRail();
    const tabs = wireRailTabs(rail);
    expect(tabs.current()).toBe('layers');
    expect(rail.dataset.railTab).toBe('layers');
    expect($('p1').hidden).toBe(false);
    expect($('p2').hidden).toBe(true);
    expect($('t1').tabIndex).toBe(0);
    expect($('t2').tabIndex).toBe(-1);
  });

  it('click switches tab, panels and aria-selected', () => {
    const rail = mkRail();
    wireRailTabs(rail);
    $('t2').click();
    expect(rail.dataset.railTab).toBe('overlays');
    expect($('t2').getAttribute('aria-selected')).toBe('true');
    expect($('t1').getAttribute('aria-selected')).toBe('false');
    expect($('p1').hidden).toBe(true);
    expect($('p2').hidden).toBe(false);
  });

  it('arrow keys wrap and move focus; Home/End jump', () => {
    const rail = mkRail();
    wireRailTabs(rail);
    $('t1').focus();
    $('t1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(rail.dataset.railTab).toBe('overlays');
    expect(document.activeElement).toBe($('t2'));
    $('t2').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(rail.dataset.railTab).toBe('layers');
    $('t1').dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(rail.dataset.railTab).toBe('overlays');
    $('t2').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(rail.dataset.railTab).toBe('layers');
  });

  it('select() ignores unknown names; dispose() unbinds clicks', () => {
    const rail = mkRail();
    const tabs = wireRailTabs(rail);
    tabs.select('nope');
    expect(tabs.current()).toBe('layers');
    tabs.dispose();
    $('t2').click();
    expect(tabs.current()).toBe('layers');
  });
});
