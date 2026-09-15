import { describe, expect, it, vi } from 'vitest';
import {
  failureFromError,
  failureMessageKey,
  runLocateFlow,
} from './locate-flow';

function fakeGeo(
  behaviour: { lat: number; lng: number } | { code: number }
): Geolocation {
  return {
    getCurrentPosition: (
      ok: PositionCallback,
      fail?: PositionErrorCallback | null
    ) => {
      if ('code' in behaviour) fail?.(behaviour as GeolocationPositionError);
      else
        ok({
          coords: { latitude: behaviour.lat, longitude: behaviour.lng },
        } as GeolocationPosition);
    },
  } as unknown as Geolocation;
}

describe('runLocateFlow', () => {
  it('resolves and hands the fix to onResolved (pin flavour: no gate)', async () => {
    const onResolved = vi.fn();
    const r = await runLocateFlow({
      geolocation: fakeGeo({ lat: 19.43, lng: -99.13 }),
      onResolved,
    });
    expect(r).toBe('resolved');
    expect(onResolved).toHaveBeenCalledWith(19.43, -99.13);
  });

  it('navigate flavour: accept() gate rejects points outside MX without calling onResolved', async () => {
    const onResolved = vi.fn();
    const onRejected = vi.fn();
    const r = await runLocateFlow({
      geolocation: fakeGeo({ lat: 29.42, lng: -98.49 }), // San Antonio, TX
      accept: async () => false,
      onResolved,
      onRejected,
    });
    expect(r).toBe('rejected');
    expect(onResolved).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledOnce();
  });

  it('maps PERMISSION_DENIED / TIMEOUT / other to coarse reasons', async () => {
    for (const [code, reason] of [
      [1, 'denied'],
      [3, 'timeout'],
      [2, 'unavailable'],
    ] as const) {
      const onError = vi.fn();
      const r = await runLocateFlow({
        geolocation: fakeGeo({ code }),
        onResolved: vi.fn(),
        onError,
      });
      expect(r).toBe(reason);
      expect(onError).toHaveBeenCalledWith(reason);
    }
  });

  it('no geolocation API ⇒ unsupported', async () => {
    const onError = vi.fn();
    const r = await runLocateFlow({
      geolocation: undefined,
      onResolved: vi.fn(),
      onError,
    });
    expect(r).toBe('unsupported');
    expect(onError).toHaveBeenCalledWith('unsupported');
  });
});

describe('helpers', () => {
  it('failureFromError', () => {
    expect(failureFromError({ code: 1 })).toBe('denied');
    expect(failureFromError({ code: 3 })).toBe('timeout');
    expect(failureFromError({ code: 2 })).toBe('unavailable');
    expect(failureFromError(null)).toBe('unavailable');
  });
  it('failureMessageKey: only timeout gets its own copy', () => {
    expect(failureMessageKey('timeout')).toBe('geo_timeout');
    expect(failureMessageKey('denied')).toBe('geo_denied');
    expect(failureMessageKey('unsupported')).toBe('geo_denied');
  });
});
