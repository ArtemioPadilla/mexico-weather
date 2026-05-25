import { describe, expect, it } from 'vitest';
import { fetchCitySnapshotByCoords, findSlugByCoords } from './city-snapshot';

describe('findSlugByCoords', () => {
  it('returns slug for exact CDMX coords', () => {
    expect(findSlugByCoords(19.43, -99.13)).toBe('cdmx');
  });

  it('matches within ~5 km tolerance', () => {
    // 0.04° drift is ~4 km, inside the 0.05° tolerance.
    expect(findSlugByCoords(19.47, -99.17)).toBe('cdmx');
  });

  it('returns null for coords outside the tolerance', () => {
    // 1° drift = ~110 km — clearly outside any tolerance.
    expect(findSlugByCoords(20.5, -100.5)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(findSlugByCoords(NaN, -99.13)).toBeNull();
    expect(findSlugByCoords(19.43, Infinity)).toBeNull();
  });
});

describe('fetchCitySnapshotByCoords', () => {
  it('returns null when no slug matches', async () => {
    // 1° drift = ~110 km outside any TOP_CITIES entry.
    const fakeFetch = (): Promise<Response> => {
      throw new Error('should not be called');
    };
    const result = await fetchCitySnapshotByCoords(
      0,
      0,
      '/base/',
      fakeFetch as unknown as typeof fetch,
    );
    expect(result).toBeNull();
  });

  it('returns the parsed snapshot on success', async () => {
    const doc = {
      slug: 'cdmx',
      current: { temperature: 22, condition: 'Despejado' },
      today: { date: '2026-05-24', condition: 'Despejado', hi: 25, lo: 12, rain: 10 },
      next: [],
    };
    const fakeFetch = async (url: string): Promise<Response> => {
      expect(url).toBe('/base/data/city-forecast/cdmx.json');
      return new Response(JSON.stringify(doc), { status: 200 });
    };
    const result = await fetchCitySnapshotByCoords(
      19.43,
      -99.13,
      '/base/',
      fakeFetch as typeof fetch,
    );
    expect(result?.slug).toBe('cdmx');
    expect(result?.today?.hi).toBe(25);
  });

  it('returns null on 404', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response('', { status: 404 });
    const result = await fetchCitySnapshotByCoords(
      19.43,
      -99.13,
      '/base/',
      fakeFetch as typeof fetch,
    );
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    const fakeFetch = async (): Promise<Response> => {
      throw new Error('offline');
    };
    const result = await fetchCitySnapshotByCoords(
      19.43,
      -99.13,
      '/base/',
      fakeFetch as typeof fetch,
    );
    expect(result).toBeNull();
  });
});
