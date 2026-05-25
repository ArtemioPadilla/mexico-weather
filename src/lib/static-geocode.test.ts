import { afterEach, describe, expect, it } from 'vitest';
import {
  resetStaticGeocodeCache,
  tryStaticGeocode,
} from './static-geocode';

afterEach(() => {
  resetStaticGeocodeCache();
});

const SAMPLE_DOC = {
  cities: [
    { key: 'guadalajara', name: 'Guadalajara', admin1: 'Jalisco', lat: 20.66, lng: -103.35, population: 1_500_000, tz: 'America/Mexico_City' },
    { key: 'monterrey', name: 'Monterrey', admin1: 'Nuevo León', lat: 25.67, lng: -100.31, population: 1_140_000, tz: 'America/Monterrey' },
    { key: 'guadalupe', name: 'Guadalupe', admin1: 'Nuevo León', lat: 25.68, lng: -100.26, population: 650_000, tz: 'America/Monterrey' },
  ],
};

function mockFetchOk(): typeof fetch {
  return (async () => new Response(JSON.stringify(SAMPLE_DOC), { status: 200 })) as typeof fetch;
}

describe('tryStaticGeocode', () => {
  it('returns hits for a known city name', async () => {
    const out = await tryStaticGeocode('Guadalajara', '/base/', mockFetchOk());
    expect(out).not.toBeNull();
    expect(out?.[0]?.name).toBe('Guadalajara');
    expect(out?.[0]?.lat).toBe(20.66);
    expect(out?.[0]?.tz).toBe('America/Mexico_City');
  });

  it('is diacritic-insensitive', async () => {
    const out = await tryStaticGeocode('monterrey', '/base/', mockFetchOk());
    expect(out?.[0]?.name).toBe('Monterrey');
  });

  it('ranks more populous matches first on prefix collisions', async () => {
    // "guad" prefix-matches both Guadalajara and Guadalupe; the larger
    // city must come back first so the homepage CTA lands on the right
    // place.
    const out = await tryStaticGeocode('guad', '/base/', mockFetchOk());
    expect(out?.[0]?.name).toBe('Guadalajara');
    expect(out?.[1]?.name).toBe('Guadalupe');
  });

  it('returns empty array for whitespace-only queries', async () => {
    const out = await tryStaticGeocode('   ', '/base/', mockFetchOk());
    expect(out).toEqual([]);
  });

  it('returns empty array when no city matches (lets caller fall through)', async () => {
    const out = await tryStaticGeocode('NopeVille', '/base/', mockFetchOk());
    expect(out).toEqual([]);
  });

  it('returns null when the dict cannot be loaded', async () => {
    const fetchFail = (async () => new Response('', { status: 404 })) as typeof fetch;
    const out = await tryStaticGeocode('Guadalajara', '/base/', fetchFail);
    expect(out).toBeNull();
  });

  it('returns null on network failure', async () => {
    const fetchThrow = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const out = await tryStaticGeocode('Guadalajara', '/base/', fetchThrow);
    expect(out).toBeNull();
  });

  it('caches the dict — second call does not re-fetch', async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(SAMPLE_DOC), { status: 200 });
    }) as typeof fetch;
    await tryStaticGeocode('Guadalajara', '/base/', counting);
    await tryStaticGeocode('Monterrey', '/base/', counting);
    expect(calls).toBe(1);
  });
});
