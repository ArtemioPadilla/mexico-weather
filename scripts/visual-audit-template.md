# Auditoría visual lado a lado — {{date}}

Story 26.1 · `docs/PLAN_PARIDAD_VISUAL.md` §0 · generado por `scripts/visual-audit.mjs` (modo: **{{mode}}**).

Cómo usar esta hoja: las capturas de abajo son evidencia cruda. Rellena a mano
la columna **Veredicto** de la checklist (✅ paridad · 🟡 cerca · ❌ brecha) y
las notas, después copia el archivo terminado a `docs/UX_AUDIT_{{date}}.md` y
enlázalo desde `docs/PLAN_PARIDAD_VISUAL.md` §0. Se repite al cerrar cada
épica (E21–E26).

## 1. Capturas

Vista compartida: `view=23.6,-102.5,5z` (México completo). Columna izquierda
nuestro `/mapa`, columna derecha zoom.earth en el mismo producto.

| Estado | mexico-weather | zoom.earth |
|---|---|---|
{{pairs}}

## 2. Checklist §0 (marcar a mano)

| Dimensión | Qué mirar en las parejas | zoom.earth | Nosotros | Veredicto | Notas |
|---|---|---|---|---|---|
| Primera impresión | ¿El mapa abre con imagen satelital animada sobre basemap oscuro, sin interacción? | Satélite animado a pantalla completa | | | |
| Densidad del chrome | Cuenta los controles visibles en desktop (meta ≤ 8) y móvil (meta ≤ 5) | ~6 | | | |
| Timeline | ¿Barra con escala de fechas, arrastre fino, loop sin parpadeo? | Barra con fechas | | | |
| Calidad visual de campos | Temperatura: ¿gradiente nítido o raster borroso al acercar? | Gradiente nítido | | | |
| Animación | Satélite/radar: ¿frames precargados, sin parpadeo entre frames? | Precargados | | | |
| Móvil (360 px) | ¿Bottom sheet para capas/ubicación? ¿Tap targets ≥ 44 px? ¿Timeline usable? | Bottom sheet | | | |
| Consistencia | ¿Un solo lenguaje visual oscuro? ¿Textos localizados? ¿Un estilo de pastilla? | Un lenguaje oscuro | | | |

## 3. Legibilidad del basemap oscuro (riesgo 21.1)

- [ ] Etiquetas legibles sobre nubes blancas en satélite (desktop)
- [ ] Etiquetas legibles sobre nubes blancas en satélite (360 px)
- [ ] Fronteras y costas visibles bajo el radar

## 4. Incidencias de captura

{{notes}}

## 5. Conclusión

_Tres frases: qué brecha duele más hoy, qué historia del plan la cierra, qué se
re-audita al cerrar la épica._
