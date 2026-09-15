// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASEMAP_ATTRIBUTION,
  DEFAULT_BASE_SOURCE_ID,
  DEFAULT_REFERENCE_LAYER_ID,
  DEFAULT_REFERENCE_SOURCE_ID,
  ESRI_DARK_BASE,
  ESRI_DARK_REFERENCE,
  ESRI_LIGHT_BASE,
  ESRI_LIGHT_REFERENCE,
  LABEL_ZOOM_THRESHOLD,
  createBasemapThemeController,
  pickBasemapTiles,
} from './basemap-theme';

const ALL_LISTS = [
  ESRI_DARK_BASE,
  ESRI_DARK_REFERENCE,
  ESRI_LIGHT_BASE,
  ESRI_LIGHT_REFERENCE,
];

function hostOf(url: string): string {
  return new URL(url.replace(/\{[xyz]\}/g, '0')).host;
}

describe('pickBasemapTiles', () => {
  it('dark → Esri dark base + dark reference', () => {
    const t = pickBasemapTiles(true);
    expect(t.base).toBe(ESRI_DARK_BASE);
    expect(t.reference).toBe(ESRI_DARK_REFERENCE);
  });

  it('light → Esri light base + light reference', () => {
    const t = pickBasemapTiles(false);
    expect(t.base).toBe(ESRI_LIGHT_BASE);
    expect(t.reference).toBe(ESRI_LIGHT_REFERENCE);
  });

  it('never points at CARTO (watermarks anonymous tiles) nor single-host OSM', () => {
    for (const list of ALL_LISTS) {
      for (const url of list) {
        expect(url).not.toMatch(/cartocdn|carto\.com/i);
        expect(url).not.toContain('tile.openstreetmap.org');
      }
    }
  });

  it('every tile list is sharded across ≥2 distinct hosts', () => {
    // Regression guard (generalised from the OSM single-host bug): a
    // single host gives MapLibre's tile burst no parallelism and blanked
    // the light basemap at zoom ≥5.
    for (const list of ALL_LISTS) {
      const hosts = new Set(list.map(hostOf));
      expect(hosts.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses the Esri {z}/{y}/{x} path order', () => {
    for (const list of ALL_LISTS) {
      for (const url of list) expect(url).toMatch(/\/\{z\}\/\{y\}\/\{x\}$/);
    }
  });

  it('LABEL_ZOOM_THRESHOLD is 5 (matches plan P2.5)', () => {
    expect(LABEL_ZOOM_THRESHOLD).toBe(5);
  });
});

describe('createBasemapThemeController', () => {
  function fakeMap(zoom: number) {
    const sources: Record<
      string,
      { setTiles: ReturnType<typeof vi.fn>; attribution?: string }
    > = {
      [DEFAULT_BASE_SOURCE_ID]: { setTiles: vi.fn() },
      [DEFAULT_REFERENCE_SOURCE_ID]: { setTiles: vi.fn() },
    };
    const setLayoutProperty = vi.fn();
    const map = {
      getZoom: () => zoom,
      getSource: (id: string) => sources[id],
      getLayer: (id: string) =>
        id === DEFAULT_REFERENCE_LAYER_ID ? {} : undefined,
      setLayoutProperty,
      style: { sourceCaches: {} },
      transform: {},
    };
    return { map, sources, setLayoutProperty };
  }

  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('theme change → setTiles on BOTH sources with the matching theme + attribution', () => {
    const { map, sources } = fakeMap(6);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
    });
    document.documentElement.classList.add('dark');
    ctl.sync();
    expect(sources.osm.setTiles).toHaveBeenCalledWith(ESRI_DARK_BASE);
    expect(sources['osm-reference'].setTiles).toHaveBeenCalledWith(
      ESRI_DARK_REFERENCE
    );
    expect(sources.osm.attribution).toBe(BASEMAP_ATTRIBUTION);
    ctl.dispose();
  });

  it('density change → visibility flip on the reference layer, NO setTiles', () => {
    const { map, sources, setLayoutProperty } = fakeMap(3);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
    });
    ctl.sync(); // z3 < threshold → labels hidden
    expect(setLayoutProperty).toHaveBeenCalledWith(
      'osm-reference',
      'visibility',
      'none'
    );
    expect(sources.osm.setTiles).not.toHaveBeenCalled();
    ctl.dispose();
  });

  it('is idempotent when nothing changed', () => {
    const { map, setLayoutProperty } = fakeMap(8);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
    });
    ctl.sync();
    ctl.sync();
    expect(setLayoutProperty).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });
});
