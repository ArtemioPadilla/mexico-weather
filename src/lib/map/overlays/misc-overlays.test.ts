import { describe, expect, it } from 'vitest';
import { buildGraticule, createGraticuleOverlay } from './graticule';
import { createFiresOverlay } from './fires';

describe('graticule', () => {
  it('buildGraticule returns 10°-spaced meridians + parallels', () => {
    const fc = buildGraticule();
    const meridians = fc.features.filter(
      (f) => (f.properties as { kind?: string } | null)?.kind === 'meridian',
    );
    const parallels = fc.features.filter(
      (f) => (f.properties as { kind?: string } | null)?.kind === 'parallel',
    );
    // -180..180 at 10° → 37 lines.
    expect(meridians).toHaveLength(37);
    // -80..80 at 10° → 17 lines.
    expect(parallels).toHaveLength(17);
  });

  it('factory toggles add/remove cleanly', () => {
    const layers = new Set<string>();
    const sources = new Set<string>();
    const map = {
      getSource: (id: string): unknown => (sources.has(id) ? {} : undefined),
      getLayer: (id: string): unknown => (layers.has(id) ? {} : undefined),
      addSource: (id: string): void => {
        sources.add(id);
      },
      addLayer: (def: { id: string }): void => {
        layers.add(def.id);
      },
      removeLayer: (id: string): void => {
        layers.delete(id);
      },
      removeSource: (id: string): void => {
        sources.delete(id);
      },
    } as unknown as Parameters<typeof createGraticuleOverlay>[0];
    const overlay = createGraticuleOverlay(map);
    overlay.setEnabled(true);
    expect(layers.has('wx-graticule-line')).toBe(true);
    overlay.setEnabled(false);
    expect(layers.size).toBe(0);
  });
});

describe('fires overlay', () => {
  it('factory accepts a fetch dep and a base path', async () => {
    const layers = new Set<string>();
    const sources = new Set<string>();
    const fetched: string[] = [];
    const map = {
      getSource: (id: string): unknown => (sources.has(id) ? {} : undefined),
      getLayer: (id: string): unknown => (layers.has(id) ? {} : undefined),
      addSource: (id: string): void => {
        sources.add(id);
      },
      addLayer: (def: { id: string }): void => {
        layers.add(def.id);
      },
      removeLayer: (id: string): void => {
        layers.delete(id);
      },
      removeSource: (id: string): void => {
        sources.delete(id);
      },
    } as unknown as Parameters<typeof createFiresOverlay>[0];
    const fetchImpl: typeof fetch = (async (input: string | Request | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetched.push(url);
      return {
        ok: true,
        json: (): Promise<unknown> =>
          Promise.resolve({ type: 'FeatureCollection', features: [] }),
      } as unknown as Response;
    }) as typeof fetch;
    const overlay = createFiresOverlay(map, {
      fetch: fetchImpl,
      base: '/mexico-weather/',
    });
    await overlay.setEnabled(true);
    expect(fetched[0]).toBe('/mexico-weather/data/fires-na.json');
    expect(layers.has('wx-fires-circle')).toBe(true);
    await overlay.setEnabled(false);
    expect(layers.size).toBe(0);
  });
});
