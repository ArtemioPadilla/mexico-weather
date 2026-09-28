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
 *
 * Story 22.5 — collapsible rail (`data-rail-collapsible` on the rail, set
 * on /mapa for the chrome budget): the tab bar doubles as the rail's
 * disclosure. Collapsed, only the tabs show (every panel hidden); a click
 * on a tab opens the rail on that tab, a click on the tab that is already
 * open collapses it again, Escape inside the rail collapses it and focuses
 * the selected tab. ←/→/Inicio/Fin keep moving the selection without
 * changing the open state. The selected tab carries `aria-expanded`
 * (true while its panel shows); the rail mirrors the state on
 * `data-rail-open`.
 */

export interface RailTabs {
  /** Select a tab by name (`layers` | `overlays`); unknown names no-op. */
  select: (name: string, focus?: boolean) => void;
  /** Currently selected tab name. */
  current: () => string;
  /** Story 22.5 — whether the panels show (always true unless the rail
   *  is collapsible). */
  isOpen: () => boolean;
  /** Story 22.5 — open or collapse a collapsible rail; no-op otherwise. */
  setOpen: (open: boolean) => void;
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

  const collapsible = rail.dataset.railCollapsible !== undefined;
  let open = !collapsible || rail.dataset.railOpen === 'true';

  let selected =
    tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset
      .railTabBtn ??
    tabs[0]?.dataset.railTabBtn ??
    'layers';

  function select(name: string, focus = false): void {
    const target = tabs.find((t) => t.dataset.railTabBtn === name);
    if (!target) return;
    selected = name;
    apply();
    rail.dataset.railTab = name;
    if (focus) target.focus();
  }

  function apply(): void {
    for (const t of tabs) {
      const on = t.dataset.railTabBtn === selected;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (collapsible) t.setAttribute('aria-expanded', String(on && open));
      const panel = panelOf(t);
      if (panel) panel.hidden = !(on && open);
    }
    if (collapsible) rail.dataset.railOpen = String(open);
  }

  function setOpen(next: boolean): void {
    if (!collapsible) return;
    open = next;
    apply();
  }

  const onClick = (e: Event): void => {
    const tab = (e.currentTarget as HTMLElement).dataset.railTabBtn;
    if (!tab) return;
    if (collapsible) {
      // The open tab collapses the rail; any tab opens it on itself.
      if (open && tab === selected) {
        setOpen(false);
        return;
      }
      open = true;
    }
    select(tab);
  };
  const onRailKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open || e.defaultPrevented) return;
    e.preventDefault();
    setOpen(false);
    tabs.find((t) => t.dataset.railTabBtn === selected)?.focus();
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
  if (collapsible) rail.addEventListener('keydown', onRailKey);
  select(selected);

  return {
    select,
    current: () => selected,
    isOpen: () => open,
    setOpen,
    dispose: (): void => {
      for (const t of tabs) {
        t.removeEventListener('click', onClick);
        t.removeEventListener('keydown', onKey);
      }
      if (collapsible) rail.removeEventListener('keydown', onRailKey);
    },
  };
}
