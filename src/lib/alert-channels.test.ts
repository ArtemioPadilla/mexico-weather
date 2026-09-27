import { describe, expect, it } from 'vitest';
import type { AlertRule } from './alerts';
import {
  alertIcsFilename,
  buildAlertIcs,
  describeRule,
  notifyFired,
  pendingNotifications,
} from './alert-channels';

const rule: AlertRule = {
  lat: 19.43,
  lng: -99.13,
  name: 'Ciudad de México',
  metric: 'temp_hi',
  op: '>',
  threshold: 30,
  createdAt: 0,
};

describe('alert channels (Story 17.3)', () => {
  it('builds a daily 07:00 reminder .ics linking back to the forecast', () => {
    const ics = buildAlertIcs(
      rule,
      'https://x.test/forecast/?lat=19.43&lng=-99.13',
      new Date('2026-09-27T12:00:00Z')
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('DTSTART:20260928T070000');
    expect(ics).toContain(
      'SUMMARY:Revisar clima: Ciudad de México — Temp. máx. > 30°C'
    );
    expect(ics).toContain('URL:https://x.test/forecast/?lat=19.43&lng=-99.13');
    expect(ics).toContain('DTSTAMP:20260927T120000Z');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(alertIcsFilename(rule)).toBe('clima-ciudad-de-mexico-temp_hi.ics');
    expect(
      describeRule({ ...rule, metric: 'wind', op: '<', threshold: 5 })
    ).toBe('Viento < 5km/h');
  });

  it('notifies each fired rule once per day and only with permission', () => {
    const fired = [{ rule, value: 33 }];
    const first = pendingNotifications(fired, [], '2026-09-27');
    expect(first.alerts).toHaveLength(1);
    expect(first.keys[0]).toMatch(/:2026-09-27$/);
    expect(
      pendingNotifications(fired, first.keys, '2026-09-27').alerts
    ).toHaveLength(0);
    expect(
      pendingNotifications(fired, first.keys, '2026-09-28').alerts
    ).toHaveLength(1);

    const made: string[] = [];
    class Granted {
      static permission = 'granted' as const;
      constructor(title: string, opts?: { body?: string }) {
        made.push(`${title} | ${opts?.body ?? ''}`);
      }
    }
    expect(notifyFired(fired, Granted)).toBe(1);
    expect(made[0]).toContain('Ciudad de México: Temp. máx. > 30°C');
    expect(made[0]).toContain('Alcanza 33°C');
    class Denied {
      static permission = 'denied' as const;
      constructor() {
        throw new Error('should not construct');
      }
    }
    expect(notifyFired(fired, Denied)).toBe(0);
    expect(notifyFired(fired, undefined)).toBe(0);
  });
});
