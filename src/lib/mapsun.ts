// Pure, DOM-free solar position + day/night terminator polygon for the /mapa
// sunlight overlay. Uses standard astronomy approximations — accurate to
// well under a degree, which is more than enough for a visual terminator.
// No external data; no network; deterministic for a given Unix-ms timestamp.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Days since J2000.0 (TT close enough to UT for visual accuracy). */
function jdSinceJ2000(ms: number): number {
  return ms / 86400000 - 10957.5;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Subsolar point at the given UTC timestamp (ms since epoch).
 * Returns lat in [-23.45, 23.45]° and lng in [-180, 180]°.
 */
export function solarPosition(dateUtcMs: number): LatLng {
  const d = jdSinceJ2000(dateUtcMs);
  const L = (280.46 + 0.9856474 * d) % 360;
  const g = ((357.528 + 0.9856003 * d) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * d) * DEG;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  const ra =
    (Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD + 360) % 360;
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  const gmstMod = ((gmst % 360) + 360) % 360;
  let lng = ra - gmstMod;
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  return { lat: dec, lng };
}

/**
 * Closed GeoJSON Polygon enclosing the night-side hemisphere at the given UTC
 * timestamp. Samples the terminator (great circle 90° from the subsolar point)
 * `samples` times around its azimuth circle, then closes through the
 * antisolar pole so the polygon truly covers night-side cells when rendered.
 */
export function terminatorPolygon(
  dateUtcMs: number,
  samples: number = 180,
): { type: 'Polygon'; coordinates: number[][][] } {
  const n = Math.max(8, Math.floor(samples));
  const sun = solarPosition(dateUtcMs);
  const sunLatR = sun.lat * DEG;
  const sunLngR = sun.lng * DEG;
  const nightPoleLat = -sun.lat;
  const nightPoleLng = sun.lng > 0 ? sun.lng - 180 : sun.lng + 180;
  const ring: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const lat = Math.asin(
      Math.sin(sunLatR) * 0 + Math.cos(sunLatR) * 1 * Math.cos(a),
    );
    const lng =
      sunLngR +
      Math.atan2(Math.sin(a) * 1 * Math.cos(sunLatR), 0 - Math.sin(sunLatR) * Math.sin(lat));
    ring.push([normalizeLng(lng * RAD), lat * RAD]);
  }
  ring.push([normalizeLng(nightPoleLng), nightPoleLat > 0 ? 90 : -90]);
  ring.push([normalizeLng(nightPoleLng + 180), nightPoleLat > 0 ? 90 : -90]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function normalizeLng(lng: number): number {
  let x = lng;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}
