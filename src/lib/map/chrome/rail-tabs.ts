/**
 * Layers panel tabs — Story 22.2.
 *
 * The rail holds two tabs: "Capas" (the layer tiles + the active layer's
 * block) and "Superposiciones" (the overlays list with its filter). This
 * wires the WAI-ARIA tabs pattern on markup rendered by
 * InteractiveMap.astro:
 *
 *   <div class="im-rail" data-rail-tab="layers">
 *     <div role="tablist">
 *       <button role="tab" data-rail-tab-btn="layers" aria-controls="P1">…
 *       <button role="tab" data-rail-tab-btn="overlays" aria-controls="P2">…
 *     </div>
 *     <div id="P1" role="tabpanel">…</div>
 *     <div id="P2" role="tabpanel" hidden>…</div>
 *   </div>
 *
 * Click selects; ←/→ (wrapping), Home and End move the selection and the
 * focus (automatic activation, roving tabindex). The selected tab name is
 * mirrored on the rail's `data-rail-tab` so CSS and tests can read it.
 * Pure DOM, no map dependency: it runs from the component script before
 * MapLibre boots, so the tabs work even while the map is still loading.
 */

export interface RailTabs {
  /** Select a tab by name (`layers` | `overlays`); unknown names no-op. */
  select: (name: string, focus?: boolean) => void;
  /** Currently selected tab name. */
  current: () => string;
  /** Remove the listeners. */
  dispose: () => void;
}

export function wireRailTabs(rail: HTMLElement): RailTabs {
  const tabs = Array.from(
    rail.querySelectorAll<HTMLElement>('[role="tab"][data-rail-tab-btn]')
  );
  const panelOf = (tab: HTMLElement): HTMLElement | null => {
    const id = tab.getAttribute('aria-controls');
    return id ? rail.ownerDocument.getElementById(id) : null;
  };

  let selected =
    tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset
      .railTabBtn ??
    tabs[0]?.dataset.railTabBtn ??
    'layers';

  function select(name: string, focus = false): void {
    const target = tabs.find((t) => t.dataset.railTabBtn === name);
    if (!target) return;
    selected = name;
    for (const t of tabs) {
      const on = t === target;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = panelOf(t);
      if (panel) panel.hidden = !on;
    }
    rail.dataset.railTab = name;
    if (focus) target.focus();
  }

  const onClick = (e: Event): void => {
    const tab = (e.currentTarget as HTMLElement).dataset.railTabBtn;
    if (tab) select(tab);
  };
  const onKey = (e: KeyboardEvent): void => {
    const i = tabs.indexOf(e.currentTarget as HTMLElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const name = tabs[next].dataset.railTabBtn;
    if (name) select(name, true);
  };
  for (const t of tabs) {
    t.addEventListener('click', onClick);
    t.addEventListener('keydown', onKey);
  }
  select(selected);

  return {
    select,
    current: () => selected,
    dispose: (): void => {
      for (const t of tabs) {
        t.removeEventListener('click', onClick);
        t.removeEventListener('keydown', onKey);
      }
    },
  };
}
