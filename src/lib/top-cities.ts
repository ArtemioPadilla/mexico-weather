/**
 * Curated list of MX metropolitan areas used for the per-city landing
 * pages under /clima/<slug>/. Each entry produces one statically
 * generated route at build time via getStaticPaths.
 *
 * Source: KNOWN_CITIES in ask-router.ts deduped, plus a handful of
 * additional capitals/large metros so we cover all 32 federal entities
 * once. Lat/lng rounded to 2 dp — the city pages link out to the
 * interactive /forecast/ which re-geocodes against the bbox; we don't
 * need precision beyond ~1 km for SEO landings.
 *
 * Timezone strings follow IANA names. Most of MX is on
 * America/Mexico_City; we only override the cities the IANA db lists
 * separately (Tijuana, Hermosillo, Mazatlán/Culiacán/La Paz on
 * Mountain, Chihuahua on Mountain, Cancún on Eastern).
 *
 * Keep this file under ~30 entries — beyond that the SEO benefit of
 * adding more slugs diminishes and the build output grows without
 * proportional value.
 */
export interface TopCity {
  /** URL slug — lowercase, ASCII, no spaces. */
  slug: string;
  /** Display name with diacritics. */
  name: string;
  /** Federal entity name (full, not abbreviated). */
  admin: string;
  lat: number;
  lng: number;
  /** IANA timezone string. */
  tz: string;
}

export const TOP_CITIES: readonly TopCity[] = [
  { slug: 'cdmx', name: 'Ciudad de México', admin: 'CDMX', lat: 19.43, lng: -99.13, tz: 'America/Mexico_City' },
  { slug: 'guadalajara', name: 'Guadalajara', admin: 'Jalisco', lat: 20.66, lng: -103.35, tz: 'America/Mexico_City' },
  { slug: 'monterrey', name: 'Monterrey', admin: 'Nuevo León', lat: 25.67, lng: -100.31, tz: 'America/Monterrey' },
  { slug: 'puebla', name: 'Puebla', admin: 'Puebla', lat: 19.04, lng: -98.2, tz: 'America/Mexico_City' },
  { slug: 'tijuana', name: 'Tijuana', admin: 'Baja California', lat: 32.51, lng: -117.04, tz: 'America/Tijuana' },
  { slug: 'leon', name: 'León', admin: 'Guanajuato', lat: 21.13, lng: -101.67, tz: 'America/Mexico_City' },
  { slug: 'toluca', name: 'Toluca', admin: 'Estado de México', lat: 19.29, lng: -99.65, tz: 'America/Mexico_City' },
  { slug: 'merida', name: 'Mérida', admin: 'Yucatán', lat: 20.97, lng: -89.61, tz: 'America/Merida' },
  { slug: 'queretaro', name: 'Querétaro', admin: 'Querétaro', lat: 20.59, lng: -100.39, tz: 'America/Mexico_City' },
  { slug: 'chihuahua', name: 'Chihuahua', admin: 'Chihuahua', lat: 28.63, lng: -106.07, tz: 'America/Chihuahua' },
  { slug: 'hermosillo', name: 'Hermosillo', admin: 'Sonora', lat: 29.07, lng: -110.95, tz: 'America/Hermosillo' },
  { slug: 'veracruz', name: 'Veracruz', admin: 'Veracruz', lat: 19.18, lng: -96.13, tz: 'America/Mexico_City' },
  { slug: 'cancun', name: 'Cancún', admin: 'Quintana Roo', lat: 21.16, lng: -86.85, tz: 'America/Cancun' },
  { slug: 'acapulco', name: 'Acapulco', admin: 'Guerrero', lat: 16.85, lng: -99.82, tz: 'America/Mexico_City' },
  { slug: 'oaxaca', name: 'Oaxaca', admin: 'Oaxaca', lat: 17.07, lng: -96.72, tz: 'America/Mexico_City' },
  { slug: 'morelia', name: 'Morelia', admin: 'Michoacán', lat: 19.7, lng: -101.18, tz: 'America/Mexico_City' },
  { slug: 'aguascalientes', name: 'Aguascalientes', admin: 'Aguascalientes', lat: 21.88, lng: -102.29, tz: 'America/Mexico_City' },
  { slug: 'saltillo', name: 'Saltillo', admin: 'Coahuila', lat: 25.42, lng: -101.0, tz: 'America/Monterrey' },
  { slug: 'durango', name: 'Durango', admin: 'Durango', lat: 24.02, lng: -104.66, tz: 'America/Monterrey' },
  { slug: 'zacatecas', name: 'Zacatecas', admin: 'Zacatecas', lat: 22.77, lng: -102.58, tz: 'America/Mexico_City' },
  { slug: 'culiacan', name: 'Culiacán', admin: 'Sinaloa', lat: 24.81, lng: -107.39, tz: 'America/Mazatlan' },
  { slug: 'mazatlan', name: 'Mazatlán', admin: 'Sinaloa', lat: 23.22, lng: -106.42, tz: 'America/Mazatlan' },
  { slug: 'tampico', name: 'Tampico', admin: 'Tamaulipas', lat: 22.25, lng: -97.86, tz: 'America/Monterrey' },
  { slug: 'villahermosa', name: 'Villahermosa', admin: 'Tabasco', lat: 17.99, lng: -92.95, tz: 'America/Mexico_City' },
  { slug: 'tuxtla-gutierrez', name: 'Tuxtla Gutiérrez', admin: 'Chiapas', lat: 16.75, lng: -93.12, tz: 'America/Mexico_City' },
  { slug: 'pachuca', name: 'Pachuca', admin: 'Hidalgo', lat: 20.12, lng: -98.74, tz: 'America/Mexico_City' },
  { slug: 'cuernavaca', name: 'Cuernavaca', admin: 'Morelos', lat: 18.92, lng: -99.23, tz: 'America/Mexico_City' },
  { slug: 'la-paz', name: 'La Paz', admin: 'Baja California Sur', lat: 24.14, lng: -110.31, tz: 'America/Mazatlan' },
  { slug: 'san-luis-potosi', name: 'San Luis Potosí', admin: 'San Luis Potosí', lat: 22.16, lng: -100.98, tz: 'America/Mexico_City' },
  { slug: 'ciudad-juarez', name: 'Ciudad Juárez', admin: 'Chihuahua', lat: 31.74, lng: -106.49, tz: 'America/Ojinaga' },
];

/** Lookup by slug. Returns undefined for unknown slugs. */
export function findCityBySlug(slug: string): TopCity | undefined {
  return TOP_CITIES.find((c) => c.slug === slug);
}
