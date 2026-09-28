/**
 * The `?` keyboard cheat-sheet dialog — Story 22.5 (plan PARIDAD_VISUAL
 * E22). Renders the sections of shortcuts.ts into a native `<dialog>`
 * (markup in InteractiveMap.astro) and wires it:
 *
 * - `?` anywhere on the page (not while typing) opens it; `?` again, Esc,
 *   the close button or a click on the backdrop closes it.
 * - Any `[data-shortcuts-open]` element (the entry in the ⋯ menu) opens it.
 * - Modal (`showModal()`): focus moves into the dialog and the page behind
 *   is inert; keys pressed inside never reach the map's global shortcuts
 *   (propagation stops at the dialog), so reading the list with the
 *   keyboard cannot toggle layers behind it.
 * - Closing returns the focus to where it was, or to `fallbackFocus`
 *   when that element is gone or hidden (the ⋯ entry lives in a popover
 *   that closes when the dialog opens).
 *
 * jsdom has no `showModal()`: the fallback toggles the `open` attribute
 * and focuses the close button, so the contract is testable.
 */
import { isShortcutsKey, type ShortcutSection } from './shortcuts';

export interface ShortcutsDialogEls {
  dialog: HTMLElement;
  /** Where the sections are rendered. Defaults to `[data-shortcuts-body]`
   *  inside the dialog. */
  body?: HTMLElement | null;
  /** Focus target on close when the element focused before opening is
   *  no longer visible. */
  fallbackFocus?: HTMLElement | null;
}

export interface ShortcutsDialog {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  /** Re-render (e.g. after a language change). */
  render: (sections: ReadonlyArray<ShortcutSection>) => void;
  dispose: () => void;
}

type DialogLike = HTMLElement & {
  showModal?: () => void;
  close?: () => void;
  open?: boolean;
};

/** Render the sections as headed definition lists of `<kbd>` → action. */
export function renderShortcutSections(
  body: HTMLElement,
  sections: ReadonlyArray<ShortcutSection>
): void {
  const doc = body.ownerDocument;
  body.replaceChildren();
  for (const s of sections) {
    const section = doc.createElement('section');
    section.dataset.shortcutsSection = s.id;
    section.className = 'min-w-0';
    const h = doc.createElement('h3');
    h.id = `mw-shortcuts-h-${s.id}`;
    h.textContent = s.title;
    h.className =
      'mb-1 text-[10px] font-semibold uppercase tracking-wide text-im-muted';
    section.setAttribute('aria-labelledby', h.id);
    const dl = doc.createElement('dl');
    dl.className = 'space-y-0.5';
    for (const r of s.rows) {
      const row = doc.createElement('div');
      row.dataset.shortcut = r.target;
      row.className = 'flex items-center gap-2';
      const dt = doc.createElement('dt');
      dt.className = 'flex w-16 shrink-0 flex-wrap gap-0.5';
      if (r.keys.length === 0) {
        const none = doc.createElement('span');
        none.textContent = '—';
        none.className = 'text-im-muted';
        dt.appendChild(none);
      }
      for (const k of r.keys) {
        const kbd = doc.createElement('kbd');
        kbd.textContent = k;
        kbd.className =
          'inline-flex min-w-[1.5rem] justify-center rounded border border-white/20 bg-white/10 px-1 font-mono text-[11px] leading-5 text-im-text';
        dt.appendChild(kbd);
      }
      const dd = doc.createElement('dd');
      dd.textContent = r.label;
      dd.className = 'min-w-0 text-im-text';
      row.append(dt, dd);
      dl.appendChild(row);
    }
    section.append(h, dl);
    body.appendChild(section);
  }
}

function isShown(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if (el.closest('[hidden]')) return false;
  return true;
}

export function wireShortcutsDialog(
  els: ShortcutsDialogEls,
  sections: ReadonlyArray<ShortcutSection>
): ShortcutsDialog {
  const dialog = els.dialog as DialogLike;
  const doc = dialog.ownerDocument;
  const body =
    els.body ?? dialog.querySelector<HTMLElement>('[data-shortcuts-body]');
  const native = typeof dialog.showModal === 'function';
  let returnTo: HTMLElement | null = null;

  const isOpen = (): boolean => dialog.hasAttribute('open');

  function render(next: ReadonlyArray<ShortcutSection>): void {
    if (body) renderShortcutSections(body, next);
  }

  function open(): void {
    if (isOpen()) return;
    const active = doc.activeElement;
    returnTo =
      active instanceof HTMLElement && active !== doc.body ? active : null;
    if (native) {
      dialog.showModal!();
    } else {
      dialog.setAttribute('open', '');
    }
    // showModal() focuses the first focusable (the close button); do it
    // explicitly for the fallback and for browsers that focus the dialog.
    dialog.querySelector<HTMLElement>('[data-shortcuts-close]')?.focus();
  }

  function restoreFocus(): void {
    const target = isShown(returnTo)
      ? returnTo
      : isShown(els.fallbackFocus ?? null)
        ? els.fallbackFocus!
        : null;
    returnTo = null;
    target?.focus();
  }

  function close(): void {
    if (!isOpen()) return;
    if (native && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    restoreFocus();
  }

  const onDocKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || isOpen() || !isShortcutsKey(e)) return;
    e.preventDefault();
    open();
  };
  const onDialogKey = (e: KeyboardEvent): void => {
    // The map's letters, Escape handlers (menus, measuring, Controles)
    // and `?` itself must not act behind the modal.
    e.stopPropagation();
    const help = isShortcutsKey({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
    });
    if (e.key === 'Escape' || help) {
      e.preventDefault();
      close();
    }
  };
  // The browser's own close request (Escape through a close watcher):
  // same path, so the focus is restored once.
  const onCancel = (e: Event): void => {
    e.preventDefault();
    close();
  };
  const onDialogClick = (e: MouseEvent): void => {
    const t = e.target as Element | null;
    // A click on the ::backdrop targets the dialog element itself.
    if (t === dialog || t?.closest?.('[data-shortcuts-close]')) close();
  };
  const onOpener = (e: Event): void => {
    const t = e.target as Element | null;
    if (t?.closest?.('[data-shortcuts-open]')) open();
  };

  render(sections);
  doc.addEventListener('keydown', onDocKey);
  doc.addEventListener('click', onOpener);
  dialog.addEventListener('keydown', onDialogKey);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('click', onDialogClick);

  return {
    isOpen,
    open,
    close,
    render,
    dispose: (): void => {
      doc.removeEventListener('keydown', onDocKey);
      doc.removeEventListener('click', onOpener);
      dialog.removeEventListener('keydown', onDialogKey);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onDialogClick);
    },
  };
}
