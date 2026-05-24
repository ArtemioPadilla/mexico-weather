# Map subsystem architecture

Status: **proposed** · Target: `src/lib/map/`

## Why

`src/lib/interactive-map.ts` is ~2200 lines and growing. Every new feature (overlay, sub-option, settings toggle, keyboard shortcut, new data source) touches multiple places and risks regressions in unrelated layers. Adding a feature like "isobars" or "city value pills" today costs ~3–4 h of careful surgery; with the architecture below, it's ~1 h of writing one isolated file.

Goal: make the map a **plugin registry** where each capability is a self-contained module with a declarative interface. The UI, URL hash, keyboard shortcuts, and settings panel all enumerate the registry rather than hard-coding feature lists.

## Principles

1. **One feature = one file.** Adding fires or isobars never edits `interactive-map.ts`.
2. **Registry is the single source of truth.** Layer rail, shortcuts, hash serializer, settings panel — all read from the registry.
3. **Four plugin kinds**: `BaseLayer` (mutually exclusive), `Overlay` (N at a time, combinable), `DataSource` (data providers), `Control` (UI buttons).
4. **Centralized reactive state.** One `MapStore` that serializes to URL hash + localStorage. The UI subscribes; plugins emit.
5. **Migration is incremental.** Each phase ships independently; nothing breaks.

## Layered structure

```
┌────────────────────────────────────────────────────────────────┐
│  index.ts (façade) — initInteractiveMap(opts) — public API     │
└────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  CORE        │      │  PLUGINS     │      │  UI          │
│  - Registry  │◀────▶│  - BaseLayers│      │  - LayerRail │
│  - Store     │      │  - Overlays  │      │  - Timeline  │
│  - Events    │      │              │      │  - Tooltip   │
│  - Hash      │      │  Each one    │      │  - Settings  │
│  - Shortcuts │      │  registers   │      │  - PlacePopup│
│  - Theme     │      │  via API     │      │              │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                      │
       │              ┌──────▼───────┐              │
       │              │  SOURCES     │              │
       │              │  - OpenMeteo │              │
       │              │  - RainViewer│              │
       │              │  - NASA GIBS │              │
       │              │  - NHC       │              │
       │              │  - FIRMS     │              │
       │              └──────┬───────┘              │
       │                     │                      │
       └───── MapLibre ◀─────┴──────────────────────┘
```

## Directory layout

```
src/lib/map/
├── index.ts                       # initInteractiveMap façade (~80 LOC)
│
├── core/
│   ├── types.ts                   # BaseLayer | Overlay | DataSource | Control
│   ├── registry.ts                # singleton, register/list/get
│   ├── store.ts                   # vanilla reactive store + persistence
│   ├── events.ts                  # typed EventEmitter
│   ├── hash.ts                    # URL ↔ store serialization
│   ├── shortcuts.ts               # generic keyboard binder
│   ├── theme.ts                   # dark/light/system observer
│   └── fetch.ts                   # cachedFetch + request coalescing
│
├── plugins/
│   ├── base-layers/               # mutually exclusive
│   │   ├── basemap.ts             # CARTO Dark Matter / OSM
│   │   ├── radar.ts               # RainViewer
│   │   ├── satellite.ts           # RainViewer IR (later: NASA GIBS GOES)
│   │   ├── temperature.ts         # Open-Meteo + sub-opts actual/aparente
│   │   ├── humidity.ts            # Open-Meteo + relativa/punto-rocío
│   │   ├── pressure.ts            # Open-Meteo + surface/sea-level
│   │   ├── wind.ts                # WebGL particles + velocidad/rachas
│   │   └── sun.ts                 # terminator
│   │
│   └── overlays/                  # combinable (N active at a time)
│       ├── radar-coverage.ts      # Cobertura de radar (Q)
│       ├── precipitation-anim.ts  # Animación de lluvia (P)
│       ├── wind-particles.ts      # Animación de viento (V)
│       ├── fires.ts               # NASA FIRMS (I)
│       ├── tropical.ts            # NHC (T)
│       ├── labels.ts              # Etiquetas OSM (E)
│       ├── city-values.ts         # Valores de etiquetas (B)
│       ├── temp-labels.ts         # Temperaturas (K)
│       ├── borders.ts             # Líneas fronteras (F)
│       ├── isobars.ts             # Isolíneas de presión (S)
│       ├── night-line.ts          # Límite nocturno (O)
│       └── graticule.ts           # Retícula (X)
│
├── sources/                       # data providers
│   ├── open-meteo.ts
│   ├── rainviewer.ts
│   ├── nasa-gibs.ts
│   ├── nasa-firms.ts
│   ├── nhc.ts
│   └── osm-nominatim.ts
│
├── ui/                            # dumb DOM components
│   ├── layer-rail.ts
│   ├── overlay-menu.ts
│   ├── timeline.ts
│   ├── tooltip.ts
│   ├── coords-display.ts
│   ├── scale-bar.ts
│   ├── settings-panel.ts
│   ├── info-panel.ts
│   ├── place-popup.ts
│   └── search-autocomplete.ts
│
└── utils/
    ├── color-ramps.ts
    ├── grid-bilinear.ts
    ├── raster-canvas.ts
    └── geo-format.ts
```

## Core interfaces

```ts
// src/lib/map/core/types.ts

export interface MapPluginContext {
  map: maplibregl.Map;
  store: MapStore;                  // reactive, subscribable
  events: EventEmitter<MapEvents>;
  i18n: { es: I18n; en: I18n };
  source: <T>(id: string) => T;     // typed source resolver
}

export interface BaseLayer {
  id: string;                       // 'temperature'
  kind: 'base';
  label: I18nString;
  icon: string;                     // emoji or SVG path
  shortcut?: string;                // 'T'

  // sub-options like Actual/Aparente
  subOptions?: SubOption[];
  defaultSubOption?: string;

  // which overlays work over this layer; '*' = all
  compatibleOverlays?: '*' | string[];

  // lifecycle
  mount(ctx: MapPluginContext): Promise<void> | void;
  activate(ctx: MapPluginContext, opts: { sub?: string; frame?: Frame }): Promise<void> | void;
  deactivate(ctx: MapPluginContext): void;
  unmount(ctx: MapPluginContext): void;

  // optional capabilities
  tooltipValueAt?(lng: number, lat: number, frame?: Frame): string | null;
  legend?(): LegendStop[];
  frames?(): Promise<Frame[]>;     // if it supports timeline
}

export interface Overlay {
  id: string;
  kind: 'overlay';
  label: I18nString;
  icon: string;
  shortcut: string;
  availableOn: '*' | string[];     // ['radar'] or ['*']
  defaultEnabled?: boolean;

  mount(ctx: MapPluginContext): Promise<void> | void;
  enable(ctx: MapPluginContext): Promise<void> | void;
  disable(ctx: MapPluginContext): void;
  unmount(ctx: MapPluginContext): void;
}

export interface DataSource<TParams = unknown, TResult = unknown> {
  id: string;
  ttl: number;                     // ms
  attribution: string;
  fetch(params: TParams, signal?: AbortSignal): Promise<TResult>;
}
```

## State store

```ts
export type MapState = {
  baseLayerId: string;
  subOptionId?: string;
  enabledOverlays: ReadonlySet<string>;
  view: { lng: number; lat: number; zoom: number };
  frame: Frame | null;
  theme: 'light' | 'dark' | 'system';
  settings: {
    tz: 'local' | 'UTC';
    hourFormat: '12' | '24';
    timeControl: 'timeline' | 'clock';
    summaryGranularity: 'daily' | 'hourly';
    uiOpacity: 'translucent' | 'opaque';
    units: { temp: 'C' | 'F'; wind: 'km/h' | 'mph' | 'kt'; pressure: 'hPa' | 'inHg' };
  };
};

export interface MapStore {
  get(): MapState;
  set(patch: Partial<MapState>): void;
  subscribe(fn: (state: MapState, prev: MapState) => void): () => void;
  setBaseLayer(id: string, sub?: string): void;
  toggleOverlay(id: string): void;
  setView(view: MapState['view']): void;
}
```

Persistence: the store syncs to URL hash (view, layer, sub, overlays, frame) and localStorage (settings, theme). One `serialize()/deserialize()` pair in `hash.ts`.

## Example: adding "Isolíneas de presión" (S)

**Today**: ~200 LOC spread across `interactive-map.ts`, `maplayers.ts`, hash code, shortcut handler. Risk: touching the 2200-LOC monolith.

**With this architecture**:

```ts
// src/lib/map/plugins/overlays/isobars.ts — ONE new file
import * as d3contour from 'd3-contour';
import type { Overlay } from '../../core/types';
import { openMeteoSource } from '../../sources/open-meteo';

export const isobarsOverlay: Overlay = {
  id: 'isobars',
  kind: 'overlay',
  label: { es: 'Isolíneas de presión', en: 'Pressure isobars' },
  icon: '〰️',
  shortcut: 'S',
  availableOn: ['pressure'],

  mount(ctx) {
    ctx.map.addSource('isobars-src', { type: 'geojson', data: emptyFC });
    ctx.map.addLayer({
      id: 'isobars-line',
      type: 'line',
      source: 'isobars-src',
      paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.6 },
      layout: { visibility: 'none' },
    });
  },

  async enable(ctx) {
    const grid = await openMeteoSource.fetchGrid({
      bbox: ctx.store.get().view,
      param: 'surface_pressure',
    });
    const contours = d3contour
      .contours()
      .thresholds([1000, 1004, 1008, 1012, 1016, 1020, 1024])(grid.values);
    (ctx.map.getSource('isobars-src') as GeoJSONSource).setData(
      contoursToGeoJSON(contours, grid.bounds),
    );
    ctx.map.setLayoutProperty('isobars-line', 'visibility', 'visible');
  },

  disable(ctx) {
    ctx.map.setLayoutProperty('isobars-line', 'visibility', 'none');
  },

  unmount(ctx) {
    if (ctx.map.getLayer('isobars-line')) ctx.map.removeLayer('isobars-line');
    if (ctx.map.getSource('isobars-src')) ctx.map.removeSource('isobars-src');
  },
};
```

```ts
// src/lib/map/index.ts — one line
import { isobarsOverlay } from './plugins/overlays/isobars';
registry.register(isobarsOverlay);
```

UI rail, overlay menu and keyboard handler automatically pick it up because they enumerate the registry filtered by current `baseLayerId`.

## Migration phases

Each row is a separate PR. The site never breaks at any step.

| Phase | Effort | Output | Risk |
|---|---|---|---|
| **F1** Types + empty registry + store | 2 h | Exported types, no behavior change | 0 |
| **F2** Extract constants (cities, ramps, helpers) | 1 h | Pure utils in `utils/` | 0 |
| **F3** Extract data sources (Open-Meteo, RainViewer) | 2 h | `sources/*.ts`; monolith uses them | low |
| **F4** Migrate `sun` layer to new model | 2 h | First real plugin; flag-gated | low |
| **F5** Migrate other 6 base layers, one at a time | 1.5 h each | 6 small PRs | low |
| **F6** Migrate existing overlays | 1 h each | | low |
| **F7** Replace imperative UI with state-driven | 4 h | Rail, tooltip etc. subscribe to store | medium |
| **F8** Delete legacy `interactive-map.ts` | 30 min | Only `index.ts` remains | 0 (all migrated) |
| **F9** Add new features (isobars, fires, NASA GIBS, click-popup) | 1–3 h each | Pure gain | 0 |

Total base migration: ~20–25 h in ~10 reviewable PRs. After F8, each new feature costs 1–3 h.

## Design decisions worth defending

1. **No global event bus.** The store is the only conduit. Plugins emit via `events` only for non-state things ("tile-load-failed"). Avoids pub/sub spaghetti.
2. **Plugins don't know each other.** `isobars` doesn't know `pressure` exists — it declares `availableOn: ['pressure']` and the registry resolves. Zero coupling.
3. **UI subscribes, never queries.** Layer rail never calls `getActiveLayer()`. It rerenders when the store fires. Eliminates race conditions.
4. **Sources are pure functions, not classes.** Cache by URL hash + TTL. Coalesce duplicate requests. Testable without mock frameworks.
5. **No UI framework.** Astro generates static HTML; plugins manipulate existing DOM nodes. Zero React/Vue overhead.
6. **No DI container.** `MapPluginContext` is injected explicitly. Boring and it works.

## Benefits vs today

| Metric | Today | After |
|---|---|---|
| LOC for a new overlay | ~200 (scattered) | ~80 (one file) |
| Risk of breaking unrelated layers when editing | medium-high | ~0 (isolated modules) |
| Test coverage achievable | hard (monolith) | high (mocked sources, isolated plugins) |
| Contributor onboarding time | hours (reading 2200 LOC) | minutes (reading one plugin) |
| Map subsystem reusable elsewhere | no | yes (it's a library) |

## Out of scope

- React/Vue/Svelte. The site is Astro; we're not adding a runtime framework.
- A general-purpose plugin marketplace. This is internal architecture, not a public extension API.
- Hot reload / dev tooling. The map already mounts via Astro's standard pipeline.

## Tracking

Each migration phase is a separate GitHub issue. Cross-link this doc when opening PRs.
