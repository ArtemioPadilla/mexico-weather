/**
 * Map subsystem plugin types.
 *
 * The map is built around a registry of plugins of four kinds:
 * - {@link BaseLayer}: mutually-exclusive map layers (radar, temperature, …).
 *   Exactly one is active at a time.
 * - {@link Overlay}: combinable toggles that paint on top of any compatible
 *   base layer (fires, tropical storms, isobars, …). N may be active.
 * - {@link DataSource}: fetchers for upstream APIs (Open-Meteo, RainViewer,
 *   NASA FIRMS, …). Sources are pure functions with cache + coalescing.
 * - {@link SettingsControl}: declarative settings panel entries (timezone,
 *   units, hour format, …) bound to {@link MapState} keys.
 *
 * See `docs/ARCHITECTURE.md` for the full design.
 */

import type maplibregl from 'maplibre-gl';

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

export interface I18nString {
  es: string;
  en: string;
}

// ---------------------------------------------------------------------------
// Frame / timeline
// ---------------------------------------------------------------------------

export interface Frame {
  /** ISO 8601 UTC timestamp. */
  time: string;
  /** Provider-defined key (e.g. RainViewer path, GIBS time string). */
  key: string;
  /** Whether this frame is past observation or model forecast. */
  kind: 'past' | 'nowcast' | 'forecast';
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export interface LegendStop {
  /** Display value, e.g. "≤0°", "1014 hPa", "Intensa". */
  label: string;
  /** CSS color string. */
  color: string;
}

// ---------------------------------------------------------------------------
// Sub-options (Temperatura → Actual/Aparente; Viento → Velocidad/Rachas)
// ---------------------------------------------------------------------------

export interface SubOption {
  /** Stable id used in URL hash, e.g. 'actual', 'aparente'. */
  id: string;
  label: I18nString;
  /** Provider-specific param this sub-option resolves to, e.g.
   *  `temperature_2m` vs `apparent_temperature` on Open-Meteo. */
  paramHint?: string;
}

// ---------------------------------------------------------------------------
// Plugin context — passed to every lifecycle hook
// ---------------------------------------------------------------------------

export interface MapPluginContext {
  /** The MapLibre instance. */
  map: maplibregl.Map;
  /** Reactive state store; plugins read via `store.get()` and react via
   *  `store.subscribe(fn)`. */
  store: MapStore;
  /** Typed event bus for non-state signals (e.g. tile-load-failed). */
  events: EventBus;
  /** Translated UI strings. The active language is on `store.get().lang`. */
  i18n: { es: I18n; en: I18n };
  /** Typed resolver for registered data sources. */
  source: <T = unknown>(id: string) => DataSource<unknown, T>;
}

/** Minimal i18n bag. Subset duplicated to avoid coupling to `src/i18n/ui.ts`. */
export interface I18n {
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// BaseLayer
// ---------------------------------------------------------------------------

export interface BaseLayer {
  id: string;
  kind: 'base';
  label: I18nString;
  /** Emoji or SVG path string for the layer rail. */
  icon: string;
  /** Single uppercase letter for keyboard activation, e.g. 'T'. */
  shortcut?: string;

  /** Optional sub-options (Actual/Aparente etc.). */
  subOptions?: readonly SubOption[];
  defaultSubOption?: string;

  /** Which overlays may stack on this base; '*' means all registered. */
  compatibleOverlays?: '*' | readonly string[];

  // -------- Lifecycle --------

  /** Create sources + layers; called once when the map is ready. */
  mount(ctx: MapPluginContext): Promise<void> | void;

  /** Make this layer the active base. Other base layers receive
   *  `deactivate()` before this fires. */
  activate(
    ctx: MapPluginContext,
    opts: { sub?: string; frame?: Frame },
  ): Promise<void> | void;

  /** Hide / pause work; another base is taking over. Sources stay mounted
   *  so re-activation is cheap. */
  deactivate(ctx: MapPluginContext): void;

  /** Tear down everything (only at map disposal). */
  unmount(ctx: MapPluginContext): void;

  // -------- Optional capabilities --------

  /** Return formatted value at the cursor (e.g. "25°", "1014 hPa") for
   *  the hover tooltip. Return null if no value at that point. */
  tooltipValueAt?(
    lng: number,
    lat: number,
    frame?: Frame,
  ): string | null;

  /** Color ramp displayed in the legend panel. */
  legend?(): readonly LegendStop[];

  /** If the layer supports a timeline scrubber, return available frames. */
  frames?(): Promise<readonly Frame[]>;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export interface Overlay {
  id: string;
  kind: 'overlay';
  label: I18nString;
  icon: string;
  shortcut: string;

  /** Which base layers this overlay applies to. `'*'` means all.
   *  e.g. `['radar']` for "Cobertura de radar", `['pressure']` for isobars. */
  availableOn: '*' | readonly string[];

  /** Whether this overlay is enabled by default the first time its base
   *  layer becomes active. Used for city-value pills on field layers. */
  defaultEnabled?: boolean;

  // -------- Lifecycle --------

  /** Create sources + layers; called once at map ready. The overlay should
   *  start hidden — `enable()` reveals it. */
  mount(ctx: MapPluginContext): Promise<void> | void;

  /** Reveal + start any animation / refresh data. */
  enable(ctx: MapPluginContext): Promise<void> | void;

  /** Hide + pause. Sources and layers stay around for cheap re-enable. */
  disable(ctx: MapPluginContext): void;

  /** Tear down (only at map disposal). */
  unmount(ctx: MapPluginContext): void;
}

// ---------------------------------------------------------------------------
// DataSource
// ---------------------------------------------------------------------------

export interface DataSource<TParams = unknown, TResult = unknown> {
  id: string;
  /** Cache lifetime in milliseconds. After expiry the next fetch hits the
   *  network. In-flight duplicate calls coalesce within TTL. */
  ttl: number;
  /** Attribution string for the legend / footer. */
  attribution: string;

  fetch(params: TParams, signal?: AbortSignal): Promise<TResult>;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SettingsSection =
  | 'horaria'
  | 'unidades'
  | 'personalizacion'
  | 'cuenta';

export interface SettingsControl<K extends keyof MapState['settings'] =
  keyof MapState['settings']> {
  id: string;
  section: SettingsSection;
  label: I18nString;
  type: 'toggle' | 'segmented' | 'select';
  shortcut?: string;
  /** Key inside `state.settings` this control reads/writes. */
  bind: K;
  /** For segmented/select controls — the available values. */
  options?: readonly {
    value: MapState['settings'][K];
    label: I18nString;
  }[];
}

// ---------------------------------------------------------------------------
// MapState — single source of truth, serialized to URL + localStorage
// ---------------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark' | 'system';
export type TempUnit = 'C' | 'F';
export type WindUnit = 'km/h' | 'mph' | 'kt' | 'm/s';
export type PressureUnit = 'hPa' | 'inHg' | 'mmHg';

export interface MapState {
  /** Active base layer id. Always exactly one. */
  baseLayerId: string;
  /** Active sub-option id within the base, if any. */
  subOptionId?: string;
  /** Set of enabled overlay ids. */
  enabledOverlays: ReadonlySet<string>;

  /** Camera. */
  view: { lng: number; lat: number; zoom: number };

  /** Active timeline frame, if any. */
  frame: Frame | null;

  /** Theme preference (system means follow OS). */
  theme: ThemeMode;

  /** UI language. */
  lang: 'es' | 'en';

  /** User-tweakable settings. Persisted to localStorage. */
  settings: {
    tz: 'local' | 'UTC';
    hourFormat: '12' | '24';
    timeControl: 'timeline' | 'clock';
    summaryGranularity: 'daily' | 'hourly';
    uiOpacity: 'translucent' | 'opaque';
    units: {
      temp: TempUnit;
      wind: WindUnit;
      pressure: PressureUnit;
    };
  };
}

export interface MapStore {
  /** Read current state. */
  get(): MapState;
  /** Merge a patch and notify subscribers. */
  set(patch: Partial<MapState>): void;
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(
    fn: (state: MapState, prev: MapState) => void,
  ): () => void;

  /** Convenience setters that emit the right events for plugins. */
  setBaseLayer(id: string, sub?: string): void;
  toggleOverlay(id: string): void;
  enableOverlay(id: string): void;
  disableOverlay(id: string): void;
  setView(view: MapState['view']): void;
  setFrame(frame: Frame | null): void;
}

// ---------------------------------------------------------------------------
// EventBus — typed pub/sub for non-state signals
// ---------------------------------------------------------------------------

/**
 * Events fired by the map subsystem. Plugins emit; UI / other plugins listen.
 * State changes belong on {@link MapStore}, not here.
 */
export interface MapEvents {
  /** A tile fetch failed. UI may show a toast. */
  'tile-error': { source: string; url: string; status?: number };
  /** A click on the map (lng/lat). Used by the place-popup overlay. */
  'map-click': { lng: number; lat: number };
  /** Cursor moved on the map (already throttled). */
  'cursor-move': { lng: number; lat: number };
  /** A data source's fetch completed with non-empty data. */
  'source-data': { sourceId: string };
  /** A plugin failed to mount/activate. */
  'plugin-error': { pluginId: string; error: Error };
}

export interface EventBus {
  on<K extends keyof MapEvents>(
    event: K,
    fn: (payload: MapEvents[K]) => void,
  ): () => void;
  emit<K extends keyof MapEvents>(event: K, payload: MapEvents[K]): void;
}

// ---------------------------------------------------------------------------
// Plugin = discriminated union for the registry
// ---------------------------------------------------------------------------

export type MapPlugin = BaseLayer | Overlay;
