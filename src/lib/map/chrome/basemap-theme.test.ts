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
  REFERENCE_OVER_IMAGERY_OPACITY,
  createBasemapThemeController,
  isDarkBasemap,
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
  it('dark, no imagery → Esri dark base + dark reference', () => {
    const t = pickBasemapTiles({ dark: true, imagery: false });
    expect(t.base).toBe(ESRI_DARK_BASE);
    expect(t.reference).toBe(ESRI_DARK_REFERENCE);
  });

  it('light, no imagery → Esri light base + light reference', () => {
    const t = pickBasemapTiles({ dark: false, imagery: false });
    expect(t.base).toBe(ESRI_LIGHT_BASE);
    expect(t.reference).toBe(ESRI_LIGHT_REFERENCE);
  });

  // Story 21.1 — the full dark × imagery matrix: imagery wins.
  it.each([
    { dark: false, imagery: false, expectDark: false },
    { dark: false, imagery: true, expectDark: true },
    { dark: true, imagery: false, expectDark: true },
    { dark: true, imagery: true, expectDark: true },
  ])(
    'dark=$dark imagery=$imagery → dark canvas: $expectDark',
    ({ dark, imagery, expectDark }) => {
      const t = pickBasemapTiles({ dark, imagery });
      expect(isDarkBasemap(t)).toBe(expectDark);
      // Base and reference always come from the SAME theme — a light
      // reference (dark labels) over a dark canvas would be unreadable.
      expect(t.reference).toBe(
        expectDark ? ESRI_DARK_REFERENCE : ESRI_LIGHT_REFERENCE
      );
      expect(t.base).toBe(expectDark ? ESRI_DARK_BASE : ESRI_LIGHT_BASE);
    }
  );

  it('light theme + imagery points the BASE at World_Dark_Gray_Base', () => {
    const t = pickBasemapTiles({ dark: false, imagery: true });
    for (const url of t.base) expect(url).toContain('World_Dark_Gray_Base');
  });

  it('REFERENCE_OVER_IMAGERY_OPACITY is 0.8 (plan Story 21.1)', () => {
    expect(REFERENCE_OVER_IMAGERY_OPACITY).toBe(0.8);
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
    const setPaintProperty = vi.fn();
    const map = {
      getZoom: () => zoom,
      getSource: (id: string) => sources[id],
      getLayer: (id: string) =>
        id === DEFAULT_REFERENCE_LAYER_ID ? {} : undefined,
      setLayoutProperty,
      setPaintProperty,
      style: { sourceCaches: {} },
      transform: {},
    };
    return { map, sources, setLayoutProperty, setPaintProperty };
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
    const { map, setLayoutProperty, setPaintProperty } = fakeMap(8);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
    });
    ctl.sync();
    ctl.sync();
    expect(setLayoutProperty).toHaveBeenCalledTimes(1);
    // First sync applies the reference opacity for "no imagery" once.
    expect(setPaintProperty).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });

  // Story 21.1 — imagery flag.
  it('setImagery(true) in the LIGHT theme swaps both sources to dark + dims labels', () => {
    const { map, sources, setPaintProperty } = fakeMap(6);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
    });
    ctl.sync();
    expect(sources.osm.setTiles).not.toHaveBeenCalled();
    ctl.setImagery(true);
    expect(sources.osm.setTiles).toHaveBeenCalledWith(ESRI_DARK_BASE);
    expect(sources['osm-reference'].setTiles).toHaveBeenCalledWith(
      ESRI_DARK_REFERENCE
    );
    expect(setPaintProperty).toHaveBeenLastCalledWith(
      'osm-reference',
      'raster-opacity',
      REFERENCE_OVER_IMAGERY_OPACITY
    );
    // Back to base → light tiles again, labels fully opaque.
    ctl.setImagery(false);
    expect(sources.osm.setTiles).toHaveBeenLastCalledWith(ESRI_LIGHT_BASE);
    expect(sources['osm-reference'].setTiles).toHaveBeenLastCalledWith(
      ESRI_LIGHT_REFERENCE
    );
    expect(setPaintProperty).toHaveBeenLastCalledWith(
      'osm-reference',
      'raster-opacity',
      1
    );
    ctl.dispose();
  });

  it('setImagery(true) in the DARK theme dims labels but swaps no tiles', () => {
    document.documentElement.classList.add('dark');
    const { map, sources, setPaintProperty } = fakeMap(6);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: true,
    });
    ctl.setImagery(true);
    expect(sources.osm.setTiles).not.toHaveBeenCalled();
    expect(sources['osm-reference'].setTiles).not.toHaveBeenCalled();
    expect(setPaintProperty).toHaveBeenCalledWith(
      'osm-reference',
      'raster-opacity',
      REFERENCE_OVER_IMAGERY_OPACITY
    );
    ctl.dispose();
  });

  it('theme toggle while imagery is on keeps the dark canvas (MutationObserver path)', async () => {
    const { map, sources } = fakeMap(6);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
    });
    ctl.setImagery(true);
    sources.osm.setTiles.mockClear();
    // User flips to dark, then back to light: the canvas is dark under
    // imagery either way, so the observer-driven sync must swap nothing.
    document.documentElement.classList.add('dark');
    await Promise.resolve();
    document.documentElement.classList.remove('dark');
    await Promise.resolve();
    expect(sources.osm.setTiles).not.toHaveBeenCalled();
    // Leaving imagery now follows the (light) theme.
    ctl.setImagery(false);
    expect(sources.osm.setTiles).toHaveBeenLastCalledWith(ESRI_LIGHT_BASE);
    ctl.dispose();
  });

  it('initialImagery describes the tiles the map was built with (no swap on first sync)', () => {
    const { map, sources } = fakeMap(6);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
      initialImagery: true,
    });
    ctl.sync();
    expect(sources.osm.setTiles).not.toHaveBeenCalled();
    ctl.dispose();
  });

  it('setImagery is idempotent', () => {
    const { map, sources } = fakeMap(6);
    const ctl = createBasemapThemeController(map as never, {
      initialDark: false,
    });
    ctl.setImagery(true);
    ctl.setImagery(true);
    expect(sources.osm.setTiles).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });
});
