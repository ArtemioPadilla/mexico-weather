/**
 * Shared in-memory fetch cache + request coalescing.
 *
 * Used across the map subsystem so the home embed, the /mapa overlay and
 * the forecast embed don't fire duplicate requests for the same Open-Meteo
 * grid or RainViewer manifest.
 *
 * - Keyed by URL only. We have no non-GET requests; if that changes the
 *   key needs to include method + body.
 * - 2xx responses are cached for {@link FETCH_CACHE_TTL_MS}. Non-2xx
 *   responses bypass the cache so transient failures (429, 5xx) can be
 *   retried on the next call.
 * - Concurrent identical requests coalesce: only one network fetch fires;
 *   the other callers receive a `.clone()` of the same Response.
 */

export const FETCH_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  ts: number;
  body: string;
  headers: Record<string, string>;
  status: number;
}

const fetchCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Response>>();

export function cachedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  // Don't cache non-GET (we don't have any, but be safe).
  if (method !== 'GET') return globalThis.fetch(input as RequestInfo, init);

  const cached = fetchCache.get(url);
  if (cached && Date.now() - cached.ts < FETCH_CACHE_TTL_MS) {
    return Promise.resolve(
      new Response(cached.body, {
        status: cached.status,
        headers: cached.headers,
      }),
    );
  }

  // Coalesce concurrent identical requests.
  const existing = inFlight.get(url);
  if (existing) {
    // Each caller needs its own Response (body can only be read once),
    // so clone before handing back.
    return existing.then((r) => r.clone());
  }

  const p = globalThis.fetch(input as RequestInfo, init).then(async (res) => {
    // Only cache 2xx so we re-try on 429 / 5xx next call instead of pinning
    // the failure for 10 minutes.
    if (res.ok) {
      try {
        const clone = res.clone();
        const body = await clone.text();
        const headers: Record<string, string> = {};
        clone.headers.forEach((v, k) => {
          headers[k] = v;
        });
        fetchCache.set(url, {
          ts: Date.now(),
          body,
          headers,
          status: res.status,
        });
      } catch {
        /* ignore — fall through and return the original */
      }
    }
    return res;
  });
  inFlight.set(url, p);
  // Always remove from in-flight on settle so future calls don't get a stale
  // Promise after the cache also expires.
  p.finally(() => {
    if (inFlight.get(url) === p) inFlight.delete(url);
  });
  return p.then((r) => r.clone());
}

// ---------------------------------------------------------------------------
// Test / dev helpers — not for production use
// ---------------------------------------------------------------------------

/** Clear cache + in-flight map. Used by unit tests. */
export function __clearFetchCache(): void {
  fetchCache.clear();
  inFlight.clear();
}

/** Snapshot of cache sizes for debugging. */
export function __cacheCounts(): { cached: number; inFlight: number } {
  return { cached: fetchCache.size, inFlight: inFlight.size };
}
