import { describe, it, expect } from 'vitest';
import { LAYERS, LAYER_IDS, getLayer, RADAR_LEGEND } from './maplayers';

describe('layer registry', () => {
  it('exposes base and radar layers with stable ids', () => {
    expect(LAYER_IDS).toEqual(['base', 'radar']);
    expect(LAYERS.map((l) => l.id)).toEqual(['base', 'radar']);
  });

  it('base is kind "base", radar is a raster-tile with <1 default opacity', () => {
    const base = getLayer('base');
    const radar = getLayer('radar');
    expect(base?.kind).toBe('base');
    expect(base?.defaultOpacity).toBe(1);
    expect(radar?.kind).toBe('raster-tile');
    expect(radar?.labelKey).toBe('map_layer_radar');
    expect(radar?.defaultOpacity).toBeGreaterThan(0);
    expect(radar?.defaultOpacity).toBeLessThanOrEqual(1);
  });

  it('getLayer returns undefined for an unknown id', () => {
    expect(getLayer('bogus')).toBeUndefined();
  });
});

describe('RADAR_LEGEND', () => {
  it('has light/moderate/heavy/snow stops with hex colors and i18n keys', () => {
    expect(RADAR_LEGEND.map((s) => s.labelKey)).toEqual([
      'legend_light',
      'legend_moderate',
      'legend_heavy',
      'legend_snow',
    ]);
    for (const stop of RADAR_LEGEND) {
      expect(stop.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
