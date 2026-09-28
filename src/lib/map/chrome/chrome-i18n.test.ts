// @vitest-environment jsdom
/**
 * Story 25.3 — sentinel for the map chrome's i18n.
 *
 * Every word the map chrome shows lives in `src/i18n/ui.ts` (es + en):
 * the Astro markup renders `t.*` and carries the English twin in a
 * `data-i18n-en*` attribute (BaseLayout swaps it before first paint), and
 * the script-built chrome reads `t.*` in the document's language. This
 * fails when a Spanish literal creeps back into the chrome sources, or
 * when a translated attribute / text node loses its English twin.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { documentUiLang, fillUi, ui } from '../../../i18n/ui';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

const ASTRO = 'src/components/InteractiveMap.astro';
/** Script sources that build map chrome (the monolith and the chrome
 *  modules it wires, plus the raster factory that raises a toast). */
const TS_FILES = [
  'src/lib/interactive-map.ts',
  'src/lib/map/chrome/autocomplete.ts',
  'src/lib/map/chrome/crosshair.ts',
  'src/lib/map/chrome/layer-rail.ts',
  'src/lib/map/chrome/overlay-registry.ts',
  'src/lib/map/chrome/pin-manager.ts',
  'src/lib/map/chrome/place-card.ts',
  'src/lib/map/chrome/rail-tabs.ts',
  'src/lib/map/chrome/shortcuts-dialog.ts',
  'src/lib/map/chrome/shortcuts.ts',
  'src/lib/map/chrome/snapshot-compare.ts',
  'src/lib/map/chrome/sub-options.ts',
  'src/lib/map/chrome/timeline-jump.ts',
  'src/lib/map/chrome/tool-pill.ts',
  'src/lib/map/chrome/tools-menu.ts',
  'src/lib/map/layers/weather-raster.ts',
];

/** Letters only Spanish uses among the chrome's two languages. */
const SPANISH_CHARS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
/** Spanish function words inside prose (a string with a space), not a
 *  class list, a unit or a shortcut letter. */
const SPANISH_WORD =
  /(^|[\s(])(de|del|la|las|los|el|y|con|sin|para|por|al|un|una|otro|más)(?=[\s.,:;)]|$)/;
const spanishProse = (s: string): boolean =>
  SPANISH_CHARS.test(s) || (/\S\s+\S/.test(s) && SPANISH_WORD.test(s));

/** Proper names that stay as they are in both languages. Each entry must
 *  still occur somewhere, so the list cannot rot. */
const ALLOWLIST = ['Clima México'];

const stripAllowed = (s: string): string =>
  ALLOWLIST.reduce((acc, a) => acc.split(a).join(''), s);

/** Every string literal / template chunk of a TS file, with its line. */
function tsLiterals(file: string): { line: number; text: string }[] {
  const src = read(file);
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: { line: number; text: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      out.push({ line, text: n.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The Astro file without its comments (JSX, block, HTML and line). */
function astroWithoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** The template part of the component (between the frontmatter and the
 *  global style block), comments removed. */
function astroMarkup(): string {
  const src = astroWithoutComments(read(ASTRO));
  const start = src.indexOf('---', 3) + 3;
  const end = src.indexOf('<style is:global>');
  return src.slice(start, end);
}

interface Tag {
  text: string;
  /** Text right after the tag, up to the next `<`. */
  after: string;
}

/** Opening tags of JSX-like markup; `>` inside `{…}` or quotes does not
 *  close a tag. */
function openTags(markup: string): Tag[] {
  const tags: Tag[] = [];
  for (let i = 0; i < markup.length; i++) {
    if (markup[i] !== '<' || !/[a-zA-Z]/.test(markup[i + 1] ?? '')) continue;
    let depth = 0;
    let quote: string | null = null;
    let j = i + 1;
    for (; j < markup.length; j++) {
      const c = markup[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const next = markup.indexOf('<', j + 1);
    tags.push({
      text: markup.slice(i, j + 1),
      after: markup.slice(j + 1, next < 0 ? undefined : next),
    });
    i = j;
  }
  return tags;
}

/** `{…}` value of `attr` in a tag, brace-balanced, or null. */
function exprAttr(tag: string, attr: string): string | null {
  const m = new RegExp(`(?:^|\\s)${attr}=\\{`).exec(tag);
  if (!m) return null;
  let depth = 1;
  let k = m.index + m[0].length;
  const from = k;
  for (; k < tag.length && depth > 0; k++) {
    if (tag[k] === '{') depth++;
    else if (tag[k] === '}') depth--;
  }
  return tag.slice(from, k - 1);
}

const tagName = (tag: string): string => /^<([\w-]+)/.exec(tag)?.[1] ?? '?';

describe('map chrome i18n (Story 25.3)', () => {
  it('the allowlist is short and every entry is still used', () => {
    expect(ALLOWLIST.length).toBeLessThanOrEqual(3);
    const all = [read(ASTRO), ...TS_FILES.map(read)].join('\n');
    for (const a of ALLOWLIST) expect(all, a).toContain(a);
  });

  it('no Spanish string literal in the chrome scripts', () => {
    const hits: string[] = [];
    for (const f of TS_FILES) {
      for (const { line, text } of tsLiterals(f)) {
        const s = stripAllowed(text);
        if (spanishProse(s)) {
          hits.push(`${f}:${line} ${JSON.stringify(text)}`);
        }
      }
    }
    expect(hits, 'move these to src/i18n/ui.ts (es + en)').toEqual([]);
  });

  it('no accented Spanish anywhere in InteractiveMap.astro but comments', () => {
    const hits = astroWithoutComments(read(ASTRO))
      .split('\n')
      .map((l, i) => ({ l: stripAllowed(l), n: i + 1 }))
      .filter(({ l }) => SPANISH_CHARS.test(l))
      .map(({ l, n }) => `${n}: ${l.trim()}`);
    expect(hits, 'move these to src/i18n/ui.ts (es + en)').toEqual([]);
  });

  it('no hard-coded words in the markup: attributes and text come from t.*', () => {
    const hits: string[] = [];
    for (const tag of openTags(astroMarkup())) {
      for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
        const lit = new RegExp(`(?:^|\\s)${attr}="([^"]*)"`).exec(tag.text);
        if (lit && /[A-Za-z]{2,}/.test(lit[1])) {
          hits.push(`<${tagName(tag.text)}> ${attr}="${lit[1]}"`);
        }
      }
      const text = stripAllowed(tag.after.replace(/\{[^{}]*\}/g, ''));
      if (spanishProse(text)) {
        hits.push(`<${tagName(tag.text)}> text "${text.trim()}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('every translated attribute and text node carries its English twin', () => {
    const missing: string[] = [];
    const tags = openTags(astroMarkup());
    let translated = 0;
    for (const tag of tags) {
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        const v = exprAttr(tag.text, attr);
        if (v === null || !/\bt\.\w/.test(v)) continue;
        translated++;
        const en = exprAttr(tag.text, `data-i18n-en-${attr}`);
        if (en === null || !/\bui\.en\.\w/.test(en)) {
          missing.push(`<${tagName(tag.text)}> ${attr}={${v}}`);
        }
      }
      if (/^\s*\{t\.\w+\}\s*$/.test(tag.after)) {
        translated++;
        const en = exprAttr(tag.text, 'data-i18n-en');
        if (en === null || !/\bui\.en\.\w/.test(en)) {
          missing.push(`<${tagName(tag.text)}> text ${tag.after.trim()}`);
        }
      }
    }
    // The scan really walked the chrome (settings, info, tools, rail…).
    expect(translated).toBeGreaterThan(60);
    expect(missing).toEqual([]);
  });

  it('the English twins name the same keys as the Spanish text', () => {
    const wrong: string[] = [];
    for (const tag of openTags(astroMarkup())) {
      const es = /^\s*\{t\.(\w+)\}\s*$/.exec(tag.after)?.[1];
      const en = /\bui\.en\.(\w+)/.exec(
        exprAttr(tag.text, 'data-i18n-en') ?? ''
      )?.[1];
      if (es && en && es !== en) wrong.push(`${es} ≠ ${en}`);
    }
    expect(wrong).toEqual([]);
  });

  it('every t.* key the chrome reads exists in both languages', () => {
    const keys = new Set<string>();
    for (const src of [read(ASTRO), read('src/lib/interactive-map.ts')]) {
      for (const m of src.matchAll(/\b(?:t|ui\.en|ui\.es)\.([a-z]\w*)/g)) {
        keys.add(m[1]);
      }
    }
    // Locals named `t` that are not the ui table.
    for (const k of ['time', 'toFixed']) keys.delete(k);
    for (const k of keys) {
      expect(ui.es, k).toHaveProperty(k);
      expect(ui.en, k).toHaveProperty(k);
    }
  });

  it('the English table reads English (no Spanish letters)', () => {
    const bad = Object.entries(ui.en)
      .filter(([, v]) => SPANISH_CHARS.test(stripAllowed(v)))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });
});

describe('fillUi', () => {
  it('fills named placeholders and leaves unknown ones visible', () => {
    expect(fillUi(ui.es.map_measure_add_points, { n: 2 })).toBe(
      'Añade 2 punto(s) más'
    );
    expect(fillUi(ui.en.map_measure_add_points, { n: 1 })).toBe(
      'Add 1 more point(s)'
    );
    expect(fillUi('{a} y {b}', { a: 'x' })).toBe('x y {b}');
    expect(fillUi(ui.en.map_satellite_zoom_limit, { z: 9 })).toMatch(
      /^Satellite is limited to zoom z9 /
    );
  });

  it('keeps the placeholders of each key the same in es and en', () => {
    const ph = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(ui.es) as (keyof typeof ui.es)[]) {
      expect(ph(ui.en[k]), k).toEqual(ph(ui.es[k]));
    }
  });
});

describe('documentUiLang', () => {
  afterEach(() => document.documentElement.removeAttribute('data-lang'));

  it('reads <html data-lang>, else the fallback', () => {
    expect(documentUiLang()).toBe('es');
    expect(documentUiLang('en')).toBe('en');
    document.documentElement.setAttribute('data-lang', 'en');
    expect(documentUiLang('es')).toBe('en');
    document.documentElement.setAttribute('data-lang', 'es');
    expect(documentUiLang('en')).toBe('es');
    document.documentElement.setAttribute('data-lang', 'fr');
    expect(documentUiLang('en')).toBe('en');
  });
});
