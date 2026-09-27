// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type maplibregl from 'maplibre-gl';
import { CROSSHAIR_ID, CROSSHAIR_VALUE_ID, createCrosshair } from './crosshair';

function fakeMap(center: { lng: number; lat: number }) {
  const handlers = new Map<string, Set<() => void>>();
  const map = {
    getCenter: () => center,
    on: (ev: string, fn: () => void) => {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(fn);
    },
    off: (ev: string, fn: () => void) => handlers.get(ev)?.delete(fn),
    fire: (ev: string) => handlers.get(ev)?.forEach((fn) => fn()),
  };
  return {
    map: map as unknown as maplibregl.Map & { fire: (ev: string) => void },
    handlers,
  };
}

describe('crosshair mode (Story 18.3)', () => {
  it('mounts a centred mark + readout, follows the map centre and unmounts cleanly', () => {
    const container = document.createElement('div');
    const center = { lng: -99.1, lat: 19.4 };
    const { map, handlers } = fakeMap(center);
    let sampled: [number, number] | null = null;
    const ch = createCrosshair(map, {
      container,
      getValueAt: (lng, lat) => {
        sampled = [lng, lat];
        return `🌡 ${Math.round(lat)}°`;
      },
    });
    expect(ch.isEnabled()).toBe(false);
    ch.setEnabled(true);
    expect(container.querySelector(`#${CROSSHAIR_ID}`)).not.toBeNull();
    const readout = container.querySelector(`#${CROSSHAIR_VALUE_ID}`)!;
    expect(readout.textContent).toBe('🌡 19°');
    expect(sampled).toEqual([-99.1, 19.4]);
    center.lat = 25.7;
    map.fire('move');
    expect(readout.textContent).toBe('🌡 26°');
    expect(handlers.get('move')?.size).toBe(1);
    ch.toggle();
    expect(ch.isEnabled()).toBe(false);
    expect(container.querySelector(`#${CROSSHAIR_ID}`)).toBeNull();
    expect(handlers.get('move')?.size).toBe(0);
  });

  it('prints a dash when the active layer has no value', () => {
    const container = document.createElement('div');
    const { map } = fakeMap({ lng: 0, lat: 0 });
    const ch = createCrosshair(map, { container, getValueAt: () => null });
    ch.setEnabled(true);
    expect(container.querySelector(`#${CROSSHAIR_VALUE_ID}`)?.textContent).toBe(
      '—'
    );
  });
});
