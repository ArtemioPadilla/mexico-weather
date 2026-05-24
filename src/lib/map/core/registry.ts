/**
 * Plugin registry — single source of truth for what the map can do.
 *
 * Plugins (base layers, overlays, data sources, settings controls) register
 * themselves once at module init. The UI (layer rail, overlay menu, settings
 * panel, keyboard handler, hash serializer) all enumerate the registry rather
 * than hard-coding feature lists.
 *
 * Registration is idempotent on id: re-registering replaces. This lets HMR
 * during dev re-evaluate plugin files without throwing.
 */

import type {
  BaseLayer,
  DataSource,
  MapPlugin,
  Overlay,
  SettingsControl,
} from './types';

interface RegistryState {
  baseLayers: Map<string, BaseLayer>;
  overlays: Map<string, Overlay>;
  sources: Map<string, DataSource>;
  settings: Map<string, SettingsControl>;
}

function emptyState(): RegistryState {
  return {
    baseLayers: new Map(),
    overlays: new Map(),
    sources: new Map(),
    settings: new Map(),
  };
}

const state: RegistryState = emptyState();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBaseLayer(layer: BaseLayer): void {
  if (layer.kind !== 'base') {
    throw new Error(
      `registerBaseLayer: '${layer.id}' has kind '${layer.kind}', expected 'base'`,
    );
  }
  state.baseLayers.set(layer.id, layer);
}

export function registerOverlay(overlay: Overlay): void {
  if (overlay.kind !== 'overlay') {
    throw new Error(
      `registerOverlay: '${overlay.id}' has kind '${overlay.kind}', expected 'overlay'`,
    );
  }
  state.overlays.set(overlay.id, overlay);
}

export function registerSource(source: DataSource): void {
  state.sources.set(source.id, source);
}

export function registerSettings(control: SettingsControl): void {
  state.settings.set(control.id, control);
}

/** Convenience: accept any plugin and dispatch by kind. */
export function register(plugin: MapPlugin): void {
  if (plugin.kind === 'base') registerBaseLayer(plugin);
  else if (plugin.kind === 'overlay') registerOverlay(plugin);
  else {
    const exhaustive: never = plugin;
    throw new Error(`register: unknown plugin kind: ${JSON.stringify(exhaustive)}`);
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getBaseLayer(id: string): BaseLayer | undefined {
  return state.baseLayers.get(id);
}

export function getOverlay(id: string): Overlay | undefined {
  return state.overlays.get(id);
}

export function getSource<T extends DataSource = DataSource>(
  id: string,
): T | undefined {
  return state.sources.get(id) as T | undefined;
}

export function getSettingsControl(id: string): SettingsControl | undefined {
  return state.settings.get(id);
}

// ---------------------------------------------------------------------------
// Enumeration (used by UI)
// ---------------------------------------------------------------------------

export function listBaseLayers(): readonly BaseLayer[] {
  return Array.from(state.baseLayers.values());
}

export function listOverlays(): readonly Overlay[] {
  return Array.from(state.overlays.values());
}

/**
 * List overlays compatible with the given base layer id. An overlay is
 * compatible when `availableOn === '*'` or includes the base id.
 */
export function listOverlaysFor(baseLayerId: string): readonly Overlay[] {
  return listOverlays().filter(
    (o) => o.availableOn === '*' || o.availableOn.includes(baseLayerId),
  );
}

export function listSources(): readonly DataSource[] {
  return Array.from(state.sources.values());
}

export function listSettings(): readonly SettingsControl[] {
  return Array.from(state.settings.values());
}

// ---------------------------------------------------------------------------
// Test / dev helpers — NOT for production use
// ---------------------------------------------------------------------------

/**
 * Clear all registrations. Only used by unit tests; calling this in
 * production will tear down the live map.
 */
export function __clearRegistry(): void {
  state.baseLayers.clear();
  state.overlays.clear();
  state.sources.clear();
  state.settings.clear();
}

/** Snapshot of registration counts — useful for debugging. */
export function __counts(): Readonly<Record<keyof RegistryState, number>> {
  return {
    baseLayers: state.baseLayers.size,
    overlays: state.overlays.size,
    sources: state.sources.size,
    settings: state.settings.size,
  };
}
