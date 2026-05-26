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

/** Multi-state variant for places that span multiple federal
 *  entities (volcanoes straddling 2–3 states). Aggregates state-
 *  tagged avisos from every slug, dedupes by `link` (the SMN advisory
 *  PDF URL is the most stable identifier across re-scrapes), and
 *  appends the global bucket. Order preserved by first-seen. */
export function avisosForStates(
  doc: SmnByStateDoc | null,
  stateSlugs: readonly string[],
): SmnAviso[] {
  if (!doc) return [];
  const seen = new Set<string>();
  const out: SmnAviso[] = [];
  const pushUnique = (a: SmnAviso): void => {
    const key = a.link || a.title;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  for (const slug of stateSlugs) {
    for (const a of doc.byState?.[slug] ?? []) pushUnique(a);
  }
  for (const a of doc.global ?? []) pushUnique(a);
  return out;
}
