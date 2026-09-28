// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WMO, WMO_EN } from '../../weather';
import {
  GLYPH_SPRITES,
  conditionIconHtml,
  glyphLinesHtml,
  hasEmoji,
  parseGlyphLines,
  renderGlyphLines,
  spriteForGlyph,
  stripEmoji,
} from './glyph-icons';

const HERE = dirname(fileURLToPath(import.meta.url));
const sprite = readFileSync(
  resolve(HERE, '../../../components/common/IconSprite.astro'),
  'utf-8'
);

describe('glyph icons (Story 25.4)', () => {
  it('every mapped sprite exists in IconSprite.astro', () => {
    for (const id of new Set(Object.values(GLYPH_SPRITES))) {
      expect(sprite, id).toMatch(new RegExp(`(^|\\s)'?${id}'?:\\s*'`, 'm'));
    }
  });

  it('knows every WMO condition glyph (es and en)', () => {
    for (const label of [...Object.values(WMO), ...Object.values(WMO_EN)]) {
      expect(conditionIconHtml(label), label).toMatch(/#i-[\w-]+/);
    }
    expect(conditionIconHtml('Lluvia 🌧️')).toContain('#i-cloud-rain');
    expect(conditionIconHtml('sin icono')).toBe('·');
  });

  it('spriteForGlyph ignores the presentation selector', () => {
    expect(spriteForGlyph('🌧️')).toBe('cloud-rain');
    expect(spriteForGlyph('🌧')).toBe('cloud-rain');
    expect(spriteForGlyph('☀️')).toBe('sun');
    expect(spriteForGlyph('x')).toBeNull();
  });

  it('hasEmoji: emoji and symbol glyphs yes; arrows, degrees, guillemets no', () => {
    for (const e of [
      '🌡',
      '💧',
      '☀️',
      '⚠',
      '⚠️',
      '⚙',
      'ℹ',
      '✓',
      '▶',
      '🌀',
      '🇲🇽',
    ])
      expect(hasEmoji(e), e).toBe(true);
    for (const t of [
      '↗ NE',
      '↘',
      '← →',
      '24°',
      '± 2',
      '‹ › « »',
      '⋯',
      '·',
      '©',
    ])
      expect(hasEmoji(t), t).toBe(false);
    expect(stripEmoji('a ⚠️ b 🌀 c')).toBe('a  b  c');
  });

  it('parses the tooltip lines, keeping the wind arrow', () => {
    expect(parseGlyphLines('🌡 24°\n💧 60%\n💨 12 km/h ↗ NE\nDía')).toEqual([
      { icon: 'thermometer', text: '24°' },
      { icon: 'droplet', text: '60%' },
      { icon: 'wind', text: '12 km/h ↗ NE' },
      { icon: null, text: 'Día' },
    ]);
    // An unknown emoji never reaches the chrome.
    expect(parseGlyphLines('🦄 7')).toEqual([{ icon: null, text: '7' }]);
    // A leading arrow is text, not a glyph.
    expect(parseGlyphLines('↗ 3')).toEqual([{ icon: null, text: '↗ 3' }]);
  });

  it('renderGlyphLines: one row per line, sprite + spoken name + value', () => {
    const el = document.createElement('div');
    el.textContent = 'old';
    renderGlyphLines(el, '🌡 24°\n🧭 1014 hPa', {
      thermometer: 'Temperatura',
    });
    const rows = [...el.children];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('use')?.getAttribute('href')).toBe(
      '#i-thermometer'
    );
    expect(rows[0]?.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(rows[0]?.textContent).toBe('Temperatura 24°');
    expect(rows[1]?.textContent).toBe('1014 hPa');
    expect(hasEmoji(el.textContent ?? '')).toBe(false);
    // Plain text (the dash, Día / Noche) is one row without an icon.
    renderGlyphLines(el, '—');
    expect(el.children).toHaveLength(1);
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toBe('—');
  });

  it('glyphLinesHtml escapes and joins with a middle dot', () => {
    const html = glyphLinesHtml('🌡 <b>\n💧 60%', { droplet: 'Humedad' });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('#i-thermometer');
    expect(html).toContain('<span class="sr-only">Humedad</span>');
    expect(html).toContain(' · ');
    expect(hasEmoji(html)).toBe(false);
  });
});
