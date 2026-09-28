/**
 * Glyph icons — Story 25.4, plan PARIDAD_VISUAL E25.
 *
 * The map's value strings lead each line with an emoji ("🌡 24°\n💧 60%",
 * from tooltipValueAt() in interactive-map.ts) and the WMO condition
 * strings end with one ("Lluvia 🌧️", src/lib/weather.ts). Those strings
 * stay as they are: the city value labels drawn by MapLibre, the marine
 * labels and the content pages read them. What changes is how the CHROME
 * draws them: the hover tooltip, the crosshair readout and the place card
 * swap each known emoji for the matching IconSprite.astro symbol
 * (monochrome, currentColor, the same on every OS), so no emoji ever
 * reaches a panel over the map. An emoji this table does not know is
 * dropped from the chrome rather than shown.
 *
 * Pure except renderGlyphLines(), which writes into an element with
 * textContent/createElementNS only (no innerHTML of caller strings).
 */

/** Emoji (without the U+FE0F presentation selector) → sprite id. */
export const GLYPH_SPRITES: Readonly<Record<string, string>> = {
  // Metric lines (tooltipValueAt, marine labels).
  '🌡': 'thermometer',
  '💧': 'droplet',
  '🧭': 'gauge',
  '💨': 'wind',
  '🌧': 'cloud-rain',
  '🌊': 'waves',
  // WMO conditions (weather.ts WMO / WMO_EN).
  '☀': 'sun',
  '⛅': 'cloud-sun',
  '🌤': 'cloud-sun',
  '☁': 'cloud',
  '🌫': 'cloud-fog',
  '🌦': 'cloud-drizzle',
  '🌨': 'cloud-snow',
  '❄': 'cloud-snow',
  '🌩': 'cloud-lightning',
  '⛈': 'cloud-lightning',
};

/**
 * What counts as an emoji in the chrome: anything drawn as a colour
 * picture by default (Emoji_Presentation), any pictograph forced to one
 * by U+FE0F, the supplementary emoji planes (🌡 has no FE0F in our
 * strings), and the Miscellaneous Symbols / Dingbats blocks (☀ ☁ ⚠ ⚙ ⛈
 * ✓ ❄ …, which iOS and Android paint as emoji even without FE0F), plus
 * ℹ ▶ ◀ ⭐ ⭕. Not the arrows (↗ ↘ are the wind heading), °, ±, ·, ‹ ›.
 * Source (not a RegExp) so each caller builds its own flags.
 */
export const EMOJI_SOURCE =
  '\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\u{FE0F}|[\\u{1F000}-\\u{1FAFF}\\u{2139}\\u{25B6}\\u{25C0}\\u{2600}-\\u{27BF}\\u{2B50}\\u{2B55}]\\u{FE0E}?';
const EMOJI_G = new RegExp(`(?:${EMOJI_SOURCE})\\u{200D}?`, 'gu');
const LEAD = /^(\p{Extended_Pictographic})[\u{FE0E}\u{FE0F}]?\s*/u;

/** True when `s` holds an emoji (see EMOJI_SOURCE). */
export function hasEmoji(s: string): boolean {
  return new RegExp(EMOJI_SOURCE, 'u').test(s);
}

/** `s` without any emoji (and without the selectors that styled them). */
export function stripEmoji(s: string): string {
  return s.replace(EMOJI_G, '').replace(/[\u{FE0E}\u{FE0F}]/gu, '');
}

/** Sprite id for one emoji glyph ("🌧️" and "🌧" alike), or null. */
export function spriteForGlyph(glyph: string): string | null {
  const bare = glyph.replace(/[\u{FE0E}\u{FE0F}]/gu, '').trim();
  return GLYPH_SPRITES[bare] ?? null;
}

export interface GlyphLine {
  /** Sprite id for the line's leading emoji, if it had a known one. */
  icon: string | null;
  /** The line without its leading emoji (and with no emoji left). */
  text: string;
}

/** Split a multi-line value string into lines with their icon. */
export function parseGlyphLines(text: string): GlyphLine[] {
  return text.split('\n').map((line) => {
    const m = LEAD.exec(line);
    const icon = m ? spriteForGlyph(m[1] ?? '') : null;
    // Only a real emoji lead is consumed (never a leading arrow).
    const lead = m && (icon || hasEmoji(m[0])) ? m[0] : '';
    return { icon, text: stripEmoji(line.slice(lead.length)).trim() };
  });
}

/** Screen-reader names per sprite id ("thermometer" → "Temperatura"),
 *  supplied by the caller in the document's language. */
export type GlyphLabels = Readonly<Partial<Record<string, string>>>;

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `<svg><use href="#i-…"/></svg>` markup for a sprite id. */
export function spriteSvgHtml(icon: string, className = 'h-4 w-4'): string {
  return `<svg class="${escHtml(className)}" aria-hidden="true"><use href="#i-${escHtml(icon)}"></use></svg>`;
}

/** HTML for the WMO condition's icon (place card rows): the sprite of
 *  its trailing emoji, or a middle dot when it has none we know. */
export function conditionIconHtml(
  condition: string,
  className = 'mx-auto h-4 w-4'
): string {
  const parts = condition.trim().split(/\s+/);
  const icon = spriteForGlyph(parts[parts.length - 1] ?? '');
  return icon ? spriteSvgHtml(icon, className) : '·';
}

/** Inline HTML of value lines for a string-built panel (place card):
 *  icon + text per line, lines separated by a middle dot. */
export function glyphLinesHtml(text: string, labels: GlyphLabels = {}): string {
  return parseGlyphLines(text)
    .filter((l) => l.text || l.icon)
    .map((l) => {
      const name = l.icon ? labels[l.icon] : undefined;
      return (
        `<span class="inline-flex items-center gap-1">` +
        (l.icon ? spriteSvgHtml(l.icon, 'h-3.5 w-3.5 shrink-0') : '') +
        (name ? `<span class="sr-only">${escHtml(name)}</span>` : '') +
        `<span>${escHtml(l.text)}</span></span>`
      );
    })
    .join('<span aria-hidden="true"> · </span>');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Replace `el`'s content with one row per value line: the sprite icon
 *  (aria-hidden), an optional screen-reader name, the text. For the
 *  floating hover tooltip and the crosshair readout. */
export function renderGlyphLines(
  el: HTMLElement,
  text: string,
  labels: GlyphLabels = {}
): void {
  const doc = el.ownerDocument;
  el.textContent = '';
  for (const line of parseGlyphLines(text)) {
    if (!line.text && !line.icon) continue;
    const row = doc.createElement('span');
    row.className = 'flex items-center justify-center gap-1';
    if (line.icon) {
      const svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'h-3.5 w-3.5 shrink-0');
      svg.setAttribute('aria-hidden', 'true');
      const use = doc.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', `#i-${line.icon}`);
      svg.appendChild(use);
      row.appendChild(svg);
      const name = labels[line.icon];
      if (name) {
        const sr = doc.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = `${name} `;
        row.appendChild(sr);
      }
    }
    const txt = doc.createElement('span');
    txt.textContent = line.text;
    row.appendChild(txt);
    el.appendChild(row);
  }
}
