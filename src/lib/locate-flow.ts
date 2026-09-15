/**
 * Shared "use my location" flow.
 *
 * Two surfaces ask the browser for a position and then do something
 * different with it:
 *   - the home CTA (#geo) NAVIGATES to /clima/<slug>/ or /forecast/
 *     after confirming the point is inside Mexico (story 2.1);
 *   - the map's locate button (#maploc) drops a PIN and never leaves
 *     the page.
 * The permission / timeout / unsupported handling is identical, so it
 * lives here once. The caller decides the final action via callbacks.
 *
 * DOM-free (only the Geolocation interface), so it is unit-testable
 * with a fake `geolocation` object.
 */

export type LocateFailure =
  'unsupported' | 'denied' | 'unavailable' | 'timeout';
export type LocateResult = 'resolved' | 'rejected' | LocateFailure;

export interface LocateFlowOptions {
  /** Defaults to `navigator.geolocation`; undefined ⇒ 'unsupported'. */
  geolocation?: Geolocation | undefined;
  positionOptions?: PositionOptions;
  /** Optional gate on the fix (e.g. "inside MX?"). Falsy ⇒ onRejected. */
  accept?: (lat: number, lng: number) => boolean | Promise<boolean>;
  /** The final action: navigate, drop a pin, … */
  onResolved: (lat: number, lng: number) => void | Promise<void>;
  /** Called when `accept` returned false. */
  onRejected?: () => void;
  /** Called on any geolocation failure with a coarse reason. */
  onError?: (reason: LocateFailure) => void;
}

/** 8 s: long enough for a cellular cold-start GPS fix, short enough that
 *  users don't think the page hung. maximumAge 10 min reuses a recent
 *  fix. enableHighAccuracy off saves battery — indoor accuracy is fine
 *  for state resolution and for a map pin at country zoom. */
export const DEFAULT_POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 8000,
  maximumAge: 600000,
};

export function failureFromError(
  err: { code?: number } | null | undefined
): LocateFailure {
  // GeolocationPositionError.code: 1=PERMISSION_DENIED,
  // 2=POSITION_UNAVAILABLE, 3=TIMEOUT.
  if (err?.code === 1) return 'denied';
  if (err?.code === 3) return 'timeout';
  return 'unavailable';
}

/** Which UI string to show for a failure (keys into i18n `ui`). */
export function failureMessageKey(
  reason: LocateFailure
): 'geo_denied' | 'geo_timeout' {
  return reason === 'timeout' ? 'geo_timeout' : 'geo_denied';
}

export function requestPosition(
  geolocation: Geolocation | undefined,
  positionOptions: PositionOptions = DEFAULT_POSITION_OPTIONS
): Promise<{ lat: number; lng: number } | LocateFailure> {
  if (!geolocation) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        (pos) =>
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => resolve(failureFromError(err)),
        positionOptions
      );
    } catch {
      resolve('unavailable');
    }
  });
}

export async function runLocateFlow(
  o: LocateFlowOptions
): Promise<LocateResult> {
  const geolocation =
    o.geolocation !== undefined
      ? o.geolocation
      : typeof navigator !== 'undefined'
        ? navigator.geolocation
        : undefined;
  const fix = await requestPosition(geolocation, o.positionOptions);
  if (typeof fix === 'string') {
    o.onError?.(fix);
    return fix;
  }
  if (o.accept && !(await o.accept(fix.lat, fix.lng))) {
    o.onRejected?.();
    return 'rejected';
  }
  await o.onResolved(fix.lat, fix.lng);
  return 'resolved';
}
