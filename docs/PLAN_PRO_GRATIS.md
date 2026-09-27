# Plan: la UX y el valor de zoom.earth, con su tier Pro gratis

Estado: **propuesto** · 2026-09-27 · Continúa la numeración de `docs/ROADMAP.md` (E15–E20, Story 15.x–20.x) y usa sus convenciones: épica → historia (~1 PR, tag `Story N.M`) → tarea (`[ ]`), prioridad P0–P4, estimaciones honestas.

Restricciones que **no se tocan**: sin tracking, sin cookies, sin cuentas, sin API keys, sin backend. Cada historia dice cómo las respeta.

---

## 0. ¿Ya existe un plan comprensivo? Sí, pero apunta a otra meta

`docs/ROADMAP.md` (revisado 2026-07-29) sí es un plan real: 14 épicas, 9 shipped (E1–E9) y 5 abiertas (E10–E14) con 19 historias, tareas con checkbox, criterios de aceptación y estimaciones. Solo **1 issue abierto** en GitHub (#136, la migración al plugin-registry); todo lo demás vive en el markdown.

Lo que el roadmap actual **no** cubre para esta meta:

| Hueco | Detalle |
|---|---|
| Declara "paridad funcional total" con zoom.earth | Es paridad de *cantidad* de capas (17 overlays vs 16). En profundidad temporal zoom.earth gratis nos gana: 10 días de satélite, 72 h de radar, ~10 días de corridas pasadas; nosotros 0 h de historia en campos, 2 h de radar y el satélite **no** hace scrub (el timeline muestra frames de RainViewer pero `weather-raster.ts` siempre pide `gibsRoundedTime()`). |
| "PRO tier: ⛔ won't do" | Está escrito como "no cobrar", correcto. Pero nunca se listó *qué* es el Pro de zoom.earth para darlo gratis. Ese es el objeto de este plan. |
| Sin historias para horizonte de pronóstico | `/forecast` = 7 días, snapshot de ciudades = 8, campos del mapa = **2 días**. zoom.earth free = 60 h, Pro = 10 días. |
| Sin historias para nowcast > 30 min ni archivo de radar | RainViewer da 2 h atrás + 30 min adelante. |
| Alertas push en icebox (14.1) sin diseño | Es la única feature Pro de zoom.earth que necesita "algo que envíe". Hay una solución sin backend (ver E17). |
| Higiene de datos | 460 commits de bot en 12 días sobre `main` (snapshots cada 15 min). Cualquier archivo histórico (radar, campos) haría explotar el repo si se sigue commiteando en `main`. |

---

## 1. Qué cobra zoom.earth (verificado 2026-09-27) y dónde estamos

Zoom Earth Pro: suscripción in-app, **$1.99/mes o $11.99/año** (US), cuenta opcional para usarla en web. Todo lo demás (12 capas, 16 overlays, 2 modelos, HD, medición, share) es igual en free y Pro (verificado en su bundle JS).

| # | Feature Pro de zoom.earth | Free de zoom.earth | Nosotros hoy | Qué falta |
|---|---|---|---|---|
| P1 | Mapas de pronóstico hasta **10 días** | +60 h | **2 días** (campos), 7 en `/forecast` | E15 · Story 15.1–15.3 |
| P2 | Nowcast de radar hasta **60 min** | ~16 min | **30 min** (RainViewer) — ya supera su free | E16 · Story 16.3 para 60 min |
| P3 | Alertas push de sistemas tropicales | ninguna | Banner local por reglas, RSS SMN, `/huracanes` | E17 |
| P4 | Sin anuncios | AdSense header/footer | **Sin anuncios, nunca** | ✅ ya |
| P5 | Tarjeta diaria de **10 días** en el panel de ubicación | 5 días | 7 días en `/forecast`, 8 en `/clima/<slug>`, **0** en el mapa (no hay tarjeta al tocar) | E15 · Story 15.4 + Fase 4 del plan home |
| P6 | **30** ubicaciones guardadas | 3 | Ilimitadas (localStorage) | ✅ ya |
| P7 | Cambio automático ICON→GFS al agotar ICON | manual | `best_match` de Open-Meteo lo hace por punto | ✅ ya (documentar) |

Tres de siete ya las damos gratis. Las otras cuatro son E15, E16 y E17.

## 2. Qué da zoom.earth **gratis** y nosotros no

| Free de zoom.earth | Nosotros | Plan |
|---|---|---|
| Satélite GeoColor con **10 días** de historia (frames cada 10 min) | Solo "ahora"; scrub sin efecto | Story 16.1 |
| Radar con **72 h** de historia | 2 h | Story 16.2 |
| Corridas pasadas de ICON/GFS (~10 días) en los mapas de pronóstico | Ninguna; frames empiezan hoy 00Z | Story 15.2 (24 h) |
| 9 mapas de pronóstico incl. **Precipitación** (lluvia/nieve/nubes), rachas, sensación, punto de rocío, bulbo húmedo | Faltan precipitación pronosticada como campo y la vista combinada | Story 15.5, 13.2 |
| Páginas de tormenta con **cono**, track, watches/warnings | Posición + categoría, sin cono | Story 18.1 |
| Panel de ubicación al tocar el mapa (diario/horario) | No existe en el mapa | Story 15.4 |
| Crosshair mode (valor en el centro), animación de lluvia, isolíneas con valores | Isobaras sin valores; tooltip de una métrica | Story 13.1 (existente), 18.3 |
| Páginas por capa `/maps/radar/`, `/maps/satellite/` (SEO) | Solo `/mapa#layer=` | Story 19.1 |
| Onboarding: "Welcome, show your location" + intro por capa | Nada | Story 19.2 |
| Ajustes de unidades (°F, mph, inHg), 12/24 h, TZ | Solo TZ + formato de hora | Story 19.3 |
| Loop de satélite 3/6/12/24 h, velocidad de animación | Play fijo a 700 ms | Story 16.4 |

Donde **ya ganamos**: 17 overlays MX-específicos (SMN por estado, sismos, AQI, marina, volcanes, playas, webcams), 5 modelos (ellos 2), tooltip, comparador, `/pregunta`, i18n, cero anuncios, cero tracking. Nada de esto se toca.

---

## 3. Épicas nuevas

### E15 · Pronóstico a 10 días (P1) — el "Pro" más visible

> Outcome: cualquier capa de pronóstico se puede llevar a +10 días en el mapa y en cada tarjeta, gratis, sin romper la cuota de Open-Meteo ni el repo.

**Presupuesto de datos, antes de codear.** Open-Meteo no-comercial: 10 000 llamadas/día, con 429 por minuto observados en `build-field-grids.py`. Hoy: 4 chunks × 4 variables cada hora ≈ 400/día. Pasar `forecast_days=2→10` **no** añade llamadas, añade payload: 768 pts × 240 h × 4 vars ≈ 740 k valores ≈ 3–4 MB por snapshot. Commitearlo cada hora en `main` es inviable (ver E20). Decisión: días 0–2 horario (como hoy, baked), días 3–10 a **3 h** (`temporal_resolution=hourly_3`) y fetch **on demand** en el cliente solo cuando el usuario cruza +48 h, cacheado 10 min (`cachedFetch` ya existe).

**Story 15.1 — Horizonte de 10 días en campos (temp/humedad/presión/nubes/viento)** · est 3d · **shipped 2026-09-27** (nubes queda en frame 0: el overlay es estático por diseño)
- [ ] `src/lib/mapfields.ts`: `forecast_days` 2→10 con `temporal_resolution=hourly_3` a partir de +48 h; unificar en un eje de frames `[hourly 0–48h] + [3h 48–240h]`.
- [ ] Timeline: escala no uniforme (ticks por día a partir de +2 d), etiqueta "Día 5 · 15:00", chip "Ahora" intacto; `t=` del hash acepta cualquier frame.
- [ ] Carga perezosa: el primer scrub más allá de +48 h dispara el fetch 3 h; spinner en el chip del timeline, no en el mapa.
- [ ] Cuota: contador de llamadas por sesión en `cachedFetch`, tope suave (p. ej. 60/10 min) con toast "pronóstico extendido en pausa 1 min".
- Acceptance: `#view=…&layer=temperature&t=<+9d>` pinta el campo a 9 días en ≤3 s tras el primer fetch; `npm run test` con fixtures de 10 días; sin nuevas llamadas hasta que el usuario cruza +48 h.

**Story 15.2 — 24 h de historia en campos ("hace 24 h")** · est 2d
- [ ] Open-Meteo `past_days=1` en la misma llamada (gratis, misma cuota).
- [ ] Timeline arranca en −24 h; `t=` negativo permitido; botón "Ayer" (ya existe day-skip).
- [ ] Desbloquea Story 13.5 (antes/después) sin archivo propio.
- Acceptance: scrub a −24 h muestra el campo de ayer; snapshots de `field-grids` incluyen `past_days`.

**Story 15.3 — 10 y 16 días en `/forecast`, `/clima/<slug>`, `/compara`** · est 2d
- [ ] `forecast.ts` `forecast_days: '7'` → 10 por defecto; toggle "16 días" (Open-Meteo lo permite) con aviso de confianza decreciente.
- [ ] `city-forecasts.yml` snapshot 8→10 días (mismo número de llamadas).
- [ ] Barra de temperatura semanal → escala a 10/16 filas; chip de desacuerdo entre modelos por día (ya existe para 1 día: `DISAGREEMENT_MODELS`).
- Acceptance: `/forecast` muestra 10 días por defecto; e2e `search.spec.ts` sigue verde; Lighthouse LCP sin regresión.

**Story 15.4 — Tarjeta de ubicación al tocar el mapa (diario 10 d / horario 48 h)** · est 3d
- [ ] Reusar `placePopup` (`interactive-map.ts`, click-to-place ya existe) y el layout de "Tu ubicación" de zoom.earth: 5 filas visibles, "ver 10 días" expande; toggle Diario/Horario.
- [ ] Datos: una llamada `/v1/forecast` por punto (`forecast_days=10`), cache 10 min; en móvil, panel swipeable inferior (patrón Story 11.3).
- [ ] Botón "Pronóstico completo →" a `/forecast?lat&lng` y estrella de favorito.
- [ ] Cierra la Fase 4 del plan home (tap-to-forecast card).
- Acceptance: tap en cualquier punto de MX abre la tarjeta con 10 días en ≤1 s; en el home y en `/mapa`; a11y con foco atrapado en el panel en móvil.

**Story 15.5 — Campo de precipitación pronosticada** · est 2d
- [ ] Nueva variable en `mapfields.ts`: `precipitation` (mm/h) + `snowfall`; rampa azul→morado como la leyenda de radar ("Ligera/Moderada/Intensa/Nieve").
- [ ] Capa `precipitation` en `LAYERS` (tecla `W` libre), sub-opciones Lluvia / Nieve / Probabilidad (`precipitation_probability`).
- [ ] Encaja con Story 13.2 (modo combinado satélite + nubes + radar/precipitación).
- Acceptance: la capa aparece en rail y hash; leyenda con unidad; snapshot `field-grids` la incluye.

---

### E16 · Profundidad temporal de observaciones (P1) — satélite 10 d, radar 72 h, nowcast 60 min

> Outcome: el timeline de observaciones iguala a zoom.earth free (satélite 10 días, radar 72 h) y supera a su Pro en nowcast (60 min) sin tile server propio.

**Story 16.1 — Satélite con scrub real (GIBS TIME)** · est 2d · **P0 dentro de la épica: hoy el UI miente**
- [ ] `weather-raster.ts`: usar el frame seleccionado en vez de `gibsRoundedTime()`; `GIBS_LAYERS[*].hasTime` ya existe.
- [ ] Índice de frames propio: GOES-East GeoColor/IR cada 10 min; spike de ½ d para medir la retención real de GIBS (se estima ≥ 30 días; documentar el número medido).
- [ ] Loop de 3/6/12/24 h (Story 16.4) y prefetch de los 6 frames siguientes al pulsar play.
- Acceptance: scrub a −6 h muestra nubes distintas (test e2e con dos URLs de tile distintas capturadas por `page.route`); "Última imagen hace N min" en el chip.

**Story 16.2 — Archivo de radar 72 h (composite MX, sin tile server)** · est 4d
- [ ] Workflow `radar-archive.yml` cada 10 min (repo público = minutos ilimitados): descarga los ~6 tiles z5 de RainViewer que cubren MX, los cose en un PNG (~100 KB) y lo publica como frame `radar/<iso>.png` con un `index.json` rodante de 72 h (432 frames ≈ 45 MB).
- [ ] Almacén **fuera de `main`**: rama huérfana `data-radar` con force-push de un solo commit (o assets de un Release "rolling"); ver E20.
- [ ] Cliente: si el frame pedido es más viejo que las 2 h de RainViewer, cambia a `raster` source con `coordinates` (image source de MapLibre) sobre el bbox MX; opacidad y leyenda idénticas.
- [ ] Zoom > 7 con frame archivado: toast "Archivo a resolución reducida".
- Acceptance: scrub a −48 h pinta radar sobre MX; el índice nunca supera 72 h; `du` del almacén estable en ~50 MB.

**Story 16.3 — Nowcast de radar a 60 min (extrapolación propia)** · est 5d
- [ ] En el mismo workflow: sobre los últimos 6 frames cosidos, flujo óptico (pysteps `extrapolation` o `cv2.calcOpticalFlowFarneback`) → 6 frames +10…+60 min, marcados `nowcast: 'mx-extrap'`.
- [ ] Cliente: frames RainViewer hasta +30 min (mejor calidad), propios de +40 a +60 con etiqueta "Nowcast experimental" en el timeline y opacidad decreciente.
- [ ] Validación: script que compara el frame +30 propio contra el observado 30 min después (CSI/FAR) y publica el score en el índice; si CSI < umbral 2 días seguidos, el cliente oculta +40…+60.
- Acceptance: timeline llega a +60 min en MX; CSI publicado; nunca se muestra como observación.

**Story 16.4 — Controles de animación** · est 1d
- [ ] Ajustes: duración del loop (3/6/12/24 h), velocidad (lenta/media/rápida), estilo (rápido/suave = crossfade CSS).
- [ ] Persistir en `settings.ts` (localStorage), atajo `J` para reloj vs timeline como zoom.earth.
- Acceptance: los tres ajustes aplican en vivo; `settings.test.ts` cubre defaults y migración.

---

### E17 · Alertas que llegan al teléfono, sin backend ni cuentas (P1)

> Outcome: lo único del Pro de zoom.earth que "empuja" (avisos de ciclones) lo damos gratis, sin guardar ningún dato del usuario.

**Diseño.** No hay servidor que almacene suscripciones Web Push, y no lo vamos a tener. Tres canales que no requieren nada nuestro:

1. **ntfy.sh (recomendado):** GitHub Actions publica en tópicos públicos `climamx-huracanes`, `climamx-smn-<estado>`; el usuario se suscribe desde la app ntfy (iOS/Android) o desde ntfy.sh web con push nativo. Cero datos en nuestro lado; el tópico es la única "identidad". Costo 0. Riesgo: dependencia de un tercero (mitigación: tópicos espejo en un ntfy self-host es un backend → no; el espejo es RSS).
2. **RSS/Atom por estado** (ya existe `/rss.xml` nacional): feeds por estado y por ciclón, para lectores y automatizaciones (IFTTT, Feedly, correo vía Blogtrottr).
3. **Calendario (.ics)** de un ciclón activo: "Llegada estimada a costa" como evento con recordatorio; se descarga, nada se sube.

**Story 17.1 — Publicador de alertas tropicales** · est 2d
- [ ] `quakes-storms-snapshot.yml` detecta cambios de estado NHC (nuevo sistema, cambio de categoría, watch/warning para costa MX) y `curl -d` a `ntfy.sh/climamx-huracanes` con título, texto y link a `/huracanes/`.
- [ ] Dedupe por `(stormId, advisoryNumber)` guardado en el snapshot para no repetir.
- [ ] Página `/alertas/` explicando los tres canales, con botón "Suscribirme" (deep link `ntfy://climamx-huracanes`) y QR.
- Acceptance: un aviso NHC nuevo produce una notificación en un teléfono suscrito en < 15 min; cero requests desde el sitio a ntfy (solo el Action).

**Story 17.2 — Alertas SMN por estado** · est 1d
- [ ] `smn-rss.yml`: diff por estado → tópico `climamx-smn-<slug>`; feed `/rss/<estado>.xml`.
- [ ] En `/estado/<slug>` y en la tarjeta de ciudad: "Recibir avisos de <estado>" → `/alertas/#<slug>`.
- Acceptance: cambio en `smn-by-state.json` dispara notificación al tópico correcto; RSS por estado valida contra el validador W3C.

**Story 17.3 — Reglas personales, ahora con canal** · est 1d
- [ ] `alerts.ts` (reglas locales) exporta la regla como URL de tópico ntfy propio del usuario (`climamx-<uuid local>`)? **No**: eso requeriría que nuestro Action conozca el uuid → dato de usuario. Alternativa que sí respeta la restricción: la regla genera un `.ics` recurrente "revisar clima" y un botón "abrir pronóstico"; y documentar que las reglas son locales por diseño.
- [ ] Notificación **in-page** cuando la PWA está abierta (Notification API sin push: `new Notification()` al detectar regla cumplida al cargar). Sin SW push.
- Acceptance: con permiso concedido, abrir la PWA con una regla cumplida muestra notificación del sistema; sin permiso, banner como hoy.

---

### E18 · Tormentas y valores en el mapa (P2)

**Story 18.1 — Cono y trayectoria pronosticada de ciclones** · est 3d
- [ ] `build-storms-snapshot.py`: por cada sistema activo en `CurrentStorms.json`, descargar el GIS de NHC (KMZ/shapefile de `forecastCone`, `forecastTrack`, `watchesWarnings`), convertir a GeoJSON (Python, `zipfile` + parser KML sin deps pesadas).
- [ ] Overlay `tropical`: cono (fill 15 %), track con puntos por advisory (categoría por color), watches/warnings como líneas de costa.
- [ ] `/huracanes/<id>/` prerenderizada por sistema activo: tabla de track, cono, avisos en texto, "ver en el mapa".
- Acceptance: con un sistema activo, el cono coincide con nhc.noaa.gov; sin sistemas, la página lista "sin actividad" y el overlay se auto-oculta (ya lo hace).

**Story 18.2 — Áreas de posible desarrollo (2 días / 7 días)** · est 1d
- [ ] NHC "Tropical Weather Outlook" GIS (`gtwo_areas`) → overlay punteado con "% en 2 d / 7 d".
- Acceptance: los porcentajes coinciden con el TWO vigente.

**Story 18.3 — Isolíneas con valores y modo mira** · est 2d
- [ ] `isobars.ts`: etiquetas de hPa sobre la línea (símbolo `symbol-placement: line`).
- [ ] Modo "mira" (tecla `C`): valor de la capa activa en el centro del mapa, fijo, útil en móvil donde no hay hover; completa Story 13.1.
- Acceptance: isobaras muestran valores cada ~4 hPa; el modo mira actualiza al pan sin fetch extra.

---

### E19 · Descubrimiento, onboarding y unidades (P2)

**Story 19.1 — Páginas por capa para SEO** · est 1d
- [ ] `src/pages/mapa/[layer].astro` prerenderizado para las 9 capas (`/mapa/radar/`, `/mapa/satelite/`, `/mapa/temperatura/`…): H1, párrafo, JSON-LD, y el mismo `InteractiveMap` con `initialLayer`.
- [ ] Sitemap + hreflang; enlaces desde el rail ("compartir esta capa").
- Acceptance: 9 URLs indexables con contenido único; `a11y.spec` las incluye.

**Story 19.2 — Onboarding de primera visita** · est 1d
- [ ] Diálogo "Bienvenido: encuentra tu ubicación" (reusa `#geo`), una sola vez (`localStorage`), sin cookies.
- [ ] Intro de una línea por capa la primera vez que se activa (texto en `ui.ts` es/en).
- Acceptance: segunda visita no muestra nada; axe limpio con el diálogo abierto.

**Story 19.3 — Unidades** · est 1d
- [ ] `settings.ts`: temperatura °C/°F, viento km/h·mph·kt·m/s, presión hPa/inHg, distancia km/mi; aplica en tooltip, leyenda, tarjeta, `/forecast`.
- Acceptance: cambiar unidad re-renderiza sin recarga; tests unitarios de conversión.

---

### E20 · Higiene de datos e infraestructura (P0 técnico, habilita E15–E16)

**Story 20.1 — Sacar los snapshots de `main`** · est 2d
- [ ] Rama huérfana `data` (o Releases "rolling") para todo `public/data/*` que cambie más de una vez al día; el build de CD hace `git fetch data` y copia. `main` deja de recibir 40 commits de bot al día.
- [ ] Squash automático de `data` cada semana (force-push de un commit) para que el clon no crezca.
- [ ] Mantener en `main` solo lo mensual (ciudades, IBTrACS, estados).
- Acceptance: `git log main` sin commits de bot en 24 h; tamaño del clon de `main` estable.

**Story 20.2 — Presupuesto de cuota y canarios** · est 1d
- [ ] Contador diario de llamadas Open-Meteo agregando los logs de los workflows; alerta (issue automático) al 70 % de 10 000.
- [ ] Canario de RainViewer y GIBS como el de Esri (`basemap-canary.yml`): tile de muestra + tamaño + tipo.
- Acceptance: issue automático al superar el umbral; canarios verdes 7 días.

---

## 4. Integración con el backlog existente

| Existente | Relación |
|---|---|
| E10 first paint (P0) | Sigue primero; E16.1 depende de que el mapa pinte sin interacción. |
| E11 mobile (P1) | Story 11.3 (bottom-sheet de controles) es el patrón que reusa 15.4 y 16.4. Hacer 11.3 antes de 15.4. |
| E13.1 tooltip multi-métrica | Se completa con 18.3 (modo mira). |
| E13.2 modo Precipitación | Necesita 15.5 (campo de precipitación) para ser real; reordenar: 15.5 → 13.2. |
| E13.5 antes/después | Se vuelve trivial tras 15.2 (past_days) y 16.1/16.2. |
| E14.1 push | Se cierra con E17 (diseño sin backend). |
| Plan home Fase 4 | La tarjeta al tocar = 15.4; leyenda móvil y timeline = 16.4. |
| E12 registry | Cada capa nueva (15.5) nace ya como plugin (`plugins/base-layers/`), no en el monolito. |

## 5. Orden de ejecución y hitos

**Hito M1 · "Todo lo Pro, gratis" (≈ 4–5 semanas):** 20.1 → 15.1 → 15.3 → 15.4 → 17.1 → 17.2 → 16.1. Al cerrar M1, cada renglón de la tabla §1 está en "✅ ya".

**Hito M2 · "Su free, completo" (≈ 4 semanas):** 16.2 → 16.3 → 15.2 → 15.5 → 13.2 → 18.1 → 18.2 → 16.4 → 20.2.

**Hito M3 · "Mejor que ambos" (≈ 3 semanas):** 19.1 → 19.2 → 19.3 → 18.3 → 13.1 → 13.5 → 13.3.

Total ≈ 11–12 semanas de una persona, en PRs de 1–5 días. E10/E11 corren antes o intercalados según el estado real en dispositivo (gate de Story 10.1).

## 6. Costos y cuotas (por qué sigue siendo gratis)

| Recurso | Uso tras M2 | Límite | Margen |
|---|---|---|---|
| Open-Meteo forecast | ~400 llamadas/día de workflows + on-demand de usuarios (cacheado) | 10 000/día no-comercial | amplio; el contador de 20.2 avisa |
| GitHub Actions | radar cada 10 min + los actuales ≈ 200 runs/día | ilimitado en repo público | — |
| Almacén radar | ~50 MB rodantes fuera de `main` | rama/Release | estable por squash |
| ntfy.sh | 1 publicación por aviso (decenas/día en temporada) | límites públicos generosos | RSS como respaldo |
| Esri, GIBS, RainViewer, NHC, USGS, FIRMS | igual que hoy | sin llave | canarios |

## 7. Riesgos

- **Nowcast propio (16.3) puede ser peor que nada.** Por eso publica su CSI y se auto-oculta. Nunca se etiqueta como observación.
- **Retención de GIBS para GOES** no está documentada; el spike de 16.1 mide y fija el horizonte real (mínimo aceptable: 3 días).
- **ntfy.sh como tercero:** si cae, queda RSS; no se guarda nada nuestro allí.
- **Payload de 10 días en móvil:** 3 h en vez de 1 h y fetch solo al cruzar +48 h; medir con Lighthouse en `/mapa`.
- **Crecimiento del repo:** 20.1 va **antes** que cualquier archivo; es el único P0 técnico del plan.
- **Esri no-comercial:** el sitio sigue sin ingresos, sin anuncios; documentado en `basemap-theme.ts`.

## 8. Métricas de éxito

- Tabla §1: 7 de 7 en "✅" al cerrar M1.
- Timeline: satélite ≥ 3 días atrás, radar 72 h atrás y +60 min adelante, campos −24 h … +10 d.
- Alertas: una notificación real en teléfono por un aviso NHC/SMN en < 15 min desde que el dato cambia, con 0 datos de usuario almacenados.
- Guardarraíles intactos: `privacy.spec.ts` (0 cookies, 0 analytics), sin API keys en el repo, sin backend; suites unit + e2e verdes; Lighthouse LCP ≤ 2.5 s en `/` y `/mapa`.
