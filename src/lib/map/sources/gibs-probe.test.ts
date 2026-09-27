import { describe, expect, it, vi } from 'vitest';
import {
  GIBS_PROBE_TILE,
  GIBS_PROBE_TIMEOUT_MS,
  bootLayerAfterProbe,
  gibsProbeUrl,
  probeGibs,
} from './gibs-probe';
import { GIBS_LAYERS, gibsLatestTime } from './nasa-gibs';

describe('gibsProbeUrl', () => {
  it('is the GeoColor Level7 tile over central Mexico at the newest frame', () => {
    const now = new Date('2026-09-27T15:04:00Z');
    const url = gibsProbeUrl(GIBS_LAYERS.goesGeocolor, now);
    expect(url).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/' +
        `${gibsLatestTime(now)}/GoogleMapsCompatible_Level7/` +
        `${GIBS_PROBE_TILE.z}/${GIBS_PROBE_TILE.y}/${GIBS_PROBE_TILE.x}.png`
    );
    expect(url).toContain('/2026-09-27T14:30:00Z/');
    expect(url).not.toMatch(/[{}]/);
  });
});

describe('probeGibs', () => {
  const noTimers = { setTimeout: () => 1, clearTimeout: () => {} };

  it('ok on a 2xx, down on an HTTP error, down on a failed fetch', async () => {
    const f200 = vi.fn(async () => new Response('', { status: 200 }));
    expect(await probeGibs(f200, { url: 'u', ...noTimers })).toBe('ok');
    expect(f200).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({ method: 'GET', mode: 'cors' })
    );
    const f503 = async () => new Response('', { status: 503 });
    expect(await probeGibs(f503, { url: 'u', ...noTimers })).toBe('down');
    const f404 = async () => new Response('', { status: 404 });
    expect(await probeGibs(f404, { url: 'u', ...noTimers })).toBe('down');
    const fThrow = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await probeGibs(fThrow, { url: 'u', ...noTimers })).toBe('down');
  });

  it('unknown when the timeout aborts the request; timer always cleared', async () => {
    let fire: (() => void) | null = null;
    const clear = vi.fn();
    const hanging = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    const p = probeGibs(hanging, {
      url: 'u',
      setTimeout: (fn, ms) => {
        expect(ms).toBe(GIBS_PROBE_TIMEOUT_MS);
        fire = fn;
        return 9;
      },
      clearTimeout: clear,
    });
    fire!();
    expect(await p).toBe('unknown');
    expect(clear).toHaveBeenCalledWith(9);
  });
});

describe('bootLayerAfterProbe', () => {
  it('passes non-satellite layers through', () => {
    expect(bootLayerAfterProbe('radar', 'down', true)).toBe('radar');
    expect(bootLayerAfterProbe('temperature', 'down', false)).toBe(
      'temperature'
    );
    expect(bootLayerAfterProbe(null, 'down', true)).toBeNull();
    expect(bootLayerAfterProbe('base', 'ok', true)).toBe('base');
  });

  it('keeps satellite on ok and unknown, falls to radar then base on down', () => {
    expect(bootLayerAfterProbe('satellite', 'ok', false)).toBe('satellite');
    expect(bootLayerAfterProbe('satellite', 'unknown', false)).toBe(
      'satellite'
    );
    expect(bootLayerAfterProbe('satellite', 'down', true)).toBe('radar');
    expect(bootLayerAfterProbe('satellite', 'down', false)).toBe('base');
  });
});
