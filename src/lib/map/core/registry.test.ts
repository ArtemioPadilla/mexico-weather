import { afterEach, describe, expect, it } from 'vitest';
import type { BaseLayer, DataSource, Overlay } from './types';
import {
  __clearRegistry,
  __counts,
  getBaseLayer,
  getOverlay,
  getSource,
  listBaseLayers,
  listOverlaysFor,
  register,
  registerBaseLayer,
  registerOverlay,
  registerSource,
} from './registry';

function noop(): void {
  /* intentionally empty */
}

function dummyBase(id: string, partial: Partial<BaseLayer> = {}): BaseLayer {
  return {
    id,
    kind: 'base',
    label: { es: id, en: id },
    icon: '·',
    mount: noop,
    activate: noop,
    deactivate: noop,
    unmount: noop,
    ...partial,
  };
}

function dummyOverlay(
  id: string,
  partial: Partial<Overlay> = {},
): Overlay {
  return {
    id,
    kind: 'overlay',
    label: { es: id, en: id },
    icon: '·',
    shortcut: id[0]?.toUpperCase() ?? 'X',
    availableOn: '*',
    mount: noop,
    enable: noop,
    disable: noop,
    unmount: noop,
    ...partial,
  };
}

describe('registry', () => {
  afterEach(() => {
    __clearRegistry();
  });

  it('starts empty', () => {
    expect(__counts()).toEqual({
      baseLayers: 0,
      overlays: 0,
      sources: 0,
      settings: 0,
    });
  });

  it('registers and looks up base layers', () => {
    registerBaseLayer(dummyBase('temperature'));
    expect(getBaseLayer('temperature')?.id).toBe('temperature');
    expect(listBaseLayers()).toHaveLength(1);
  });

  it('registers and looks up overlays', () => {
    registerOverlay(dummyOverlay('fires'));
    expect(getOverlay('fires')?.id).toBe('fires');
  });

  it('register() dispatches by kind', () => {
    register(dummyBase('radar'));
    register(dummyOverlay('isobars'));
    expect(__counts().baseLayers).toBe(1);
    expect(__counts().overlays).toBe(1);
  });

  it('rejects mis-kinded base layer', () => {
    const bad = { ...dummyBase('x'), kind: 'overlay' } as unknown as BaseLayer;
    expect(() => registerBaseLayer(bad)).toThrow();
  });

  it('rejects mis-kinded overlay', () => {
    const bad = { ...dummyOverlay('x'), kind: 'base' } as unknown as Overlay;
    expect(() => registerOverlay(bad)).toThrow();
  });

  it('is idempotent on id (replaces)', () => {
    registerBaseLayer(dummyBase('temperature', { icon: 'a' }));
    registerBaseLayer(dummyBase('temperature', { icon: 'b' }));
    expect(__counts().baseLayers).toBe(1);
    expect(getBaseLayer('temperature')?.icon).toBe('b');
  });

  it('listOverlaysFor filters by availableOn', () => {
    registerOverlay(dummyOverlay('global', { availableOn: '*' }));
    registerOverlay(
      dummyOverlay('isobars', { availableOn: ['pressure'] }),
    );
    registerOverlay(
      dummyOverlay('coverage', { availableOn: ['radar'] }),
    );

    const onPressure = listOverlaysFor('pressure').map((o) => o.id).sort();
    expect(onPressure).toEqual(['global', 'isobars']);

    const onRadar = listOverlaysFor('radar').map((o) => o.id).sort();
    expect(onRadar).toEqual(['coverage', 'global']);

    const onTemp = listOverlaysFor('temperature').map((o) => o.id).sort();
    expect(onTemp).toEqual(['global']);
  });

  it('registers and resolves data sources', () => {
    const src: DataSource<{ id: string }, { value: number }> = {
      id: 'demo',
      ttl: 60_000,
      attribution: 'demo',
      fetch: async () => ({ value: 42 }),
    };
    registerSource(src as DataSource);
    expect(getSource('demo')?.id).toBe('demo');
  });
});
