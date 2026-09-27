# Plan: home "map-first" para Clima México

> **Estado (2026-09-15):** Fases 0, 1a, 1b, 2 y 3 **shipped** en la rama
> `claude/mexico-weather-inceptor-x63slj` (cinco commits, uno por fase).
> Fase 4 (detalles zoom.earth) sigue pendiente. Este documento es la v3
> del plan: v1 se sometió a una revisión adversarial (5 lentes, 25
> hallazgos, 3 escépticos por hallazgo, 12 confirmados) y a un crítico de
> completitud; las secciones "Cambios respecto a v1/v2" y "Hallazgos
> descartados" conservan ese registro.
>
> **Desviaciones al implementar:**
> - Fase 1b: en vez de ocultar el FAB con un IntersectionObserver, el
>   home lo rinde *inline* en el footer (`FeedbackFAB placement="inline"`,
>   `BaseLayout feedbackPlacement`). Ocultarlo rompía `cross-3`
>   ("FAB reachable from every route") en cuanto el mapa quedó arriba
>   del fold en Fase 2.
> - Fase 2: el rail recibe su offset por CSS var (`railOffsetTop` prop
>   en `InteractiveMap.astro`) para no chocar con el overlay del CTA.
> - Fase 3: los chips usan el atributo `[hidden]` en vez de la clase
>   `hidden` (empataba con `inline-flex`); los glifos de texto en
>   tooltips/tarjetas (🌡💧💨 con valores) quedan fuera del alcance.
> - Los e2e que dependen de `map.on('load')` (`mapa.spec.ts`,
>   `map-first-paint.spec.ts`) no corren en el sandbox de desarrollo
>   (fallan igual en `main`); los valida el workflow `e2e.yml` en el PR.

Repo: /home/user/mexico-weather (Astro 6 + Tailwind 4 + MapLibre, sin React, sin Inceptor).
Rama de trabajo: `claude/mexico-weather-inceptor-x63slj` (HEAD `2377883`).
Referencia visual: zoom.earth (mapa a pantalla completa, ~6 controles, iconos monocromos, un acento).
Referencias `archivo:línea` verificadas contra HEAD el 2026-09-15.
v3 = v2 + las seis brechas del crítico de completitud (ver "Cambios respecto a v2").

**Dependencia entre fases:** Fase 0 y Fase 1a tocan extensamente los mismos dos archivos (`interactive-map.ts`, `InteractiveMap.astro`). Cada fase se ramifica desde `main` **con la fase anterior ya mergeada**; no arrancar Fase 1 sobre una rama sin el fix de basemap.

Estimación total: 6.5–8 días (v1: 6.5). Fase 0 sube de 0.5 a 1–1.5 días; Fase 1 sube de 0.5 a 1–1.5 días y se parte en dos PRs.

## Diagnóstico

- El home (`src/pages/index.astro:16-29`) abre con un hero que ocupa una pantalla de celular (badge "Actualizado cada 10 min", H1 con bandera, subtítulo, CTA "Mostrar mi clima" `#geo` en `:36`, buscador `#q` en `:47`, timestamp) y debajo un embed de mapa de 400 px (`index.astro:65-78`, `height="400px"`, `lazy={true}`).
- El embed hereda todo el chrome de `/mapa`: rail de **8 capas** con emoji (`src/lib/maplayers.ts:7-9` `LAYER_IDS`, `:26-34` `LAYERS`: base, radar, satellite, temperature, humidity, pressure, wind, sunlight). En móvil el rail se recorta con **scroll vertical nativo** (`InteractiveMap.astro:204`: `max-h-[70vh] overflow-y-auto sm:max-h-none sm:overflow-visible`), no con una flecha de overflow — no existe tal affordance en `InteractiveMap.astro` ni en `interactive-map.ts`. Además: botón info, engrane de ajustes, Distancia/Área, captura de snapshot, toggle de modelo, coords, leyenda flotante, más el FeedbackFAB fijo de BaseLayout y la barra de tiempo con 4 controles. ~17 targets sobre 400 px (8 capas + 9 controles), sin contar los 4 de la timeline.
- Causa en código: en `src/components/InteractiveMap.astro` los 9 bloques de markup (`:202`, `:375`, `:389`, `:407`, `:436`, `:465`, `:488`, `:502`, `:539`) están condicionados a `features.layerRail`, no a flags propios. En `src/lib/interactive-map.ts` la misma flag se lee en 10 sitios (`:444`, `:2077`, `:2133`, `:2150`, `:2478`, `:2489`, `:2497`, `:2740`, `:2875`, `:2908`) que gobiernan popups, overlays, medición, model-toggle y snapshot. `index.astro:70-71` activa `layerRail: true, timeline: true`.
- Emoji como iconografía (`src/lib/maplayers.ts:27-34` define `icon: '🗺️'` etc.; `interactive-map.ts:2087-2092` los renderiza como `textContent` de un `<span>` en el DOM), tres formas de chip, cuatro acentos (azul, amarillo alertas, ámbar SMN, verde FAB). Aparte, tres overlays MapLibre llevan emoji **dentro de `text-field`** (`src/lib/map/overlays/lakes.ts:59`, `volcanoes.ts:62`, `webcams.ts:91`), que es otro mecanismo de render (ver Fase 3).
- Bug real: CARTO ahora estampa "API KEY REQUIRED" en tiles sin llave. Verificado con curl a `https://a.basemaps.cartocdn.com/dark_all/5/7/13.png` el 2026-09-14. URLs en `src/lib/map/chrome/basemap-theme.ts:23-46`. Ningún test lo detectó ni podía detectarlo: `basemap-theme.test.ts` solo inspecciona plantillas de URL, y los e2e mockean tiles (`e2e/mapa.spec.ts:318`).

## Fase 0. Basemap sin llave (bug, 1–1.5 días)

Subió de 0.5 a 1–1.5 días: no es un swap de URLs sino una segunda capa raster (Reference) con su propio z-order, un cambio de contrato en dos funciones, reescritura casi completa del test unitario, y un canary de red nuevo.

### 0.1 Tiles Esri Canvas (Base + Reference)

- Reemplazar CARTO por Esri Canvas raster, verificado hoy sin llave y sin marca de agua:
  - Dark: `Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` (jpeg) + `Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}` (etiquetas, png).
  - Light: `World_Light_Gray_Base` + `World_Light_Gray_Reference`.
  - Orden `{z}/{y}/{x}`, zoom máximo 16.
- **Sharding de host obligatorio.** `server.arcgisonline.com` negocia HTTP/1.1 (sin h2) y como host único reproduce exactamente el antipatrón que documenta `basemap-theme.ts:16-22` (un solo host → sin paralelismo bajo la ráfaga de tiles → canvas en blanco en z≥5) y que ya tiene guard de regresión en `basemap-theme.test.ts:24-32`. `server.arcgisonline.com` y `server2.arcgisonline.com` resuelven a distribuciones CloudFront distintas y ambos sirven la misma tile con 200. Verificado el 2026-09-15: `server3`/`server4.arcgisonline.com` no responden (timeout); **solo `server` y `server2` existen**. Usar exactamente `['server', 'server2']` en cada source y documentar en el comentario de diseño del módulo que Esri ofrece dos subdominios (no cuatro como CARTO) y que ambos son distribuciones CloudFront distintas.

### 0.2 Cambio de contrato en `basemap-theme.ts` (no "conserva su forma")

Hoy `pickBasemapTiles(dark, dense): string[]` (`basemap-theme.ts:52-55`) devuelve un solo arreglo para **una** source `osm`, y `createBasemapThemeController(map, { sourceId })` (`:68-131`) solo conoce un `sourceId` y en `sync()` hace `src.setTiles(pickBasemapTiles(dark, dense))` sobre esa única source (`:87`). Con Esri, Base y Reference son dos sources/layers distintos, así que `dense` deja de elegir URLs y pasa a ser visibilidad de una segunda capa. Nuevo contrato:

- `pickBasemapTiles(dark: boolean): { base: string[]; reference: string[] }` — depende solo de `dark`. `LABEL_ZOOM_THRESHOLD = 5` (`:49`) se conserva.
- `createBasemapThemeController(map, { baseSourceId, referenceSourceId, referenceLayerId, initialDark })`. `sync()` hace: si cambió `dark` → `setTiles` en **ambas** sources (Reference también tiene tiles por tema, dark/light) + limpieza de caché como hoy (`:91-113`); si cambió `dense` → `map.setLayoutProperty(referenceLayerId, 'visibility', dense ? 'visible' : 'none')`.
- Renombrar exports: `ESRI_DARK_BASE`, `ESRI_DARK_REFERENCE`, `ESRI_LIGHT_BASE`, `ESRI_LIGHT_REFERENCE`. Reescribir el docstring de diseño (`:16-22`) explicando por qué dos capas y por qué sharding.
- **`src/lib/interactive-map.ts` entra al alcance** (v1 no lo listaba): el estilo inicial vive en `:355-372` (única `sources.osm` + `layers: [{ id: 'osm', source: 'osm' }]`), los imports de `CARTO_*` en `:157-161` y `:321-322`, y la instanciación del controlador en `:705-708` (`sourceId: 'osm'`). Añadir la segunda source/layer `osm-reference` inmediatamente encima de la base y por debajo de cualquier capa propia; pasar los tres ids al controlador.

### 0.3 Atribución: tres sitios de código + href

- `src/lib/interactive-map.ts:368` — `attribution: '© OpenStreetMap contributors © CARTO'` en la definición estática del estilo. Es el string que **ve el usuario en la carga inicial**: `sync()` no se invoca al arrancar, solo en `zoomend` (`:709`) y en cambios de `html.dark`.
- `src/lib/map/chrome/basemap-theme.ts:87-90` — el controlador sobreescribe `anySrc.attribution` en cada `sync()`.
- `src/components/InteractiveMap.astro:577` — `<a href="https://carto.com/attributions">CARTO</a>` en el panel `#mw-info`. Cambiar texto **y** href (a `https://www.esri.com/en-us/legal/terms/data-attributions` o equivalente).
- String: "Esri, HERE, Garmin, © OpenStreetMap contributors" en los tres sitios.

### 0.4 Documentación que describe el basemap como CARTO

Listar explícitamente (v1 solo mencionaba `USER_JOURNEYS.md`):
- `README.md:55-56`, `:62`
- `docs/USER_GUIDE.md:96`, `:125-126`
- `docs/ARCHITECTURE.md:68`
- `docs/ROADMAP.md:65`
- `docs/PLAN_UX_PARITY.md:680`, `:685`, `:826`, `:844`, `:925` — menciones en presente a "Carto" (solo C mayúscula). El documento se autodeclara superseded pero Fase 2 lo sigue citando; corregir esas cinco líneas.
- `docs/AUDIT_2026-06-09.md` — registro histórico, **se deja intacto** y se excluye del centinela.
- `docs/USER_JOURNEYS.md:24`, `:390`, `:402` — deuda **preexistente**: `:24` y `:402` dicen que el tema claro se sirve desde `tile.openstreetmap.org`, cosa que dejó de ser cierta cuando CARTO Positron reemplazó ese host (`basemap-theme.ts:16-22`). Un find/replace de `cartocdn` no las tocaría; auditar todo el documento por hosts de tiles obsoletos (`tile.`, `basemaps.`, `cartocdn`) y dejar solo Esri.
- **No hay fixtures e2e de cartocdn que migrar** (`grep -rn cartocdn e2e/` vacío). El único mock de basemap es `e2e/mapa.spec.ts:318` (`**/tile.openstreetmap.org/**`), que hay que cambiar a `**/*.arcgisonline.com/**`. `helpers.ts` y `fixtures/*.json` no referencian tiles de basemap.
- El escenario `forecast-7` (`docs/USER_JOURNEYS.md:388-403`) sigue **NOT YET COVERED**; esta fase solo corrige su bloque "Theme sync" (`:402`) para que diga hosts Esri. Implementarlo queda explícitamente pospuesto (fuera de este plan).

### 0.5 Preconnect

No existe ningún `preconnect`/`dns-prefetch` en `src/layouts/BaseLayout.astro` hoy (grep vacío). Añadir uno por cada subdominio Esri usado en 0.1.

### 0.6 Aceptación

- Sin marca de agua en z4–z12 en ambos temas; captura antes/después en el PR.
- `basemap-theme.test.ts` **se reescribe casi por completo**, no "gana un test": los 5 tests actuales (`:11-41`) comparan por identidad de referencia contra `CARTO_*` (`toBe(CARTO_DARK_TILES)`), y esas constantes desaparecen. Nueva suite:
  - `pickBasemapTiles(true|false)` devuelve `{ base, reference }` con las constantes `ESRI_*` correctas.
  - Ninguna URL contiene `cartocdn` ni `tile.openstreetmap.org`.
  - **Guard de host único extendido**: cada arreglo `base`/`reference` tiene ≥2 hosts distintos (extrae hostname y cuenta únicos) — es la generalización del test `:24-32`.
  - `LABEL_ZOOM_THRESHOLD` sigue en 5.
  - Test del controlador con un `map` fake: cambio de `dark` → `setTiles` en ambas sources; cambio de `dense` → `setLayoutProperty(referenceLayerId, 'visibility', …)` y **no** `setTiles`.
- Test unitario `src/lib/no-carto.test.ts` (o dentro de `basemap-theme.test.ts`) que lee `src/lib/interactive-map.ts`, `src/lib/map/chrome/basemap-theme.ts`, `src/components/InteractiveMap.astro`, `README.md`, `docs/USER_GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/USER_JOURNEYS.md` más `docs/PLAN_UX_PARITY.md`, y falla si aparece `/carto/i` (**case-insensitive**: `CARTO`, `Carto`, `CartoDB`, `cartocdn`) — centinela no detecta strings de atribución obsoletos por sí solo. `docs/AUDIT_2026-06-09.md` queda fuera de la lista a propósito.
- **Canary de red** (nuevo, no unit test): workflow `.github/workflows/basemap-canary.yml` con `schedule: cron` nocturno + `workflow_dispatch`, mismo patrón que `aqi-snapshot.yml`/`marine-snapshot.yml`. Descarga una tile de muestra (`5/13/7`) de cada una de las 4 sources Esri con `curl --retry --max-time`, verifica `content-type` `image/jpeg|png`, tamaño mínimo (>2 KB) y decodificación como imagen; falla el job (no el pipeline de PRs) si algo difiere. Es la única salvaguarda contra el modo de falla real que motivó esta fase (HTTP 200 con contenido cambiado), que un test sobre plantillas de URL no puede ver.
- Alternativa posterior: OpenFreeMap vectorial (`https://tiles.openfreemap.org/styles/dark` y `/styles/positron`, verificados 200 sin llave). Implica pasar de estilo raster custom a `setStyle` y re-agregar capas propias tras `style.load`. PR separado.

## Fase 1. Quitar el ruido del embed del home (1–1.5 días, dos PRs)

Subió de 0.5 a 1–1.5 días y se parte en dos PRs ortogonales. El refactor de flags toca 9 bloques de markup + 10 sitios de lógica, y la forma `features` está **triplicada**: `interface Features` en `InteractiveMap.astro:22-36` (7 llaves), `ImCfg.features` inline en el `<script>` (`InteractiveMap.astro:653`, 6 llaves) e `InteractiveMapFeatures` en `interactive-map.ts:121` (5 llaves). Cada flag nueva exige decidir en cuál de las tres capas vive. **Solo hay 2 call-sites del componente Astro** (`index.astro:65-78`, `mapa.astro:40-57`). `/forecast` **no** renderiza `InteractiveMap.astro`: llama directo a `initInteractiveMap()` sobre su propio `#fc-map` (`forecast.astro:1081-1092`) con `InteractiveMapFeatures` y `layerRail: false`, así que su template nunca contiene `#mw-settings`, `#mw-info`, `#mw-model-toggle` ni `#legend-bar`. No tocar `forecast.astro` ni añadir las flags nuevas a `InteractiveMapFeatures` por ese motivo; solo las que gobiernen lógica en `interactive-map.ts` (ver reclasificación abajo).

### PR 1a — flags granulares en `InteractiveMap.astro` + `interactive-map.ts`

- Nuevas flags en `interface Features` (`InteractiveMap.astro:22-36`): `tools` (medir `:465-487` + snapshot `:436-464`), `settings` (`:502-538`), `info` (`:539-…`), `modelToggle` (`:407-435`), `coords` (`:375-381`), **`legend` (`:389-401`, `#legend-bar`)** — v1 no le asignaba flag y hoy está atado a `layerRail` igual que los demás; sin flag propio seguiría apareciendo en el home, donde `layerRail` se queda en `true`. **Edición obligatoria en `src/pages/mapa.astro:40-57`:** añadir `tools: true, settings: true, info: true, modelToggle: true, coords: true, legend: true` al objeto literal `features={{…}}`. El default de `InteractiveMap.astro:65-72` solo aplica cuando el prop `features` se omite por completo (no hay merge por llave), y ambos call-sites pasan siempre un objeto literal; si no se edita `mapa.astro`, las flags nuevas quedan `undefined` y `/mapa` pierde silenciosamente ajustes, info, model-toggle, medición, snapshot y leyenda. En `index.astro:65-78` van explícitamente en `false` (o se omiten, mismo efecto). Alternativa válida: hacer merge `{ ...DEFAULTS, ...features }` en el componente y documentarlo; en ese caso `index.astro` **debe** pasarlas en `false`.
- Flag `railLayers?: LayerId[]` para que el embed muestre solo 5 capas (base, radar, temperature, wind, sunlight) y el rail quepa sin scroll (`:204`).
- Reclasificar cada uno de los 10 sitios de `interactive-map.ts` (`:444` popups, `:2077` rail, `:2133`/`:2150` settings, `:2478`/`:2489`/`:2497` overlays+opacidad, `:2740` medición, `:2875` model toggle, `:2908` snapshot) a su flag nueva; propagar las flags a `ImCfg.features` (`:653`) e `InteractiveMapFeatures` (`:121`).
- Aceptación 1a: `e2e/mobile-audit.spec.ts:124-125` ya audita targets sobre `home-map`; agregar en `e2e/home.spec.ts` (tras `page.goto('')`, patrón del archivo) que dentro de `#home-map-root` tienen `toHaveCount(0)`: `#mw-measure-wrap`, `#mw-settings`, `#mw-info`, **`#mw-model-toggle`, `#legend-bar`, `#home-map-coords`** (v1 solo cubría 3 de 6). Y que `/mapa` sigue teniendo los 6. `/mapa` sin cambios visibles (`e2e/mapa.spec.ts` verde). De ~17 targets a ~6.
- TODO documentado en el PR: `mw-measure-wrap`, `mw-settings`, `mw-info`, `legend-bar`, `mw-model-toggle` son ids literales, no derivados de `mapId` (`InteractiveMap.astro:94-112`); derivarlos antes de que exista una segunda instancia en la misma página.

### PR 1b — FeedbackFAB + altura del embed

- FeedbackFAB (`src/layouts/BaseLayout.astro:708`; `src/components/common/FeedbackFAB.astro:33` es `fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6 right-5 z-50`, sin ninguna lógica de visibilidad hoy): ocultarlo con `IntersectionObserver` mientras un `.maplibregl-map` esté en viewport, o mover el disparador al footer en el home. Comportamiento global nuevo, por eso PR aparte.
- Altura del embed: de `400px` (`index.astro:67`) a `min(70dvh, 560px)` en móvil.
- Aceptación 1b: `e2e/home.spec.ts` verifica que `#secid-report-btn` no está visible mientras el mapa está en viewport; `e2e/mobile-audit.spec.ts` verde.

## Fase 2. Home map-first (2 días)

- Layout: el mapa ocupa `calc(100dvh - nav)` como en `mapa.astro:31` (`h-[calc(100dvh-3rem)] sm:h-[calc(100dvh-3.5rem)]`). Favoritos, ciudades, alertas SMN y fuentes quedan debajo en flujo normal con un asa "peek".
- Hero: H1 a `sr-only` (patrón de `mapa.astro:36`); subtítulo y badge van a la meta description (`index.astro:12` ya pasa una propia; actualizarla con el texto del subtítulo) y al timestamp del timeline. JSON-LD (`src/lib/structured-data.ts`) no cambia (el home no emite ninguno hoy; ver hallazgos descartados).
- **Buscar y ubicar: se comparte la lógica, no la UI.** Hoy hay dos sistemas con **comportamiento de producto distinto**:
  - Home: `#geo` (`index.astro:36`) → handler en `index.astro:1098-1135` → `resolveStateByCoords` (`:1114`) → `location.href = fullHref(...)` (`:1128`). **Navega** a `/clima/<slug>/` o `/forecast`. Es el CTA primario ancho por decisión documentada (`index.astro:30-34`, story 2.1; `index.astro:55-59` explica por qué el embed no duplica search/locate).
  - Mapa: `features.locateButton` (`interactive-map.ts:2712-2729`) → `setUserPin(t.map_locate, lat, lng, 'geo')`. **Deja un pin, no navega.** Es el botón compacto `#maploc` de 44 px (`InteractiveMap.astro:96`; `e2e/mobile-audit.spec.ts:56`).
  - Decisión v2: `#geo` se **mantiene** como CTA ancho propio del home (no se colapsa en el icono del mapa) y `#q` se mantiene con su `aria-label` "Buscar cualquier ciudad o lugar…" (distinto al del mapa, "Buscar un lugar en el mapa…"). Se extrae a `src/lib/locate-flow.ts` solo la parte pura (`getCurrentPosition` + `resolveStateByCoords` + manejo de errores/`geo_denied`) con **dos acciones finales configurables**: `onResolved: 'navigate' | 'pin'`. Home usa `navigate`; `interactive-map.ts:2712-2729` usa `pin`. Se reubica el bloque `#geo`/`#q` sobre el mapa (overlay superior) para que el mapa quede arriba del fold sin perder el CTA. `search`/`locateButton` del embed del home siguen en `false`.
  - Aceptación: `e2e/mostrar-mi-clima.spec.ts:13-21` (`#geo` visible, ancho >300) y `e2e/search.spec.ts:14-16` (combobox por nombre) pasan **sin modificación**. Nuevo caso en `e2e/mapa.spec.ts`: al pulsar `#maploc` con geolocalización mockeada, aparece un pin y la URL **no** cambia de `/mapa/`.
- Capa inicial: `initialLayer="radar"`. Temperatura sería mejor, pero primero confirmar el estado de E10 en `docs/ROADMAP.md:121-169` (Story 10.2 ya marca `[x]` el reemplazo rAF→`setTimeout`, y `InteractiveMap.astro:760` ya lo lleva; `docs/PLAN_UX_PARITY.md` está superseded para este punto).
- Rendimiento: el embed hoy es `lazy={true}` (`index.astro:77`; IO en `InteractiveMap.astro:734-747`); arriba del fold debe ser `lazy={false}` (camino `:760`, el mismo que `/mapa`). LCP pasa a ser el canvas. **`e2e/map-first-paint.spec.ts` hoy no tiene target para el home** (`TARGETS` en `:55-60` solo cubre `/mapa` y `/forecast embed`): añadir `{ name: '/ (home)', url: '' }` y su propio `PAINT_VARIANCE_FLOOR['/ (home)']` (`:25`) calibrado en `main` tras el cambio, igual que se hizo para los otros dos. Lighthouse CI (`.lighthouserc.json:25`, LCP ≤2500 ms en `warn`) sigue siendo la medida de LCP real; el spec de píxeles es la salvaguarda de "canvas en blanco".
- Documentación: actualizar `docs/USER_GUIDE.md:9` (Routes overview: "~400 px tall") y `:91` (Per-page notes: "Search + Mi ubicación stay above… lazy-loaded via IntersectionObserver") junto con `USER_JOURNEYS.md`; ambas afirmaciones quedan falsas tras Fase 1/2.

## Fase 3. Sistema visual (1.5 días)

- Iconos DOM: `def.icon` pasa de emoji a id de sprite SVG (`<symbol>` en `public/` o inline en BaseLayout); render `<svg><use href="#i-radar"/></svg>` en `interactive-map.ts:2087-2092` (hoy `iconSpan.textContent = def.icon`). Aplica a las 8 capas (`maplayers.ts:27-34`), a 📏📐📸👁⚙️ℹ️📍 en el chrome y a ⚠️⭐➕ en el home.
- **Etiquetas MapLibre (tratamiento aparte, no sprite DOM):** `src/lib/map/overlays/lakes.ts:59` (`label: \`💧 ${l.name}\``), `volcanoes.ts:62` (🌋) y `webcams.ts:91` (📹) alimentan layers `type: 'symbol'` con `'text-field': ['get', 'label']` (`lakes.ts:78-82`), renderizados por el motor de glifos WebGL de MapLibre. No hay forma de meter un `<use>` ahí. Opción A (recomendada, trivial): quitar el emoji del texto y dejar solo el nombre — la capa `circle` de cada overlay ya da la marca visual. Opción B: `icon-image` + `map.addImage()` con el SVG rasterizado, tarea separada. Decidir A salvo que el PR de capturas muestre que se pierde legibilidad.
- Chips: una sola spec: 44 px, redondos, `bg-gray-900/80 text-white backdrop-blur` en ambos temas sobre el mapa.
- Color: un acento (azul) para interacción; ámbar solo cuando hay avisos SMN reales para el estado del usuario (`SmnAlertRibbon` ya lo sabe); el bloque amarillo "Alertas activas" deja de estar siempre encendido; FAB neutro.
- Aceptación: `e2e/a11y.spec.ts` (`PAGES` en `:24-34` ya incluye `home`, y `:83` cubre `/mapa`) y `e2e/theme.spec.ts` verdes; test unitario que `LAYERS` no contiene ningún carácter fuera del BMP en `icon`; capturas móvil claro/oscuro en el PR.

## Fase 4. Detalles zoom.earth (2 días, opcional)

- Leyenda como tira delgada arriba del mapa también en móvil. Estado real hoy: `#legend-bar` (`InteractiveMap.astro:391-393`) no usa `hidden`; su clase es `sm:flex` sin display-utility para `<sm`, y la visibilidad la controla `style.display` inline que `renderLegend()` alterna en runtime (`interactive-map.ts:1467-1513`: `'none'` sin capa con leyenda, `''` con ella). Al limpiar el inline style bajo 640 px el div cae a `display:block`, es decir, **puede estar mostrándose en móvil** con layout de bloque. Fase 4 primero fija el comportamiento móvil deseado (tira superior) con una regla explícita y luego mueve el render; no partir de la premisa "hoy está oculto".
- Tap en el mapa abre tarjeta con 5 días (como "Tu ubicación" de zoom.earth); existe `markerPopups` (`interactive-map.ts:444`), falta el contenido.
- Timeline con play a la izquierda y "Ahora 3:43 PM" centrado.

## Riesgos

- Términos de uso de Esri (gratis con atribución para uso no comercial); si incomoda, OpenFreeMap (PR separado, cambio de arquitectura raster→vector).
- Esri degradándose silenciosamente como CARTO (200 con contenido cambiado): mitigado por el canary nocturno de Fase 0.6.
- Regresión de LCP / canvas en blanco en Fase 2: mitigado por el target de home en `map-first-paint.spec.ts` + Lighthouse CI.
- Churn en e2e: `home`, `mapa` (mock de tiles + caso de pin), `mobile-audit`, `map-first-paint`. `mostrar-mi-clima` y `search` **no** deben cambiar (son la garantía de que el CTA del home sobrevive).
- Cada fase corre `npm run build`, `npm run check`, `npm run test`, `npm run test:e2e` antes de push.

## Cambios respecto a v1

1. Diagnóstico: "9 capas / flecha de overflow" → 8 capas (`maplayers.ts:7-9`, `:26-34`) y scroll vertical con `max-h-[70vh] overflow-y-auto` (`InteractiveMap.astro:204`); conteo de targets ajustado a ~17.
2. Fase 0.2: se elimina la afirmación de que `pickBasemapTiles`/`createBasemapThemeController` "conservan su forma"; nuevo contrato `{ base, reference }` + controlador con `baseSourceId`/`referenceSourceId`/`referenceLayerId`, `setTiles` para tema y `setLayoutProperty` para densidad; `interactive-map.ts:355-372` y `:705-708` entran al alcance.
3. Fase 0.1/0.6: sharding de host obligatorio (Esri es HTTP/1.1, host único = antipatrón de `basemap-theme.ts:16-22`), `basemap-theme.test.ts` se declara reescrito casi por completo con guard de host único generalizado; Fase 0 re-estimada de 0.5 a 1–1.5 días.
4. Fase 0.3/0.4: atribución con los tres sitios de código explícitos (`interactive-map.ts:368`, `basemap-theme.ts:87-90`, `InteractiveMap.astro:577` incl. href) y los cuatro docs (`README.md:55-62`, `USER_GUIDE.md:125-126`, `ARCHITECTURE.md:68`, `ROADMAP.md:65`); test unitario que falla si queda `CARTO`/`cartocdn`.
5. Fase 0.4: se elimina "migrar fixtures e2e de cartocdn" (no existen); se corrige `USER_JOURNEYS.md:24`/`:390`/`:402` como deuda preexistente auditando todos los hosts; `forecast-7` queda explícitamente pospuesto.
6. Fase 0.6: nuevo canary de red nocturno (`basemap-canary.yml`, patrón `aqi-snapshot.yml`) que valida contenido real de tiles; el test de plantillas de URL se mantiene pero se reconoce que no detecta el modo de falla que motivó la fase.
7. Fase 1: re-estimada de 0.5 a 1–1.5 días y partida en PR 1a (flags granulares: 9 bloques + 10 sitios + forma `features` triplicada + 3 call-sites) y PR 1b (FeedbackFAB + altura).
8. Fase 1: flag `legend` para `#legend-bar` (`InteractiveMap.astro:389-401`); aceptación extendida a `#mw-model-toggle`, `#legend-bar`, `#home-map-coords` (antes solo 3 de 6).
9. Fase 2: se deja de fusionar `#geo`/`#q` con los controles del mapa; `locate-flow.ts` comparte solo la lógica pura con acción final `navigate | pin`; `mostrar-mi-clima.spec.ts` y `search.spec.ts` pasan sin cambios; nuevo caso e2e de que `/mapa` fija pin sin redirigir.
10. Fase 2: "revisar presupuesto en `map-first-paint.spec.ts`" → añadir target `/ (home)` a `TARGETS` (`:55-60`) con su propio `PAINT_VARIANCE_FLOOR`; se anota Lighthouse CI como la medida de LCP real.
11. Fase 3: `lakes.ts:59` (y `volcanoes.ts:62`, `webcams.ts:91`, mismo patrón) separados del sprite DOM: son `text-field` de MapLibre; opción A quitar emoji, opción B `icon-image` + `addImage()`.
12. Global: `docs/USER_GUIDE.md:9` y `:91` añadidos a la aceptación de Fase 2 (y `:96`, `:125-126` a Fase 0).

## Cambios respecto a v2 (brechas del crítico de completitud)

1. Fase 1a: edición explícita de `mapa.astro:40-57` con las seis flags en `true`; se explica que el default de `InteractiveMap.astro:65-72` no hace merge por llave (major).
2. Fase 1: `/forecast` deja de contarse como call-site del componente; llama a `initInteractiveMap()` directo con `layerRail: false` y no necesita las flags nuevas (major).
3. Fase 0.1: sharding resuelto hoy con curl: solo `server` y `server2` responden; se fija el arreglo y se quita la tarea abierta (minor).
4. Fase 0.4/0.6: `docs/PLAN_UX_PARITY.md` (cinco menciones a "Carto") entra a la lista de docs y el centinela pasa a `/carto/i`; `AUDIT_2026-06-09.md` se excluye explícitamente como histórico (minor).
5. Fase 4: corregida la caracterización de `#legend-bar` en móvil (no está `hidden`; lo controla `renderLegend()` por inline style) (minor).
6. Global: dependencia entre fases declarada al inicio: cada fase se ramifica desde `main` con la anterior mergeada (minor).

## Hallazgos descartados

1. "El plan confunde el home con la landing SEO de `/clima/[slug].astro`" — refutado: PLAN_v1 nunca menciona Google, SEO ni "clima Guadalajara"; la justificación de Fase 2 es paridad UX con `/mapa`, story 2.1 y LCP. Hombre de paja.
2. "La atribución omite 'and the GIS user community' → incumplimiento" — refutado como major: es un matiz de redacción legal sin impacto de usuario, y la propuesta de leer `?f=json` en build/CI mete una dependencia de red externa en el pipeline. Si forja quiere completar el literal en una línea, no hay objeción, pero no es criterio de aceptación.
3. "OpenFreeMap debería ser primaria porque Esri migra a API keys" — refutado: la retirada de legacy API keys aplica a ArcGIS Location Platform, no al MapServer anónimo `server.arcgisonline.com` (verificado 200 sin llave hoy, tres meses después de esa fecha); el plan ya lista OpenFreeMap como contingencia; meter una migración raster→vector en un hotfix de producción rompe el timebox.
4. "OpenFreeMap no es red de seguridad incondicional; considerar self-hosting" — refutado: el plan solo dice "si incomoda, OpenFreeMap" y ya lo trata como PR separado con cambio de arquitectura; self-hosting de tiles contradice "no introducir backend" (`docs/PLAN_UX_PARITY.md`) y es desproporcionado para un ítem minor.
5. "El criterio `#mw-settings`… no es ejecutable porque los ids son literales" — refutado: ids literales son más fáciles de seleccionar, no menos; `home.spec.ts` ya usa `page.goto('')` por convención; no hay segunda instancia del componente en ninguna fase. Se conserva solo un TODO sobre derivar los ids de `mapId` (Fase 1a).
6. "El gate de `initialLayer='temperature'` cita PLAN_UX_PARITY superseded y E10 sigue abierto" — refutado como blocker: el fix rAF→`setTimeout` ya está en `InteractiveMap.astro:760` y `forecast.astro:1075-1080`; ROADMAP E10 dice "Both paint without interaction in a foreground context" (`:147`); lo pendiente es limpieza y verificación en dispositivo. Solo se corrigió la cita (ahora `ROADMAP.md:121-169`).
7. "Bloquear `lazy={false}` hasta cerrar E10 porque el embed tarda 3 s" — refutado: la medición de 3 s es del embed de `/forecast`, que llama a `initInteractiveMap` directo (`forecast.astro:1081`) con capa temperatura casi uniforme; el home usa `InteractiveMap.astro`, el mismo camino no-lazy que `/mapa` (que mide bien), con `initialLayer="radar"`; y el plan ya citaba `map-first-paint.spec.ts` como gate.
8. "H1 `sr-only` rompe `home.spec.ts:22-27` (`toBeVisible`)" — refutado: Playwright considera visible cualquier elemento con bounding box no vacío y sin `visibility:hidden`; `sr-only` es 1×1 px con `clip`, verificado empíricamente como `isVisible: true`; además el plan ya listaba churn en `home` y corre e2e por fase.
9. "`sr-only` reduce texto indexable en la única página con prosa real" — refutado: `sr-only` mantiene el texto en el DOM; `clima/[slug].astro`, `volcan/[slug].astro`, `huracanes/index.astro` tienen más prosa única que el subtítulo genérico del home; el plan reubica subtítulo/badge, no los borra.
10. "Partir Fase 2 en dos PRs" — refutado: la propuesta deja tres de los cuatro riesgos juntos en el PR2 y separa temporalmente "borrar controles del hero" del rediseño del hero, creando un estado intermedio sin CTA sobre el fold; los gates de e2e por fase son los mismos en 1 o 2 PRs. (La v2 además ya no borra `#geo`/`#q`, lo que reduce el riesgo que motivaba el split.)
11. "`a11y.spec.ts` no audita el home-map" — refutado: `PAGES` (`e2e/a11y.spec.ts:24-34`) incluye `{ name: 'home', url: '' }` y el describe `:38` corre axe sobre todo el DOM del home, incluido `#home-map`; el grep de "map" no lo encontró porque el nombre del test no contiene esa palabra.
12. "La comparación con zoom.earth se acotó a `/mapa` en PLAN_UX_PARITY" — refutado: PLAN_v1 no cita ese documento para justificar el home; la referencia visual es propia y el diagnóstico del home se sostiene en código (chrome heredado, CARTO roto, emoji); Fase 2 conserva favoritos/ciudades/alertas debajo del mapa; medir bounce/scroll choca con "sin tracking, sin cookies".
13. "El home no emite JSON-LD, así que 'no cambia' es engañoso" — refutado: el dato es cierto (`index.astro:12` no pasa `jsonLd`; `structured-data.ts` solo exporta `cityLd`/`beachLd`/`stateLd`/`breadcrumbLd`, no hay `WebSite`/`Organization`), pero "no cambia" se lee como "fuera de alcance"; añadir JSON-LD al home es scope creep de SEO en una fase de UX. Se dejó una aclaración entre paréntesis en Fase 2.
