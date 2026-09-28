/**
 * Overlay registry chrome — builds the Superposiciones checkbox panel
 * and the global keyboard-shortcut handler.
 *
 * Pure DOM + event wiring. Caller passes the overlay definitions and
 * an optional layer-shortcut callback (so the same keyboard listener
 * can activate map layers as well as toggle overlays).
 *
 * Story 22.2 — the panel is now the "Superposiciones" tab of the layers
 * panel: the most used overlays are pinned first (`deps.pinned`), a
 * filter input narrows the list, the tab shows how many overlays are on,
 * and the shortcut letter lives in the row's `title` instead of a chip
 * (the cheat-sheet of Story 22.5 lists them all).
 */

import { orderOverlays, overlayMatches } from './layer-rail';

export interface OverlayDef {
  /** Stable id (used for the DOM id `overlay-${id}`). */
  id: string;
  /** Visible label next to the checkbox. */
  label: string;
  /** Single uppercase letter shortcut. Lowercased input matches too. */
  shortcut: string;
  isEnabled: () => boolean;
  setEnabled: (on: boolean) => void;
}

export interface OverlayRegistry {
  /** Render the checkboxes inside the wrap element. Idempotent. */
  build: () => void;
  /** Re-sync each checkbox's `checked` property with `isEnabled()`. */
  refresh: () => void;
  /** Remove the global keydown listener installed by installShortcuts().
   *  No-op when shortcuts were never installed. */
  dispose: () => void;
}

export interface LayerShortcut {
  shortcut: string;
  id: string;
}

export interface OverlayRegistryEls {
  /** The <div> that holds the overlay checkboxes. When null, build()
   *  is a no-op (e.g. embedded maps without the layer rail). */
  wrap: HTMLElement | null;
  /** Story 22.2 — filter input; typing hides the rows whose label does
   *  not match (accent-insensitive, every word). Optional. */
  filter?: HTMLInputElement | null;
  /** Story 22.2 — badge on the overlays tab with the number of overlays
   *  switched on (empty + hidden at 0). Optional. */
  count?: HTMLElement | null;
}

export interface OverlayRegistryStrings {
  /** Heading over the pinned group ("Más usadas"). */
  pinned: string;
  /** Heading over the rest ("Todas"). */
  all: string;
  /** Shown when the filter matches nothing. */
  empty: string;
}

export interface OverlayRegistryDeps {
  /** Optional layer shortcut list. When set, the keyboard handler
   *  matches uppercase keys against this list FIRST and calls
   *  onLayerShortcut(id); falls through to overlay matches otherwise. */
  layers?: ReadonlyArray<LayerShortcut>;
  onLayerShortcut?: (id: string) => void;
  /** Story 22.2 — overlay ids listed first, under their own heading. */
  pinned?: ReadonlyArray<string>;
  /** Story 22.2 — group headings + empty-filter message. */
  strings?: OverlayRegistryStrings;
}

export function createOverlayRegistry(
  els: OverlayRegistryEls,
  overlays: ReadonlyArray<OverlayDef>,
  deps: OverlayRegistryDeps = {}
): OverlayRegistry {
  const rowOf = (def: OverlayDef): HTMLLabelElement => {
    const id = `overlay-${def.id}`;
    const row = document.createElement('label');
    row.htmlFor = id;
    row.dataset.overlayRow = def.id;
    row.className =
      'flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-blue-500/10 max-sm:min-h-[44px]';
    // Story 22.2 — no chip: the letter (every A–Z key is bound by now,
    // so not every overlay has one) rides in the tooltip until the `?`
    // cheat-sheet of Story 22.5 lists them.
    if (def.shortcut) row.title = `${def.label} (${def.shortcut})`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = def.isEnabled();
    cb.className = 'accent-blue-600';
    // Explicit accessible name (A11Y-1). The wrapping <label> should
    // already name the input, but some AT/browser combos announced
    // these checkboxes as just "on" — aria-label makes the name
    // unambiguous and matches the visible label text.
    cb.setAttribute('aria-label', def.label);
    cb.addEventListener('change', () => {
      def.setEnabled(cb.checked);
      refreshCount();
    });
    const lbl = document.createElement('span');
    lbl.textContent = def.label;
    lbl.className = 'flex-1';
    row.appendChild(cb);
    row.appendChild(lbl);
    return row;
  };

  const heading = (text: string, group: string): HTMLParagraphElement => {
    const p = document.createElement('p');
    p.dataset.overlayHeading = group;
    p.textContent = text;
    p.className =
      'mt-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
    return p;
  };

  let emptyEl: HTMLParagraphElement | null = null;

  function build(): void {
    if (!els.wrap) return;
    // Clear any pre-existing rows so build() is safely re-runnable.
    els.wrap.textContent = '';
    const { pinned, rest } = orderOverlays(overlays, deps.pinned ?? []);
    const groups: Array<{ name: string; defs: OverlayDef[] }> =
      pinned.length > 0
        ? [
            { name: 'pinned', defs: pinned },
            { name: 'all', defs: rest },
          ]
        : [{ name: 'all', defs: rest }];
    for (const g of groups) {
      if (g.defs.length === 0) continue;
      const box = document.createElement('div');
      box.dataset.overlayGroup = g.name;
      box.className = 'flex flex-col gap-1';
      // Headings only when there is something to tell apart.
      if (pinned.length > 0 && deps.strings) {
        box.appendChild(
          heading(
            g.name === 'pinned' ? deps.strings.pinned : deps.strings.all,
            g.name
          )
        );
      }
      for (const def of g.defs) box.appendChild(rowOf(def));
      els.wrap.appendChild(box);
    }
    emptyEl = document.createElement('p');
    emptyEl.dataset.overlayEmpty = '';
    emptyEl.hidden = true;
    emptyEl.className = 'px-1 py-1 italic text-gray-400';
    emptyEl.textContent = deps.strings?.empty ?? '—';
    els.wrap.appendChild(emptyEl);
    applyFilter();
    refreshCount();
  }

  /** Hide the rows whose label does not match the filter text; a group
   *  with no match loses its heading; nothing at all shows the message. */
  function applyFilter(): void {
    if (!els.wrap) return;
    const q = els.filter?.value ?? '';
    let any = false;
    els.wrap
      .querySelectorAll<HTMLElement>('[data-overlay-group]')
      .forEach((box) => {
        let groupAny = false;
        box
          .querySelectorAll<HTMLElement>('[data-overlay-row]')
          .forEach((row) => {
            const def = overlays.find((o) => o.id === row.dataset.overlayRow);
            const ok = !!def && overlayMatches(def.label, q);
            row.hidden = !ok;
            groupAny ||= ok;
          });
        box.hidden = !groupAny;
        any ||= groupAny;
      });
    if (emptyEl) emptyEl.hidden = any;
  }

  function refreshCount(): void {
    if (!els.count) return;
    const n = overlays.filter((o) => o.isEnabled()).length;
    els.count.textContent = n > 0 ? String(n) : '';
    els.count.hidden = n === 0;
  }

  const onFilterInput = (): void => applyFilter();
  const onFilterKey = (e: KeyboardEvent): void => {
    // Escape clears a non-empty filter first; the next Escape falls
    // through to whoever closes the panel.
    if (e.key === 'Escape' && els.filter && els.filter.value) {
      e.preventDefault();
      els.filter.value = '';
      applyFilter();
    }
  };
  if (els.filter) {
    els.filter.addEventListener('input', onFilterInput);
    els.filter.addEventListener('keydown', onFilterKey);
  }

  function refresh(): void {
    for (const def of overlays) {
      const cb = document.getElementById(
        `overlay-${def.id}`
      ) as HTMLInputElement | null;
      if (cb) cb.checked = def.isEnabled();
    }
    refreshCount();
  }

  // Global keydown — only attached when there's at least an overlay
  // or layer list, and when a window is available. Caller can wrap
  // this in a feature-gate (`features.layerRail`) by simply not
  // calling installShortcuts() — see the dedicated method below.
  let shortcutsHandler: ((e: KeyboardEvent) => void) | null = null;
  function installShortcuts(): void {
    if (typeof window === 'undefined' || shortcutsHandler) return;
    shortcutsHandler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable))
      ) {
        return;
      }
      const key = e.key.toUpperCase();
      const layerMatch = deps.layers?.find((l) => l.shortcut === key);
      if (layerMatch && deps.onLayerShortcut) {
        e.preventDefault();
        deps.onLayerShortcut(layerMatch.id);
        return;
      }
      const overlay = overlays.find((o) => o.shortcut === key);
      if (overlay) {
        e.preventDefault();
        overlay.setEnabled(!overlay.isEnabled());
        refresh();
      }
    };
    window.addEventListener('keydown', shortcutsHandler);
  }

  function dispose(): void {
    if (els.filter) {
      els.filter.removeEventListener('input', onFilterInput);
      els.filter.removeEventListener('keydown', onFilterKey);
    }
    if (typeof window !== 'undefined' && shortcutsHandler) {
      window.removeEventListener('keydown', shortcutsHandler);
      shortcutsHandler = null;
    }
  }

  return {
    build,
    refresh,
    dispose,
    // Not in the type but exposed via cast — see usage in the
    // interactive-map.ts wiring.
    ...({ installShortcuts } as { installShortcuts: () => void }),
  } as OverlayRegistry & { installShortcuts: () => void };
}
