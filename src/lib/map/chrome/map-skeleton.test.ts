// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAP_READY_CLASS,
  SKELETON_FALLBACK_MS,
  createSkeletonReveal,
  findMapRoot,
  revealsSkeleton,
} from './map-skeleton';

describe('revealsSkeleton', () => {
  it('only a sourcedata event with isSourceLoaded === true reveals', () => {
    expect(revealsSkeleton({ isSourceLoaded: true })).toBe(true);
    expect(revealsSkeleton({ isSourceLoaded: false })).toBe(false);
    expect(revealsSkeleton({})).toBe(false);
    expect(revealsSkeleton({ sourceId: 'osm' })).toBe(false);
  });
});

describe('findMapRoot', () => {
  it('walks up from the MapLibre container to .im-root', () => {
    document.body.innerHTML =
      '<div id="map-root" class="im-root"><div id="map"></div></div>';
    const container = document.getElementById('map');
    expect(findMapRoot(container)?.id).toBe('map-root');
  });

  it('returns the container itself when it is the root, null when detached', () => {
    document.body.innerHTML = '<div id="r" class="im-root"></div>';
    const r = document.getElementById('r');
    expect(findMapRoot(r)).toBe(r);
    expect(findMapRoot(null)).toBeNull();
    expect(findMapRoot(document.createElement('div'))).toBeNull();
  });
});

describe('createSkeletonReveal', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="im-root"></div>';
    root = document.querySelector<HTMLElement>('.im-root')!;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds im-ready on the first LOADED sourcedata, ignores the rest', () => {
    const ctl = createSkeletonReveal(root);
    ctl.onSourceData({ isSourceLoaded: false, sourceId: 'osm' });
    expect(root.classList.contains(MAP_READY_CLASS)).toBe(false);
    expect(ctl.revealed).toBe(false);
    ctl.onSourceData({ isSourceLoaded: true, sourceId: 'osm' });
    expect(root.classList.contains(MAP_READY_CLASS)).toBe(true);
    expect(ctl.revealed).toBe(true);
    ctl.dispose();
  });

  it('reveal() is idempotent and cancels the fallback timer', () => {
    const clearTimeout = vi.fn();
    const ctl = createSkeletonReveal(root, {
      setTimeout: () => 42,
      clearTimeout,
    });
    ctl.reveal();
    ctl.reveal();
    expect(clearTimeout).toHaveBeenCalledTimes(1);
    expect(clearTimeout).toHaveBeenCalledWith(42);
    expect(root.classList.contains(MAP_READY_CLASS)).toBe(true);
  });

  it('falls back after SKELETON_FALLBACK_MS when no tile ever lands', () => {
    const ctl = createSkeletonReveal(root);
    vi.advanceTimersByTime(SKELETON_FALLBACK_MS - 1);
    expect(root.classList.contains(MAP_READY_CLASS)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains(MAP_READY_CLASS)).toBe(true);
    ctl.dispose();
  });

  it('dispose() before the fallback leaves the class alone (map torn down)', () => {
    const ctl = createSkeletonReveal(root);
    ctl.dispose();
    vi.advanceTimersByTime(SKELETON_FALLBACK_MS * 2);
    expect(root.classList.contains(MAP_READY_CLASS)).toBe(false);
  });

  it('a null root is a no-op controller (no timer, no throw)', () => {
    const setTimeout = vi.fn(() => 1);
    const ctl = createSkeletonReveal(null, { setTimeout });
    ctl.onSourceData({ isSourceLoaded: true });
    ctl.reveal();
    ctl.dispose();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(ctl.revealed).toBe(true);
  });

  it('SKELETON_FALLBACK_MS is a sane ceiling (5–15 s)', () => {
    expect(SKELETON_FALLBACK_MS).toBeGreaterThanOrEqual(5000);
    expect(SKELETON_FALLBACK_MS).toBeLessThanOrEqual(15000);
  });
});
