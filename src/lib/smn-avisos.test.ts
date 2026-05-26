import { afterEach, describe, expect, it } from 'vitest';
import {
  avisosForState,
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
