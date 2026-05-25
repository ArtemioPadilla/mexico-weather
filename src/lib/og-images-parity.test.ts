import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOP_CITIES } from './top-cities';
import { TOP_BEACHES } from './top-beaches';
import { MX_STATES } from './mx-states';
import { MX_VOLCANOES } from './mx-volcanoes';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(
  resolve(here, '../../scripts/build-og-images.py'),
  'utf-8',
);

/**
 * scripts/build-og-images.py mirrors four TS lists by hand. These
 * tests catch slug-level drift — if the script falls out of sync,
 * social previews for the missing slugs would fall back to the
 * generic site OG (annoying but not breaking).
 */
describe('build-og-images.py parity', () => {
  it('CITIES count matches TOP_CITIES', () => {
    const slugMatches = (script.match(/\('([^']+)', '[^']*', '[^']*'\),/g) ?? [])
      .length;
    // Cities + beaches both use the (slug, name, admin) shape, so the
    // total count includes both lists.
    expect(slugMatches).toBe(TOP_CITIES.length + TOP_BEACHES.length);
  });

  it('every TOP_CITIES slug appears in the script', () => {
    for (const c of TOP_CITIES) {
      expect(script, `city ${c.slug}`).toContain(`('${c.slug}', `);
    }
  });

  it('every TOP_BEACHES slug appears in the script', () => {
    for (const b of TOP_BEACHES) {
      expect(script, `beach ${b.slug}`).toContain(`('${b.slug}', `);
    }
  });

  it('every MX_STATES slug appears in STATES', () => {
    for (const s of MX_STATES) {
      expect(script, `state ${s.slug}`).toContain(`'${s.slug}'`);
    }
  });

  it('every MX_VOLCANOES slug appears in VOLCANOES', () => {
    for (const v of MX_VOLCANOES) {
      expect(script, `volcano ${v.slug}`).toContain(`('${v.slug}', `);
    }
  });
});
