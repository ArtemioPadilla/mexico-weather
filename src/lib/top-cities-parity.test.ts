import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOP_CITIES } from './top-cities';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * scripts/build-city-forecasts.py mirrors TOP_CITIES because Python
 * can't read TS modules. This test guards the duplication — if either
 * list drifts the test fails with a clear diff.
 */
describe('TOP_CITIES Python parity', () => {
  it('Python TOP_CITIES list matches src/lib/top-cities.ts', () => {
    const py = readFileSync(
      resolve(here, '../../scripts/build-city-forecasts.py'),
      'utf-8',
    );

    // Extract slug/lat/lng/tz tuples from the Python dict literals.
    // Format: {'slug': '…', 'lat': …, 'lng': …, 'tz': '…'}
    const re =
      /\{'slug':\s*'([^']+)',\s*'lat':\s*(-?[\d.]+),\s*'lng':\s*(-?[\d.]+),\s*'tz':\s*'([^']+)'\}/g;
    const pyList: Array<{ slug: string; lat: number; lng: number; tz: string }> =
      [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(py)) !== null) {
      pyList.push({
        slug: m[1] as string,
        lat: Number(m[2]),
        lng: Number(m[3]),
        tz: m[4] as string,
      });
    }

    expect(pyList.length).toBe(TOP_CITIES.length);
    for (let i = 0; i < TOP_CITIES.length; i++) {
      const ts = TOP_CITIES[i]!;
      const p = pyList[i]!;
      expect(p.slug, `entry ${i} slug`).toBe(ts.slug);
      expect(p.lat, `entry ${i} lat (${ts.slug})`).toBeCloseTo(ts.lat, 1);
      expect(p.lng, `entry ${i} lng (${ts.slug})`).toBeCloseTo(ts.lng, 1);
      expect(p.tz, `entry ${i} tz (${ts.slug})`).toBe(ts.tz);
    }
  });
});
