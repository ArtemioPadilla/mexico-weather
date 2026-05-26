import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MX_STATES } from './mx-states';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(
  resolve(here, '../../scripts/build-smn-by-state.py'),
  'utf-8',
);

/**
 * scripts/build-smn-by-state.py hardcodes the alias → slug mapping
 * for SMN aviso state detection. If a slug is renamed in
 * src/lib/mx-states.ts (or a new state is added) the Python script
 * silently stops tagging that state's avisos and they leak into the
 * _global bucket instead. These tests catch drift in CI before any
 * aviso goes un-tagged.
 */
describe('build-smn-by-state.py ↔ MX_STATES parity', () => {
  /** Extract every quoted slug value on the right-hand side of the
   *  STATE_ALIASES dict literal. The Python file groups them as
   *  ``'<alias>': '<slug>',`` so this is unambiguous. */
  function extractPythonSlugs(): Set<string> {
    const re = /'[^']+':\s*'([a-z0-9-]+)'/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(script)) !== null) out.add(m[1]!);
    return out;
  }

  /** Extract every alias key on the left-hand side. */
  function extractPythonAliases(): string[] {
    const re = /'([^']+)':\s*'[a-z0-9-]+'/g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(script)) !== null) out.push(m[1]!);
    return out;
  }

  it('every MX_STATES.slug is referenced as a target in the Python aliases', () => {
    const pySlugs = extractPythonSlugs();
    for (const s of MX_STATES) {
      expect(
        pySlugs.has(s.slug),
        `state slug '${s.slug}' has no entry in STATE_ALIASES — avisos mentioning it would leak into _global`,
      ).toBe(true);
    }
  });

  it('every Python slug target is a real MX_STATES.slug', () => {
    // Catches the reverse: a Python alias pointing at a slug that no
    // longer exists, which would tag avisos under a phantom state.
    const realSlugs = new Set(MX_STATES.map((s) => s.slug));
    for (const slug of extractPythonSlugs()) {
      expect(
        realSlugs.has(slug),
        `Python script targets slug '${slug}' which is not in MX_STATES`,
      ).toBe(true);
    }
  });

  it('every state has at least one alias that resembles its canonical name', () => {
    // The Python script is diacritic-insensitive but case-sensitive on
    // the alias key. Confirm each state's canonical name (lowercased
    // + diacritic-stripped) appears verbatim as an alias — otherwise
    // SMN's natural wording won't match.
    const aliases = new Set(extractPythonAliases());
    for (const s of MX_STATES) {
      const canonical = s.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      expect(
        aliases.has(canonical),
        `state '${s.name}' (canonical '${canonical}') has no matching alias in STATE_ALIASES`,
      ).toBe(true);
    }
  });
});
