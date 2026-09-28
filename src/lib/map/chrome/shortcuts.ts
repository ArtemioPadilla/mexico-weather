/**
 * Keyboard cheat-sheet data — Story 22.5 (plan PARIDAD_VISUAL E22).
 *
 * The `?` panel lists every keyboard shortcut of the map. It is generated,
 * never hand-written: the layer letters come from `LAYERS`
 * (src/lib/maplayers.ts) and the overlay letters from `overlayDefs`
 * (src/lib/interactive-map.ts), the same two lists the global keydown
 * handler of overlay-registry.ts reads. Names come from src/i18n/ui.ts
 * (es/en), so the panel follows the page language.
 *
 * Precedence mirrors the handler: a layer letter wins over an overlay with
 * the same letter (today `T` is Temperatura, not Sistemas tropicales, and
 * `A` is Satélite, not Alertas SMN por estado). A shadowed overlay is
 * listed without a key — the panel never promises a key that does
 * something else.
 *
 * Pure: no DOM. src/lib/map/chrome/shortcuts-dialog.ts renders it.
 */

export interface ShortcutLayerSource {
  id: string;
  /** Single uppercase letter, or undefined/'' for none. */
  shortcut?: string;
  /** Display name in the current language. */
  label: string;
}

export interface ShortcutOverlaySource {
  id: string;
  shortcut: string;
  label: string;
}

export interface ShortcutRow {
  /** What the row is about: `layer:<id>`, `overlay:<id>` or a general id. */
  target: string;
  /** Keys to press, in order (`['?']`, `['+', '−']`); empty when the
   *  action has no key (listed so the panel stays a complete index). */
  keys: string[];
  label: string;
}

export interface ShortcutSection {
  id: 'general' | 'layers' | 'overlays';
  title: string;
  rows: ShortcutRow[];
}

export interface ShortcutStrings {
  general: string;
  layers: string;
  overlays: string;
  help: string;
  escape: string;
  zoom: string;
  pan: string;
  /** Story 23.3 — Enter on the timeline opens "Saltar a fecha": the key's
   *  name in the page language ("Intro" / "Enter") and the row's label.
   *  Omitted ⇒ no row (maps without a timeline). */
  jumpDate?: { key: string; label: string };
}

/** ui.ts key of an overlay's display name (`map_overlay_<id>`). */
export function overlayLabelKey(id: string): string {
  return `map_overlay_${id}`;
}

/**
 * An overlay's name in the given string table, falling back to the
 * definition's own (Spanish) label when the table has no entry.
 */
export function overlayShortcutLabel(
  strings: object,
  id: string,
  fallback: string
): string {
  const v = (strings as Record<string, unknown>)[overlayLabelKey(id)];
  return typeof v === 'string' && v ? v : fallback;
}

/** Normalised letter (uppercase, trimmed) or '' when there is none. */
export function normaliseKey(k: string | undefined): string {
  return (k ?? '').trim().toUpperCase();
}

/**
 * The key that actually toggles this overlay: its letter unless a layer
 * claims the same one (the handler matches layers first), else ''.
 */
export function effectiveOverlayKey(
  layers: ReadonlyArray<{ shortcut?: string }>,
  overlay: { shortcut: string }
): string {
  const key = normaliseKey(overlay.shortcut);
  if (!key) return '';
  return layers.some((l) => normaliseKey(l.shortcut) === key) ? '' : key;
}

/** Overlay ids whose letter is shadowed by a layer letter. */
export function shadowedOverlays(
  layers: ReadonlyArray<{ shortcut?: string }>,
  overlays: ReadonlyArray<{ id: string; shortcut: string }>
): string[] {
  return overlays
    .filter((o) => normaliseKey(o.shortcut) && !effectiveOverlayKey(layers, o))
    .map((o) => o.id);
}

/**
 * The cheat-sheet: general keys, then every layer (LAYERS order), then
 * every overlay (overlayDefs order). Rows without a key stay in the list
 * (e.g. Precipitación, Posible desarrollo) so the panel doubles as an
 * index of what exists; `withKeysOnly` drops them.
 */
export function buildShortcutSections(
  layers: ReadonlyArray<ShortcutLayerSource>,
  overlays: ReadonlyArray<ShortcutOverlaySource>,
  strings: ShortcutStrings,
  opts: { withKeysOnly?: boolean } = {}
): ShortcutSection[] {
  const keep = (r: ShortcutRow): boolean =>
    !opts.withKeysOnly || r.keys.length > 0;
  const general: ShortcutRow[] = [
    { target: 'help', keys: ['?'], label: strings.help },
    { target: 'escape', keys: ['Esc'], label: strings.escape },
    { target: 'zoom', keys: ['+', '−'], label: strings.zoom },
    { target: 'pan', keys: ['←', '↑', '→', '↓'], label: strings.pan },
  ];
  if (strings.jumpDate) {
    general.push({
      target: 'jump-date',
      keys: [strings.jumpDate.key],
      label: strings.jumpDate.label,
    });
  }
  const layerRows: ShortcutRow[] = layers.map((l) => {
    const key = normaliseKey(l.shortcut);
    return { target: `layer:${l.id}`, keys: key ? [key] : [], label: l.label };
  });
  const overlayRows: ShortcutRow[] = overlays.map((o) => {
    const key = effectiveOverlayKey(layers, o);
    return {
      target: `overlay:${o.id}`,
      keys: key ? [key] : [],
      label: o.label,
    };
  });
  return [
    { id: 'general' as const, title: strings.general, rows: general },
    {
      id: 'layers' as const,
      title: strings.layers,
      rows: layerRows.filter(keep),
    },
    {
      id: 'overlays' as const,
      title: strings.overlays,
      rows: overlayRows.filter(keep),
    },
  ].filter((s) => s.rows.length > 0);
}

/**
 * Whether a key event's target is a field that takes typed characters,
 * so the map's single-key shortcuts must leave the key alone. A range
 * input (`#tl-range`, focused whenever the timeline bar is pressed) does
 * nothing with letters or `?`, so it does not count: the shortcuts keep
 * working after a click or drag on the bar.
 */
export function isTypingTarget(
  target: EventTarget | null | undefined
): boolean {
  const t = target as
    | { tagName?: string; type?: string; isContentEditable?: boolean }
    | null
    | undefined;
  if (!t) return false;
  const tag = (t.tagName ?? '').toUpperCase();
  return (
    (tag === 'INPUT' && (t.type ?? '').toLowerCase() !== 'range') ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    t.isContentEditable === true
  );
}

/**
 * Whether a keydown should open (or close) the cheat-sheet: the `?`
 * character on any layout (Shift is how most keyboards type it), with no
 * Ctrl/Meta/Alt, and not while typing in a field.
 */
export function isShortcutsKey(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTypingTarget(e.target);
}
