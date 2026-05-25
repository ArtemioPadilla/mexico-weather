import { describe, expect, it } from 'vitest';
import { TOP_CITIES, findCityBySlug } from './top-cities';

describe('TOP_CITIES', () => {
  it('has at least 25 entries (covers all federal entities)', () => {
    expect(TOP_CITIES.length).toBeGreaterThanOrEqual(25);
  });

  it('every slug is unique', () => {
    const slugs = TOP_CITIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every slug is URL-safe (lowercase ASCII, hyphens only)', () => {
    for (const c of TOP_CITIES) {
      expect(c.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every entry has valid MX-ish lat/lng', () => {
    // Loose bounds — covers all of MX + a margin for Ciudad Juárez at
    // 31.7N (just inside) and Tijuana at 32.5N (also inside).
    for (const c of TOP_CITIES) {
      expect(c.lat).toBeGreaterThan(14);
      expect(c.lat).toBeLessThan(33);
      expect(c.lng).toBeGreaterThan(-118);
      expect(c.lng).toBeLessThan(-86);
    }
  });

  it('every entry has a non-empty name + admin + tz', () => {
    for (const c of TOP_CITIES) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.admin.length).toBeGreaterThan(0);
      expect(c.tz).toMatch(/^America\//);
    }
  });

  it('findCityBySlug returns the matching city', () => {
    const cdmx = findCityBySlug('cdmx');
    expect(cdmx?.name).toBe('Ciudad de México');
  });

  it('findCityBySlug returns undefined for unknown slugs', () => {
    expect(findCityBySlug('not-a-real-city')).toBeUndefined();
  });
});
