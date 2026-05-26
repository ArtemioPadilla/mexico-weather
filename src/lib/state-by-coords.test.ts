import { afterEach, describe, expect, it } from 'vitest';
import {
  resetStateByCoordsCache,
  resolveStateByCoords,
} from './state-by-coords';

afterEach(() => {
  resetStateByCoordsCache();
});

// Tiny synthetic polygon set — two squares so we can verify
// point-in-polygon + the not-in-any-polygon → null behavior without
// depending on the full 62 KB MX polygon file.
const TINY_DOC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { slug: 'square-a' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 10],
            [10, 10],
            [10, 0],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { slug: 'square-b' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [20, 0],
            [20, 10],
            [30, 10],
            [30, 0],
            [20, 0],
          ],
        ],
      },
    },
  ],
};

function fetchOk(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(TINY_DOC), { status: 200 })) as typeof fetch;
}

describe('resolveStateByCoords', () => {
  it('returns the slug of the polygon containing the point', async () => {
    expect(await resolveStateByCoords(5, 5, '/base/', fetchOk())).toBe('square-a');
    expect(await resolveStateByCoords(5, 25, '/base/', fetchOk())).toBe('square-b');
  });

  it('returns null for points outside every polygon', async () => {
    expect(await resolveStateByCoords(5, 50, '/base/', fetchOk())).toBeNull();
    expect(await resolveStateByCoords(-1, -1, '/base/', fetchOk())).toBeNull();
  });

  it('returns null for non-finite coords', async () => {
    expect(await resolveStateByCoords(NaN, 5, '/base/', fetchOk())).toBeNull();
  });

  it('returns null when the polygon file cannot be loaded', async () => {
    const fetch404 = (async () => new Response('', { status: 404 })) as typeof fetch;
    expect(await resolveStateByCoords(5, 5, '/base/', fetch404)).toBeNull();
  });

  it('returns null on network error', async () => {
    const fetchThrow = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await resolveStateByCoords(5, 5, '/base/', fetchThrow)).toBeNull();
  });

  it('caches the polygon file across calls', async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(TINY_DOC), { status: 200 });
    }) as typeof fetch;
    await resolveStateByCoords(5, 5, '/base/', counting);
    await resolveStateByCoords(5, 25, '/base/', counting);
    await resolveStateByCoords(99, 99, '/base/', counting);
    expect(calls).toBe(1);
  });
});

describe('resolveStateByCoords against the real MX polygons', () => {
  // Lazy-load the on-disk file via Node's fs in this one test so we
  // verify the actual committed polygons resolve correctly. The
  // synthetic tests above already cover the algorithmic edge cases.
  it('maps top MX city coords to the right state slugs', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '../../public/data/mx-states.geojson');
    let doc: string;
    try {
      doc = readFileSync(path, 'utf-8');
    } catch {
      // GeoJSON not present in this checkout — skip the test rather
      // than fail. The workflow rebuilds it on demand.
      return;
    }
    const localFetch: typeof fetch = (async () =>
      new Response(doc, { status: 200 })) as typeof fetch;
    expect(await resolveStateByCoords(19.43, -99.13, '/', localFetch)).toBe('cdmx');
    resetStateByCoordsCache();
    expect(await resolveStateByCoords(20.66, -103.35, '/', localFetch)).toBe(
      'jalisco',
    );
    resetStateByCoordsCache();
    expect(await resolveStateByCoords(21.16, -86.85, '/', localFetch)).toBe(
      'quintana-roo',
    );
    resetStateByCoordsCache();
    // San Antonio TX → outside MX → null.
    expect(await resolveStateByCoords(29.42, -98.49, '/', localFetch)).toBeNull();
  });
});
