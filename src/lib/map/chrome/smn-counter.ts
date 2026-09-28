/**
 * SMN avisos counter in the map's top bar — Story 22.4 (plan
 * PARIDAD_VISUAL E22).
 *
 * /mapa used to float an amber "⚠️ N avisos SMN" <details> pill in the
 * bottom-right corner, always visible — even with nothing to report
 * ("Sin alertas SMN"). It is now a compact counter next to search that
 * shows only when there is at least one aviso, and opens the same
 * <SmnAvisos> widget in a popover:
 *
 *   <button aria-expanded="false" aria-controls="P" hidden><svg>#i-alert</svg> <span>N</span></button>
 *   <div id="P" role="dialog" tabindex="-1" hidden><SmnAvisos scope="all" /></div>
 *
 * - smnCounterState() / smnCounterLabel() are pure: the count is
 *   allAvisos() — the very list the panel renders in its `scope="all"`
 *   mode — so the number on the button is the number of rows behind it.
 * - applySmnCounter() writes that state on the button (hidden at 0,
 *   `data-severity` for the red variant, the accessible name).
 * - wireSmnCounter() is the popover: the button toggles it and mirrors it
 *   on `aria-expanded`; opening focuses the panel; Escape closes it and
 *   returns focus to the button; a pointer press outside closes it. Same
 *   non-modal contract as the ⋯ tools menu (tools-menu.ts), no focus trap.
 *
 * Pure DOM, no map dependency: it runs from the /mapa page script, which
 * does not wait for MapLibre.
 */
import { allAvisos, type SmnAviso, type SmnByStateDoc } from '../../smn-avisos';

export type SmnSeverity = SmnAviso['severity'];

export interface SmnCounterState {
  count: number;
  /** Highest severity among the avisos; null when there are none. */
  severity: SmnSeverity | null;
}

const RANK: Record<SmnSeverity, number> = { info: 0, warn: 1, critical: 2 };

export function smnCounterState(doc: SmnByStateDoc | null): SmnCounterState {
  const avisos = allAvisos(doc);
  let severity: SmnSeverity | null = null;
  for (const a of avisos) {
    const s: SmnSeverity = a.severity in RANK ? a.severity : 'info';
    if (severity === null || RANK[s] > RANK[severity]) severity = s;
  }
  return { count: avisos.length, severity };
}

/** Accessible name / tooltip of the counter: "3 avisos SMN", "1 SMN alert". */
export function smnCounterLabel(count: number, lang: 'es' | 'en'): string {
  if (lang === 'en') return `${count} SMN alert${count === 1 ? '' : 's'}`;
  return `${count} aviso${count === 1 ? '' : 's'} SMN`;
}

export interface SmnCounterEls {
  button: HTMLElement;
  panel: HTMLElement;
  /** Where the number goes (inside the button). */
  countEl?: HTMLElement | null;
}

/** Write a counter state on the button. Hidden when there is nothing to
 *  count (0 avisos or no feed at all) — the panel closes with it. */
export function applySmnCounter(
  els: SmnCounterEls,
  state: SmnCounterState,
  lang: 'es' | 'en'
): void {
  const { button, panel, countEl } = els;
  const show = state.count > 0;
  button.hidden = !show;
  if (!show) {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    return;
  }
  if (countEl) countEl.textContent = String(state.count);
  const label = smnCounterLabel(state.count, lang);
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.dataset.severity = state.severity ?? 'info';
}

export interface SmnCounter {
  isOpen: () => boolean;
  open: () => void;
  /** Close; `focus` returns the focus to the counter. */
  close: (focus?: boolean) => void;
  /** Remove every listener. */
  dispose: () => void;
}

export function wireSmnCounter(els: SmnCounterEls): SmnCounter {
  const { button, panel } = els;
  const doc = button.ownerDocument;

  const isOpen = (): boolean => !panel.hidden;

  function open(): void {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    panel.focus();
  }

  function close(focus = false): void {
    if (!isOpen()) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }

  const onButton = (): void => {
    if (isOpen()) close();
    else open();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !isOpen()) return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    close(true);
  };
  const onPointerDown = (e: Event): void => {
    if (!isOpen()) return;
    const t = e.target as Node | null;
    if (t && (button.contains(t) || panel.contains(t))) return;
    close();
  };

  button.addEventListener('click', onButton);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('pointerdown', onPointerDown, true);
  button.setAttribute('aria-expanded', String(isOpen()));

  return {
    isOpen,
    open,
    close,
    dispose: (): void => {
      button.removeEventListener('click', onButton);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('pointerdown', onPointerDown, true);
    },
  };
}
