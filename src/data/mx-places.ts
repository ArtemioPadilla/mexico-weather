// Curated Mexico place-name alias map for location search.
//
// WHY THIS EXISTS
// ---------------
// The Open-Meteo geocoding API prefix-matches on the place NAME only. For
// several Mexican state capitals the API's canonical `name` differs from the
// colloquial term a user types, so the populous city never appears (or only
// tiny same-named hamlets do). The clearest example: typing "queretaro"
// returns ONLY hamlets literally named "Querétaro" (pop ≤ 2203). The real
// city is stored as "Santiago de Querétaro" (pop 1,594,212) and is NEVER
// returned for "queretaro". Mexican STATE names are not geocoding entities at
// all (e.g. "Jalisco", "Sonora" return only obscure hamlets), so a user
// typing a state should be routed to that state's capital.
//
// Each canonical term below was verified against the live API
// (https://geocoding-api.open-meteo.com/v1/search) to actually surface the
// populous capital city. Entries are only included where the colloquial input
// genuinely fails or is ambiguous; capitals that already resolve fine via the
// raw query + population sort (e.g. Monterrey, Guadalajara, Mérida) are
// intentionally omitted from the capital section but ARE reachable via their
// state-name aliases.

/**
 * Normalize a free-text Mexican place query to a lookup key:
 * lowercase, NFD accent-strip, collapse internal whitespace, trim.
 */
export function normalizeMx(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// (a) Capital aliases: colloquial / common name -> canonical Open-Meteo
//     search term. Keys are already normalized (see normalizeMx).
//     Verified: each value returns the populous capital as the top
//     population-ranked result.
const CAPITAL_ALIASES: Record<string, string> = {
  // Querétaro: raw "queretaro" returns ONLY tiny hamlets; the city is
  // "Santiago de Querétaro" (pop ~1.59M).
  queretaro: 'Santiago de Querétaro',
  'santiago de queretaro': 'Santiago de Querétaro',
  // Chiapas capital: API name is "Tuxtla Gtz"; "Tuxtla Gutiérrez" returns
  // nothing. Querying "Tuxtla" surfaces it (pop ~604k).
  'tuxtla gutierrez': 'Tuxtla',
  tuxtla: 'Tuxtla',
  // Durango capital: raw "Durango" returns Colorado / Spain first and the
  // MX capital never appears; the city is "Victoria de Durango" (pop ~519k).
  durango: 'Victoria de Durango',
  'victoria de durango': 'Victoria de Durango',
  // Tamaulipas capital: API name is "Cd. Victoria"; querying the full
  // "Ciudad Victoria" reliably returns it (pop ~332k).
  'ciudad victoria': 'Ciudad Victoria',
  // Guerrero capital: API name "Chilpancingo de los Bravo".
  chilpancingo: 'Chilpancingo de los Bravo',
  // México state capital: API name "Toluca de Lerdo".
  toluca: 'Toluca de Lerdo',
  // Puebla capital: API name "Puebla de Zaragoza".
  puebla: 'Puebla de Zaragoza',
  // Tlaxcala capital: bare "Tlaxcala" works, but the official long name is
  // commonly typed too.
  'tlaxcala de xicohtentcatl': 'Tlaxcala',
  'tlaxcala de xicohtencatl': 'Tlaxcala',
  // Oaxaca capital: API name is just "Oaxaca" (pop ~255k). NOTE: querying
  // "Oaxaca de Juárez" returns NOTHING, so the colloquial long name must be
  // mapped back to the bare "Oaxaca".
  'oaxaca de juarez': 'Oaxaca',
  // Mexico City: many colloquial forms.
  cdmx: 'Ciudad de México',
  df: 'Ciudad de México',
  'd f': 'Ciudad de México',
  'distrito federal': 'Ciudad de México',
  mexico: 'Ciudad de México',
  'mexico df': 'Ciudad de México',
  'ciudad de mexico': 'Ciudad de México',
  'mexico city': 'Ciudad de México',
};

// (b) State-name -> that state's capital canonical search term.
//     Mexican state names are NOT geocoding entities, so typing a state must
//     resolve to the capital city. 31 states + CDMX.
const STATE_TO_CAPITAL: Record<string, string> = {
  aguascalientes: 'Aguascalientes',
  'baja california': 'Mexicali',
  'baja california sur': 'La Paz',
  campeche: 'Campeche',
  chiapas: 'Tuxtla',
  chihuahua: 'Chihuahua',
  coahuila: 'Saltillo',
  'coahuila de zaragoza': 'Saltillo',
  colima: 'Colima',
  'ciudad de mexico': 'Ciudad de México',
  durango: 'Victoria de Durango',
  guanajuato: 'Guanajuato',
  guerrero: 'Chilpancingo de los Bravo',
  hidalgo: 'Pachuca',
  jalisco: 'Guadalajara',
  mexico: 'Toluca de Lerdo',
  'estado de mexico': 'Toluca de Lerdo',
  michoacan: 'Morelia',
  'michoacan de ocampo': 'Morelia',
  morelos: 'Cuernavaca',
  nayarit: 'Tepic',
  'nuevo leon': 'Monterrey',
  oaxaca: 'Oaxaca',
  puebla: 'Puebla de Zaragoza',
  queretaro: 'Santiago de Querétaro',
  'queretaro de arteaga': 'Santiago de Querétaro',
  'quintana roo': 'Chetumal',
  'san luis potosi': 'San Luis Potosí',
  sinaloa: 'Culiacán',
  sonora: 'Hermosillo',
  tabasco: 'Villahermosa',
  tamaulipas: 'Ciudad Victoria',
  tlaxcala: 'Tlaxcala',
  veracruz: 'Xalapa',
  'veracruz de ignacio de la llave': 'Xalapa',
  yucatan: 'Mérida',
  zacatecas: 'Zacatecas',
};

// Merged lookup. Capital aliases take precedence over state names when a key
// collides (e.g. "durango"/"queretaro" mean the capital city to most users;
// the value is identical in those cases anyway). `mexico` is intentionally
// overridden to Ciudad de México (the dominant colloquial intent) by the
// capital section, which is defined last in this spread.
const MX_PLACE_ALIASES: Record<string, string> = {
  ...STATE_TO_CAPITAL,
  ...CAPITAL_ALIASES,
};

/**
 * Resolve a free-text MX query to a canonical Open-Meteo search term.
 * Returns the canonical term if `query` (after normalization) matches a known
 * alias, otherwise `null` (caller should fall back to the raw query).
 */
export function resolveMxAlias(query: string): string | null {
  const key = normalizeMx(query);
  if (key === '') return null;
  return MX_PLACE_ALIASES[key] ?? null;
}

export { MX_PLACE_ALIASES };
