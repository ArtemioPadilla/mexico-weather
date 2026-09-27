/**
 * Relative label for a timeline frame ("Ahora", "−35 min", "+6 h",
 * "+3 d"). Pure so the wording is unit-testable; the clock part of the
 * label stays in interactive-map.ts because it depends on the user's
 * time-zone / hour-format settings.
 *
 * Story 15.1: with 10-day forecast windows the old "+4320 min" reads
 * badly, so past ±60 min we switch to hours and past ±24 h to days.
 */
export interface TimelineLabelStrings {
  now: string;
}

export const HOUR = 60;
export const DAY = 24 * HOUR;

export function relativeFrameLabel(
  offsetMinutes: number,
  strings: TimelineLabelStrings
): string {
  if (offsetMinutes === 0) return strings.now;
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  if (abs < HOUR) return `${sign}${abs} min`;
  if (abs < DAY) return `${sign}${Math.round(abs / HOUR)} h`;
  const days = abs / DAY;
  const rounded = Math.round(days * 2) / 2; // half-day precision: "+2.5 d"
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${sign}${text} d`;
}

/** Whether the clock part should carry the weekday (frames ≥ 24 h away
 *  are ambiguous with a bare "15:00"). */
export function needsWeekday(offsetMinutes: number): boolean {
  return Math.abs(offsetMinutes) >= DAY;
}
