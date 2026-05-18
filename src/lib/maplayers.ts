// Pure, DOM-free weather-map layer registry + legend data.
// Single source of truth for valid layer ids (consumed by maphash.ts).

export type LayerId = 'base' | 'radar';

export const LAYER_IDS = ['base', 'radar'] as const;

export interface LayerDef {
  id: LayerId;
  /** Key into UiStrings for the rail button label. */
  labelKey: string;
  kind: 'base' | 'raster-tile';
  /** Initial raster opacity (0..1); 1 for the base map. */
  defaultOpacity: number;
}

export const LAYERS: LayerDef[] = [
  { id: 'base', labelKey: 'map_layer_base', kind: 'base', defaultOpacity: 1 },
  { id: 'radar', labelKey: 'map_layer_radar', kind: 'raster-tile', defaultOpacity: 0.8 },
];

export function getLayer(id: string): LayerDef | undefined {
  return LAYERS.find((l) => l.id === id);
}

export interface LegendStop {
  /** Key into UiStrings for the stop label. */
  labelKey: string;
  /** Representative hex color, illustrative of the RainViewer palette. */
  color: string;
}

export const RADAR_LEGEND: LegendStop[] = [
  { labelKey: 'legend_light', color: '#7ad151' },
  { labelKey: 'legend_moderate', color: '#f9d423' },
  { labelKey: 'legend_heavy', color: '#e8431f' },
  { labelKey: 'legend_snow', color: '#9fd9ff' },
];
