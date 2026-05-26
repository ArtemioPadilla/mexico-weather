/**
 * Client for the per-state SMN avisos index produced by
 * scripts/build-smn-by-state.py. Loaded once + memoized; subsequent
 * lookups are synchronous on the cached doc.
 */

export interface SmnAviso {
  title: string;
  link: string;
  pubDate: string;
  category: string;
  severity: 'critical' | 'warn' | 'info';
}

export interface SmnByStateDoc {
  metadata?: {
    updated?: string;
    total_items?: number;
  };
  byState?: Record<string, SmnAviso[]>;
  global?: SmnAviso[];
}

let cached: SmnByStateDoc | null = null;
let inflight: Promise<SmnByStateDoc | null> | null = null;

export function resetSmnAvisosCache(): void {
  cached = null;
  inflight = null;
}

export async function loadSmnAvisos(
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SmnByStateDoc | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetchImpl(`${base}data/smn-by-state.json`);
      if (!r.ok) return null;
      const doc = (await r.json()) as SmnByStateDoc;
      cached = doc;
      return doc;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Return avisos that apply to the given state slug: state-tagged
 *  avisos first, then the global bucket (national-scope warnings).
 *  Empty array when nothing applies. */
export function avisosForState(
  doc: SmnByStateDoc | null,
  stateSlug: string | null,
): SmnAviso[] {
  if (!doc) return [];
  const stateHits = stateSlug ? doc.byState?.[stateSlug] ?? [] : [];
  return [...stateHits, ...(doc.global ?? [])];
}
