import { describe, expect, it } from 'vitest';
import {
  LAYER_PAGES,
  layerPageBySlug,
  layerPageFor,
  layerPagesCoverRegistry,
} from './layer-pages';

describe('layer pages (Story 19.1)', () => {
  it('covers every weather layer in the registry with a unique slug', () => {
    expect(layerPagesCoverRegistry()).toBe(true);
    const slugs = LAYER_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z]+$/);
  });

  it('resolves by id and by slug, with bilingual copy', () => {
    expect(layerPageFor('radar')?.slug).toBe('radar');
    expect(layerPageBySlug('satelite')?.id).toBe('satellite');
    expect(layerPageBySlug('nope')).toBeUndefined();
    for (const p of LAYER_PAGES) {
      expect(p.titleEs.length).toBeGreaterThan(5);
      expect(p.descEn.length).toBeGreaterThan(40);
    }
  });
});
