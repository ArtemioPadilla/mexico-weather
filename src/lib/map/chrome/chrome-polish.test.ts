// @vitest-environment jsdom
/**
 * Story 25.4 — sentinel for the map chrome's polish (plan PARIDAD_VISUAL
 * E25): one button spec, no emoji, one set of radii and shadows, and the
 * 150 ms panel entrance that stops under reduced motion.
 *
 *  - Every <button> of InteractiveMap.astro (and /mapa's top-bar slot)
 *    carries `im-btn` and no state utility of its own (`hover:`,
 *    `focus-visible:`, `aria-pressed:` …): hover, pressed, focus, on,
 *    selected and disabled live once, in global.css.
 *  - No emoji in any <button> / <summary> markup, nor in any text the
 *    component renders (comments aside): icons come from the sprite.
 *  - Radii and shadows are the `--im-*` tokens (`rounded-im-panel`,
 *    `rounded-im-control`, `rounded-full`; `shadow-im`, `shadow-im-raised`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasEmoji } from './glyph-icons';
import { createSubOptionsGroup } from './sub-options';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

const ASTRO = 'src/components/InteractiveMap.astro';
const MAPA = 'src/pages/mapa.astro';

/** The component's markup: everything after the frontmatter fence, up to
 *  its global <style> (CSS comments may name glyphs). */
function markupOf(src: string): string {
  const body = src.slice(src.indexOf('---', 3) + 3);
  const style = body.indexOf('<style');
  return style >= 0 ? body.slice(0, style) : body;
}

/** Opening tag starting at `from` (`<name …>`), skipping `>` inside
 *  quotes and `{…}` expressions. */
function openingTag(src: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`unterminated tag at ${from}`);
}

/** Whole elements (`<button …>…</button>`) of a tag that never nests. */
function elements(src: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = src.indexOf(`</${tag}`, m.index);
    const tagText = openingTag(src, m.index);
    out.push(end > 0 ? src.slice(m.index, end) : tagText);
    re.lastIndex = m.index + tagText.length;
  }
  return out;
}

/** The static class list of an opening tag (`class="…"` or the string
 *  literals of `class:list={[…]}`). */
function classOf(tag: string): string {
  const plain = /\sclass="([^"]*)"/.exec(tag)?.[1];
  if (plain !== undefined) return plain;
  const list = /\sclass:list=\{\[([\s\S]*?)\]\}/.exec(tag)?.[1] ?? '';
  return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]).join(' ');
}

/** Utilities that restyle a state: only `.im-btn` may do that. */
const STATE_UTILITY =
  /(^|\s)(?:[\w[\]=/.-]+:)*(?:hover|focus|focus-visible|focus-within|active|aria-pressed|aria-expanded|aria-selected|disabled|enabled):/;

const stripComments = (s: string): string =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<!--[\s\S]*?-->/g, '');

describe('map chrome polish (Story 25.4)', () => {
  const astro = markupOf(read(ASTRO));
  const mapa = markupOf(read(MAPA));
  const buttons = [...elements(astro, 'button'), ...elements(mapa, 'button')];

  it('finds the chrome buttons it guards', () => {
    // 58 in the component (tiles, tabs, settings, timeline…) + the SMN
    // counter: a parser that silently finds none must not pass.
    expect(elements(astro, 'button').length).toBeGreaterThanOrEqual(50);
    expect(elements(mapa, 'button').length).toBeGreaterThanOrEqual(1);
  });

  it('no emoji inside any <button> or <summary> markup', () => {
    const offenders = [
      ...buttons,
      ...elements(astro, 'summary'),
      ...elements(mapa, 'summary'),
    ].filter(hasEmoji);
    expect(offenders).toEqual([]);
  });

  it('no emoji anywhere in the rendered markup of InteractiveMap.astro', () => {
    expect(hasEmoji(stripComments(astro))).toBe(false);
  });

  it('every button carries im-btn and no state utility of its own', () => {
    const bad = buttons
      .map((b) => ({ tag: openingTag(b, 0), cls: classOf(openingTag(b, 0)) }))
      .filter(
        ({ cls }) => !/(^|\s)im-btn(\s|$)/.test(cls) || STATE_UTILITY.test(cls)
      )
      .map(({ tag }) => tag.replace(/\s+/g, ' ').slice(0, 160));
    expect(bad).toEqual([]);
  });

  it('script-built buttons use the same spec', () => {
    // Layer tiles (interactive-map.ts), place card, sub-options.
    const monolith = read('src/lib/interactive-map.ts');
    const tile =
      /btn\.id = `layerbtn-[\s\S]*?btn\.className =\s*'([^']*)'/.exec(
        monolith
      )?.[1];
    expect(tile).toMatch(/(^|\s)im-btn(\s|$)/);
    expect(tile).not.toMatch(STATE_UTILITY);

    const wrap = document.createElement('div');
    createSubOptionsGroup(wrap, {
      containerId: 'x',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      getActive: () => 'a',
      isVisible: () => true,
      onSelect: () => undefined,
    });
    const subs = [...wrap.querySelectorAll('button')];
    expect(subs).toHaveLength(2);
    for (const b of subs) {
      expect(b.classList.contains('im-btn')).toBe(true);
      expect(b.className).not.toMatch(STATE_UTILITY);
    }
  });

  it('radii and shadows come from the --im-* tokens', () => {
    const utils = [
      ...astro.matchAll(
        /(?<![\w-])(?:[\w[\]=/.-]+:)*(rounded|shadow)(-[\w[\]/.-]+)?/g
      ),
    ].map((m) => m[0].replace(/^(?:[\w[\]=/.-]+:)*/, ''));
    const allowed =
      /^(rounded(-[trbl]{1,2})?-(full|im-panel|im-control)|shadow-im(-raised)?)$/;
    expect(utils.filter((u) => !allowed.test(u))).toEqual([]);
    // …and the panels actually use them.
    expect(utils).toContain('rounded-im-panel');
    expect(utils).toContain('shadow-im-raised');
  });

  it('panels enter with the 150 ms reveal', () => {
    const panels = [
      'id="mw-welcome"',
      'id={ids.ac}',
      'id={ids.layersPanel}',
      'id={ids.overlaysPanel}',
      'id={ids.msg}',
      'id={ids.placeCard}',
      'id="mw-tools-panel"',
      'id="mw-tools-tools"',
      'id="mw-settings"',
      'id="mw-info"',
      'id="mw-shortcuts"',
      'id="mw-tool-pill"',
    ];
    for (const id of panels) {
      const at = astro.indexOf(id);
      expect(at, id).toBeGreaterThan(0);
      const start = astro.lastIndexOf('<', at);
      expect(classOf(openingTag(astro, start)), id).toMatch(/\bim-reveal\b/);
    }
    const smnPanel = mapa.indexOf('id="mapa-smn-panel"');
    expect(classOf(openingTag(mapa, mapa.lastIndexOf('<', smnPanel)))).toMatch(
      /\bim-reveal\b/
    );
  });

  describe('global.css', () => {
    const css = read('src/styles/global.css');

    it('defines the states once: hover, pressed, focus, on, selected', () => {
      expect(css).toMatch(/--im-motion:\s*150ms/);
      expect(css).toMatch(/\.im-btn:hover:not\(:disabled\)\s*\{/);
      expect(css).toMatch(/\.im-btn:active:not\(:disabled\)\s*\{/);
      expect(css).toMatch(/\.im-btn:focus-visible\s*\{/);
      expect(css).toMatch(/\.im-btn:disabled\s*\{/);
      expect(css).toMatch(/\.im-btn\[role='tab'\]\[aria-selected='true'\]/);
      expect(css).toMatch(
        /\.im-btn:is\(\[aria-pressed='true'\], \[aria-expanded='true'\]\)/
      );
      expect(css).toMatch(
        /\.im-btn\s*\{[^}]*transition-duration:\s*var\(--im-motion\)/
      );
    });

    it('panel motion is 150 ms and stops under reduced motion', () => {
      expect(css).toMatch(
        /\.im-reveal\s*\{\s*animation:\s*im-reveal var\(--im-motion\)/
      );
      expect(css).toMatch(/animation:\s*im-sheet-in var\(--im-motion\)/);
      expect(css).not.toMatch(/\b(160|200)ms\b/);
      const reduced = [
        ...css.matchAll(
          /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g
        ),
      ].map((m) => m[1]);
      expect(
        reduced.some((b) => /\.im-btn\s*\{\s*transition:\s*none/.test(b))
      ).toBe(true);
      expect(
        reduced.some((b) => /\.im-reveal\s*\{\s*animation:\s*none/.test(b))
      ).toBe(true);
    });
  });
});
