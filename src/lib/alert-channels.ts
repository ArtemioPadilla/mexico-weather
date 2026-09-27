/**
 * Delivery channels for the personal alert rules (Story 17.3, plan
 * PRO_GRATIS E17). The rules live only in this browser by design — no
 * backend ever learns them — so the two channels that respect that are:
 *
 *  1. a recurring calendar reminder (.ics) that links back to the
 *     forecast page, for people who want a nudge to check;
 *  2. a system notification through the Notification API when the PWA
 *     is open and a rule is met (no push, no service-worker messaging).
 *
 * Pure helpers; the page decides when to call them.
 */
import type { AlertRule, FiredAlert } from './alerts';
import { alertKey } from './alerts';

const METRIC_ES: Record<AlertRule['metric'], string> = {
  rain: 'Lluvia',
  temp_hi: 'Temp. máx.',
  temp_lo: 'Temp. mín.',
  wind: 'Viento',
};
const UNIT_ES: Record<AlertRule['metric'], string> = {
  rain: 'mm/h',
  temp_hi: '°C',
  temp_lo: '°C',
  wind: 'km/h',
};

export function describeRule(rule: AlertRule): string {
  return `${METRIC_ES[rule.metric]} ${rule.op} ${rule.threshold}${UNIT_ES[rule.metric]}`;
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function icsStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** A daily 07:00 (floating local time) reminder to check the forecast
 *  for this rule's place, with the page URL in the event. */
export function buildAlertIcs(
  rule: AlertRule,
  url: string,
  now: Date = new Date()
): string {
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const d = String(start.getDate()).padStart(2, '0');
  const uid = `${alertKey(rule)}@climamx`;
  const summary = `Revisar clima: ${rule.name} — ${describeRule(rule)}`;
  const desc = `Regla personal de Clima México (guardada solo en tu navegador). Abre el pronóstico: ${url}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clima México//alertas personales//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${y}${m}${d}T070000`,
    `DTEND:${y}${m}${d}T071500`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    `URL:${icsEscape(url)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function alertIcsFilename(rule: AlertRule): string {
  const slug = rule.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `clima-${slug || 'lugar'}-${rule.metric}.ics`;
}

/** localStorage key for the "already notified today" set. */
export const NOTIFIED_KEY = 'secid-mwx-alerts-notified';

/** Which fired alerts still deserve a system notification today
 *  (one per rule per calendar day, so a page reload does not re-buzz). */
export function pendingNotifications(
  fired: readonly FiredAlert[],
  notified: readonly string[],
  todayIso: string
): { alerts: FiredAlert[]; keys: string[] } {
  const seen = new Set(notified);
  const alerts: FiredAlert[] = [];
  const keys: string[] = [];
  for (const f of fired) {
    const k = `${alertKey(f.rule)}:${todayIso}`;
    if (seen.has(k)) continue;
    alerts.push(f);
    keys.push(k);
  }
  return { alerts, keys };
}

export interface NotificationLike {
  permission: 'default' | 'granted' | 'denied';
  new (
    title: string,
    options?: { body?: string; tag?: string; icon?: string }
  ): unknown;
}

/** Fire one system notification per pending alert when permission is
 *  granted. Returns how many were shown (0 when the API is missing or
 *  permission is not granted — the page keeps its in-page banner). */
export function notifyFired(
  alerts: readonly FiredAlert[],
  NotificationCtor: NotificationLike | undefined,
  icon?: string
): number {
  if (!NotificationCtor || NotificationCtor.permission !== 'granted') return 0;
  let n = 0;
  for (const f of alerts) {
    try {
      new NotificationCtor(`⚠️ ${f.rule.name}: ${describeRule(f.rule)}`, {
        body: `Alcanza ${Math.round(f.value)}${UNIT_ES[f.rule.metric]} en las próximas 24 h.`,
        tag: alertKey(f.rule),
        icon,
      });
      n += 1;
    } catch {
      /* some browsers throw for constructor use inside a page; ignore */
    }
  }
  return n;
}
