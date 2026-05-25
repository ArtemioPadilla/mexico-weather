import { describe, expect, it } from 'vitest';
import {
  CARTO_DARK_NOLABELS,
  CARTO_DARK_TILES,
  CARTO_LIGHT_NOLABELS,
  LABEL_ZOOM_THRESHOLD,
  OSM_TILES,
  pickBasemapTiles,
} from './basemap-theme';

describe('pickBasemapTiles', () => {
  it('dark + dense → dark_all', () => {
    expect(pickBasemapTiles(true, true)).toBe(CARTO_DARK_TILES);
  });

  it('dark + !dense → dark_nolabels (P2.5 low-zoom)', () => {
    expect(pickBasemapTiles(true, false)).toBe(CARTO_DARK_NOLABELS);
  });

  it('light + dense → OSM', () => {
    expect(pickBasemapTiles(false, true)).toBe(OSM_TILES);
  });

  it('light + !dense → CARTO voyager_nolabels', () => {
    expect(pickBasemapTiles(false, false)).toBe(CARTO_LIGHT_NOLABELS);
  });

  it('LABEL_ZOOM_THRESHOLD is 5 (matches plan P2.5)', () => {
    expect(LABEL_ZOOM_THRESHOLD).toBe(5);
  });
});
