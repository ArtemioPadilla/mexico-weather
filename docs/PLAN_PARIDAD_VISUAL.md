# Plan: paridad de UX/UI con zoom.earth

Estado: **propuesto** · 2026-09-27 · Continúa la numeración de `docs/ROADMAP.md` y `docs/PLAN_PRO_GRATIS.md` (E21–E26, Story 21.x–26.x): épica → historia (~1 PR, tag `Story N.M`) → tarea (`[ ]`), prioridad P0–P2, estimaciones honestas. Cada historia trae criterio de aceptación medible y el archivo donde vive el cambio.

---

## 0. Diagnóstico: en datos ganamos, en experiencia todavía no

Tras `PLAN_PRO_GRATIS` (18/21 historias en `main`) el sitio da gratis todo lo que zoom.earth cobra y más (10 días, satélite con 10 días de historia, cono de ciclones, alertas sin backend, 17 overlays MX, cero anuncios). Lo que sigue por debajo es lo que la gente ve en los primeros 5 segundos y lo que siente al arrastrar el timeline.

| Dimensión | zoom.earth | Nosotros (`/mapa`, `main` @ 2026-09-27) | Evidencia | Brecha |
|---|---|---|---|---|
| Primera impresión | Satélite animado a pantalla completa sobre basemap oscuro, sin interacción | Basemap gris claro, capa base (o radar en home); el mapa "vacío" hasta elegir capa | `initialLayer` ausente en `mapa.astro`; `pickBasemapTiles(dark)` solo sigue `html.dark` | Alta |
| Densidad del chrome | ~6 controles visibles | ~20: rail de 8 capas con chips de atajo, sub-opciones, acordeón de 20 overlays, 5 pastillas de herramientas (`mw-measure-*`, `mw-snapshot-*`, `mw-crosshair-btn`), toggle de modelos, pastilla SMN, ⚙, ℹ, búsqueda, ubicación | ids `mw-*` en `InteractiveMap.astro` | Alta |
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

**Story 21.1 — Basemap oscuro bajo capas de imagen** · est 1d
- [ ] `basemap-theme.ts`: `pickBasemapTiles()` toma `{ dark, imagery }`; con satélite/radar activo usa `ESRI_DARK_BASE` aunque el tema sea claro; la capa de referencia (etiquetas) pasa **encima** del raster meteorológico con opacidad 0.8.
- [ ] Nuevo token `--im-chrome-bg` oscuro para paneles flotantes (`global.css`), usado por rail, timeline, leyenda, pastillas.
- [ ] Test unitario de `pickBasemapTiles` (matriz dark × imagery) y e2e: con satélite activo la fuente base es `World_Dark_Gray_Base`.
- Acceptance: en tema claro, activar satélite cambia el basemap a oscuro y las etiquetas siguen legibles sobre las nubes.

**Story 21.2 — `/mapa` arranca en satélite GeoColor animado** · est 1d
- [ ] `mapa.astro`: `initialLayer="satellite"`; el hash sin `layer` ya no cae en `base` (`maphash.ts` DEFAULT_VIEW.layer → `satellite` solo para `/mapa`; el home embed sigue en radar).
- [ ] Autoplay del loop de las últimas 3 h tras el primer frame, salvo `prefers-reduced-motion` o ahorro de datos (`navigator.connection.saveData`); pausa al primer toque.
- [ ] `map_layer_unavailable` para satélite ya no existe: sin GIBS se cae a radar, sin RainViewer a base, con toast.
- [ ] e2e: `/mapa` fresco → `#layerbtn-satellite` presionado, `#tl-play` en `playing` (con la animación permitida).
- Acceptance: abrir `/mapa` muestra nubes moviéndose sin ningún clic; LCP ≤ 2.5 s en Lighthouse móvil.

**Story 21.3 — Prefetch y caché de frames** · est 2d
- [ ] `src/lib/map/layers/frame-prefetch.ts`: para raster-tile (satélite y radar) precarga las teselas visibles de los N frames siguientes (`Image()` con las URLs que ya generan `gibsTileUrl`/`rainviewerTileUrl`), N = 6, presupuesto 4 MB, cancelable al cambiar capa o vista.
- [ ] `weather-raster.ts`: no recrear fuente por frame; mantener **dos** fuentes (A/B) y alternar con `raster-fade-duration` para un crossfade real.
- [ ] Indicador de buffering en el botón de play mientras faltan frames (icono giratorio, `aria-busy`).
- [ ] Test: el scheduler no pide más de N frames, respeta el presupuesto y se cancela.
- Acceptance: loop de satélite sin parpadeo a 700 ms por frame; ≤ 1 tesela nueva por frame en la 2.ª vuelta.

**Story 21.4 — Sin mapa gris: skeleton hasta el primer frame** · est ½d
- [ ] Contenedor del mapa con gradiente oscuro + shimmer (`im-root::before`) que se desvanece al primer `sourcedata` cargado; sin JS extra en el LCP.
- [ ] Reusar en el embed del home y en las páginas por capa.
- Acceptance: nunca se ve un rectángulo gris plano; `map-first-paint.spec` sigue verde.

---

### E22 · Dieta de chrome (P0)

**Story 22.1 — Presupuesto de controles como test** · est ½d
- [ ] `e2e/chrome-budget.spec.ts`: cuenta elementos interactivos visibles sobre el mapa en `/mapa` (desktop 1280 y móvil 360); falla si > 8 / > 5. Primero se escribe con los números actuales como línea base (`test.fixme` hasta 22.5) para que el PR de cada historia lo baje.
- Acceptance: el test existe y documenta el número actual.

**Story 22.2 — Rail compacto y revelación progresiva** · est 2d
- [ ] Rail: icono + etiqueta corta; sub-opciones (`sub-options.ts`) solo bajo la capa activa, animadas; chips de atajo se retiran del rail (van al panel `?`, Story 22.5).
- [ ] Opacidad: pasa de slider permanente a control dentro de la capa activa.
- [ ] Overlays: el acordeón "Superposiciones" se vuelve pestaña del panel de capas con búsqueda y los 4 más usados arriba (`tropical`, `clouds`, `precipMode`, `windOverlay`).
- Acceptance: rail desktop ≤ 9 filas visibles con una capa activa; todas las capas y overlays siguen accesibles en ≤ 2 toques.

**Story 22.3 — Un solo menú de herramientas** · est 1d
- [ ] Botón ⋯ ("Herramientas") que agrupa Distancia, Área, Capturar, Hace 24 h y Mira (`mw-measure-wrap`, `mw-snapshot-wrap`, `mw-crosshair-btn`) en un popover; el estado activo (p. ej. midiendo) se muestra como una sola pastilla de contexto con "Salir".
- [ ] ⚙ Ajustes e ℹ Info pasan al mismo menú como pestañas; el toggle de modelos queda solo cuando hay una capa de pronóstico activa.
- [ ] Mantener ids existentes (los tests dependen de ellos); solo cambia el contenedor.
- Acceptance: en `/mapa` con satélite activo se ven: buscar, ubicación, ⋯, rail, timeline, leyenda. Nada más.

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

| Métrica | Hoy (estimado) | Meta | Cómo se mide |
|---|---|---|---|
| Controles visibles en `/mapa` (desktop / móvil) | ~20 / ~10 | ≤ 8 / ≤ 5 | `chrome-budget.spec` |
| Tiempo a primer frame de satélite (4G simulado) | n/a (no arranca en satélite) | < 2 s | `ux-metrics.spec` |
| fps del loop de satélite en móvil medio | n/a | ≥ 30, sin parpadeo | `ux-metrics.spec` |
| Teselas nuevas por frame en la 2.ª vuelta del loop | todas | ≤ 1 | `ux-metrics.spec` |
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
