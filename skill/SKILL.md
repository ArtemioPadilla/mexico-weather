---
name: mexico-weather
description: "Pronóstico del clima para ciudades en México con alta precisión. Usa este skill siempre que alguien pregunte por el clima, temperatura, lluvia, frentes fríos, chubascos o condiciones meteorológicas en cualquier ciudad mexicana — incluso si solo dicen '¿va a llover?' o '¿cómo está el tiempo?'. No uses wttr.in para México: este skill usa Open-Meteo ensemble (GFS + ECMWF + DWD) + SMN/Conagua y detecta la ventana horaria de lluvia más probable del día. También incluye smn_rss.py para generar un feed RSS 2.0 con alertas SMN en tiempo real."
---

# mexico-weather

## Cuándo usar este skill

Usa este skill cuando el usuario pregunte sobre:
- El clima actual o pronóstico en México
- Temperatura, lluvia, o condiciones meteorológicas en ciudades mexicanas
- Frentes fríos, alertas SMN, o chubascos
- "¿Va a llover hoy/mañana?"
- "¿Cómo está el clima en CDMX/Vallarta/Oaxaca?"
- Cualquier consulta de weather para ciudades en México

**NO uses wttr.in** — es poco preciso para México. Este skill usa Open-Meteo + SMN.

---

## Ciudades Precargadas

| Ciudad | Latitud | Longitud | Timezone |
|--------|---------|----------|----------|
| CDMX / Ciudad de México | 19.43 | -99.13 | America/Mexico_City |
| Puerto Vallarta | 20.65 | -105.25 | America/Mexico_City |
| Oaxaca | 17.07 | -96.72 | America/Mexico_City |
| Guadalajara | 20.67 | -103.35 | America/Mexico_City |
| Monterrey | 25.67 | -100.31 | America/Mexico_City |
| Cancún | 21.16 | -86.85 | America/Cancun |
| Tijuana | 32.53 | -117.04 | America/Tijuana |

---

## Opción Rápida: Script Python

La forma más rápida y confiable es usar el script incluido:

```bash
python3 scripts/weather_mx.py "CDMX"
python3 scripts/weather_mx.py "Puerto Vallarta"
python3 scripts/weather_mx.py "Oaxaca"
```

El script hace todo automáticamente: Open-Meteo + SMN + análisis de lluvia por hora.

---

## API Open-Meteo (Ensemble + Hourly)

### Parámetros clave

- **`models=best_match`** — selecciona automáticamente el mejor modelo ensemble (GFS + ECMWF + DWD) según la región
- **`hourly`** — datos hora por hora para análisis de ventana de lluvia
- **`daily`** — resumen del día (min/max temp, precip total, código de clima)
- **`forecast_days=2`** — hoy y mañana suele ser suficiente

### Comando curl — Open-Meteo Completo

```bash
# CDMX
curl -s "https://api.open-meteo.com/v1/forecast?latitude=19.43&longitude=-99.13&hourly=temperature_2m,precipitation_probability,precipitation,weathercode,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode&timezone=America/Mexico_City&forecast_days=2&models=best_match" | python3 -m json.tool | head -80

# Puerto Vallarta
curl -s "https://api.open-meteo.com/v1/forecast?latitude=20.65&longitude=-105.25&hourly=temperature_2m,precipitation_probability,precipitation,weathercode,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode&timezone=America/Mexico_City&forecast_days=2&models=best_match" | python3 -m json.tool | head -80

# Oaxaca
curl -s "https://api.open-meteo.com/v1/forecast?latitude=17.07&longitude=-96.72&hourly=temperature_2m,precipitation_probability,precipitation,weathercode,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode&timezone=America/Mexico_City&forecast_days=2&models=best_match" | python3 -m json.tool | head -80
```

### Análisis de Ventana de Lluvia

Después de obtener los datos horarios, filtrar por las horas del día actual (UTC-6) y encontrar bloques donde `precipitation_probability >= 40`:

```python
import json, subprocess
from datetime import datetime

data = json.loads(subprocess.check_output(["curl", "-s", URL]))
hourly = data["hourly"]
times = hourly["time"]
probs = hourly["precipitation_probability"]
precip = hourly["precipitation"]

# Filtrar horas de hoy (primer 24 entries)
today_hours = list(zip(times[:24], probs[:24], precip[:24]))

# Encontrar bloques de lluvia (prob >= 40%)
rain_windows = [(t, p, r) for t, p, r in today_hours if p >= 40]

if rain_windows:
    start = rain_windows[0][0][-5:]   # "HH:MM"
    end = rain_windows[-1][0][-5:]
    max_prob = max(p for _, p, _ in rain_windows)
    print(f"🌧 Lluvia probable entre {start}–{end} (máx {max_prob}%)")
else:
    print("☀️ Sin lluvia significativa esperada hoy")
```

---

## SMN / Conagua

### API oficial (puede ser inestable)

```bash
# Pronóstico por estado — method=1 devuelve JSON con alertas
curl -s "https://smn.conagua.gob.mx/webservices/?method=1" | python3 -m json.tool 2>/dev/null | head -40
```

Si la API falla (es común), buscar alertas vía web_search:
- Query: `SMN Conagua frente frío alerta hoy site:smn.conagua.gob.mx OR site:conagua.gob.mx`
- O simplemente: `"frente frío" OR "chubasco" México hoy`

### Interpretar respuesta SMN

```json
{
  "nombre_estado": "Oaxaca",
  "descripcion": "Cielos nublados con lluvias y posibles chubascos...",
  "tmax": "29",
  "tmin": "15"
}
```

Buscar palabras clave: `chubasco`, `tormenta`, `frente frío`, `lluvia intensa`, `alerta`.

---

## Códigos de Clima (WMO)

| Código | Descripción |
|--------|-------------|
| 0 | Despejado ☀️ |
| 1-3 | Parcialmente nublado 🌤️ |
| 45, 48 | Niebla 🌫️ |
| 51-57 | Llovizna 🌦️ |
| 61-67 | Lluvia 🌧️ |
| 71-77 | Nieve ❄️ |
| 80-82 | Chubascos 🌩️ |
| 95-99 | Tormenta eléctrica ⛈️ |

---

## Output Format (respuesta al usuario)

```
🌤 Clima en [CIUDAD] — [DÍA]

🌡 Temperatura: [MIN]–[MAX]°C (sensación: [FEELS_LIKE]°C)
💧 Lluvia: [PROB_MAX]% de probabilidad ([TOTAL] mm)
🕐 Ventana de lluvia: [HH:MM]–[HH:MM] (máx [PROB]%)
   — o —
☀️ Sin lluvia esperada hoy

⚠️ SMN: [ALERTA O "Sin alertas activas"]
```

---

---

## SMN RSS Feed — smn_rss.py

Genera un feed RSS 2.0 con alertas, comunicados y pronósticos del SMN usando **Playwright** (scraping JS-hydrated).

### Uso rápido

```bash
# Feed básico — escribe src/data/smn-feed.xml por defecto
python3 scripts/smn-rss/smn_rss.py --verbose

# Con pronóstico por municipio (San Pablo Etla = 20530, Oaxaca de Juárez = 20274)
python3 scripts/smn-rss/smn_rss.py --municipios 20274,20530 --verbose

# Escribir a otra ruta de salida
python3 scripts/smn-rss/smn_rss.py --out src/data/smn-feed.xml --verbose

# Con URL pública del feed (para el atom:link self)
python3 scripts/smn-rss/smn_rss.py --feed-url https://artemiop.com/mexico-weather/rss.xml --verbose
```

### Contenido del feed

| Categoría | Fuente | Tipo |
|-----------|--------|------|
| Alerta | Home SMN (JS hydrated) | Banner activo: viento, calor, etc. |
| Comunicado | Home SMN | Reportes matutino/vespertino + PDF link |
| Pronóstico General | `/es/pronosticos/.../pronostico-meteorologico-general` | Aviso nacional diario |
| Aviso Tormentas | `/es/pronosticos/avisos/aviso-de-potencial-de-tormentas` | Potencial de tormentas |
| Municipio | `/es/pronosticos/pronostico-de-ciudad?id=ID` | Pronóstico local |

### IDs de municipios comunes

| ID | Municipio |
|----|-----------|
| 9002 | Ciudad de México (Cuauhtémoc) |
| 14039 | Guadalajara |
| 19039 | Monterrey |
| 20274 | Oaxaca de Juárez |
| 20530 | San Pablo Etla, Oaxaca |
| 23001 | Cancún |
| 6003 | Colima |

### GitHub Pages + Actions

El repo incluye `.github/workflows/smn-rss.yml` que:
1. Corre cada hora (cron `17 * * * *`)
2. Instala playwright + chromium
3. Ejecuta `scripts/smn-rss/smn_rss.py` y regenera `src/data/smn-feed.xml`
4. Hace commit+push solo si el contenido cambió y dispara el workflow `cd.yml` para redeplegar el sitio

El feed se sirve desde el endpoint Astro `src/pages/rss.xml.ts`, que lee
`src/data/smn-feed.xml` cuando está fresco (con fallback de derivación
Open-Meteo en build).

URL del feed (sitio en vivo): `https://artemiop.com/mexico-weather/rss.xml`

### Instalar dependencias locales

```bash
pip install playwright
playwright install chromium --with-deps
```

---

## Notas de Precisión

- **Open-Meteo `best_match`** usa GFS para México (actualizado 4x/día), con blend de ECMWF cuando disponible
- **SMN** tiene ventaja en frentes fríos del norte y sistemas tropicales — siempre verificar en temporada ciclónica (jun–oct)
- **wttr.in ESTÁ DEPRECADO** para México. No lo uses.
- Lección aprendida: wttr.in marcó 0% lluvia en Oaxaca cuando SMN dijo chubascos 5–25mm. Alexa: 3, ArtemIO: 0. ¡Ya no más!

---

## Temporadas en México

| Período | Condición |
|---------|-----------|
| Nov–Feb | Frentes fríos del norte ("nortes"), secas en el sur |
| Mar–May | Calor seco, inicio de tormentas vespertinas |
| Jun–Oct | Temporada de lluvias (chubascos por las tardes), ciclones en Pacífico y Golfo |
| Todo el año | CDMX: lluvia vespertina May–Oct; Vallarta: muy húmedo Jul–Sep |
