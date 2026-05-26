import { afterEach, describe, expect, it } from 'vitest';
import {
  avisosForState,
  avisosForStates,
  loadSmnAvisos,
  resetSmnAvisosCache,
} from './smn-avisos';

afterEach(() => {
  resetSmnAvisosCache();
});

const SAMPLE_DOC = {
  metadata: { updated: '2026-05-25', total_items: 3 },
  byState: {
    jalisco: [
      {
        title: 'Lluvias fuertes en Jalisco',
        link: 'https://example.com/a',
        pubDate: 'Mon, 25 May 2026',
        category: 'Alerta',
        severity: 'critical' as const,
      },
    ],
    oaxaca: [
      {
        title: 'Calor extremo en Oaxaca',
        link: 'https://example.com/b',
        pubDate: 'Mon, 25 May 2026',
        category: 'Aviso',
        severity: 'warn' as const,
      },
    ],
  },
  global: [
    {
      title: 'Frente frío núm. 51',
      link: 'https://example.com/c',
      pubDate: 'Mon, 25 May 2026',
      category: 'Pronóstico',
      severity: 'info' as const,
    },
  ],
};

function fetchOk(doc: object = SAMPLE_DOC): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(doc), { status: 200 })) as typeof fetch;
}

describe('loadSmnAvisos', () => {
  it('parses the doc on success', async () => {
    const doc = await loadSmnAvisos('/base/', fetchOk());
    expect(doc?.metadata?.total_items).toBe(3);
    expect(doc?.byState?.jalisco).toHaveLength(1);
  });

  it('returns null on HTTP error', async () => {
    const fail = (async () => new Response('', { status: 404 })) as typeof fetch;
    expect(await loadSmnAvisos('/base/', fail)).toBeNull();
  });

  it('returns null on network error', async () => {
    const fail = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await loadSmnAvisos('/base/', fail)).toBeNull();
  });

  it('caches across calls', async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(SAMPLE_DOC), { status: 200 });
    }) as typeof fetch;
    await loadSmnAvisos('/base/', counting);
    await loadSmnAvisos('/base/', counting);
    expect(calls).toBe(1);
  });
});

describe('avisosForState', () => {
  it('returns state-tagged hits + global avisos', () => {
    const out = avisosForState(SAMPLE_DOC, 'jalisco');
    // Jalisco hit + 1 global = 2.
    expect(out.map((a) => a.title)).toEqual([
      'Lluvias fuertes en Jalisco',
      'Frente frío núm. 51',
    ]);
  });

  it('returns only global avisos when state is unknown', () => {
    const out = avisosForState(SAMPLE_DOC, 'nonexistent');
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('Frente frío núm. 51');
  });

  it('returns only global avisos when stateSlug is null', () => {
    const out = avisosForState(SAMPLE_DOC, null);
    expect(out).toHaveLength(1);
  });

  it('returns empty array when doc is null', () => {
    expect(avisosForState(null, 'jalisco')).toEqual([]);
  });
});

describe('avisosForStates (multi-state, volcano use case)', () => {
  // Simulate Popocatépetl covering Puebla / Edomex / Morelos. Add an
  // overlapping aviso (same link) tagged in two of the three to verify
  // dedupe.
  const VOLCANO_DOC = {
    metadata: { updated: '2026-05-25', total_items: 4 },
    byState: {
      puebla: [
        {
          title: 'Aviso de ceniza Popo (Puebla)',
          link: 'https://example.com/popo-ash',
          pubDate: 'Mon, 25 May 2026 12:00:00 -0600',
          category: 'Alerta',
          severity: 'critical' as const,
        },
        {
          title: 'Lluvias en Puebla',
          link: 'https://example.com/puebla-rain',
          pubDate: 'Mon, 25 May 2026 10:00:00 -0600',
          category: 'Aviso',
          severity: 'warn' as const,
        },
      ],
      'estado-de-mexico': [
        // Same aviso ID as the Puebla one — should dedupe by link.
        {
          title: 'Aviso de ceniza Popo (Edomex)',
          link: 'https://example.com/popo-ash',
          pubDate: 'Mon, 25 May 2026 12:00:00 -0600',
          category: 'Alerta',
          severity: 'critical' as const,
        },
      ],
      morelos: [
        {
          title: 'Caída de ceniza en Morelos',
          link: 'https://example.com/morelos-ash',
          pubDate: 'Mon, 25 May 2026 11:00:00 -0600',
          category: 'Aviso',
          severity: 'warn' as const,
        },
      ],
    },
    global: [
      {
        title: 'Frente frío núm. 51',
        link: 'https://example.com/frente',
        pubDate: 'Mon, 25 May 2026',
        category: 'Pronóstico',
        severity: 'info' as const,
      },
    ],
  };

  it('aggregates avisos from every passed state slug', () => {
    const out = avisosForStates(VOLCANO_DOC, ['puebla', 'estado-de-mexico', 'morelos']);
    // Puebla (2) + Edomex dedupe-to-0 new + Morelos (1) + global (1) = 4.
    expect(out).toHaveLength(4);
    const titles = out.map((a) => a.title);
    expect(titles).toContain('Aviso de ceniza Popo (Puebla)');
    expect(titles).toContain('Caída de ceniza en Morelos');
    expect(titles).toContain('Frente frío núm. 51');
  });

  it('dedupes by link across overlapping state buckets', () => {
    const out = avisosForStates(VOLCANO_DOC, ['puebla', 'estado-de-mexico']);
    // Same advisory in both buckets — only one copy comes out, and the
    // first-seen (Puebla) wins on title.
    const ashHits = out.filter((a) => a.link === 'https://example.com/popo-ash');
    expect(ashHits).toHaveLength(1);
    expect(ashHits[0]?.title).toBe('Aviso de ceniza Popo (Puebla)');
  });

  it('returns just global avisos when slugs are empty', () => {
    const out = avisosForStates(VOLCANO_DOC, []);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('Frente frío núm. 51');
  });

  it('returns empty when doc is null', () => {
    expect(avisosForStates(null, ['puebla'])).toEqual([]);
  });
});
