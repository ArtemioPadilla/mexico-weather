/**
 * Sentinel: CARTO watermarks anonymous basemap tiles ("API KEY
 * REQUIRED" over an HTTP 200), so nothing in the shipped code or the
 * living docs may still point at it or credit it. Historical records
 * (docs/AUDIT_*.md) are deliberately excluded.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

// Code: forbid the hosts and the attribution string.
const CODE_FILES = [
  'src/lib/interactive-map.ts',
  'src/lib/map/chrome/basemap-theme.ts',
  'src/components/InteractiveMap.astro',
  'src/pages/forecast.astro',
  'src/layouts/BaseLayout.astro',
];
const CODE_FORBIDDEN = /cartocdn|carto\.com|©\s*CARTO/i;

// Docs: forbid the word itself (case-insensitive, whole word — so
// "cartográfico" is fine).
const DOC_FILES = [
  'README.md',
  'docs/USER_GUIDE.md',
  'docs/ARCHITECTURE.md',
  'docs/ROADMAP.md',
  'docs/USER_JOURNEYS.md',
  'docs/PLAN_UX_PARITY.md',
];
const DOC_FORBIDDEN = /\bcarto(db|cdn)?\b/i;

function offendingLines(file: string, re: RegExp): string[] {
  return readFileSync(resolve(ROOT, file), 'utf-8')
    .split('\n')
    .map((line, i) =>
      re.test(line) ? `${file}:${i + 1}: ${line.trim()}` : null
    )
    .filter((x): x is string => x !== null);
}

describe('no CARTO basemap references remain', () => {
  it.each(CODE_FILES)('%s has no CARTO host or attribution', (file) => {
    expect(offendingLines(file, CODE_FORBIDDEN)).toEqual([]);
  });

  it.each(DOC_FILES)('%s does not describe the basemap as CARTO', (file) => {
    expect(offendingLines(file, DOC_FORBIDDEN)).toEqual([]);
  });
});
