#!/usr/bin/env python3
"""Pre-compute a 10-year mean-Tmax climatology for every day-of-year
at the top 30 MX metropolitan areas, sourced from Open-Meteo's free
archive API (ERA5-Land, keyless, CORS).

Output: public/data/climate-baseline-mx.json — shape:

  {
    "metadata": {...},
    "cities": [
      { "key": "cdmx", "name": "Ciudad de México", "lat": 19.43,
        "lng": -99.13 },
      ...
    ],
    "baseline": {
      "cdmx": { "01-01": { "tmaxMean": 22.4, "yearsUsed": 10 }, ... }
    }
  }

The forecast page (/forecast/) reads this file BEFORE falling back to
the live archive endpoint — saving ~30k archive API calls per day for
returning visitors. Re-built weekly via GitHub Action; the archive
itself updates ~monthly so weekly is a safe cadence.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

CITIES: list[dict[str, object]] = [
    {'key': 'cdmx',         'name': 'Ciudad de México',   'lat': 19.43, 'lng': -99.13,  'tz': 'America/Mexico_City'},
    {'key': 'guadalajara',  'name': 'Guadalajara',         'lat': 20.66, 'lng': -103.35, 'tz': 'America/Mexico_City'},
    {'key': 'monterrey',    'name': 'Monterrey',           'lat': 25.67, 'lng': -100.31, 'tz': 'America/Monterrey'},
    {'key': 'puebla',       'name': 'Puebla',              'lat': 19.04, 'lng': -98.20,  'tz': 'America/Mexico_City'},
    {'key': 'tijuana',      'name': 'Tijuana',             'lat': 32.51, 'lng': -117.04, 'tz': 'America/Tijuana'},
    {'key': 'leon',         'name': 'León',                'lat': 21.13, 'lng': -101.67, 'tz': 'America/Mexico_City'},
    {'key': 'toluca',       'name': 'Toluca',              'lat': 19.29, 'lng': -99.65,  'tz': 'America/Mexico_City'},
    {'key': 'merida',       'name': 'Mérida',              'lat': 20.97, 'lng': -89.61,  'tz': 'America/Mexico_City'},
    {'key': 'queretaro',    'name': 'Querétaro',           'lat': 20.59, 'lng': -100.39, 'tz': 'America/Mexico_City'},
    {'key': 'chihuahua',    'name': 'Chihuahua',           'lat': 28.63, 'lng': -106.07, 'tz': 'America/Chihuahua'},
    {'key': 'hermosillo',   'name': 'Hermosillo',          'lat': 29.07, 'lng': -110.95, 'tz': 'America/Hermosillo'},
    {'key': 'veracruz',     'name': 'Veracruz',            'lat': 19.18, 'lng': -96.13,  'tz': 'America/Mexico_City'},
    {'key': 'acapulco',     'name': 'Acapulco',            'lat': 16.85, 'lng': -99.82,  'tz': 'America/Mexico_City'},
    {'key': 'cancun',       'name': 'Cancún',              'lat': 21.16, 'lng': -86.85,  'tz': 'America/Cancun'},
    {'key': 'oaxaca',       'name': 'Oaxaca',              'lat': 17.07, 'lng': -96.72,  'tz': 'America/Mexico_City'},
    {'key': 'morelia',      'name': 'Morelia',             'lat': 19.70, 'lng': -101.18, 'tz': 'America/Mexico_City'},
    {'key': 'aguascalientes','name': 'Aguascalientes',     'lat': 21.88, 'lng': -102.29, 'tz': 'America/Mexico_City'},
    {'key': 'saltillo',     'name': 'Saltillo',            'lat': 25.42, 'lng': -101.00, 'tz': 'America/Monterrey'},
    {'key': 'durango',      'name': 'Durango',             'lat': 24.02, 'lng': -104.66, 'tz': 'America/Monterrey'},
    {'key': 'zacatecas',    'name': 'Zacatecas',           'lat': 22.77, 'lng': -102.58, 'tz': 'America/Mexico_City'},
    {'key': 'culiacan',     'name': 'Culiacán',            'lat': 24.81, 'lng': -107.39, 'tz': 'America/Mazatlan'},
    {'key': 'mazatlan',     'name': 'Mazatlán',            'lat': 23.22, 'lng': -106.42, 'tz': 'America/Mazatlan'},
    {'key': 'tampico',      'name': 'Tampico',             'lat': 22.25, 'lng': -97.86,  'tz': 'America/Mexico_City'},
    {'key': 'villahermosa', 'name': 'Villahermosa',        'lat': 17.99, 'lng': -92.95,  'tz': 'America/Mexico_City'},
    {'key': 'tuxtla',       'name': 'Tuxtla Gutiérrez',    'lat': 16.75, 'lng': -93.12,  'tz': 'America/Mexico_City'},
    {'key': 'pachuca',      'name': 'Pachuca',             'lat': 20.10, 'lng': -98.73,  'tz': 'America/Mexico_City'},
    {'key': 'cuernavaca',   'name': 'Cuernavaca',          'lat': 18.92, 'lng': -99.23,  'tz': 'America/Mexico_City'},
    {'key': 'la-paz',       'name': 'La Paz',              'lat': 24.14, 'lng': -110.31, 'tz': 'America/Mazatlan'},
    {'key': 'campeche',     'name': 'Campeche',            'lat': 19.84, 'lng': -90.52,  'tz': 'America/Mexico_City'},
    {'key': 'manzanillo',   'name': 'Manzanillo',          'lat': 19.11, 'lng': -104.32, 'tz': 'America/Mexico_City'},
]

YEARS_BACK = int(os.environ.get('YEARS_BACK', '10'))


def fetch_archive(lat: float, lng: float, start: str, end: str, tz: str) -> dict:
    params = urllib.parse.urlencode({
        'latitude': lat,
        'longitude': lng,
        'start_date': start,
        'end_date': end,
        'daily': 'temperature_2m_max,temperature_2m_min',
        'timezone': tz,
    })
    url = f'https://archive-api.open-meteo.com/v1/archive?{params}'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:  # noqa: S310
                return json.loads(r.read().decode('utf-8'))
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 2:
                raise
            wait = 2 ** attempt
            print(f'  retry {attempt + 1}/3 after {wait}s ({e})', file=sys.stderr)
            time.sleep(wait)
    return {}


def doy_baseline(daily: dict) -> dict[str, dict[str, float]]:
    """Group daily Tmax/Tmin by MM-DD; return mean per DOY."""
    times = daily.get('time') or []
    tmax = daily.get('temperature_2m_max') or []
    tmin = daily.get('temperature_2m_min') or []
    by_doy: dict[str, dict[str, list[float]]] = {}
    for i, iso in enumerate(times):
        if len(iso) < 10:
            continue
        mmdd = iso[5:10]
        if mmdd == '02-29':  # skip leap day; rare and adds noise
            continue
        slot = by_doy.setdefault(mmdd, {'tmax': [], 'tmin': []})
        v = tmax[i] if i < len(tmax) else None
        if isinstance(v, (int, float)):
            slot['tmax'].append(float(v))
        w = tmin[i] if i < len(tmin) else None
        if isinstance(w, (int, float)):
            slot['tmin'].append(float(w))
    out: dict[str, dict[str, float]] = {}
    for mmdd, slot in by_doy.items():
        if not slot['tmax']:
            continue
        out[mmdd] = {
            'tmaxMean': round(sum(slot['tmax']) / len(slot['tmax']), 2),
            'tminMean': round(sum(slot['tmin']) / len(slot['tmin']), 2) if slot['tmin'] else 0,
            'yearsUsed': len(slot['tmax']),
        }
    return out


def main() -> None:
    today = dt.date.today()
    end_year = today.year - 1  # use last completed year as the end
    start_year = end_year - YEARS_BACK + 1
    start_date = f'{start_year}-01-01'
    end_date = f'{end_year}-12-31'

    baseline: dict[str, dict] = {}
    for c in CITIES:
        key = str(c['key'])
        print(f'  fetching {c["name"]} ({start_date} → {end_date})', file=sys.stderr)
        try:
            data = fetch_archive(
                float(c['lat']), float(c['lng']),
                start_date, end_date, str(c['tz']),
            )
        except Exception as e:  # noqa: BLE001
            print(f'    failed: {e}', file=sys.stderr)
            continue
        daily = data.get('daily') or {}
        baseline[key] = doy_baseline(daily)

    fc = {
        'metadata': {
            'source': 'Open-Meteo Archive (ERA5-Land)',
            'license': 'CC BY 4.0',
            'startDate': start_date,
            'endDate': end_date,
            'yearsBack': YEARS_BACK,
            'cityCount': len(baseline),
        },
        'cities': [
            {'key': c['key'], 'name': c['name'], 'lat': c['lat'], 'lng': c['lng']}
            for c in CITIES
        ],
        'baseline': baseline,
    }
    out_path = 'public/data/climate-baseline-mx.json'
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(fc, f, separators=(',', ':'), ensure_ascii=False)
    days = sum(len(v) for v in baseline.values())
    print(f'wrote {len(baseline)} cities × ~366 days = {days} day-baselines', file=sys.stderr)


if __name__ == '__main__':
    main()
