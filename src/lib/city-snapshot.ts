/**
 * Client for the per-city static forecast snapshots produced by
 * scripts/build-city-forecasts.py and served from
 * /data/city-forecast/<slug>.json.
 *
 * Both the /clima/<slug>/ landing page and the homepage city cards
 * consume the same snapshot — the homepage uses `today` for the
 * tmax/tmin/rain summary, the landing uses `next` for the
 * 3-day preview, both use `current`.
 */
import { TOP_CITIES } from './top-cities';

/** Raw snapshot shape — must stay in sync with the JSON emitted by
 *  scripts/build-city-forecasts.py normalize(). */
export interface CitySnapshot {
  slug: string;
  updated?: string;
  current?: {
    temperature?: number | null;
    feelsLike?: number | null;
    condition?: string | null;
    windKmh?: number | null;
    humidity?: number | null;
  };
  today?: {
    date?: string;
    condition?: string;
    hi?: number | null;
    lo?: number | null;
    rain?: number | null;
  } | null;
  next?: Array<{
    date?: string;
    condition?: string;
    hi?: number | null;
    lo?: number | null;
    rain?: number | null;
  }>;
}

const TOL = 0.05; // ~5 km — matches index.astro findSlugByCoords()

/** Look up a TOP_CITIES slug whose coordinates match (lat, lng) within
 *  ~5 km, or null if no match. */
export function findSlugByCoords(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const c of TOP_CITIES) {
    if (Math.abs(c.lat - lat) <= TOL && Math.abs(c.lng - lng) <= TOL) {
      return c.slug;
    }
  }
  return null;
}

/** Try to fetch the static snapshot for the city whose coordinates
 *  match (lat, lng). Returns null when no slug matches, the file is
 *  missing, or the response can't be parsed. The caller should fall
 *  through to a live API call in that case. */
export async function fetchCitySnapshotByCoords(
  lat: number,
  lng: number,
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CitySnapshot | null> {
  const slug = findSlugByCoords(lat, lng);
  if (!slug) return null;
  try {
    const r = await fetchImpl(`${base}data/city-forecast/${slug}.json`);
    if (!r.ok) return null;
    return (await r.json()) as CitySnapshot;
  } catch {
    return null;
  }
}
