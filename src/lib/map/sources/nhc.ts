/**
 * NHC (National Hurricane Center) data source.
 *
 * Fetches `CurrentStorms.json` from the NHC website. During hurricane
 * season (≈June–November) this returns an array of active Atlantic and
 * East Pacific systems with positions, classifications, and forecast
 * tracks. Outside the season `activeStorms` is empty.
 *
 * The plugin should render these as markers; this module only owns
 * fetching and shape normalization.
 */

import type { DataSource } from '../core/types';
import { cachedFetch } from '../utils/fetch';

const CURRENT_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
/** Static snapshot refreshed every 15 min by the
 *  quakes-storms-snapshot.yml GitHub Action. Tried before the live
 *  CURRENT_URL so the browser reads from our CDN unless the static
 *  cache is unavailable. */
const STATIC_SNAPSHOT_PATH = 'data/storms-snapshot.json';
const ATTRIBUTION = '© NOAA NHC';
/** NHC updates advisories every ~6 h; cache for 5 min so the page reuses
 *  across base-layer switches without refetching constantly. */
const TTL_MS = 5 * 60 * 1000;

/** Normalized current-storm shape stable across API revisions. */
export interface NhcStorm {
  /** Storm id, e.g. 'al012025'. */
  id: string;
  /** Display name, e.g. 'ARTHUR'. */
  name: string;
  /** Two-letter NHC classification: TD, TS, HU, EX, … */
  classification: string;
  /** Sustained wind speed, kt. */
  intensityKt: number | null;
  /** Central pressure, hPa. */
  pressureHpa: number | null;
  /** Latest center position. */
  lat: number;
  lng: number;
  /** ISO timestamp of the latest advisory. */
  advisoryTime: string | null;
}

interface RawStorm {
  id?: unknown;
  name?: unknown;
  classification?: unknown;
  intensity?: unknown;
  pressure?: unknown;
  lat?: unknown;
  lon?: unknown;
  lastUpdate?: unknown;
}

interface RawPayload {
  activeStorms?: unknown;
}

/** Static-snapshot shape emitted by scripts/build-storms-snapshot.py. */
interface StaticStormsDoc {
  updated?: string;
  storms?: Array<{
    name?: unknown;
    lat?: unknown;
    lng?: unknown;
    classification?: unknown;
    intensityKt?: unknown;
  }>;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function parseNhcResponse(raw: unknown): NhcStorm[] {
  const data = raw as RawPayload;
  const arr = Array.isArray(data?.activeStorms) ? data.activeStorms : [];
  const out: NhcStorm[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const s = item as RawStorm;
    const lat = num(s.lat);
    const lng = num(s.lon);
    if (lat === null || lng === null) continue;
    out.push({
      id: str(s.id, 'unknown'),
      name: str(s.name, 'Unnamed'),
      classification: str(s.classification, '??'),
      intensityKt: num(s.intensity),
      pressureHpa: num(s.pressure),
      lat,
      lng,
      advisoryTime: typeof s.lastUpdate === 'string' ? s.lastUpdate : null,
    });
  }
  return out;
}

/** Try the static snapshot first; resolve to null on any failure so
 *  the caller falls through to the live NHC endpoint. */
async function fetchStaticSnapshot(
  base: string | undefined,
  signal: AbortSignal | undefined,
): Promise<NhcStorm[] | null> {
  if (!base) return null;
  try {
    const res = await cachedFetch(`${base}${STATIC_SNAPSHOT_PATH}`, {
      signal,
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as StaticStormsDoc;
    if (!doc?.storms?.length) return null;
    const out: NhcStorm[] = [];
    for (const s of doc.storms) {
      const lat = num(s.lat);
      const lng = num(s.lng);
      if (lat === null || lng === null) continue;
      out.push({
        id: `static-${out.length}`,
        name: str(s.name, 'Unnamed'),
        classification: str(s.classification, 'TS'),
        intensityKt: num(s.intensityKt),
        pressureHpa: null,
        lat,
        lng,
        advisoryTime: typeof doc.updated === 'string' ? doc.updated : null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Factory: returns an nhcSource bound to a specific site base, so
 *  the static cache lookup uses the right URL. Falls through to the
 *  live endpoint when the cache is unavailable. */
export function createNhcSource(
  base?: string,
): DataSource<void, NhcStorm[]> {
  return {
    id: 'nhc-current',
    ttl: TTL_MS,
    attribution: ATTRIBUTION,
    async fetch(_params, signal) {
      const cached = await fetchStaticSnapshot(base, signal);
      if (cached) return cached;
      const res = await cachedFetch(CURRENT_URL, { signal });
      if (!res.ok) return [];
      const json = await res.json();
      return parseNhcResponse(json);
    },
  };
}

/** Default singleton — no base path; only the live endpoint is hit.
 *  Kept for backwards compatibility with any existing imports. */
export const nhcSource: DataSource<void, NhcStorm[]> = createNhcSource();
