import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for issue #124 / PR #289.
 *
 * requestAnimationFrame does not fire in hidden or heavily throttled
 * tabs. Anything that *gates a map boot* on rAF therefore fails to mount
 * the map at all — not merely fails to paint it. PR #289 fixed this for
 * /mapa (InteractiveMap.astro); src/pages/forecast.astro had the same
 * bug because it calls initInteractiveMap() directly.
 *
 * These are source-text assertions on purpose: both boot schedulers are
 * inline <script> blocks that vitest cannot import. They pin one
 * *decision* — never gate a map boot on rAF — at two known call sites,
 * and nothing more. The behavioural guard is e2e/map-first-paint.spec.ts,
 * which starves rAF and asserts the map still mounts.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

/** Strip line + block comments: the #289 tombstone comment in
 *  InteractiveMap.astro quotes `requestAnimationFrame(boot)` verbatim, so a
 *  naive source match reports the very bug it documents. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('map boot scheduling', () => {
  it('forecast.astro does not wrap initInteractiveMap in requestAnimationFrame', () => {
    const src = code(read('../../pages/forecast.astro'));
    expect(src).toContain('initInteractiveMap({');
    // The bug shape: an rAF callback whose body contains the factory call.
    // 400 chars is comfortably wider than the real block (measured: 111).
    const rafBlocks =
      src.match(/requestAnimationFrame\(\s*\(\)\s*=>\s*\{[\s\S]{0,400}?\}/g) ?? [];
    for (const block of rafBlocks) {
      expect(block).not.toContain('initInteractiveMap');
    }
  });

  it('the /mapa non-lazy path still boots via setTimeout, not rAF', () => {
    const src = code(read('../../components/InteractiveMap.astro'));
    expect(src).toContain('window.setTimeout(boot, 0)');
    expect(src).not.toMatch(/requestAnimationFrame\(\s*boot\s*\)/);
  });
});
