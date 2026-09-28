/**
 * Sub-options inline button group for the layer rail.
 *
 * zoom.earth-parity feature: under the active layer, a small row of
 * radio-style chips that let the user pick a variant (Temperatura →
 * Actual/Aparente/Bulbo, Satélite → GeoColor/IR/Color real, etc.).
 *
 * Story 22.2 — the chips wrap on one or two lines inside the active
 * layer's block of the compact rail (the caller passes that block's
 * slot as `wrap`), and fade in (`im-reveal`) each time they appear.
 * Whether they show below `sm` is the slot's call, not this module's.
 *
 * The 5 inline implementations in interactive-map.ts were copies of
 * this template — this factory deduplicates the markup + click +
 * refresh logic.
 *
 * Caller owns:
 *   - the selected value (passed via getActive/setActive callbacks),
 *   - the visibility predicate (true when the parent layer is active),
 *   - what to do after selection changes (commonly: re-call
 *     setActiveLayer(parentLayerId) to refetch with the new variant).
 */

export interface SubOptionDef<T extends string> {
  id: T;
  label: string;
}

export interface SubOptionsGroup<T extends string> {
  /** Re-sync the visibility + aria-pressed state to match the
   *  current active value + visibility predicate. */
  refresh: () => void;
}

export interface SubOptionsOpts<T extends string> {
  /** ID of the container element to insert into the rail. Also used
   *  as the id of the inserted <div>. */
  containerId: string;
  /** Returns the currently-selected variant id. */
  getActive: () => T;
  /** Set the new variant and run any necessary side-effects (e.g.
   *  setActiveLayer + refetch). The group does NOT need to refresh
   *  itself afterwards — the factory calls refresh() before invoking
   *  the callback. */
  onSelect: (next: T) => void;
  /** Predicate: true when this group should be visible (typically:
   *  the parent layer is the active layer on the map). */
  isVisible: () => boolean;
  /** The choices, displayed in array order. */
  options: SubOptionDef<T>[];
}

export function createSubOptionsGroup<T extends string>(
  wrap: HTMLElement | null,
  opts: SubOptionsOpts<T>
): SubOptionsGroup<T> {
  if (!wrap) {
    return { refresh: (): void => undefined };
  }
  const container = document.createElement('div');
  container.id = opts.containerId;
  container.className =
    'im-reveal hidden flex-wrap gap-1 text-[11px] text-im-muted';

  for (const o of opts.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.sub = o.id;
    btn.textContent = o.label;
    // Story 25.4 — the chrome's one button spec (global.css `.im-btn`).
    btn.className =
      'im-btn im-btn-chip rounded-full px-2 py-0.5 max-sm:min-h-[44px]';
    btn.setAttribute('aria-pressed', String(opts.getActive() === o.id));
    btn.addEventListener('click', () => {
      if (opts.getActive() === o.id) return;
      opts.onSelect(o.id);
      group.refresh();
    });
    container.appendChild(btn);
  }
  wrap.appendChild(container);

  const group: SubOptionsGroup<T> = {
    refresh: (): void => {
      const show = opts.isVisible();
      container.classList.toggle('hidden', !show);
      container.classList.toggle('flex', show);
      const current = opts.getActive();
      container.querySelectorAll('button').forEach((b) => {
        b.setAttribute(
          'aria-pressed',
          String((b as HTMLButtonElement).dataset.sub === current)
        );
      });
    },
  };
  group.refresh();
  return group;
}
