/**
 * Crosshair ("mira") mode — Story 18.3, plan PRO_GRATIS E18.
 *
 * On a phone there is no hover, so the per-pixel tooltip never shows.
 * This mode pins a crosshair to the map centre and prints the active
 * layer's value there, refreshed on every pan/zoom and on every
 * timeline frame (the wiring calls refresh() from applyFrame). No
 * fetch involved: it samples the grids already in memory through the
 * same getValueAt() the hover tooltip uses.
 */
import type maplibregl from 'maplibre-gl';

export interface CrosshairDeps {
  /** The map's positioned container (map.getContainer()). */
  container: HTMLElement;
  /** Same sampler as the hover tooltip; null when the layer has none. */
  getValueAt: (lng: number, lat: number) => string | null;
}

export interface Crosshair {
  isEnabled: () => boolean;
  setEnabled: (on: boolean) => void;
  toggle: () => void;
  /** Re-sample at the current centre (after a frame or layer change). */
  refresh: () => void;
}

export const CROSSHAIR_ID = 'mw-crosshair';
export const CROSSHAIR_VALUE_ID = 'mw-crosshair-value';

export function createCrosshair(
  map: maplibregl.Map,
  deps: CrosshairDeps
): Crosshair {
  let enabled = false;
  let mark: HTMLDivElement | null = null;
  let value: HTMLDivElement | null = null;

  function build(): void {
    if (mark) return;
    mark = document.createElement('div');
    mark.id = CROSSHAIR_ID;
    mark.setAttribute('aria-hidden', 'true');
    mark.className =
      'pointer-events-none absolute left-1/2 top-1/2 z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] ' +
      "before:absolute before:left-1/2 before:top-[-9px] before:h-[calc(100%+18px)] before:w-px before:-translate-x-1/2 before:bg-white before:content-[''] " +
      "after:absolute after:top-1/2 after:left-[-9px] after:h-px after:w-[calc(100%+18px)] after:-translate-y-1/2 after:bg-white after:content-['']";
    value = document.createElement('div');
    value.id = CROSSHAIR_VALUE_ID;
    value.setAttribute('role', 'status');
    value.setAttribute('aria-live', 'polite');
    value.className =
      'pointer-events-none absolute left-1/2 top-[calc(50%+1.25rem)] z-20 -translate-x-1/2 whitespace-pre rounded bg-im-bg px-2 py-1 text-center text-sm font-medium leading-tight text-im-text shadow-lg backdrop-blur-sm';
    deps.container.appendChild(mark);
    deps.container.appendChild(value);
  }

  function refresh(): void {
    if (!enabled || !value) return;
    const c = map.getCenter();
    value.textContent = deps.getValueAt(c.lng, c.lat) ?? '—';
  }

  function setEnabled(on: boolean): void {
    if (on === enabled) return;
    enabled = on;
    if (on) {
      build();
      map.on('move', refresh);
      refresh();
    } else {
      map.off('move', refresh);
      mark?.remove();
      value?.remove();
      mark = null;
      value = null;
    }
  }

  return {
    isEnabled: (): boolean => enabled,
    setEnabled,
    toggle: (): void => setEnabled(!enabled),
    refresh,
  };
}
