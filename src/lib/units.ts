/**
 * Unit conversion + formatting (Story 19.3, plan PRO_GRATIS E19).
 *
 * Data stays metric everywhere (Open-Meteo's defaults: °C, km/h, hPa,
 * km); only the last formatting step converts, driven by the ⚙ settings
 * (src/lib/map/settings.ts → unitsOf()). Pure and DOM-free so the map
 * tooltip, legend, place card and /forecast share one implementation.
 */
import { formatDistance } from './map/utils/measure';

export type TempUnit = 'C' | 'F';
export type SpeedUnit = 'kmh' | 'mph' | 'kt' | 'ms';
export type PressureUnit = 'hPa' | 'inHg';
export type DistanceUnit = 'km' | 'mi';

export interface Units {
  temp: TempUnit;
  speed: SpeedUnit;
  pressure: PressureUnit;
  distance: DistanceUnit;
}

export const DEFAULT_UNITS: Units = {
  temp: 'C',
  speed: 'kmh',
  pressure: 'hPa',
  distance: 'km',
};

export const SPEED_LABEL: Record<SpeedUnit, string> = {
  kmh: 'km/h',
  mph: 'mph',
  kt: 'kt',
  ms: 'm/s',
};
export const PRESSURE_LABEL: Record<PressureUnit, string> = {
  hPa: 'hPa',
  inHg: 'inHg',
};
export const TEMP_LABEL: Record<TempUnit, string> = { C: '°C', F: '°F' };

export function convertTemp(c: number, unit: TempUnit): number {
  return unit === 'F' ? (c * 9) / 5 + 32 : c;
}

/** "24°" — the degree sign only; the scale's unit lives in the legend. */
export function formatTemp(c: number, unit: TempUnit): string {
  return `${Math.round(convertTemp(c, unit))}°`;
}

export function convertSpeed(kmh: number, unit: SpeedUnit): number {
  switch (unit) {
    case 'mph':
      return kmh / 1.609344;
    case 'kt':
      return kmh / 1.852;
    case 'ms':
      return kmh / 3.6;
    default:
      return kmh;
  }
}

/** "12 km/h", "7 mph", "6 kt", "3.3 m/s" (m/s keeps one decimal
 *  because the range is small). */
export function formatSpeed(kmh: number, unit: SpeedUnit): string {
  const v = convertSpeed(kmh, unit);
  const n =
    unit === 'ms'
      ? (Math.round(v * 10) / 10).toFixed(1)
      : String(Math.round(v));
  return `${n} ${SPEED_LABEL[unit]}`;
}

export function convertPressure(hPa: number, unit: PressureUnit): number {
  return unit === 'inHg' ? hPa / 33.8639 : hPa;
}

/** "1014 hPa" or "29.95 inHg". */
export function formatPressure(hPa: number, unit: PressureUnit): string {
  const v = convertPressure(hPa, unit);
  return unit === 'inHg' ? `${v.toFixed(2)} inHg` : `${Math.round(v)} hPa`;
}

const MI_PER_KM = 0.621371;

/** Metric keeps the measure tool's own formatter; miles mirror it:
 *  < 0.1 mi → feet, < 100 mi → one decimal, else rounded. */
export function formatDistanceKm(km: number, unit: DistanceUnit): string {
  if (unit === 'km') return formatDistance(km);
  const mi = km * MI_PER_KM;
  if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
  if (mi < 100) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString('en-US')} mi`;
}

/** Legend stop labels carry metric numbers ("≤0°", "1015", "≥1040 hPa");
 *  convert the number in place and swap the unit suffix so the scale
 *  reads in the chosen unit. Other kinds pass through untouched. */
export function convertLegendLabel(
  label: string,
  kind: 'temperature' | 'pressure' | string,
  units: Units
): string {
  if (kind === 'temperature' && units.temp !== 'C') {
    return label.replace(/(-?\d+(?:\.\d+)?)/, (m) =>
      String(Math.round(convertTemp(Number(m), units.temp)))
    );
  }
  if (kind === 'pressure' && units.pressure !== 'hPa') {
    return label
      .replace(/(-?\d+(?:\.\d+)?)/, (m) =>
        convertPressure(Number(m), units.pressure).toFixed(1)
      )
      .replace(/\s*hPa$/, ' inHg');
  }
  return label;
}

export function convertLegendStops<T extends { label: string }>(
  stops: T[],
  kind: string,
  units: Units
): T[] {
  if (kind !== 'temperature' && kind !== 'pressure') return stops;
  return stops.map((s) => ({
    ...s,
    label: convertLegendLabel(s.label, kind, units),
  }));
}
