/**
 * Static-first geocoding against the per-month-cached MX cities
 * dictionary (public/data/mx-cities.json, produced by
 * scripts/build-mx-cities.py). Lets the homepage + map search bar
 * resolve common city names with zero network round-trip after the
 * one-time JSON load.
 *
 * Falls through to the live Open-Meteo geocoder (in geocode.ts) only
 * when the static dict has no match — typical for niche localities,
 * misspellings, or anything outside the curated ~250-entry list.
 */
import type { GeoResult } from './geocode';

interface StaticCity {
  key?: string;
  name?: string;
  admin1?: string;
  admin1_short?: string;
  lat?: number;
  lng?: number;
  population?: number;
  tz?: string;
}

interface StaticCitiesDoc {
  cities?: StaticCity[];
}

const SPANISH_DIACRITICS_RE = /[̀-ͯ]/g;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(SPANISH_DIACRITICS_RE, '')
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let cachedDoc: StaticCitiesDoc | null = null;
let cachedPromise: Promise<StaticCitiesDoc | null> | null = null;

/** Load the cities JSON once and reuse on subsequent calls. Tests
 *  reset the cache via {@link resetStaticGeocodeCache}. */
async function loadDoc(
  base: string,
  fetchImpl: typeof fetch,
): Promise<StaticCitiesDoc | null> {
  if (cachedDoc) return cachedDoc;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const r = await fetchImpl(`${base}data/mx-cities.json`);
      if (!r.ok) return null;
      const doc = (await r.json()) as StaticCitiesDoc;
      cachedDoc = doc;
      return doc;
    } catch {
      return null;
    } finally {
      cachedPromise = null;
    }
  })();
  return cachedPromise;
}

/** Test-only: clear the module-level cache between cases. */
export function resetStaticGeocodeCache(): void {
  cachedDoc = null;
  cachedPromise = null;
}

function toGeoResult(c: StaticCity): GeoResult | null {
  if (
    typeof c.lat !== 'number' ||
    typeof c.lng !== 'number' ||
    typeof c.name !== 'string'
  ) {
    return null;
  }
  return {
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    admin1: typeof c.admin1 === 'string' ? c.admin1 : undefined,
    country: 'México',
    tz: typeof c.tz === 'string' ? c.tz : 'America/Mexico_City',
    population: typeof c.population === 'number' ? c.population : undefined,
  };
}

/**
 * Try to resolve `query` against the static dictionary. Returns
 *  - up to 8 matches, ranked by population (desc), when the dict has
 *    any hit (live call skipped)
 *  - an empty array when the dict has zero matches (caller falls
 *    through to the live API)
 *  - `null` when the dict couldn't be loaded at all (caller falls
 *    through to live too — same outcome, distinguishing for tests)
 */
export async function tryStaticGeocode(
  query: string,
  base: string,
  fetchImpl: typeof fetch,
): Promise<GeoResult[] | null> {
  const q = normalize(query);
  if (!q) return [];
  const doc = await loadDoc(base, fetchImpl);
  if (!doc || !Array.isArray(doc.cities)) return null;

  const matches: StaticCity[] = [];
  for (const c of doc.cities) {
    const nameN = c.name ? normalize(c.name) : '';
    const keyN = c.key ? normalize(c.key) : '';
    // Prefer prefix matches on key (the slug), fall back to substring
    // matches on the name. Population ranking happens below.
    if (keyN.startsWith(q) || nameN.startsWith(q) || nameN.includes(q)) {
      matches.push(c);
    }
  }
  matches.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));

  const out: GeoResult[] = [];
  for (const c of matches.slice(0, 8)) {
    const r = toGeoResult(c);
    if (r) out.push(r);
  }
  return out;
}
