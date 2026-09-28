import { describe, expect, it, vi } from 'vitest';
import {
  BOOT_AUTOPLAY_TILE_WAIT_MS,
  BOOT_LOOP_HOURS,
  bootActivationAllowed,
  bootLoopHours,
  readSaveData,
  shouldBootAutoplay,
  whenSourceLoaded,
  type SourceDataEventLike,
  type SourceLoadWatchable,
} from './boot-autoplay';

const ok = {
  layerId: 'satellite',
  frameCount: 144,
  seekIso: null,
  reducedMotion: false,
  saveData: false,
};

describe('shouldBootAutoplay', () => {
  it('plays for satellite with frames, no seek, motion and data allowed', () => {
    expect(shouldBootAutoplay(ok)).toBe(true);
  });

  it('never plays another layer (radar fallback stays static)', () => {
    expect(shouldBootAutoplay({ ...ok, layerId: 'radar' })).toBe(false);
    expect(shouldBootAutoplay({ ...ok, layerId: 'base' })).toBe(false);
    expect(shouldBootAutoplay({ ...ok, layerId: null })).toBe(false);
  });

  it('respects reduced motion, data saver, a shared instant and <2 frames', () => {
    expect(shouldBootAutoplay({ ...ok, reducedMotion: true })).toBe(false);
    expect(shouldBootAutoplay({ ...ok, saveData: true })).toBe(false);
    expect(shouldBootAutoplay({ ...ok, seekIso: '2026-09-27T12:00:00Z' })).toBe(
      false
    );
    expect(shouldBootAutoplay({ ...ok, frameCount: 1 })).toBe(false);
    expect(shouldBootAutoplay({ ...ok, frameCount: 0 })).toBe(false);
  });
});

describe('readSaveData', () => {
  it('is true only for connection.saveData === true', () => {
    expect(readSaveData({ connection: { saveData: true } })).toBe(true);
    expect(readSaveData({ connection: { saveData: false } })).toBe(false);
    expect(readSaveData({ connection: { saveData: 'yes' } })).toBe(false);
    expect(readSaveData({ connection: {} })).toBe(false);
    expect(readSaveData({})).toBe(false);
    expect(readSaveData(null)).toBe(false);
    expect(readSaveData(undefined)).toBe(false);
  });
});

describe('bootLoopHours', () => {
  it('is 3 h when nothing is stored or the record has no loopHours', () => {
    expect(BOOT_LOOP_HOURS).toBe(3);
    expect(bootLoopHours(null)).toBe(3);
    expect(bootLoopHours('')).toBe(3);
    expect(bootLoopHours('{"tz":"UTC"}')).toBe(3);
    expect(bootLoopHours('{"loopHours":5}')).toBe(3);
    expect(bootLoopHours('not json')).toBe(3);
    expect(bootLoopHours('[1,2]')).toBe(3);
  });

  it('lets a stored user choice win, including the 24 h default written back', () => {
    expect(bootLoopHours('{"loopHours":6}')).toBe(6);
    expect(bootLoopHours('{"loopHours":"12"}')).toBe(12);
    expect(bootLoopHours('{"loopHours":24}')).toBe(24);
    expect(bootLoopHours('{"loopHours":3}')).toBe(3);
  });
});

function fakeMap(loaded: Record<string, boolean> = {}) {
  const listeners = new Set<(e: SourceDataEventLike) => void>();
  const map: SourceLoadWatchable = {
    on: (_t, fn) => listeners.add(fn),
    off: (_t, fn) => listeners.delete(fn),
    getSource: (id) => (id in loaded ? { id } : undefined),
    isSourceLoaded: (id) => loaded[id] === true,
  };
  return {
    map,
    fire: (e: SourceDataEventLike) => listeners.forEach((fn) => fn(e)),
    listenerCount: () => listeners.size,
  };
}

describe('whenSourceLoaded', () => {
  it('resolves at once when the source is already loaded', async () => {
    const { map, listenerCount } = fakeMap({ 'wx-raster': true });
    await expect(whenSourceLoaded(map, 'wx-raster')).resolves.toBe('loaded');
    expect(listenerCount()).toBe(0);
  });

  it('waits for the matching sourcedata and detaches', async () => {
    const { map, fire, listenerCount } = fakeMap({ 'wx-raster': false });
    const clear = vi.fn();
    const p = whenSourceLoaded(map, 'wx-raster', {
      setTimeout: () => 7,
      clearTimeout: clear,
    });
    expect(listenerCount()).toBe(1);
    fire({ sourceId: 'osm', isSourceLoaded: true }); // another source
    fire({ sourceId: 'wx-raster', isSourceLoaded: false }); // not yet
    fire({ sourceId: 'wx-raster', isSourceLoaded: true });
    await expect(p).resolves.toBe('loaded');
    expect(listenerCount()).toBe(0);
    expect(clear).toHaveBeenCalledWith(7);
  });

  it('gives up after the cap (default 4 s) and detaches', async () => {
    const { map, listenerCount } = fakeMap();
    let scheduled: { fn: () => void; ms: number } | null = null;
    const p = whenSourceLoaded(map, 'wx-raster', {
      setTimeout: (fn, ms) => {
        scheduled = { fn, ms };
        return 1;
      },
      clearTimeout: () => {},
    });
    expect(scheduled!.ms).toBe(BOOT_AUTOPLAY_TILE_WAIT_MS);
    scheduled!.fn();
    await expect(p).resolves.toBe('timeout');
    expect(listenerCount()).toBe(0);
  });

  it('treats a throwing isSourceLoaded as not loaded', async () => {
    const { map, fire } = fakeMap({ 'wx-raster': false });
    map.isSourceLoaded = () => {
      throw new Error('no source');
    };
    const p = whenSourceLoaded(map, 'wx-raster', {
      setTimeout: () => 1,
      clearTimeout: () => {},
    });
    fire({ sourceId: 'wx-raster', isSourceLoaded: true });
    await expect(p).resolves.toBe('loaded');
  });
});

describe('bootActivationAllowed', () => {
  const untouched = {
    userPickedLayer: false,
    activeLayer: 'base',
    wanted: 'satellite',
  };

  it('allows the boot on an untouched map', () => {
    expect(bootActivationAllowed(untouched)).toBe(true);
  });

  it('allows a retry when the first iteration already set the wanted layer', () => {
    expect(
      bootActivationAllowed({ ...untouched, activeLayer: 'satellite' })
    ).toBe(true);
  });

  it('bails once the visitor picked a layer, whatever is active', () => {
    // Field layers set activeLayer only after their grid lands: the flag
    // is what protects a click whose fetch is still in flight.
    expect(bootActivationAllowed({ ...untouched, userPickedLayer: true })).toBe(
      false
    );
    expect(
      bootActivationAllowed({
        ...untouched,
        userPickedLayer: true,
        activeLayer: 'temperature',
      })
    ).toBe(false);
    // A pick that failed and fell to base is still the visitor's choice.
    expect(
      bootActivationAllowed({
        ...untouched,
        userPickedLayer: true,
        activeLayer: 'base',
      })
    ).toBe(false);
    // Even when they picked exactly what the boot wanted: no boot autoplay.
    expect(
      bootActivationAllowed({
        ...untouched,
        userPickedLayer: true,
        activeLayer: 'satellite',
      })
    ).toBe(false);
  });

  it('bails when another layer is active even without the flag', () => {
    expect(
      bootActivationAllowed({ ...untouched, activeLayer: 'temperature' })
    ).toBe(false);
    expect(bootActivationAllowed({ ...untouched, activeLayer: 'radar' })).toBe(
      false
    );
    expect(
      bootActivationAllowed({
        ...untouched,
        activeLayer: 'radar',
        wanted: 'radar',
      })
    ).toBe(true);
  });
});
