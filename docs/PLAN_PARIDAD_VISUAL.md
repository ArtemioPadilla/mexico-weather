# Plan: paridad de UX/UI con zoom.earth

Estado: **propuesto** · 2026-09-27 · Continúa la numeración de `docs/ROADMAP.md` y `docs/PLAN_PRO_GRATIS.md` (E21–E26, Story 21.x–26.x): épica → historia (~1 PR, tag `Story N.M`) → tarea (`[ ]`), prioridad P0–P2, estimaciones honestas. Cada historia trae criterio de aceptación medible y el archivo donde vive el cambio.

---

## 0. Diagnóstico: en datos ganamos, en experiencia todavía no

Tras `PLAN_PRO_GRATIS` (18/21 historias en `main`) el sitio da gratis todo lo que zoom.earth cobra y más (10 días, satélite con 10 días de historia, cono de ciclones, alertas sin backend, 17 overlays MX, cero anuncios). Lo que sigue por debajo es lo que la gente ve en los primeros 5 segundos y lo que siente al arrastrar el timeline.

| Dimensión | zoom.earth | Nosotros (`/mapa`, `main` @ 2026-09-27) | Evidencia | Brecha |
|---|---|---|---|---|
| Primera impresión | Satélite animado a pantalla completa sobre basemap oscuro, sin interacción | Basemap gris claro, capa base (o radar en home); el mapa "vacío" hasta elegir capa | `initialLayer` ausente en `mapa.astro`; `pickBasemapTiles(dark)` solo sigue `html.dark` | Alta |
| Densidad del chrome | ~6 controles visibles | **38 desktop / 26 móvil** medidos por `chrome-budget.spec` (Story 22.1); a ojo, ~20: rail de 8 capas con chips de atajo, sub-opciones, acordeón de 20 overlays, 5 pastillas de herramientas (`mw-measure-*`, `mw-snapshot-*`, `mw-crosshair-btn`), toggle de modelos, pastilla SMN, ⚙, ℹ, búsqueda, ubicación | ids `mw-*` en `InteractiveMap.astro` | Alta |
| Timeline | Barra con escala de fechas, arrastre fino, loop fluido | `<input type=range>` en una pastilla, etiqueta de texto, sin ticks de fecha | `#tl-range`, `#tl-time` | Media |
| Calidad visual de campos | Gradientes nítidos a cualquier zoom | Raster 32×24 interpolado en canvas; borroso al acercar | `renderFieldRaster()` en `mapraster.ts`; Story 13.4 abierta | Media |
| Animación | Frames precargados, sin parpadeo | El satélite pide teselas al cambiar de frame; el prefetch de 16.1 quedó pendiente | `weather-raster.ts` recrea la fuente por frame | Media |
| Móvil | Bottom sheet para ubicación y capas | Tarjeta flotante; panel "Controles" (11.3 parcial) | `mobileControls`, `#mw-welcome`, `placeCardEl` | Media |
| Consistencia | Un lenguaje visual oscuro | Paneles claros sobre mapa gris; ajustes, herramientas y sub-opciones con texto fijo en español; pastillas de 3 estilos | `InteractiveMap.astro`, `sub-options.ts`, `overlayDefs` | Media |

Salvedad: la comparación es sobre DOM y capturas con red simulada (el sandbox no carga Esri ni GIBS). La Story 26.1 convierte esto en evidencia real antes de tocar nada.

---

## 1. Principios de diseño (para no rehacerlo dos veces)

1. **Dark-first sobre el mapa.** Todo lo que flota sobre imagen satelital va en tokens oscuros translúcidos; el tema claro queda para páginas de contenido.
2. **Presupuesto de chrome:** ≤ 8 controles visibles en desktop, ≤ 5 en móvil, verificado por test. Todo lo demás a ≤ 2 toques.
3. **Revelación progresiva:** la capa activa muestra sus sub-opciones; las herramientas viven en un menú; los atajos se aprenden con `?`, no con chips permanentes.
4. **60 fps o nada:** el loop no cambia de frame hasta tener el siguiente precargado; nunca parpadea.
5. **Cero regresiones:** axe, `mobile-audit` (44 px), `map-first-paint` y los tests de hash siguen verdes en cada PR; toda funcionalidad actual sigue accesible.
6. **Medir antes y después:** cada historia cita la métrica de §5 que mueve.

---

## 2. Épicas nuevas

### E21 · Primera impresión: satélite animado por defecto (P0)

**Story 21.1 — Basemap oscuro bajo capas de imagen** · est 1d · **shipped 2026-09-27**
- [x] `basemap-theme.ts`: `pickBasemapTiles()` toma `{ dark, imagery }`; con satélite/radar activo usa `ESRI_DARK_BASE` aunque el tema sea claro; la capa de referencia (etiquetas) pasa **encima** del raster meteorológico con opacidad 0.8.
- [x] Nuevo token `--im-chrome-bg` oscuro para paneles flotantes (`global.css`), usado por rail, timeline, leyenda, pastillas.
- [x] Test unitario de `pickBasemapTiles` (matriz dark × imagery) y e2e: con satélite activo la fuente base es `World_Dark_Gray_Base`.
- Acceptance: en tema claro, activar satélite cambia el basemap a oscuro y las etiquetas siguen legibles sobre las nubes.
- Nota (cómo quedó): el controlador de `basemap-theme.ts` gana `setImagery(on)` (+ `initialImagery`); `showWeatherFrame` / `removeWeatherRaster` en `interactive-map.ts` lo llaman, y el `MutationObserver` del tema sigue vivo (con imagen activa, alternar el tema no cambia teselas; al volver a Base se sigue el tema). Un deep-link o página que arranca en satélite/radar (o `mode=precip`) pide el lienzo oscuro desde la **primera** tesela, sin parpadeo claro→oscuro. Las etiquetas quedan encima **insertando** el raster (dim, raster y radar acompañante de 13.2) *debajo* de `osm-reference` (`beforeLayerId` en `weather-raster.ts`), no moviendo la capa de referencia: así las superposiciones que estaban arriba siguen arriba y `osm-reference` conserva su `raster-opacity` 0.8 desde el controlador (1 sin imagen). Tokens `--im-chrome-bg` (gris-900 al 88 %) y `--im-chrome-fg` en `:root` + clase `.im-chrome`; rail, pastilla del timeline y barra de leyenda los usan en **ambos** temas y llevan además la clase `dark` para que las utilidades `dark:` de sus filas resuelvan sobre el panel oscuro también en tema claro (la variante es por clase, `.dark *`; la detección del tema lee solo `<html>`). Pastillas restantes (ajustes, herramientas, tarjeta de lugar, bienvenida) quedan para 22.x/25.x. e2e (teselas simuladas, `?e2e=1`): fuente `osm` en `World_Light_Gray_Base` → satélite → `World_Dark_Gray_Base` (la petición real de Esri también), `osm-reference` en `World_Dark_Gray_Reference` (no hay petición que observar: la capa está oculta bajo z5 en la vista inicial z4.5), orden `osm < wx-raster-layer < osm-reference`, opacidad 0.8, y vuelta a Base restaura claro/1.

**Story 21.2 — `/mapa` arranca en satélite GeoColor animado** · est 1d · **shipped 2026-09-27**
- [x] `mapa.astro`: `initialLayer="satellite"`; el hash sin `layer` ya no cae en `base` (`maphash.ts` DEFAULT_VIEW.layer → `satellite` solo para `/mapa`; el home embed sigue en radar).
- [x] Autoplay del loop de las últimas 3 h tras el primer frame, salvo `prefers-reduced-motion` o ahorro de datos (`navigator.connection.saveData`); pausa al primer toque.
- [x] `map_layer_unavailable` para satélite ya no existe: sin GIBS se cae a radar, sin RainViewer a base, con toast.
- [x] e2e: `/mapa` fresco → `#layerbtn-satellite` presionado, `#tl-play` en `playing` (con la animación permitida).
- Acceptance: abrir `/mapa` muestra nubes moviéndose sin ningún clic; LCP ≤ 2.5 s en Lighthouse móvil (**pendiente de medir en CI**: el sandbox no carga GIBS; entra en las cifras de 26.2).
- Nota (cómo quedó): `mapa.astro` pasa `initialLayer="satellite"` y `bootAutoplay`; el home embed sigue en radar y las páginas `/mapa/<capa>/` en la suya. **Desviación en el hash:** en vez de un `DEFAULT_VIEW.layer` distinto por página, `parseMapHash` devuelve `layer: null` cuando el hash no trae `layer=` (o no es válido) y así gana el default de la página (`hashed.layer ?? initialLayer`); un `layer=` desconocido sigue cayendo en `base` y `buildMapHash` escribe `null` como `base`. **Autoplay** en `src/lib/map/chrome/boot-autoplay.ts` (puro, con test): solo si la capa que quedó activa es satélite, con ≥ 2 frames, sin `t=` en el hash (un instante compartido se respeta), sin `prefers-reduced-motion` y sin `navigator.connection.saveData`; arranca cuando la fuente `wx-raster` reporta su primer frame cargado (tope 4 s) después de verificar la capa en el mapa (el reintento del arranque puede re-activar). La ventana es 3 h salvo que el usuario haya elegido `loopHours` en ⚙ (se lee el registro crudo de `mw:settings`: `readSettings()` rellena el 24 h por defecto y ese default es justo lo que se anula); la primera pausa —prev/next/range, ▶, cambio de capa, herramientas— cierra la ventana para siempre y el ajuste nunca se escribe. Solo `/mapa` lo activa (`bootAutoplay`); las páginas por capa quedan estáticas (un flag las enciende). **Fallback GIBS** en `src/lib/map/sources/gibs-probe.ts` (puro, con test): en paralelo con el manifiesto de RainViewer se pide *una* tesela GeoColor (z4 · y6 · x3, centro de México, el frame más reciente: la misma URL que MapLibre pedirá, así calienta la caché); fallo de red o HTTP → radar si hay manifiesto, si no base, con `map_layer_unavailable` mostrado *después* de la activación para que el explainer de primera vez (19.2) no lo tape; un timeout (5 s) se queda en satélite. Solo el arranque sondea; el clic en la capa funciona como antes. El botón ▶ nace con `data-state="paused"`. **Dos fugas móviles** que el arranque en satélite hacía visibles desde el primer pintado, corregidas: el slider de opacidad (`hidden … sm:block`) y `tl-now` (`hidden … sm:inline-flex`) perdían `hidden` con una capa activa; ahora en páginas con Controles el panel decide la opacidad y `tl-now` queda oculto bajo `sm` (23.4 rediseña el timeline móvil). **chrome-budget:** línea base 38/26 → **42/27** (desktop suma las 3 sub-opciones GeoColor/IR/Color real y "Ver 10 días"; móvil solo "Ver 10 días"); el spec simula GIBS y espera satélite presionado + loop en marcha en vez de `map.loaded()`/`networkidle`, que con el loop nunca se asientan. **e2e** (Esri, GIBS y RainViewer simulados con el PNG 256×256): fresco → satélite presionado, `#tl-play` en `playing`, el índice salta del frame 143 al inicio de la ventana de 3 h (≥ 120) y prev pausa; solo `view=` → satélite y zoom 6.5; reduced-motion → `paused` + disabled; `t=` → sin autoplay; GIBS 503 → radar + toast + estático; GIBS 503 y manifiesto 500 → base + toast. Tres tests existentes que partían del antiguo default (clic a satélite, tema claro, scrub de radar) arrancan ahora con `layer=base` explícito. **Corrección tras validación (2026-09-28): la capa que elige el visitante gana.** El arranque aterriza tarde (sondeo GIBS ≤ 5 s + manifiesto + primer `idle`, y ~5 s más de reintentos), y una capa elegida en ese lapso —p. ej. temperatura justo después del manifiesto— era sustituida por satélite ~3 s después (y en CI, con teselas, los tests de radar/temperatura/humedad/presión/precipitación/viento/luz solar fallaban de forma intermitente por lo mismo). Ahora `setActiveLayer()` marca `userPickedLayer` y aplica vía `applyLayer()`; el arranque llama `applyLayer()` directo y pregunta antes de activar, antes de **cada** reintento, antes del toast de fallback y antes del autoplay (`bootActivationAllowed()` en `boot-autoplay.ts`, puro, con test; `armBootAutoplay` revisa el flag también al llegar el primer frame). Si el visitante eligió capa antes de que el arranque aterrice, **su capa se queda, no arranca ningún autoplay y no aparece el toast de fallback**. Auditoría de llamadas: todos los que llaman `setActiveLayer` son acciones del visitante (botones del rail, atajos de capa, sub-opciones, modo precipitación, paleta accesible, modelo); ningún camino interno previo al arranque la usa. Además, `applyLayer()` lleva un contador de generación: una activación asíncrona (rejilla de campo o viento) que aterriza después de otra más nueva se descarta sin toast ni cambio de estado — así un deep-link `#layer=temperature` cuya rejilla sigue en vuelo tampoco pisa el radar elegido entretanto. e2e nuevos en el describe de 21.2: clic en temperatura justo tras el manifiesto (GIBS retenido 2 s) → sigue presionada ≥ 6 s, eje de 72 h, `#tl-play` en `paused`, sin toast; y deep-link a temperatura con la rejilla retenida → clic en radar → radar sigue presionado ≥ 6 s tras soltar la rejilla. Con Esri y GIBS simulados todo `mapa.spec.ts` pasa (sin apuntar tests a `layer=base`).

**Story 21.3 — Prefetch y caché de frames** · est 2d · **shipped 2026-09-28**
- [x] `src/lib/map/layers/frame-prefetch.ts`: para raster-tile (satélite y radar) precarga las teselas visibles de los N frames siguientes (`Image()` con las URLs que ya generan `gibsTileUrl`/`rainviewerTileUrl`), N = 6, presupuesto 4 MB, cancelable al cambiar capa o vista.
- [x] `weather-raster.ts`: no recrear fuente por frame; mantener **dos** fuentes (A/B) y alternar con `raster-fade-duration` para un crossfade real.
- [x] Indicador de buffering en el botón de play mientras faltan frames (icono giratorio, `aria-busy`).
- [x] Test: el scheduler no pide más de N frames, respeta el presupuesto y se cancela.
- Acceptance: loop de satélite sin parpadeo a 700 ms por frame; ≤ 1 tesela nueva por frame en la 2.ª vuelta.
- Nota (cómo quedó): **Prefetch** en `frame-prefetch.ts` (puro, con test): geometría (`coveringTileZoom` replica a MapLibre — transform de 512 px, `round`, recorte a `maxzoom` —, `visibleTileCoords` desde bounds + zoom con envoltura en el antimeridiano y orden centro-primero, `fillTileTemplate`, `upcomingFrames` con la misma regla de envoltura del reproductor y la ventana del loop) y un scheduler sobre un `TileLoader` inyectado (`imageTileLoader()`: `Image()` con `crossOrigin='anonymous'`, el mismo modo CORS que el `fetch` de MapLibre, para compartir la caché HTTP). **Presupuesto = ventana:** los 4 MB acotan el peso de *todas* las teselas de los frames programados por delante del cabezal (cacheadas o no); se toman del más cercano al más lejano y el primero que desborda cierra la ventana, así el presupuesto siempre gana a N (a 1280×720 en z4.5 son 32 teselas GeoColor por frame → ~1 MB con la estimación de 32 KB/tesela → 4 frames por delante; a 360×640, 12 teselas → los 6). El tamaño real sustituye a la estimación cuando Resource Timing lo expone (`Timing-Allow-Origin`); la estimación es un supuesto, no una medición (el sandbox no llega a GIBS). Concurrencia 8, LRU de 4 000 URLs, un fallo no se reintenta con la misma clave. La clave (capa, variante, host, zoom, bounds) cancela todo lo que está en vuelo al cambiar; además `movestart` cancela y `moveend` re-planifica si el loop sigue. Se crea solo con `framePrefetch` (`/mapa` y `/mapa/<capa>/`; **nunca** el embed del home ni `/forecast`) y nunca con `navigator.connection.saveData`; solo programa mientras el loop reproduce (▶, autoplay del arranque, cada frame y cada tick). **A/B** en `weather-raster.ts`: `weatherRasterTileSpec()` es la fuente única de URL/tileSize/maxzoom para MapLibre y el prefetch; el slot A conserva los ids `wx-raster`/`wx-raster-layer` (autoplay del arranque, verificación en frío y e2e), el B es `wx-raster-b`/`wx-raster-layer-b` y nace con el segundo frame. Un frame nuevo del mismo producto va al slot oculto (`setTiles`, opacidad 0); cuando su fuente reporta cargada (evento `sourcedata`/`error` diferido un microtask, porque `setTiles` emite `metadata` y `content` seguidos) — o a los 2 s como tope — sube encima (`moveLayer` bajo el acompañante de radar de 13.2 o bajo las etiquetas de 21.1) y entra con `raster-opacity-transition` = `RASTER_FADE_MS` del ajuste "estilo" (300 ms suave, 0 rápido); el saliente queda debajo a opacidad plena durante el fundido y solo después baja a 0 (sin "valle" al 50 %). Un frame nuevo mientras el oculto carga lo re-apunta; volver al frame visible cancela el cambio; un producto distinto (capa, variante GIBS, host de radar) o un estilo reconstruido rehace desde A. `setOpacity` va al slot visible (el slider ya no toca `wx-raster-layer` directo), `setFadeMs` a ambos. **Desviación:** el aviso "Satélite limitado a zoom…" sale al construir el producto, no en cada frame (antes se repetía en cada paso del loop). **Reproductor:** `timeline-player.ts` gana `canAdvance(next) => Promise<boolean>` (con test de timers falsos): el tick espera la respuesta (sí → avanza; no → se queda y vuelve a preguntar en la siguiente cadencia; un rechazo avanza para no congelar el loop) y si tarda más de 150 ms el botón muestra `aria-busy="true"`, `data-buffering` y el símbolo `#i-loader` (nuevo en `IconSprite.astro`) con `motion-safe:animate-spin`; `data-state` sigue en `playing`. En el mapa, `canAdvance` pide al prefetch las teselas del frame siguiente (fuera del presupuesto: es el que se necesita ya) con tope de 3 s; sin prefetch (home, ahorro de datos) no hay puerta y el loop va a la cadencia de siempre. **Pendiente:** 23.2 cambia `setTimeout` por `requestAnimationFrame`; el acompañante de radar del modo precipitación no se precarga (se sigue recreando por frame). **Sonda local (2026-09-28, `/mapa` fresco a 1280×720, loop de arranque de 3 h = 15 frames de GeoColor, 256×256 PNG servido por un servidor HTTPS local con `Cache-Control: max-age=3600` al que Chromium resuelve GIBS/Esri/RainViewer — sin `page.route`, que desactiva la caché HTTP):** 1.ª vuelta **34,1 peticiones de red a GIBS por frame** (todas del prefetch; MapLibre no llegó a la red ni una vez: 601 peticiones en total = 600 del prefetch + la sonda del arranque), 895 ms por frame; **2.ª vuelta: 0 peticiones por frame** (máx. 0), 785 ms por frame. A 360×640: 5,9 → **0** peticiones por frame, 738/743 ms. Con `page.route` (caché desactivada) la 2.ª vuelta registra 0 URLs nuevas y 0 `Image()`, y ~31 `fetch` de MapLibre por frame que repiten URLs ya servidas. Con concurrencia 4 la 1.ª vuelta iba a ~1,5 s por frame (por eso 8). Métrica de §5 "teselas nuevas por frame en la 2.ª vuelta": todas → 0 (sonda local; la cifra con red real la publica 26.2). **e2e** (teselas simuladas): el loop deja `wx-raster-layer` y `wx-raster-layer-b` entre `osm` y `osm-reference` con peticiones de prefetch; con GIBS retenido tras el arranque, ▶ pasa a `aria-busy` con `#i-loader`, `data-state=playing`, el índice quieto, y al soltar avanza; con `saveData` no hay prefetch y ▶ avanza a la cadencia normal. El test existente del scrub de satélite buscaba el TIME anterior en la *última* URL pedida; con A/B el slot A puede seguir terminando sus teselas tras el clic, así que ahora lo busca entre todas las peticiones posteriores al clic (misma aserción, sin cambiar capa ni hash). Controles visibles sin cambio (42/27).

**Story 21.4 — Sin mapa gris: skeleton hasta el primer frame** · est ½d · **shipped 2026-09-27**
- [x] Contenedor del mapa con gradiente oscuro + shimmer (`im-root::before`) que se desvanece al primer `sourcedata` cargado; sin JS extra en el LCP.
- [x] Reusar en el embed del home y en las páginas por capa.
- Acceptance: nunca se ve un rectángulo gris plano; `map-first-paint.spec` sigue verde.
- Nota (cómo quedó): CSS puro en `global.css` (`.im-root::before`: gradiente radial `#1e293b → #0a0e1a` + shimmer lineal de 1.8 s, `z-index: 5` — sobre lienzo y controles de MapLibre, bajo el chrome flotante —, `pointer-events: none`, sin animación con `prefers-reduced-motion`); se desvanece 0.5 s y pasa a `visibility: hidden` cuando el root recibe `.im-ready`. La decisión de *cuándo* vive en `src/lib/map/chrome/map-skeleton.ts` (puro, con test jsdom): primer `sourcedata` con `isSourceLoaded`, más `load` como cinturón y un tope de **8 s** como tirantes para que un mapa sin teselas (offline, CDN caído) nunca esconda su chrome; `destroy()` limpia el temporizador. Como la regla va por la clase `.im-root` del componente Astro, el embed del home, `/mapa`, las páginas por capa y el embed de `/forecast` la comparten sin tocar sus páginas. e2e (teselas retenidas y luego liberadas): el pseudo-elemento existe, opaco, `pointer-events: none`, `z-index < 10`, sin `im-ready`; al soltar las teselas el root recibe `im-ready` y la opacidad llega a 0. `map-first-paint.spec` no simula teselas (mide píxeles reales), así que los 3 tests de pintado se validan en CI; en el sandbox pasan los 3 de montaje sin rAF y, con un tablero 256×256 simulado en una copia local no versionada, también los 3 de pintado.

---

### E22 · Dieta de chrome (P0)

**Story 22.1 — Presupuesto de controles como test** · est ½d · **shipped 2026-09-27**
- [x] `e2e/chrome-budget.spec.ts`: cuenta elementos interactivos visibles sobre el mapa en `/mapa` (desktop 1280 y móvil 360); falla si > 8 / > 5. Primero se escribe con los números actuales como línea base (`test.fixme` hasta 22.5) para que el PR de cada historia lo baje.
- Acceptance: el test existe y documenta el número actual.
- Nota (cómo quedó): **38 en desktop, 26 en móvil** (medido 2026-09-27, carga fría de `/mapa`, capa base, tarjeta de bienvenida ya descartada, teselas simuladas). Dos tests por viewport: el de **línea base** afirma el número exacto (sube → falla; baja → la historia que lo baja actualiza `VARIANTS[].baseline` en el spec y la columna "Hoy" de §5) y el de **presupuesto** (≤ 8 / ≤ 5) queda en `test.fixme` hasta 22.5. Cuenta `button, a[href], input, select, [role=button], summary` con caja no vacía y `checkVisibility()` verdadero que solapan `#map-root` y el viewport; excluye marcadores y popups de MapLibre (datos, no chrome) y el enlace de atribución (legal). Sí cuenta los 3 botones de navegación de MapLibre (zoom ±, brújula), el FAB de feedback, el enlace "Volver al inicio", la pastilla SMN y — sorpresa del inventario — las pastillas Distancia/Área/Mira, que siguen visibles a 360 px pese al `hidden sm:flex` del contenedor porque el bootstrap lo cambia a `flex` en el primer `idle` del mapa en cualquier viewport (22.3 las mete al menú ⋯). La decisión pura (rects → cuenta) vive en `src/lib/map/chrome/chrome-budget.ts` con test unitario; el spec solo mide.

**Story 22.2 — Rail compacto y revelación progresiva** · est 2d · **shipped 2026-09-28**
- [x] Rail: icono + etiqueta corta; sub-opciones (`sub-options.ts`) solo bajo la capa activa, animadas; chips de atajo se retiran del rail (van al panel `?`, Story 22.5).
- [x] Opacidad: pasa de slider permanente a control dentro de la capa activa.
- [x] Overlays: el acordeón "Superposiciones" se vuelve pestaña del panel de capas con búsqueda y los 4 más usados arriba (`tropical`, `clouds`, `precipMode`, `windOverlay`).
- Acceptance: rail desktop ≤ 9 filas visibles con una capa activa; todas las capas y overlays siguen accesibles en ≤ 2 toques.
- Nota (cómo quedó): **Rail** en `InteractiveMap.astro` + `buildLayerButtons()`: desde `sm` una rejilla de 3 columnas de mosaicos icono + etiqueta corta (`shortLabelKey` en `LayerDef`, claves `map_layer_short_*` es/en: Mapa, Radar, Satélite, Temp., Humedad, Presión, Precip., Viento, Sol; test: ≤ 9 caracteres); bajo `sm` sigue la columna de iconos. El nombre completo queda como `aria-label` y `title`, y el `title` lleva la letra ("Radar (R)") hasta el panel `?` de 22.5; ya no hay `<kbd>` en el rail (tampoco en las filas de overlays: la letra va al `title` de la fila). Rail `sm:w-44` → `sm:w-52` para que "Humedad"/"Satellite" no se trunquen. **Bloque de la capa activa** `#mw-rail-active` (`col-span-full`): contiene el hueco `#mw-sub-options` —donde `createSubOptionsGroup` monta ahora sus grupos, como chips que envuelven en 1–2 líneas— y `#opacitywrap`/`#opacity` (mismos ids). `interactive-map.ts` lo re-inserta tras el último mosaico de la fila de la capa activa (`activeBlockAnchor()` en `src/lib/map/chrome/layer-rail.ts`, puro, con test; 3 columnas desde 640 px, 1 debajo, re-colocado en el `change` del `matchMedia` y desmontado en `destroy()`), y lo oculta en Base: **desviación:** en desktop el slider de opacidad ya no se ve en Base (antes estaba siempre, sin efecto). Animación CSS `im-reveal` (160 ms, fade + 4 px; nada con `prefers-reduced-motion`) en el bloque y en cada grupo de sub-opciones: se reinicia en cada cambio de capa (mover el nodo o pasar de `display:none` a visible). **Pestañas** Capas / Superposiciones (`role=tablist`, `aria-selected`, tabindex itinerante, ←/→ con vuelta, Inicio/Fin) cableadas en `src/lib/map/chrome/rail-tabs.ts` (DOM, test jsdom) desde el script del componente, antes y aparte del arranque de MapLibre. `#mw-overlays` y `#layerbtns-overlays` conservan sus ids: el primero pasa de `<details>` a `role=tabpanel` y la pestaña es `#mw-overlays-tab` (con insignia `#mw-overlays-count` de overlays encendidos). **Superposiciones:** `overlay-registry.ts` fija arriba `PINNED_OVERLAYS` (tropical, clouds, precipMode, windOverlay) bajo "Más usadas" y el resto en su orden bajo "Todas"; el filtro `#mw-overlays-filter` (`type=search`) oculta filas sin coincidencia (`overlayMatches()`: sin mayúsculas ni acentos, todas las palabras), esconde el encabezado de un grupo vacío, muestra "Sin coincidencias" y Escape lo limpia (luego Escape cierra Controles como antes); la lista tiene su propio scroll (`max-h-[min(50vh,22rem)]`). Todos los `#overlay-*` siguen ahí. **Móvil:** la barra de pestañas y el bloque activo solo aparecen con Controles abierto (Story 11.3), como antes el slider y el acordeón; al cerrar Controles el rail vuelve a la pestaña Capas (si no, los iconos de capa quedarían ocultos tras una pestaña inalcanzable). **Mejora:** las sub-opciones, antes `max-sm:!hidden` (inalcanzables en teléfono), ahora salen en el bloque con Controles abierto, a 44 px; pestañas, filtro y filas de overlays también miden ≥ 44 px bajo `sm`. El embed del home comparte el rail (5 mosaicos en 2 filas); sin Controles, allí las sub-opciones siguen ocultas bajo `sm` y la opacidad visible con una capa activa, como antes. **Medido** (teselas simuladas, `/mapa` a 1280×800 en satélite): rail de **15 filas visibles** (título, 9 capas, 3 sub-opciones, opacidad, acordeón) → **7** (pestañas, 3 filas de mosaicos, 2 de chips, opacidad); aserción e2e ≤ 9 con `railRowCount()`. Capas: 0 clics (visibles); sub-opciones y opacidad: 1 (la capa); overlays: 2 en desktop (pestaña + casilla). En teléfono alcanzar un overlay sigue costando Controles + pestaña, igual que antes Controles + `summary`. **chrome-budget: 42/27 → 43/27** — **desviación:** la barra de pestañas cuesta un control más que el `summary` que sustituye (las 2 pestañas cuentan; los chips `<kbd>` nunca contaban por no ser interactivos); la baja la llevan 22.3–22.5. **e2e:** tres tests nuevos en `mapa.spec.ts` (≤ 9 filas, solo las sub-opciones de la capa activa dentro del bloque bajo la fila del satélite, sin `<kbd>`, `title` con letra; el bloque sigue a Sol y desaparece en Base; pestaña de overlays con los 4 fijados en orden, las ≥ 20 casillas visibles tras un clic, filtro, Escape y ← a Capas). `mapa-mobile-controls.spec.ts`: sirve Esri/GIBS con el PNG 256×256 y descarta la bienvenida (a 360 px la tarjeta tapa la barra de pestañas hasta cerrarla) para arrancar en satélite en cualquier runner —la opacidad ahora existe solo con capa activa—; toca `#mw-overlays-tab` en vez del `summary`; el test de 44 px cubre también pestañas, chips, filtro y filas; test nuevo: cerrar Controles en la pestaña de overlays devuelve los iconos.

**Story 22.3 — Un solo menú de herramientas** · est 1d · **shipped 2026-09-28**
- [x] Botón ⋯ ("Herramientas") que agrupa Distancia, Área, Capturar, Hace 24 h y Mira (`mw-measure-wrap`, `mw-snapshot-wrap`, `mw-crosshair-btn`) en un popover; el estado activo (p. ej. midiendo) se muestra como una sola pastilla de contexto con "Salir".
- [x] ⚙ Ajustes e ℹ Info pasan al mismo menú como pestañas; el toggle de modelos queda solo cuando hay una capa de pronóstico activa.
- [x] Mantener ids existentes (los tests dependen de ellos); solo cambia el contenedor.
- Acceptance: en `/mapa` con satélite activo se ven: buscar, ubicación, ⋯, rail, timeline, leyenda. Nada más.
- Nota (cómo quedó): **Menú** `#mw-tools` en `InteractiveMap.astro` (donde estaba ℹ, `right-3 top-16`, todos los viewports): botón `#mw-tools-btn` (icono `#i-ellipsis`, nuevo en `IconSprite.astro`; `aria-haspopup=dialog`, `aria-expanded`, `aria-controls=mw-tools-panel`) y popover `#mw-tools-panel` (`role=dialog`, panel oscuro `im-chrome`, `im-reveal`, con scroll propio bajo una altura que libra el timeline y, en teléfono, el FAB) con tres pestañas Herramientas / Ajustes / Info (`#mw-tools-tab-tools|settings|info`, las mismas WAI-ARIA tabs de `rail-tabs.ts`). Cableado en `src/lib/map/chrome/tools-menu.ts` (DOM, test jsdom) desde el script del componente, antes y aparte del arranque de MapLibre: el botón abre/cierra, abrir enfoca la pestaña seleccionada, **Escape** cierra y devuelve el foco al ⋯ (sin trampa de foco), una pulsación fuera lo cierra, y elegir una herramienta (`[data-tools-close]`) lo cierra tras correr su propio handler para que el siguiente clic caiga en el mapa. **Ids intactos:** `#mw-measure-wrap` (Distancia, Área, Mira — `#mw-crosshair-btn`) y `#mw-snapshot-wrap` (Capturar, Hace 24 h, Limpiar) solo cambiaron de contenedor (pestaña `#mw-tools-tools`), como mosaicos icono + etiqueta de 44 px; `#mw-settings` e `#mw-info` pasan de `<details>` a paneles de pestaña (sus grupos `[data-mw-*]` y `#mw-layer-page-link` no cambian; ya no hay `summary`). El wrap de medir sigue `[hidden]` hasta que el estilo del mapa carga (`load`), no hasta el primer `idle`: con el bucle de satélite del arranque el mapa tardaba de 2 a 45 s en quedar quieto y el menú mostraba el título "Medir" sin botones debajo (antes además cambiaba `hidden` por `flex` en cualquier viewport: así se colaban Distancia/Área/Mira en el teléfono). **Volver al inicio** deja la esquina superior izquierda del mapa y encabeza la pestaña Info (`#mw-back-home`; la superposición solo queda para un consumidor con `backLink` sin pestaña Info, hoy ninguno). **Sin botones +/−/brújula** en `/mapa` y `/mapa/<capa>/`: flag nuevo `gestureZoomOnly` (en ambas páginas) que omite el `NavigationControl` de MapLibre; el zoom sigue con rueda, pellizco, doble clic y teclado (+/−, flechas), y los embeds conservan los botones. **Pastilla de contexto** `#mw-tool-pill` (arriba al centro: bajo la fila de búsqueda en teléfono, en la barra superior desde `sm`): mientras hay una herramienta encendida (midiendo, mira o una captura) nombra la(s) activa(s) (`activeToolNames()` en `src/lib/map/chrome/tool-pill.ts`, puro, con test: "Distancia", "Distancia · Mira", "Comparación"…) y ofrece **Salir**, que apaga todas. Lleva además el total en curso (`#mw-measure-result`, antes pastilla propia abajo a la derecha — y oculta en teléfono) y el Mostrar/Ocultar de la comparación (`#mw-snapshot-toggle`, antes en la columna de captura; en teléfono solo el icono, con `aria-label` completo), para no reabrir el menú a mitad de una comparación. `snapshot-compare.ts` gana `isActive()`, `clear()` y `onChange` (con test); el texto visible del toggle pasa a "Ocultar"/"Mostrar" y el nombre accesible conserva "… comparación". **Modelos:** `#mw-model-toggle` sale `[hidden]` y `interactive-map.ts` lo muestra solo con una capa `field` o `particles` activa (`modelToggleApplies()` en `model-toggle.ts`, con test que lo compara con las capas cuyo grid re-pide el modelo); en teléfono sigue además detrás de Controles. **Desviaciones:** (1) la aceptación se cumple salvo dos controles que quedan a propósito: la pastilla SMN (la convierte 22.4 en contador de la barra superior) y el FAB de feedback de todo el sitio (la superficie de reporte de Inceptor, no es chrome del mapa); (2) **Salir** apaga todas las herramientas activas, no solo la última (una sola pastilla ⇒ una sola salida); (3) mientras se mide, un clic en el mapa ya no abre la tarjeta de lugar (antes abría ambas cosas y ahora la tarjeta taparía la pastilla); (4) un Escape que ya consumió otro control (cerrar el menú, la búsqueda) no sale además de la medición — el siguiente sí; (5) los botones de Ajustes miden 44 px de alto bajo `sm` (antes ~26 px); (6) la fila de búsqueda sube a `z-[21]` para que su lista de sugerencias quede sobre el ⋯. Controles (Story 11.3) ya no revela medir/captura: están en el ⋯ en todos los viewports. **chrome-budget: 43/27 → 28/19** (desktop: −5 pastillas, −⚙ −ℹ, +⋯, −5 segmentos de modelo en satélite, −Volver al inicio, −3 botones de navegación; móvil: −3 pastillas, −⚙ −ℹ, +⋯, −Volver al inicio, −3 botones de navegación). **e2e:** `mapa.spec.ts` — el test de ajustes abre ⋯ → Ajustes (y lo cierra con ⋯) en vez del `summary`; bloque nuevo "Story 22.3" con 4 tests (herramientas/ajustes/info en pestañas con los ids dentro del popover y ocultos hasta abrir, foco, ←/→, "Volver al inicio" dentro de Info y único en la página, sin `.maplibregl-ctrl-zoom-in`, Escape devuelve el foco, clic fuera cierra; pastilla única "Mira" → "Distancia · Mira" con total y sin tarjeta de lugar, Escape cierra primero el menú y luego sale de medir, Salir apaga todo; comparación con Ocultar/Mostrar en la pastilla y Limpiar en el menú; el toggle de modelos visible en temperatura y oculto en sol y satélite). `openOnSatellite` sube a nivel de módulo para compartirlo con 22.2. `mapa-mobile-controls.spec.ts`: el toggle de modelos queda oculto en satélite aun con Controles abierto; el cambio a GFS y la regla de 44 px de los segmentos se hacen tras pasar a temperatura (grid pre-horneado, sin API). `mobile-audit.spec.ts`: los `summary` de ⚙/ℹ salen de la regla estricta y entran `#mw-tools-btn`, las pestañas, las herramientas y los botones de la pastilla, con un test nuevo que abre el menú (3 pestañas, 5 herramientas) y enciende la mira (Salir). `a11y.spec.ts`: axe sobre cada pestaña del menú abierto. `home.spec.ts`: el embed tampoco pinta `#mw-tools-btn` ni `#mw-tool-pill`. `chrome-budget.spec.ts` espera a que el wrap de medir pierda `[hidden]` (ya no es visible con el menú cerrado). Bloque "Story 22.3" repetido 6 veces con `--workers=1` y teselas simuladas: 24/24.

**Story 22.4 — Avisos SMN integrados** · est ½d
- [ ] La pastilla flotante `#mapa-smn-panel` se convierte en un contador en la barra superior (junto a buscar) que abre el panel de alertas existente; oculta cuando hay 0.
- Acceptance: un control menos; el panel sigue disponible con el conteo correcto.

**Story 22.5 — Panel de atajos `?`** · est ½d
- [ ] Tecla `?` (y entrada en el menú ⋯) abre un cheat-sheet generado desde `LAYERS` y `overlayDefs` (fuente única, es/en).
- [ ] Al cerrar 22.2–22.5, el test de 22.1 pasa a `test()` real.
- Acceptance: `chrome-budget.spec` verde; ningún atajo perdió su tecla.

---

### E23 · Timeline de verdad (P1)

**Story 23.1 — Barra con escala de fechas** · est 3d
- [ ] `src/lib/map/chrome/timeline-bar.ts`: canvas/SVG con ticks de hora y día (locale, tz y formato de hora de `settings.ts`), marca "ahora", zona pasado/futuro sombreada, frame actual; arrastre con puntero, rueda para pasos, teclado ← → Home End.
- [ ] `#tl-range` se mantiene como control accesible (visually-hidden) sincronizado: los e2e y lectores de pantalla siguen funcionando.
- [ ] El botón "Ver 10 días" se vuelve un tramo punteado al final de la barra: arrastrar hacia él extiende.
- [ ] Tests unitarios de la geometría (tiempo ↔ px) y de los ticks por rango (3 h, 24 h, 10 d).
- Acceptance: arrastrar sobre la barra cambia frames sin soltar; se lee la fecha sin leer la etiqueta.

**Story 23.2 — Loop fluido** · est 1d
- [ ] `timeline-player.ts`: planificar con `requestAnimationFrame` + timestamp en vez de `setTimeout`; no avanzar si el siguiente frame no está precargado (21.3); crossfade sincronizado con `raster-fade-duration`.
- [ ] Medición: `PerformanceObserver` de long tasks durante 10 s de loop; publicado por la Story 26.2.
- Acceptance: ≥ 30 fps sostenidos en un móvil medio (Moto G power o similar) durante el loop de satélite.

**Story 23.3 — Saltar a fecha** · est ½d
- [ ] Clic en la etiqueta de fecha abre `<input type=date>`/hora nativo acotado al rango de la capa; para satélite (10 d) y campos (−1 d…+10 d).
- Acceptance: elegir una fecha lleva al frame más cercano y actualiza el hash `t=`.

**Story 23.4 — Timeline móvil a ancho completo** · est 1d
- [ ] Bajo `sm`: barra pegada al borde inferior, ancho 100 %, altura 56 px, gestos horizontales sin robar el pan del mapa (`touch-action: pan-x` solo sobre la barra).
- Acceptance: `mobile-audit` y `mapa-mobile-controls` verdes; el scrub con el pulgar no mueve el mapa.

---

### E24 · Calidad visual de datos (P1)

**Story 24.1 — Renderer WebGL de campos** (= ROADMAP Story 13.4, se ejecuta aquí) · est 1wk
- [ ] Fragment shader que muestrea el grid 32×24 como textura con interpolación bicúbica en GPU y aplica la rampa (LUT 1-D) — mismas rampas que `mapfields.ts` (test de regresión pixel a pixel contra `renderFieldRaster`).
- [ ] Fallback a canvas cuando no hay WebGL2 (flag), y en `prefers-reduced-motion` nada cambia.
- [ ] Transparencia por valor (precipitación) y alfa de borde como hoy.
- Acceptance: gradientes nítidos a z ≥ 8; tiempo de render por frame < 4 ms en desktop.

**Story 24.2 — Detalle local bajo demanda** · est 2d
- [ ] A zoom ≥ 6, pedir un subgrid de 768 puntos del viewport (misma cuota por llamada) y mezclarlo con el grid nacional (`mergeFieldGrids` por bounds); cache por vista y hora; contabilizado en `quota-audit.py` (solo cliente, documentar).
- Acceptance: acercar a una ciudad muestra estructura (valle, costa) en vez de manchas.

**Story 24.3 — Leyenda continua y tipografía del mapa** · est 1d
- [ ] Leyenda como gradiente continuo con marcas, no swatches; unidad integrada; misma fuente que las etiquetas del mapa (`Open Sans` ya cargada por MapLibre).
- [ ] Etiquetas de ciudades/valores con tamaño por zoom y halo consistente (`city-values.ts`, `isobars.ts`).
- Acceptance: una sola familia tipográfica sobre el mapa; leyenda legible en 360 px.

**Story 24.4 — Viento con estela y color por velocidad** · est 2d
- [ ] `wind-particles.ts`: estela (fade del frame anterior), densidad por zoom, color por velocidad usando `WIND_LEGEND`; respeta reduced-motion (flechas estáticas).
- Acceptance: se distingue calma de vendaval sin leer la leyenda; fps no cae bajo 30 en móvil.

---

### E25 · Móvil y sistema visual (P1)

**Story 25.1 — Bottom sheet** (= ROADMAP Story 11.3, completa) · est 2d
- [ ] Componente `bottom-sheet.ts` (tres alturas: pico, medio, completo; gesto y teclado) para la tarjeta de lugar (15.4), capas/overlays (22.2) y herramientas (22.3) bajo `sm`.
- Acceptance: en 360×640 todo el chrome cabe sin superponerse al timeline; `mobile-audit` verde.

**Story 25.2 — Tema oscuro del chrome del mapa** · est 1d
- [ ] Tokens `--im-*` en `global.css` (fondo, borde, texto, acento) y sustitución de las clases `bg-white/95 … dark:bg-gray-900/95` de `InteractiveMap.astro` por los tokens; el tema claro global no afecta a lo que flota sobre el mapa.
- Acceptance: capturas en claro y oscuro son idénticas sobre el mapa; contraste AA en todos los textos (axe).

**Story 25.3 — i18n completo de paneles** · est 1d
- [ ] Mover a `ui.ts` (es/en): ajustes (zona horaria, unidades, animación), herramientas, etiquetas de sub-opciones y `overlayDefs.label`, textos del panel de info.
- [ ] Test que falla si `InteractiveMap.astro` o `interactive-map.ts` contienen literales con acento fuera de `ui.ts` (lista blanca corta).
- Acceptance: `?lang=en` deja `/mapa` sin español visible.

**Story 25.4 — Micro-interacciones y pulido** · est 1d
- [ ] Transiciones de paneles (150 ms, respetan reduced-motion), estados hover/pressed/focus unificados (una clase `im-btn`), iconos de sprite para lo que aún usa emoji (⚠️ SMN, 🌀), sombras y radios consistentes.
- Acceptance: una sola spec de botón en `InteractiveMap.astro`; sin emoji en el chrome.

---

### E26 · Medición y evidencia (P0 técnico, va primero)

**Story 26.1 — Auditoría visual lado a lado** · est 1d · **shipped 2026-09-27** (herramienta; la primera hoja real se produce con el workflow, no desde el sandbox)
- [x] `scripts/visual-audit.mjs` (Playwright con red real, workflow manual `visual-audit.yml`): captura `/mapa` en 3 viewports (1280, 768, 360) en satélite, radar y temperatura, y el mismo estado en zoom.earth; guarda las parejas como artefacto y una hoja `docs/UX_AUDIT_<fecha>.md` con checklist (§0) marcada a mano.
- Desviaciones: la hoja se genera en `audit-out/UX_AUDIT_<fecha>.md` (artefacto del workflow, 7 días) desde `scripts/visual-audit-template.md` y se copia a `docs/` una vez marcada a mano, para no versionar capturas sin revisar. `--mock` sustituye teselas/APIs por el PNG 256×256 y zoom.earth por una página placeholder (prueba de humo sin red; validado en el sandbox: 18/18 capturas). Un estado de zoom.earth que no carga no aborta: se captura lo que haya y queda anotado en §4 de la hoja. Uso en `docs/USER_GUIDE.md` › Developer notes.
- Acceptance: primera auditoría publicada antes de la Story 21.1 (**pendiente**: ejecutar `visual-audit.yml` y publicar la hoja); se repite al cerrar cada épica.

**Story 26.2 — Métricas de UX en CI** · est 1d
- [ ] `e2e/ux-metrics.spec.ts`: tiempo a primer frame de satélite, fps del loop (10 s), controles visibles, conteo de peticiones por frame; escribe `ux-metrics.json` como artefacto y comenta el delta en el PR (job `pull_request`).
- [ ] Umbrales suaves (aviso) al principio; duros al cerrar E21–E23.
- Acceptance: cada PR muestra las 4 cifras; ninguna empeora sin que se vea.

**Story 26.3 — Prueba con 5 personas** · est 1d (opcional, con el usuario)
- [ ] Tres tareas cronometradas ("¿está lloviendo en mi ciudad?", "pronóstico del sábado", "¿hacia dónde va el huracán?") antes y después de E21–E22; guion y hoja en `docs/UX_TEST.md`.
- Acceptance: tiempo mediano de la tarea 1 < 5 s tras E21–E22.

---

## 3. Integración con el backlog existente

| Existente | Relación |
|---|---|
| ROADMAP 10.x first paint | 21.4 y 26.2 lo miden; ninguna historia aquí puede empeorar `map-first-paint.spec`. |
| ROADMAP 11.3 chrome móvil | Se cierra con 25.1 (bottom sheet) + 23.4 (timeline móvil). |
| ROADMAP 12.x plugin registry | 21.3 y 24.1 nacen como módulos en `src/lib/map/layers/`, no en el monolito. |
| ROADMAP 13.4 WebGL | = 24.1. |
| PLAN_PRO_GRATIS 16.1 (prefetch pendiente) | = 21.3. |
| PLAN_PRO_GRATIS 20.1 / 16.2 / 16.3 (infra) | Independientes; no bloquean nada de aquí. |
| PLAN_HOME_MAP_FIRST fase 4 | Leyenda móvil y timeline = 23.4 + 24.3. |

---

## 4. Orden de ejecución e hitos

**Hito V1 · "Se ve como zoom.earth" (≈ 3 semanas):** 26.1 → 22.1 → 21.1 → 21.2 → 21.3 → 21.4 → 22.2 → 22.3 → 22.4 → 22.5 → 26.2. Al cerrar: satélite animado al abrir, ≤ 8 controles, auditoría con capturas.

**Hito V2 · "Se siente como zoom.earth" (≈ 3 semanas):** 23.1 → 23.2 → 23.3 → 23.4 → 25.2 → 25.3.

**Hito V3 · "Se ve mejor que zoom.earth" (≈ 4 semanas):** 24.1 → 24.3 → 24.2 → 24.4 → 25.1 → 25.4 → 26.3.

Total ≈ 10 semanas de una persona, en PRs de ½–5 días. Cada PR: `npm run build/check/test`, e2e, `chrome-budget`, `mobile-audit`, axe, y las cifras de 26.2 en el comentario del PR.

---

## 5. Métricas de éxito

| Métrica | Hoy (estimado salvo que se indique medido) | Meta | Cómo se mide |
|---|---|---|---|
| Controles visibles en `/mapa` (desktop / móvil) | **28 / 19** (medido 2026-09-28 tras la Story 22.3: Distancia/Área/Mira, Capturar/Hace 24 h, ⚙, ℹ y "Volver al inicio" pasan al menú ⋯, sin los 3 botones de navegación de MapLibre, y los 5 segmentos de modelo solo salen con una capa de pronóstico; **43 / 27** tras la Story 22.2: las pestañas Capas / Superposiciones cuentan uno más que el `summary` del acordeón; el rail pasó de 15 a 7 filas visibles; **42 / 27** tras la Story 21.2, cuyo arranque en satélite muestra sus 3 sub-opciones y "Ver 10 días"; en capa base eran **38 / 26**, Story 22.1; la estimación previa de ~20 / ~10 no contaba los 9 botones del rail uno a uno, el navegador de MapLibre, el FAB ni la pastilla SMN) | ≤ 8 / ≤ 5 | `chrome-budget.spec` |
| Tiempo a primer frame de satélite (4G simulado) | sin medir (arranca en satélite desde la Story 21.2) | < 2 s | `ux-metrics.spec` |
| fps del loop de satélite en móvil medio | n/a | ≥ 30, sin parpadeo | `ux-metrics.spec` |
| Teselas nuevas por frame en la 2.ª vuelta del loop | **0** (sonda local de la Story 21.3 con caché HTTP real y teselas simuladas; antes: todas) | ≤ 1 | `ux-metrics.spec` |
| Texto en español fijo en paneles con `?lang=en` | decenas de cadenas | 0 | test de 25.3 |
| LCP móvil de `/mapa` (Lighthouse) | verde hoy | se mantiene ≤ 2.5 s | Lighthouse CI |
| axe / tap targets 44 px | verde | verde | `a11y.spec`, `mobile-audit` |
| Tarea "¿llueve en mi ciudad?" (mediana) | sin dato | < 5 s | 26.3 |

---

## 6. Riesgos

- **Ancho de banda del prefetch (21.3):** 6 frames × teselas visibles puede ser 2–4 MB en desktop; presupuesto duro, `saveData` respetado, y nunca en el embed del home.
- **Basemap oscuro y legibilidad (21.1):** etiquetas sobre nubes blancas; la capa de referencia encima con halo resuelve la mayoría, se valida en 26.1.
- **Ocultar el `input range` (23.1):** riesgo a11y; se mantiene en el árbol de accesibilidad y los tests siguen usándolo.
- **Selectores de e2e:** 40+ tests dependen de ids `mw-*`/`tl-*`; la regla es mover contenedores sin renombrar ids.
- **WebGL (24.1):** Safari iOS y GPUs integradas; fallback a canvas obligatorio y comparado pixel a pixel.
- **Cuota Open-Meteo (24.2):** es tráfico de cliente, fuera de `quota-audit.py`; se limita a zoom ≥ 6 y cache por vista.
