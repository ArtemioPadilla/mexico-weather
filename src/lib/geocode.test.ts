import { describe, it, expect, vi } from 'vitest';
import { buildGeocodeUrl, geocode } from './geocode';
import { normalizeMx, resolveMxAlias } from '../data/mx-places';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** Fetch mock that answers per requested ?name= with a fixture map. */
function routedFetch(map: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const name = new URL(url).searchParams.get('name') ?? '';
    return jsonResponse(map[name] ?? {});
  });
}

const deps = (fetchMock: unknown) => ({
  fetch: fetchMock as unknown as typeof fetch,
  sleep: async () => {},
});

describe('buildGeocodeUrl', () => {
  it('builds the Open-Meteo geocoding URL and over-fetches results', () => {
    const url = buildGeocodeUrl('Ciudad de México');
    expect(url).toContain('https://geocoding-api.open-meteo.com/v1/search');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('name')).toBe('Ciudad de México');
    // Over-fetch so population ranking/dedupe has material to work with.
    expect(Number(parsed.searchParams.get('count'))).toBeGreaterThanOrEqual(15);
    expect(parsed.searchParams.get('language')).toBe('es');
    expect(parsed.searchParams.get('format')).toBe('json');
  });

  it('encodes special characters and honors a custom language', () => {
    const url = buildGeocodeUrl('Querétaro & Co', 'en');
    expect(url).toContain('name=Quer%C3%A9taro+%26+Co');
    expect(url).toContain('language=en');
  });
});

describe('normalizeMx', () => {
  it('lowercases, strips accents, collapses whitespace, trims', () => {
    expect(normalizeMx('  Querétaro ')).toBe('queretaro');
    expect(normalizeMx('SAN  LUIS   POTOSÍ')).toBe('san luis potosi');
    expect(normalizeMx('Mérida')).toBe('merida');
  });
});

describe('resolveMxAlias', () => {
  it('resolves accent/case/space variants to the canonical term', () => {
    expect(resolveMxAlias('queretaro')).toBe('Santiago de Querétaro');
    expect(resolveMxAlias('Querétaro')).toBe('Santiago de Querétaro');
    expect(resolveMxAlias('  QUERETARO ')).toBe('Santiago de Querétaro');
    expect(resolveMxAlias('cdmx')).toBe('Ciudad de México');
    expect(resolveMxAlias('df')).toBe('Ciudad de México');
  });

  it('maps state names to the capital canonical term', () => {
    expect(resolveMxAlias('Jalisco')).toBe('Guadalajara');
    expect(resolveMxAlias('sonora')).toBe('Hermosillo');
    expect(resolveMxAlias('yucatán')).toBe('Mérida');
  });

  it('returns null for unknown / blank input', () => {
    expect(resolveMxAlias('Springfield')).toBeNull();
    expect(resolveMxAlias('   ')).toBeNull();
  });
});

describe('geocode', () => {
  it('maps API results into GeoResult[] incl. population/featureCode', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            name: 'Monterrey',
            admin1: 'Nuevo León',
            country: 'México',
            latitude: 25.67,
            longitude: -100.31,
            timezone: 'America/Monterrey',
            population: 1135512,
            feature_code: 'PPLA',
          },
        ],
      }),
    );

    const out = await geocode('Monterrey', deps(fetchMock));

    expect(out).toEqual([
      {
        name: 'Monterrey',
        admin1: 'Nuevo León',
        country: 'México',
        lat: 25.67,
        lng: -100.31,
        tz: 'America/Monterrey',
        population: 1135512,
        featureCode: 'PPLA',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits population/featureCode when the API does not provide them', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            name: 'Monterrey',
            admin1: 'Nuevo León',
            country: 'México',
            latitude: 25.67,
            longitude: -100.31,
            timezone: 'America/Monterrey',
          },
        ],
      }),
    );

    const out = await geocode('Monterrey', deps(fetchMock));
    expect(out[0]).not.toHaveProperty('population');
    expect(out[0]).not.toHaveProperty('featureCode');
  });

  it('sorts by population descending with null populations last (stable)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        results: [
          { name: 'Aldea A', latitude: 1, longitude: 1, timezone: 'tz' },
          {
            name: 'Ciudad Chica',
            latitude: 2,
            longitude: 2,
            timezone: 'tz',
            population: 5000,
          },
          {
            name: 'Ciudad Grande',
            latitude: 3,
            longitude: 3,
            timezone: 'tz',
            population: 900000,
          },
          { name: 'Aldea B', latitude: 4, longitude: 4, timezone: 'tz' },
        ],
      }),
    );

    const out = await geocode('Algo', deps(fetchMock));
    expect(out.map((r) => r.name)).toEqual([
      'Ciudad Grande',
      'Ciudad Chica',
      'Aldea A', // null pop, original order preserved (stable)
      'Aldea B',
    ]);
  });

  it('de-duplicates same name/admin and near-coordinate entries', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            name: 'Oaxaca',
            admin1: 'Estado de Oaxaca',
            country: 'México',
            latitude: 17.06,
            longitude: -96.72,
            timezone: 'tz',
            population: 255029,
          },
          // Same name/admin/country, lower pop — dropped.
          {
            name: 'Oaxaca',
            admin1: 'Estado de Oaxaca',
            country: 'México',
            latitude: 17.5,
            longitude: -96.9,
            timezone: 'tz',
            population: 100,
          },
          // Different name but within 0.05° of the kept Oaxaca — dropped.
          {
            name: 'Oaxaca Centro',
            admin1: 'Estado de Oaxaca',
            country: 'México',
            latitude: 17.07,
            longitude: -96.73,
            timezone: 'tz',
            population: 50,
          },
          // Genuinely distinct place — kept.
          {
            name: 'Monterrey',
            admin1: 'Nuevo León',
            country: 'México',
            latitude: 25.67,
            longitude: -100.31,
            timezone: 'tz',
            population: 1135512,
          },
        ],
      }),
    );

    const out = await geocode('Oaxaca', deps(fetchMock));
    expect(out.map((r) => r.name)).toEqual(['Monterrey', 'Oaxaca']);
  });

  it('resolves a MX alias and ranks the populous city first (merged)', async () => {
    const fetchMock = routedFetch({
      // Canonical alias term -> the real city.
      'Santiago de Querétaro': {
        results: [
          {
            name: 'Santiago de Querétaro',
            admin1: 'Estado de Querétaro de Arteaga',
            country: 'México',
            latitude: 20.5888,
            longitude: -100.3899,
            timezone: 'America/Mexico_City',
            population: 1594212,
            feature_code: 'PPLA',
          },
        ],
      },
      // Raw query -> only tiny hamlets.
      queretaro: {
        results: [
          {
            name: 'Querétaro',
            admin1: 'Estado de Chiapas',
            country: 'México',
            latitude: 16.2,
            longitude: -92.1,
            timezone: 'America/Mexico_City',
            population: 2203,
            feature_code: 'PPL',
          },
        ],
      },
    });

    const out = await geocode('queretaro', deps(fetchMock));
    // Both terms were queried (merged).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out[0].name).toBe('Santiago de Querétaro');
    expect(out[0].population).toBe(1594212);
    // The hamlet still appears but ranked below the real city.
    expect(out.some((r) => r.population === 2203)).toBe(true);
  });

  it('returns [] when the results array is omitted', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const out = await geocode('Nowhere', deps(fetchMock));
    expect(out).toEqual([]);
  });

  it('returns [] for a blank query without calling fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    const out = await geocode('   ', deps(fetchMock));
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
