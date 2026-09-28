/**
 * The one "⋯ Herramientas" menu — Story 22.3 (plan PARIDAD_VISUAL E22).
 *
 * Distancia, Área, Mira, Capturar and Hace 24 h used to float as two
 * columns of pills on the right edge of the map, next to separate ⚙ and ℹ
 * buttons. They now live behind one button, in a popover with three tabs
 * (Herramientas / Ajustes / Info). This wires the popover on markup
 * rendered by InteractiveMap.astro:
 *
 *   <button aria-expanded="false" aria-controls="P">⋯</button>
 *   <div id="P" role="dialog" hidden>
 *     <div role="tablist">
 *       <button role="tab" data-rail-tab-btn="tools" aria-controls="T1">…
 *       …
 *     </div>
 *     <div id="T1" role="tabpanel">… <button data-tools-close>…</button></div>
 *     …
 *   </div>
 *
 * - The button toggles the popover and mirrors it on `aria-expanded`.
 * - Opening focuses the selected tab (focus-visible only shows the ring
 *   after keyboard use); the tabs are the WAI-ARIA tabs of rail-tabs.ts.
 * - Escape closes it and returns focus to the button; a pointer press
 *   outside the button and the popover closes it without moving focus.
 * - A click on any `[data-tools-close]` control inside (the tools
 *   themselves) closes it after the tool's own handler ran, so the next
 *   click lands on the map — where measuring happens.
 *
 * Non-modal, no focus trap (Tab walks out of it like any popover). Pure DOM,
 * no map dependency: it runs from the component script before MapLibre
 * boots, like the rail tabs.
 */
import { wireRailTabs, type RailTabs } from './rail-tabs';

export interface ToolsMenuEls {
  button: HTMLElement;
  panel: HTMLElement;
  /** Story 25.1 — told after every open / close (the bottom sheet that
   *  the popover becomes below `sm` follows it). */
  onToggle?: (open: boolean) => void;
  /** Story 25.1 — a press on a target this accepts does not count as
   *  "outside" (the Controles trigger floating above the sheet: closing
   *  first would move it from under the finger before its click). */
  keepOpenOn?: (target: Node) => boolean;
}

export interface ToolsMenu {
  isOpen: () => boolean;
  /** Open, optionally on a given tab (`tools` | `settings` | `info`). */
  open: (tab?: string) => void;
  /** Close; `focus` returns the focus to the ⋯ button. */
  close: (focus?: boolean) => void;
  tabs: RailTabs;
  /** Remove every listener. */
  dispose: () => void;
}

export function wireToolsMenu(els: ToolsMenuEls): ToolsMenu {
  const { button, panel, onToggle, keepOpenOn } = els;
  const doc = button.ownerDocument;
  const tabs = wireRailTabs(panel);

  const isOpen = (): boolean => !panel.hidden;

  function focusSelectedTab(): void {
    const sel = panel.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    );
    sel?.focus();
  }

  function open(tab?: string): void {
    if (tab) tabs.select(tab);
    const was = isOpen();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    if (!was) onToggle?.(true);
    focusSelectedTab();
  }

  function close(focus = false): void {
    if (!isOpen()) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
    onToggle?.(false);
  }

  const onButton = (): void => {
    if (isOpen()) close();
    else open();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !isOpen()) return;
    // The search box and its suggestions consume their own Escape.
    if (e.defaultPrevented) return;
    e.preventDefault();
    close(true);
  };
  const onPointerDown = (e: Event): void => {
    if (!isOpen()) return;
    const t = e.target as Node | null;
    if (t && (button.contains(t) || panel.contains(t))) return;
    if (t && keepOpenOn?.(t)) return;
    close();
  };
  const onPanelClick = (e: Event): void => {
    const t = e.target as Element | null;
    if (t?.closest?.('[data-tools-close]')) close(true);
  };

  button.addEventListener('click', onButton);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('pointerdown', onPointerDown, true);
  panel.addEventListener('click', onPanelClick);
  button.setAttribute('aria-expanded', String(isOpen()));

  return {
    isOpen,
    open,
    close,
    tabs,
    dispose: (): void => {
      tabs.dispose();
      button.removeEventListener('click', onButton);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      panel.removeEventListener('click', onPanelClick);
    },
  };
}
