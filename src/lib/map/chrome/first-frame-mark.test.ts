import { describe, expect, it } from 'vitest';
import {
  FIRST_SATELLITE_FRAME_MARK,
  completesSatelliteFrame,
  createFirstFrameMark,
  type MarkPerformance,
} from './first-frame-mark';

const IDS = ['wx-raster', 'wx-raster-b'] as const;
const TILE = { tileID: {} };

function fakePerf(): MarkPerformance & { marks: string[] } {
  const marks: string[] = [];
  return {
    marks,
    mark: (name: string) => {
      marks.push(name);
    },
    getEntriesByName: (name: string) => marks.filter((m) => m === name),
  };
}

describe('completesSatelliteFrame', () => {
  const loaded = { sourceId: 'wx-raster', isSourceLoaded: true, tile: TILE };

  it('accepts a loaded tile of either A/B slot on satellite', () => {
    expect(completesSatelliteFrame(loaded, 'satellite', IDS)).toBe(true);
    expect(
      completesSatelliteFrame(
        { ...loaded, sourceId: 'wx-raster-b' },
        'satellite',
        IDS
      )
    ).toBe(true);
  });

  it('rejects radar, other sources, pending tiles and tile-less events', () => {
    expect(completesSatelliteFrame(loaded, 'radar', IDS)).toBe(false);
    expect(
      completesSatelliteFrame({ ...loaded, sourceId: 'osm' }, 'satellite', IDS)
    ).toBe(false);
    expect(
      completesSatelliteFrame(
        { ...loaded, isSourceLoaded: false },
        'satellite',
        IDS
      )
    ).toBe(false);
    expect(
      completesSatelliteFrame(
        { sourceId: 'wx-raster', isSourceLoaded: true },
        'satellite',
        IDS
      )
    ).toBe(false);
    expect(
      completesSatelliteFrame(
        { ...loaded, sourceDataType: 'metadata' },
        'satellite',
        IDS
      )
    ).toBe(false);
  });
});

describe('createFirstFrameMark', () => {
  it('marks once, on the first completed satellite frame', () => {
    const perf = fakePerf();
    let layer = 'base';
    const m = createFirstFrameMark({
      sourceIds: IDS,
      getActiveLayer: () => layer,
      perf,
    });
    const e = { sourceId: 'wx-raster', isSourceLoaded: true, tile: TILE };
    expect(m.onSourceData(e)).toBe(false);
    layer = 'satellite';
    expect(m.onSourceData({ ...e, isSourceLoaded: false })).toBe(false);
    expect(m.marked).toBe(false);
    expect(m.onSourceData(e)).toBe(true);
    expect(m.onSourceData(e)).toBe(false);
    expect(perf.marks).toEqual([FIRST_SATELLITE_FRAME_MARK]);
    expect(m.marked).toBe(true);
  });

  it('never overwrites a mark already in the document', () => {
    const perf = fakePerf();
    perf.mark(FIRST_SATELLITE_FRAME_MARK);
    const m = createFirstFrameMark({
      sourceIds: IDS,
      getActiveLayer: () => 'satellite',
      perf,
    });
    expect(
      m.onSourceData({
        sourceId: 'wx-raster',
        isSourceLoaded: true,
        tile: TILE,
      })
    ).toBe(false);
    expect(perf.marks).toHaveLength(1);
  });

  it('is a no-op without User Timing or when mark() throws', () => {
    const e = { sourceId: 'wx-raster', isSourceLoaded: true, tile: TILE };
    const none = createFirstFrameMark({
      sourceIds: IDS,
      getActiveLayer: () => 'satellite',
      perf: null,
    });
    expect(none.onSourceData(e)).toBe(false);
    const throwing = createFirstFrameMark({
      sourceIds: IDS,
      getActiveLayer: () => 'satellite',
      perf: {
        mark: () => {
          throw new Error('nope');
        },
        getEntriesByName: () => [],
      },
    });
    expect(() => throwing.onSourceData(e)).not.toThrow();
    expect(throwing.onSourceData(e)).toBe(false);
  });
});
