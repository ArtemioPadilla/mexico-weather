// DOM-free Open-Meteo geocoding (location search) SDK.
// Reuses the shared retrying JSON requester from weather.ts.
//
// Mexico-aware: the Open-Meteo geocoder prefix-matches the place NAME only,
// so colloquial inputs ("queretaro", state names, etc.) often miss the real
// populous city. We resolve such inputs through a curated alias map
// (src/data/mx-places.ts), then population-rank and de-duplicate results so
// the dominant city always surfaces first.

import {
  type RequestDeps,
  type RetryOptions,
  DEFAULT_RETRY,
  requestJsonWithRetry,
} from './weather';
import { resolveMxAlias, normalizeMx } from '../data/mx-places';

export interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  lat: number;
  lng: number;
  tz: string;
  /** Population from the geocoding API, when available (used for ranking). */
  population?: number;
  /** Open-Meteo feature_code, e.g. PPLC/PPLA/PPL (used for labels). */
  featureCode?: string;
}

interface ApiResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population?: number;
  feature_code?: string;
}

/** Number of raw results to request — over-fetch so ranking has material. */
const REQUEST_COUNT = 20;
/** How many ranked results to surface to the UI. */
const DISPLAY_COUNT = 8;
/** Two results within this lat/lng delta are treated as the same place. */
const NEAR_DEG = 0.05;

/** Build the Open-Meteo geocoding search URL. */
export function buildGeocodeUrl(query: string, lang = 'es'): string {
  const params = new URLSearchParams({
    name: query,
    count: String(REQUEST_COUNT),
    language: lang,
    format: 'json',
  });
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
}

function mapResult(r: ApiResult): GeoResult {
  const out: GeoResult = {
    name: r.name,
    admin1: r.admin1,
    country: r.country,
    lat: r.latitude,
    lng: r.longitude,
    tz: r.timezone,
  };
  if (typeof r.population === 'number') out.population = r.population;
  if (typeof r.feature_code === 'string') out.featureCode = r.feature_code;
  return out;
}

/**
 * Stable sort by population descending; entries without a population sort
 * after all entries that have one (their relative order is preserved).
 */
function byPopulationDesc(list: GeoResult[]): GeoResult[] {
  return list
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const pa = a.item.population;
      const pb = b.item.population;
      const aHas = typeof pa === 'number';
      const bHas = typeof pb === 'number';
      if (aHas && bHas && pa !== pb) return (pb as number) - (pa as number);
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.idx - b.idx; // stable
    })
    .map((w) => w.item);
}

/**
 * De-duplicate: drop an entry when an already-kept (higher-population, since
 * the input is population-sorted) entry has the same normalized
 * name/admin1/country, OR sits within ~0.05° lat/lng of it.
 */
function dedupe(sorted: GeoResult[]): GeoResult[] {
  const kept: GeoResult[] = [];
  const seen = new Set<string>();
  for (const r of sorted) {
    const key = [
      normalizeMx(r.name),
      normalizeMx(r.admin1 ?? ''),
      normalizeMx(r.country ?? ''),
    ].join('|');
    if (seen.has(key)) continue;
    const near = kept.some(
      (k) =>
        Math.abs(k.lat - r.lat) <= NEAR_DEG &&
        Math.abs(k.lng - r.lng) <= NEAR_DEG,
    );
    if (near) continue;
    seen.add(key);
    kept.push(r);
  }
  return kept;
}

async function fetchResults(
  term: string,
  deps: RequestDeps,
  lang: string,
  retry: RetryOptions,
): Promise<GeoResult[]> {
  const data = await requestJsonWithRetry<{ results?: ApiResult[] }>(
    buildGeocodeUrl(term, lang),
    deps,
    retry,
  );
  if (!Array.isArray(data.results)) return [];
  return data.results.map(mapResult);
}

/**
 * Search for locations matching `query`.
 *
 * - Blank query → `[]` with NO network call.
 * - No `results` in the response → `[]`.
 * - If the query matches a curated Mexico alias (e.g. "queretaro",
 *   "jalisco"), the canonical Open-Meteo term is queried as well and the
 *   results are merged, so the populous capital surfaces.
 * - Results are always population-ranked (desc, nulls last) and
 *   de-duplicated, then the top ~8 are returned.
 */
export async function geocode(
  query: string,
  deps: RequestDeps,
  lang = 'es',
  retry: RetryOptions = DEFAULT_RETRY,
): Promise<GeoResult[]> {
  const trimmed = query.trim();
  if (trimmed === '') return [];

  const alias = resolveMxAlias(trimmed);

  let merged: GeoResult[];
  if (alias && normalizeMx(alias) !== normalizeMx(trimmed)) {
    // Query the canonical alias term first (its hits should dominate by
    // population) and the raw query second, then merge.
    const [aliasHits, rawHits] = await Promise.all([
      fetchResults(alias, deps, lang, retry),
      fetchResults(trimmed, deps, lang, retry),
    ]);
    merged = [...aliasHits, ...rawHits];
  } else {
    merged = await fetchResults(trimmed, deps, lang, retry);
  }

  if (merged.length === 0) return [];

  return dedupe(byPopulationDesc(merged)).slice(0, DISPLAY_COUNT);
}
