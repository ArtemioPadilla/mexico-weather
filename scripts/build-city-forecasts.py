#!/usr/bin/env python3
"""Pre-bake per-city forecast snapshots used by the /clima/<slug>/
landing pages.

For each entry in TOP_CITIES we call Open-Meteo's forecast endpoint
once and emit a slim JSON shaped exactly like what the page consumes:
current temp + condition + wind + humidity, plus the next seven days.
The page tries the static snapshot first (~0 ms after the asset is
cached) and only falls back to a live API call if the file is
missing.

The TOP_CITIES list MUST stay in sync with src/lib/top-cities.ts. A
mismatch is caught by the unit test that asserts slug equality across
both files (see scripts/check-top-cities-parity.py).

Output: public/data/city-forecast/<slug>.json (one file per city) plus
public/data/city-forecast/index.json with the snapshot manifest.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

# Mirror of src/lib/top-cities.ts. Keep this list in sync — the parity
# script enforces it in CI.
TOP_CITIES = [
    {'slug': 'cdmx', 'lat': 19.43, 'lng': -99.13, 'tz': 'America/Mexico_City'},
    {'slug': 'guadalajara', 'lat': 20.66, 'lng': -103.35, 'tz': 'America/Mexico_City'},
    {'slug': 'monterrey', 'lat': 25.67, 'lng': -100.31, 'tz': 'America/Monterrey'},
    {'slug': 'puebla', 'lat': 19.04, 'lng': -98.20, 'tz': 'America/Mexico_City'},
    {'slug': 'tijuana', 'lat': 32.51, 'lng': -117.04, 'tz': 'America/Tijuana'},
    {'slug': 'leon', 'lat': 21.13, 'lng': -101.67, 'tz': 'America/Mexico_City'},
    {'slug': 'toluca', 'lat': 19.29, 'lng': -99.65, 'tz': 'America/Mexico_City'},
    {'slug': 'merida', 'lat': 20.97, 'lng': -89.61, 'tz': 'America/Merida'},
    {'slug': 'queretaro', 'lat': 20.59, 'lng': -100.39, 'tz': 'America/Mexico_City'},
    {'slug': 'chihuahua', 'lat': 28.63, 'lng': -106.07, 'tz': 'America/Chihuahua'},
    {'slug': 'hermosillo', 'lat': 29.07, 'lng': -110.95, 'tz': 'America/Hermosillo'},
    {'slug': 'veracruz', 'lat': 19.18, 'lng': -96.13, 'tz': 'America/Mexico_City'},
    {'slug': 'cancun', 'lat': 21.16, 'lng': -86.85, 'tz': 'America/Cancun'},
    {'slug': 'acapulco', 'lat': 16.85, 'lng': -99.82, 'tz': 'America/Mexico_City'},
    {'slug': 'oaxaca', 'lat': 17.07, 'lng': -96.72, 'tz': 'America/Mexico_City'},
    {'slug': 'morelia', 'lat': 19.70, 'lng': -101.18, 'tz': 'America/Mexico_City'},
    {'slug': 'aguascalientes', 'lat': 21.88, 'lng': -102.29, 'tz': 'America/Mexico_City'},
    {'slug': 'saltillo', 'lat': 25.42, 'lng': -101.00, 'tz': 'America/Monterrey'},
    {'slug': 'durango', 'lat': 24.02, 'lng': -104.66, 'tz': 'America/Monterrey'},
    {'slug': 'zacatecas', 'lat': 22.77, 'lng': -102.58, 'tz': 'America/Mexico_City'},
    {'slug': 'culiacan', 'lat': 24.81, 'lng': -107.39, 'tz': 'America/Mazatlan'},
    {'slug': 'mazatlan', 'lat': 23.22, 'lng': -106.42, 'tz': 'America/Mazatlan'},
    {'slug': 'tampico', 'lat': 22.25, 'lng': -97.86, 'tz': 'America/Monterrey'},
    {'slug': 'villahermosa', 'lat': 17.99, 'lng': -92.95, 'tz': 'America/Mexico_City'},
    {'slug': 'tuxtla-gutierrez', 'lat': 16.75, 'lng': -93.12, 'tz': 'America/Mexico_City'},
    {'slug': 'pachuca', 'lat': 20.12, 'lng': -98.74, 'tz': 'America/Mexico_City'},
    {'slug': 'cuernavaca', 'lat': 18.92, 'lng': -99.23, 'tz': 'America/Mexico_City'},
    {'slug': 'la-paz', 'lat': 24.14, 'lng': -110.31, 'tz': 'America/Mazatlan'},
    {'slug': 'san-luis-potosi', 'lat': 22.16, 'lng': -100.98, 'tz': 'America/Mexico_City'},
    {'slug': 'ciudad-juarez', 'lat': 31.74, 'lng': -106.49, 'tz': 'America/Ojinaga'},
]

API = 'https://api.open-meteo.com/v1/forecast'

# WMO weather code → short Spanish label. Mirrors the mapping in
# src/lib/forecast.ts describeWeatherCode().
WMO_LABELS = {
    0: 'Despejado',
    1: 'Mayormente despejado',
    2: 'Parcialmente nublado',
    3: 'Nublado',
    45: 'Niebla',
    48: 'Niebla con escarcha',
    51: 'Llovizna ligera',
    53: 'Llovizna',
    55: 'Llovizna intensa',
    61: 'Lluvia ligera',
    63: 'Lluvia',
    65: 'Lluvia intensa',
    71: 'Nevada ligera',
    73: 'Nevada',
    75: 'Nevada intensa',
    80: 'Chubascos',
    81: 'Chubascos intensos',
    82: 'Chubascos violentos',
    95: 'Tormenta',
    96: 'Tormenta con granizo',
    99: 'Tormenta severa',
}


def wmo_label(code):
    return WMO_LABELS.get(code, '—')


def fetch_one(city):
    qs = urllib.parse.urlencode({
        'latitude': city['lat'],
        'longitude': city['lng'],
        'timezone': city['tz'],
        'current': ','.join([
            'temperature_2m',
            'apparent_temperature',
            'weather_code',
            'wind_speed_10m',
            'relative_humidity_2m',
        ]),
        'daily': ','.join([
            'weather_code',
            'temperature_2m_max',
            'temperature_2m_min',
            'precipitation_probability_max',
        ]),
        'forecast_days': 8,
        'temperature_unit': 'celsius',
        'wind_speed_unit': 'kmh',
    })
    url = f'{API}?{qs}'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f'  ! {city["slug"]}: {e}', file=sys.stderr)
                return None
            time.sleep(2 ** attempt)
    return None


def _day_at(daily, i):
    """Pull a normalized day-summary dict out of the Open-Meteo daily
    arrays at index i, or None if no data."""
    dates = daily.get('time') or []
    if i >= len(dates):
        return None
    codes = daily.get('weather_code') or []
    tmaxs = daily.get('temperature_2m_max') or []
    tmins = daily.get('temperature_2m_min') or []
    rains = daily.get('precipitation_probability_max') or []
    code = codes[i] if i < len(codes) else None
    return {
        'date': dates[i],
        'condition': wmo_label(code) if code is not None else '—',
        'hi': tmaxs[i] if i < len(tmaxs) else None,
        'lo': tmins[i] if i < len(tmins) else None,
        'rain': rains[i] if i < len(rains) else None,
    }


def normalize(raw):
    cur = (raw or {}).get('current') or {}
    daily = (raw or {}).get('daily') or {}

    today = _day_at(daily, 0)
    next_days = [d for d in (_day_at(daily, i) for i in range(1, 8)) if d]

    cur_code = cur.get('weather_code')
    return {
        'current': {
            'temperature': cur.get('temperature_2m'),
            'feelsLike': cur.get('apparent_temperature'),
            'condition': wmo_label(cur_code) if cur_code is not None else '—',
            'windKmh': cur.get('wind_speed_10m'),
            'humidity': cur.get('relative_humidity_2m'),
        },
        'today': today,
        'next': next_days,
    }


def main():
    out_dir = 'public/data/city-forecast'
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    ok_count = 0
    for city in TOP_CITIES:
        raw = fetch_one(city)
        if raw is None:
            manifest.append({'slug': city['slug'], 'status': 'error'})
            time.sleep(0.2)
            continue
        doc = normalize(raw)
        # Schema guard: skip cities whose normalized doc has no meaningful
        # content — keeps previous file intact rather than writing empty data.
        if doc.get('today') is None and not doc.get('next'):
            print(
                f'  ! {city["slug"]}: normalized doc has no today/next — skipping write',
                file=sys.stderr,
            )
            manifest.append({'slug': city['slug'], 'status': 'empty'})
            time.sleep(0.2)
            continue
        doc['updated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        doc['slug'] = city['slug']
        out_path = os.path.join(out_dir, f'{city["slug"]}.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
        manifest.append({'slug': city['slug'], 'status': 'ok', 'updated': doc['updated']})
        ok_count += 1
        time.sleep(0.2)  # be kind to the API

    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'source': 'Open-Meteo Forecast API',
            'license': 'CC-BY 4.0',
            'count': ok_count,
            'cities': manifest,
        }, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {ok_count}/{len(TOP_CITIES)} city forecasts to {out_dir}', file=sys.stderr)
    if ok_count == 0:
        print('all cities failed — aborting', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
