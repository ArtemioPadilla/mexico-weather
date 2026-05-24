# `src/lib/map` — map subsystem (in migration)

Plugin-based architecture for the interactive weather map. See
[`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) for the full design.

## Current status

This directory is being populated incrementally. The legacy monolith at
`src/lib/interactive-map.ts` still ships production behavior. Migration
happens one plugin at a time; nothing here is wired up yet.

| Subdir | Status |
|---|---|
| `core/` | Phase 1 ✅ — types + registry shipped |
| `plugins/` | Phase 4+ — base layers and overlays migrate one at a time |
| `sources/` | Phase 3 — Open-Meteo, RainViewer extraction pending |
| `ui/` | Phase 7 — replaces imperative DOM with state-driven |
| `utils/` | Phase 2 — extracted from monolith |

## Quick example

Adding a new overlay is one file:

```ts
// src/lib/map/plugins/overlays/fires.ts
import type { Overlay } from '../../core/types';

export const firesOverlay: Overlay = {
  id: 'fires',
  kind: 'overlay',
  label: { es: 'Incendios activos', en: 'Active fires' },
  icon: '🔥',
  shortcut: 'I',
  availableOn: '*',
  mount(ctx)   { /* add source + layer, hidden */ },
  enable(ctx)  { /* show + fetch latest data */ },
  disable(ctx) { /* hide + pause */ },
  unmount(ctx) { /* remove source + layer */ },
};
```

Register once and the layer rail, overlay menu, keyboard handler and URL
hash all pick it up:

```ts
// src/lib/map/index.ts (future)
import { firesOverlay } from './plugins/overlays/fires';
register(firesOverlay);
```

## Don't yet

- Don't import anything from `src/lib/map/` into Astro pages yet.
- Don't move logic out of `interactive-map.ts` until its corresponding
  phase ships (see ARCHITECTURE.md migration table).
- Don't add HMR-specific code; the registry is idempotent on id so plain
  Vite reload works.
