import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LAYERS } from '../../maplayers';
import { ui } from '../../../i18n/ui';
import {
  buildShortcutSections,
  effectiveOverlayKey,
  isShortcutsKey,
  overlayLabelKey,
  overlayShortcutLabel,
  shadowedOverlays,
  type ShortcutStrings,
} from './shortcuts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The real overlayDefs (id + letter), read from the monolith's source:
 *  the list lives inside initInteractiveMap's closure. */
function realOverlayDefs(): Array<{ id: string; shortcut: string }> {
  const src = readFileSync(
    resolve(ROOT, 'src/lib/interactive-map.ts'),
    'utf-8'
  );
  const start = src.indexOf('const overlayDefs: OverlayDef[] = [');
  expect(start).toBeGreaterThan(0);
  const block = src.slice(start, src.indexOf('\n  ];', start));
  const out: Array<{ id: string; shortcut: string }> = [];
  const re = /id: '(\w+)',\n\s+label: [^\n]+\n\s+shortcut: '([A-Z]?)'/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    out.push({ id: m[1], shortcut: m[2] });
  }
  return out;
}

const STRINGS: ShortcutStrings = {
  general: 'General',
  layers: 'Capas',
  overlays: 'Superposiciones',
  help: 'Ayuda',
  escape: 'Cerrar',
  zoom: 'Zoom',
  pan: 'Mover',
};

const layerSources = (lang: 'es' | 'en' = 'es') =>
  LAYERS.map((l) => ({
    id: l.id,
    shortcut: l.shortcut,
    label: String(ui[lang][l.labelKey as keyof (typeof ui)['es']]),
  }));

describe('shortcuts — pure cheat-sheet data (Story 22.5)', () => {
  it('a layer letter shadows an overlay with the same letter', () => {
    const layers = [{ shortcut: 'T' }, { shortcut: 'R' }];
    expect(effectiveOverlayKey(layers, { shortcut: 'T' })).toBe('');
    expect(effectiveOverlayKey(layers, { shortcut: 'x' })).toBe('X');
    expect(effectiveOverlayKey(layers, { shortcut: '' })).toBe('');
    expect(
      shadowedOverlays(layers, [
        { id: 'a', shortcut: 'T' },
        { id: 'b', shortcut: 'X' },
        { id: 'c', shortcut: '' },
      ])
    ).toEqual(['a']);
  });

  it('builds general, layers and overlays sections in source order', () => {
    const sections = buildShortcutSections(
      [
        { id: 'base', shortcut: 'M', label: 'Mapa base' },
        { id: 'precipitation', label: 'Precipitación' },
      ],
      [
        { id: 'graticule', shortcut: 'X', label: 'Retícula' },
        { id: 'outlook', shortcut: '', label: 'Posible desarrollo' },
      ],
      STRINGS
    );
    expect(sections.map((s) => s.id)).toEqual([
      'general',
      'layers',
      'overlays',
    ]);
    expect(sections[0].rows.map((r) => r.keys)).toEqual([
      ['?'],
      ['Esc'],
      ['+', '−'],
      ['←', '↑', '→', '↓'],
    ]);
    expect(sections[1].rows).toEqual([
      { target: 'layer:base', keys: ['M'], label: 'Mapa base' },
      { target: 'layer:precipitation', keys: [], label: 'Precipitación' },
    ]);
    // withKeysOnly drops the rows nobody can press.
    const only = buildShortcutSections(
      [{ id: 'precipitation', label: 'Precipitación' }],
      [{ id: 'outlook', shortcut: '', label: 'Posible desarrollo' }],
      STRINGS,
      { withKeysOnly: true }
    );
    expect(only.map((s) => s.id)).toEqual(['general']);
  });

  it('overlay names come from ui.ts with the definition as fallback', () => {
    expect(overlayLabelKey('nightLights')).toBe('map_overlay_nightLights');
    expect(overlayShortcutLabel(ui.en, 'nightLights', 'x')).toBe(
      'Night lights'
    );
    expect(overlayShortcutLabel(ui.es, 'nightLights', 'x')).toBe(
      'Luces nocturnas'
    );
    expect(overlayShortcutLabel({}, 'nope', 'Fallback')).toBe('Fallback');
  });

  it('`?` opens the sheet, not while typing or with a modifier', () => {
    expect(isShortcutsKey({ key: '?' })).toBe(true);
    expect(
      isShortcutsKey({ key: '?', target: { tagName: 'BUTTON' } as never })
    ).toBe(true);
    expect(isShortcutsKey({ key: '/' })).toBe(false);
    expect(isShortcutsKey({ key: '?', ctrlKey: true })).toBe(false);
    expect(isShortcutsKey({ key: '?', metaKey: true })).toBe(false);
    expect(isShortcutsKey({ key: '?', altKey: true })).toBe(false);
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isShortcutsKey({ key: '?', target: { tagName } as never })).toBe(
        false
      );
    }
    expect(
      isShortcutsKey({
        key: '?',
        target: { tagName: 'DIV', isContentEditable: true } as never,
      })
    ).toBe(false);
  });
});

describe('shortcuts — the real LAYERS + overlayDefs (single source)', () => {
  const overlays = realOverlayDefs();

  it('reads every overlay definition from the monolith', () => {
    expect(overlays.length).toBeGreaterThanOrEqual(20);
    expect(overlays.map((o) => o.id)).toContain('graticule');
  });

  it('every overlay has an es and an en name in ui.ts', () => {
    for (const o of overlays) {
      const key = overlayLabelKey(o.id) as keyof (typeof ui)['es'];
      expect(ui.es[key], `ui.es.${key}`).toBeTruthy();
      expect(ui.en[key], `ui.en.${key}`).toBeTruthy();
    }
  });

  it('no key is listed twice, and no shortcut lost its key', () => {
    for (const lang of ['es', 'en'] as const) {
      const sections = buildShortcutSections(
        layerSources(lang),
        overlays.map((o) => ({
          ...o,
          label: overlayShortcutLabel(ui[lang], o.id, o.id),
        })),
        STRINGS,
        { withKeysOnly: true }
      );
      const letters = sections
        .filter((s) => s.id !== 'general')
        .flatMap((s) => s.rows.flatMap((r) => r.keys));
      expect(new Set(letters).size).toBe(letters.length);
      // Every layer letter is there…
      for (const l of LAYERS) {
        if (!l.shortcut) continue;
        const row = sections[1].rows.find((r) => r.target === `layer:${l.id}`);
        expect(row?.keys, l.id).toEqual([l.shortcut]);
      }
      // …and every overlay letter that the handler honours.
      for (const o of overlays) {
        const key = effectiveOverlayKey(LAYERS, o);
        if (!key) continue;
        const row = sections[2].rows.find(
          (r) => r.target === `overlay:${o.id}`
        );
        expect(row?.keys, o.id).toEqual([key]);
      }
    }
  });

  it('pins the two overlay letters a layer letter already shadows', () => {
    // Pre-existing (found by this story): T is Temperatura before
    // Sistemas tropicales, A is Satélite before Alertas SMN por estado.
    // The sheet lists neither under a key it does not own; a change here
    // means a letter moved and the sheet follows it on its own.
    expect(shadowedOverlays(LAYERS, overlays).sort()).toEqual([
      'smnStateTint',
      'tropical',
    ]);
  });
});
