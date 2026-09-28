/**
 * Story 25.2 — sentinel for the map chrome's `--im-*` tokens.
 *
 * Everything that floats over the map is themed by one set of tokens
 * (global.css) that the global light/dark theme never touches, so a light
 * and a dark screenshot of /mapa show the same chrome. This fails when a
 * per-element `bg-white/95 … dark:bg-gray-900/95`-style pair creeps back
 * into the chrome, or when a token gets a second, theme-dependent value.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

const TOKENS = ['bg', 'bg-strong', 'border', 'text', 'muted', 'accent'];

// Files that build chrome floating over the map (markup or class strings).
const CHROME_FILES = [
  'src/components/InteractiveMap.astro',
  'src/lib/interactive-map.ts',
  'src/lib/map/chrome/autocomplete.ts',
  'src/lib/map/chrome/crosshair.ts',
  'src/lib/map/chrome/overlay-registry.ts',
  'src/lib/map/chrome/place-card.ts',
  'src/lib/map/chrome/shortcuts-dialog.ts',
  'src/lib/map/chrome/sub-options.ts',
  'src/lib/map/chrome/timeline-jump.ts',
];

// Theme-dependent utilities that are NOT chrome: the map root's underlay
// (visible only where no tile has landed yet, it follows the basemap's
// theme) and the snapshot overlay's blend mode (map content).
const ALLOWED_DARK = new Set(['dark:bg-gray-950', 'dark:mix-blend-screen']);

describe('map chrome tokens (Story 25.2)', () => {
  const css = read('src/styles/global.css');

  it.each(TOKENS)('--im-%s is defined exactly once, on :root', (name) => {
    const defs = css.match(new RegExp(`--im-${name}:`, 'g')) ?? [];
    expect(defs).toHaveLength(1);
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rootBlock).toContain(`--im-${name}:`);
  });

  it.each(TOKENS)('--im-%s is a Tailwind colour (im-%s utilities)', (name) => {
    expect(css).toMatch(
      new RegExp(`--color-im-${name}:\\s*var\\(--im-${name}\\)`)
    );
  });

  it.each(CHROME_FILES)('%s has no light/dark utility pair', (file) => {
    const src = read(file);
    const dark = (src.match(/(?<![\w-])dark:[\w[\]/.%-]+/g) ?? []).filter(
      (u) => !ALLOWED_DARK.has(u)
    );
    expect(dark).toEqual([]);
    // The light half of the old pairs: near-opaque white panels.
    expect(src).not.toMatch(/\bbg-white\/9\d\b/);
  });

  it('MapLibre popups are themed by the tokens, not by html.dark', () => {
    const src = read('src/components/InteractiveMap.astro');
    expect(src).not.toMatch(/html\.dark\s+\.maplibregl-popup/);
    expect(src).toMatch(
      /\.im-root \.maplibregl-popup-content\s*\{[^}]*var\(--im-bg-strong\)/
    );
  });
});
