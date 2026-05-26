/**
 * Static reverse-geocoder: maps (lat, lng) → MX state slug.
 *
 * Loads public/data/mx-states.geojson once on first call (lazy + once-
 * cached) and runs ray-casting point-in-polygon against the 32 state
 * features. Returns null for coords outside MX, so callers can hide
 * MX-only UI gracefully.
 *
 * No external dependencies. The polygon file is ~62 KB raw and ~20 KB
 * gzipped on the wire. After the first call, every subsequent lookup
 * is a synchronous walk over the in-memory features.
 */
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
} from 'geojson';

interface StateProps {
  slug: string;
  name?: string;
}

type StateFeature = Feature<Polygon | MultiPolygon, StateProps>;

let cached: StateFeature[] | null = null;
let inflight: Promise<StateFeature[] | null> | null = null;

/** Test-only: clear the cache so tests can stub a fresh fetch. */
export function resetStateByCoordsCache(): void {
  cached = null;
  inflight = null;
}

async function loadFeatures(
  base: string,
  fetchImpl: typeof fetch,
): Promise<StateFeature[] | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetchImpl(`${base}data/mx-states.geojson`);
      if (!r.ok) return null;
      const doc = (await r.json()) as FeatureCollection<
        Polygon | MultiPolygon,
        StateProps
      >;
      const fs = (doc.features ?? []).filter(
        (f): f is StateFeature =>
          !!f?.properties?.slug && !!f?.geometry,
      );
      cached = fs;
      return fs;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Ray-casting point-in-polygon. `ring` is a [lng, lat] coordinate
 *  array; the polygon is closed (last point === first). */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0]!;
    const yi = a[1]!;
    const xj = b[0]!;
    const yj = b[1]!;
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(
  lng: number,
  lat: number,
  geom: Polygon | MultiPolygon,
): boolean {
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates;
    if (!rings.length || !pointInRing(lng, lat, rings[0]!)) return false;
    // Inside outer ring; check we're not inside a hole.
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lng, lat, rings[i]!)) return false;
    }
    return true;
  }
  // MultiPolygon: union of polygons.
  for (const poly of geom.coordinates) {
    if (!poly.length) continue;
    if (!pointInRing(lng, lat, poly[0]!)) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) {
      if (pointInRing(lng, lat, poly[i]!)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Resolve `(lat, lng)` to a MX state slug, or null if outside MX (or
 *  the polygon file can't be loaded). */
export async function resolveStateByCoords(
  lat: number,
  lng: number,
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const features = await loadFeatures(base, fetchImpl);
  if (!features) return null;
  for (const f of features) {
    if (pointInGeometry(lng, lat, f.geometry)) return f.properties.slug;
  }
  return null;
}
