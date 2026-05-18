#!/usr/bin/env python3
# Consolidated verbatim from the `mexico-weather` repo (stdlib-only urllib CLI).
"""
weather_mx.py — Pronóstico del clima para México
Fuentes: Open-Meteo (ensemble) + SMN/Conagua
Uso: python3 weather_mx.py [ciudad]
"""

import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

# ─── Ciudades precargadas ─────────────────────────────────────────────────────
CITIES = {
    "cdmx":              {"lat": 19.43,  "lng": -99.13,  "tz": "America/Mexico_City",  "name": "CDMX"},
    "ciudad de mexico":  {"lat": 19.43,  "lng": -99.13,  "tz": "America/Mexico_City",  "name": "Ciudad de México"},
    "mexico city":       {"lat": 19.43,  "lng": -99.13,  "tz": "America/Mexico_City",  "name": "Ciudad de México"},
    "vallarta":          {"lat": 20.65,  "lng": -105.25, "tz": "America/Mexico_City",  "name": "Puerto Vallarta"},
    "puerto vallarta":   {"lat": 20.65,  "lng": -105.25, "tz": "America/Mexico_City",  "name": "Puerto Vallarta"},
    "oaxaca":            {"lat": 17.07,  "lng": -96.72,  "tz": "America/Mexico_City",  "name": "Oaxaca"},
    "guadalajara":       {"lat": 20.67,  "lng": -103.35, "tz": "America/Mexico_City",  "name": "Guadalajara"},
    "gdl":               {"lat": 20.67,  "lng": -103.35, "tz": "America/Mexico_City",  "name": "Guadalajara"},
    "monterrey":         {"lat": 25.67,  "lng": -100.31, "tz": "America/Mexico_City",  "name": "Monterrey"},
    "mty":               {"lat": 25.67,  "lng": -100.31, "tz": "America/Mexico_City",  "name": "Monterrey"},
    "cancun":            {"lat": 21.16,  "lng": -86.85,  "tz": "America/Cancun",       "name": "Cancún"},
    "cancún":            {"lat": 21.16,  "lng": -86.85,  "tz": "America/Cancun",       "name": "Cancún"},
    "tijuana":           {"lat": 32.53,  "lng": -117.04, "tz": "America/Tijuana",      "name": "Tijuana"},
    "merida":            {"lat": 20.97,  "lng": -89.62,  "tz": "America/Merida",       "name": "Mérida"},
    "mérida":            {"lat": 20.97,  "lng": -89.62,  "tz": "America/Merida",       "name": "Mérida"},
    "leon":              {"lat": 21.12,  "lng": -101.68, "tz": "America/Mexico_City",  "name": "León"},
    "léon":              {"lat": 21.12,  "lng": -101.68, "tz": "America/Mexico_City",  "name": "León"},
    "puebla":            {"lat": 19.04,  "lng": -98.20,  "tz": "America/Mexico_City",  "name": "Puebla"},
    "queretaro":         {"lat": 20.59,  "lng": -100.39, "tz": "America/Mexico_City",  "name": "Querétaro"},
    "querétaro":         {"lat": 20.59,  "lng": -100.39, "tz": "America/Mexico_City",  "name": "Querétaro"},
    "san cristobal":     {"lat": 16.74,  "lng": -92.64,  "tz": "America/Mexico_City",  "name": "San Cristóbal"},
    "san cristóbal":     {"lat": 16.74,  "lng": -92.64,  "tz": "America/Mexico_City",  "name": "San Cristóbal"},
}

# ─── WMO Weather Codes ────────────────────────────────────────────────────────
WMO_CODES = {
    0: "Despejado ☀️",
    1: "Principalmente despejado 🌤️",
    2: "Parcialmente nublado ⛅",
    3: "Nublado ☁️",
    45: "Niebla 🌫️",
    48: "Niebla con escarcha 🌫️",
    51: "Llovizna ligera 🌦️",
    53: "Llovizna moderada 🌦️",
    55: "Llovizna densa 🌧️",
    61: "Lluvia ligera 🌧️",
    63: "Lluvia moderada 🌧️",
    65: "Lluvia intensa 🌧️",
    71: "Nieve ligera ❄️",
    73: "Nieve moderada ❄️",
    75: "Nieve intensa ❄️",
    77: "Granizo ❄️",
    80: "Chubascos ligeros 🌦️",
    81: "Chubascos moderados 🌩️",
    82: "Chubascos violentos ⛈️",
    85: "Chubascos de nieve ❄️",
    86: "Chubascos fuertes de nieve ❄️",
    95: "Tormenta eléctrica ⛈️",
    96: "Tormenta con granizo ⛈️",
    99: "Tormenta severa con granizo ⛈️",
}


def fetch_url(url, timeout=10):
    """Fetch URL and return parsed JSON or None."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "weather_mx/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        return None


def get_open_meteo(lat, lng, tz):
    """Fetch weather data from Open-Meteo with ensemble best_match."""
    params = {
        "latitude": lat,
        "longitude": lng,
        "hourly": "temperature_2m,precipitation_probability,precipitation,weathercode,apparent_temperature,relative_humidity_2m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode,apparent_temperature_max",
        "timezone": tz,
        "forecast_days": 3,
        "models": "best_match",
        "wind_speed_unit": "kmh",
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)
    return fetch_url(url)


def get_smn_alerts():
    """Fetch SMN/Conagua alerts. Returns list of alert strings or empty list."""
    data = fetch_url("https://smn.conagua.gob.mx/webservices/?method=1", timeout=8)
    if not data:
        return []

    alerts = []
    keywords = ["chubasco", "tormenta", "frente frío", "frente frio", "lluvia intensa",
                "alerta", "depresión tropical", "huracán", "ciclón", "norte"]

    if isinstance(data, list):
        for entry in data:
            if isinstance(entry, dict):
                desc = entry.get("descripcion", "") or entry.get("descripcion_pronostico", "")
                if desc:
                    desc_lower = desc.lower()
                    if any(kw in desc_lower for kw in keywords):
                        estado = entry.get("nombre_estado", entry.get("estado", "México"))
                        alerts.append(f"{estado}: {desc[:120]}")
    elif isinstance(data, dict):
        for key, entry in data.items():
            if isinstance(entry, dict):
                desc = entry.get("descripcion", "") or entry.get("descripcion_pronostico", "")
                if desc:
                    desc_lower = desc.lower()
                    if any(kw in desc_lower for kw in keywords):
                        estado = entry.get("nombre_estado", key)
                        alerts.append(f"{estado}: {desc[:120]}")

    return alerts[:3]  # top 3 alerts max


def analyze_rain_windows(times, probs, precip, threshold=40):
    """Find rain windows where probability >= threshold. Returns list of (start, end, max_prob, total_mm)."""
    windows = []
    in_window = False
    start_t = None
    window_probs = []
    window_precip = []

    for t, p, r in zip(times, probs, precip):
        if p is None:
            p = 0
        if r is None:
            r = 0.0
        if p >= threshold:
            if not in_window:
                in_window = True
                start_t = t
                window_probs = []
                window_precip = []
            window_probs.append(p)
            window_precip.append(r)
        else:
            if in_window:
                windows.append((start_t, t, max(window_probs), sum(window_precip)))
                in_window = False

    if in_window:
        windows.append((start_t, times[-1], max(window_probs), sum(window_precip)))

    return windows


def format_time(iso_str):
    """Extract HH:MM from ISO datetime string."""
    if "T" in iso_str:
        return iso_str.split("T")[1][:5]
    return iso_str[-5:]


def get_today_index(times, local_tz_offset=-6):
    """Find indices for today's hours (local time)."""
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc + timedelta(hours=local_tz_offset)
    today_str = now_local.strftime("%Y-%m-%d")

    indices = [i for i, t in enumerate(times) if t.startswith(today_str)]
    return indices


def print_weather(city_info, data, smn_alerts):
    """Print a clean weather summary in Spanish."""
    name = city_info["name"]
    hourly = data.get("hourly", {})
    daily = data.get("daily", {})

    times_h = hourly.get("time", [])
    temps_h = hourly.get("temperature_2m", [])
    probs_h = hourly.get("precipitation_probability", [])
    precip_h = hourly.get("precipitation", [])
    codes_h = hourly.get("weathercode", [])
    feels_h = hourly.get("apparent_temperature", [])
    humidity_h = hourly.get("relative_humidity_2m", [])

    times_d = daily.get("time", [])
    max_t = daily.get("temperature_2m_max", [])
    min_t = daily.get("temperature_2m_min", [])
    precip_d = daily.get("precipitation_sum", [])
    prob_max_d = daily.get("precipitation_probability_max", [])
    codes_d = daily.get("weathercode", [])
    feels_max_d = daily.get("apparent_temperature_max", [])

    # Current conditions (find closest hour)
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc + timedelta(hours=-6)  # UTC-6 for Mexico
    today_str = now_local.strftime("%Y-%m-%d")
    current_hour_str = now_local.strftime("%Y-%m-%dT%H:00")

    # Find current hour index
    curr_idx = None
    for i, t in enumerate(times_h):
        if t == current_hour_str:
            curr_idx = i
            break
    if curr_idx is None and times_h:
        # fallback to first today hour
        for i, t in enumerate(times_h):
            if t.startswith(today_str):
                curr_idx = i
                break

    # Today's daily index
    today_daily_idx = None
    for i, t in enumerate(times_d):
        if t == today_str:
            today_daily_idx = i
            break

    # Tomorrow's daily index
    tomorrow_str = (now_local + timedelta(days=1)).strftime("%Y-%m-%d")
    tomorrow_daily_idx = None
    for i, t in enumerate(times_d):
        if t == tomorrow_str:
            tomorrow_daily_idx = i
            break

    # Today's hourly window (from now to midnight)
    today_hours_indices = [i for i, t in enumerate(times_h)
                           if t.startswith(today_str) and
                           (curr_idx is None or i >= curr_idx)]

    today_times = [times_h[i] for i in today_hours_indices]
    today_probs = [probs_h[i] if i < len(probs_h) else 0 for i in today_hours_indices]
    today_precip = [precip_h[i] if i < len(precip_h) else 0.0 for i in today_hours_indices]

    # Rain windows analysis
    rain_windows = analyze_rain_windows(today_times, today_probs, today_precip, threshold=40)

    # Print header
    day_es = {
        "Monday": "Lunes", "Tuesday": "Martes", "Wednesday": "Miércoles",
        "Thursday": "Jueves", "Friday": "Viernes", "Saturday": "Sábado", "Sunday": "Domingo"
    }
    weekday = day_es.get(now_local.strftime("%A"), now_local.strftime("%A"))
    date_fmt = now_local.strftime(f"{weekday} %d de %B, %H:%M")

    print(f"\n{'─' * 50}")
    print(f"🇲🇽 Clima en {name} — {date_fmt} (UTC-6)")
    print(f"{'─' * 50}")

    # Current conditions
    if curr_idx is not None:
        curr_temp = temps_h[curr_idx] if curr_idx < len(temps_h) else "?"
        curr_feels = feels_h[curr_idx] if curr_idx < len(feels_h) else "?"
        curr_code = codes_h[curr_idx] if curr_idx < len(codes_h) else 0
        curr_humidity = humidity_h[curr_idx] if curr_idx < len(humidity_h) else "?"
        curr_prob = probs_h[curr_idx] if curr_idx < len(probs_h) else 0
        curr_desc = WMO_CODES.get(curr_code, f"Código {curr_code}")
        print(f"\n🕐 Ahora mismo:")
        print(f"   {curr_desc}")
        print(f"   🌡  {curr_temp}°C  (sensación {curr_feels}°C)")
        print(f"   💧 Humedad: {curr_humidity}%  |  Lluvia ahora: {curr_prob}%")

    # Today summary
    if today_daily_idx is not None:
        t_max = max_t[today_daily_idx] if today_daily_idx < len(max_t) else "?"
        t_min = min_t[today_daily_idx] if today_daily_idx < len(min_t) else "?"
        p_total = precip_d[today_daily_idx] if today_daily_idx < len(precip_d) else 0
        p_prob = prob_max_d[today_daily_idx] if today_daily_idx < len(prob_max_d) else 0
        d_code = codes_d[today_daily_idx] if today_daily_idx < len(codes_d) else 0
        d_desc = WMO_CODES.get(d_code, f"Código {d_code}")

        print(f"\n📅 Hoy ({today_str}):")
        print(f"   {d_desc}")
        print(f"   🌡  Min {t_min}°C — Máx {t_max}°C")
        print(f"   💧 Lluvia: {p_prob}% probabilidad  |  Total: {p_total:.1f} mm")

    # Rain windows
    print(f"\n🌧  Ventana de lluvia hoy:")
    if rain_windows:
        for start, end, max_prob, total_mm in rain_windows:
            s_time = format_time(start)
            e_time = format_time(end)
            print(f"   ⏰ {s_time}–{e_time}  (máx {max_prob}%,  ~{total_mm:.1f} mm)")
    else:
        max_today_prob = max(today_probs) if today_probs else 0
        if max_today_prob > 0:
            print(f"   ☀️  Lluvia poco probable  (máx {max_today_prob}% — por debajo del umbral 40%)")
        else:
            print(f"   ☀️  Sin lluvia esperada")

    # Tomorrow summary
    if tomorrow_daily_idx is not None:
        t_max = max_t[tomorrow_daily_idx] if tomorrow_daily_idx < len(max_t) else "?"
        t_min = min_t[tomorrow_daily_idx] if tomorrow_daily_idx < len(min_t) else "?"
        p_total = precip_d[tomorrow_daily_idx] if tomorrow_daily_idx < len(precip_d) else 0
        p_prob = prob_max_d[tomorrow_daily_idx] if tomorrow_daily_idx < len(prob_max_d) else 0
        d_code = codes_d[tomorrow_daily_idx] if tomorrow_daily_idx < len(codes_d) else 0
        d_desc = WMO_CODES.get(d_code, f"Código {d_code}")

        # Tomorrow's rain windows
        tmrw_hours_indices = [i for i, t in enumerate(times_h) if t.startswith(tomorrow_str)]
        tmrw_times = [times_h[i] for i in tmrw_hours_indices]
        tmrw_probs = [probs_h[i] if i < len(probs_h) else 0 for i in tmrw_hours_indices]
        tmrw_precip = [precip_h[i] if i < len(precip_h) else 0.0 for i in tmrw_hours_indices]
        tmrw_windows = analyze_rain_windows(tmrw_times, tmrw_probs, tmrw_precip, threshold=40)

        print(f"\n📅 Mañana ({tomorrow_str}):")
        print(f"   {d_desc}")
        print(f"   🌡  Min {t_min}°C — Máx {t_max}°C")
        print(f"   💧 Lluvia: {p_prob}% probabilidad  |  Total: {p_total:.1f} mm")
        if tmrw_windows:
            for start, end, max_prob, total_mm in tmrw_windows:
                s_time = format_time(start)
                e_time = format_time(end)
                print(f"   ⏰ Lluvia probable: {s_time}–{e_time}  (máx {max_prob}%)")

    # SMN Alerts
    print(f"\n⚠️  Alertas SMN:")
    if smn_alerts:
        for alert in smn_alerts:
            print(f"   🔔 {alert}")
    else:
        print(f"   ✅ Sin alertas activas (o API SMN no disponible)")

    print(f"\n{'─' * 50}")
    print(f"📡 Fuente: Open-Meteo (best_match ensemble) + SMN/Conagua")
    print(f"{'─' * 50}\n")


def resolve_city(query):
    """Resolve city name to coordinates."""
    if not query:
        return CITIES["cdmx"]

    q = query.lower().strip()

    # Direct match
    if q in CITIES:
        return CITIES[q]

    # Partial match
    for key, info in CITIES.items():
        if q in key or key in q:
            return info

    # If not found, return None (could add geocoding here)
    return None


def main():
    city_query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "cdmx"

    city_info = resolve_city(city_query)
    if not city_info:
        print(f"❌ Ciudad no reconocida: '{city_query}'")
        print("   Ciudades disponibles: CDMX, Vallarta, Oaxaca, Guadalajara, Monterrey, Cancún, Tijuana, Mérida, Puebla, Querétaro")
        sys.exit(1)

    print(f"🔍 Consultando clima para {city_info['name']}...")

    # Fetch weather data
    weather_data = get_open_meteo(city_info["lat"], city_info["lng"], city_info["tz"])
    if not weather_data:
        print("❌ Error: No se pudo obtener datos de Open-Meteo")
        sys.exit(1)

    # Fetch SMN alerts (best-effort)
    print("📡 Consultando SMN/Conagua...")
    smn_alerts = get_smn_alerts()

    # Print results
    print_weather(city_info, weather_data, smn_alerts)


if __name__ == "__main__":
    main()
