/**
 * Geographic coordinate and direction formatting helpers.
 *
 * These are pure functions used by the cursor coordinate badge, value pills
 * on city markers, and any future overlay that needs to render geographic
 * positions in a human-readable form.
 */

/** Cardinal compass abbreviations used for wind direction. */
const CARDINALS_16 = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSO', 'SO', 'OSO',
  'O', 'ONO', 'NO', 'NNO',
] as const;

/** Cardinal letter only — used for short formats. */
const CARDINALS_4 = ['N', 'E', 'S', 'O'] as const;

/**
 * Format a latitude or longitude in degrees-minutes (DM) with a cardinal
 * letter, the way zoom.earth shows the cursor coordinate.
 *
 * @example
 *   formatLatDM(19.43)   → "19°25′N"
 *   formatLatDM(-19.43)  → "19°25′S"
 *   formatLngDM(-99.13)  → "99°07′O"
 *   formatLngDM(99.13)   → "99°07′E"
 */
export function formatLatDM(latDeg: number): string {
  return formatDM(latDeg, latDeg >= 0 ? 'N' : 'S');
}

export function formatLngDM(lngDeg: number): string {
  return formatDM(lngDeg, lngDeg >= 0 ? 'E' : 'O');
}

function formatDM(deg: number, cardinal: string): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  return `${d}°${pad2(m)}′${cardinal}`;
}

/**
 * Format a (lat, lng) pair as zoom.earth does: "19°25′N 99°07′O".
 */
export function formatLatLngDM(lat: number, lng: number): string {
  return `${formatLatDM(lat)} ${formatLngDM(lng)}`;
}

/**
 * Convert a meteorological bearing in degrees (0 = North, 90 = East,
 * clockwise) to a 16-point cardinal abbreviation in Spanish.
 *
 * @example
 *   bearingToCardinal16(0)    → "N"
 *   bearingToCardinal16(90)   → "E"
 *   bearingToCardinal16(180)  → "S"
 *   bearingToCardinal16(270)  → "O"
 *   bearingToCardinal16(45)   → "NE"
 */
export function bearingToCardinal16(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  const idx = Math.round(normalized / 22.5) % 16;
  return CARDINALS_16[idx];
}

/**
 * Convert a bearing in degrees to a 4-point cardinal abbreviation (N/E/S/O).
 * Used for compact value pills where 16-point is too verbose.
 */
export function bearingToCardinal4(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  const idx = Math.round(normalized / 90) % 4;
  return CARDINALS_4[idx];
}

/**
 * Format a bearing as a Unicode arrow pointing in that direction.
 *
 * Useful for compact wind-direction pills: "12 km/h ↑" (wind from the south
 * blowing northward → arrow points up).
 *
 * The arrow points in the direction the wind is BLOWING TOWARD, which is
 * 180° from the meteorological convention.
 */
export function bearingToArrow(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'][idx];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
