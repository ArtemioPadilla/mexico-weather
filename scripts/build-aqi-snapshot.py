#!/usr/bin/env python3
"""Pre-compute the current PM2.5 reading for the 12 MX-AQI cities used
by the Calidad del aire overlay.

The overlay (src/lib/map/overlays/aqi.ts) currently calls Open-Meteo's
air-quality API on every overlay toggle. Replacing that with a static
JSON refreshed hourly by a GitHub Action:
  - Removes per-overlay-toggle API calls (the api host is free but the
    map overlay UX feels instant when there's nothing to wait for).
  - Lets us pre-bake the EPA breakpoint colour per feature, simplifying
    the runtime layer paint.

Output: public/data/aqi-snapshot.json (GeoJSON FeatureCollection).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from typing import Optional

MX_AQI_CITIES = [
    {'name': 'CDMX',         'lng': -99.13,  'lat': 19.43},
    {'name': 'Guadalajara',  'lng': -103.35, 'lat': 20.66},
    {'name': 'Monterrey',    'lng': -100.31, 'lat': 25.67},
    {'name': 'Puebla',       'lng': -98.20,  'lat': 19.04},
    {'name': 'Tijuana',      'lng': -117.04, 'lat': 32.51},
    {'name': 'León',         'lng': -101.67, 'lat': 21.13},
    {'name': 'Toluca',       'lng': -99.65,  'lat': 19.29},
    {'name': 'Mérida',       'lng': -89.61,  'lat': 20.97},
    {'name': 'Querétaro',    'lng': -100.39, 'lat': 20.59},
    {'name': 'Chihuahua',    'lng': -106.07, 'lat': 28.63},
    {'name': 'Hermosillo',   'lng': -110.95, 'lat': 29.07},
    {'name': 'Veracruz',     'lng': -96.13,  'lat': 19.18},
]


def epa_color(pm: float) -> str:
    """EPA PM2.5 breakpoints → EPA AQI colour."""
    if pm < 12:
        return '#22c55e'  # good
    if pm < 35:
        return '#facc15'  # moderate
    if pm < 55:
        return '#f97316'  # USG
    if pm < 150:
        return '#dc2626'  # unhealthy
    return '#7c2d12'  # hazardous


def fetch_pm() -> dict[str, Optional[float]]:
    lats = ','.join(str(c['lat']) for c in MX_AQI_CITIES)
    lngs = ','.join(str(c['lng']) for c in MX_AQI_CITIES)
    params = urllib.parse.urlencode({
        'latitude': lats,
        'longitude': lngs,
        'current': 'pm2_5',
        'timezone': 'UTC',
    })
    url = f'https://air-quality-api.open-meteo.com/v1/air-quality?{params}'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310
                data = json.loads(r.read().decode('utf-8'))
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f'  air-quality fetch failed: {e}', file=sys.stderr)
                return {}
            time.sleep(2 ** attempt)
    arr = data if isinstance(data, list) else [data]
    out: dict[str, Optional[float]] = {}
    for i, c in enumerate(MX_AQI_CITIES):
        try:
            pm = arr[i].get('current', {}).get('pm2_5')  # type: ignore[union-attr]
            out[str(c['name'])] = (
                float(pm) if isinstance(pm, (int, float)) else None
            )
        except (IndexError, AttributeError):
            out[str(c['name'])] = None
    return out


def main() -> None:
    pm_by_city = fetch_pm()
    if not pm_by_city:
        print('air-quality fetch returned empty — preserving previous snapshot', file=sys.stderr)
        sys.exit(1)
    features = []
    for c in MX_AQI_CITIES:
        name = str(c['name'])
        pm = pm_by_city.get(name)
        if pm is None:
            continue
        features.append({
            'type': 'Feature',
            'properties': {
                'name': name,
                'pm': round(pm, 1),
                'color': epa_color(pm),
                'label': f'{name}\n{round(pm)} µg/m³',
            },
            'geometry': {'type': 'Point', 'coordinates': [c['lng'], c['lat']]},
        })

    fc = {
        'type': 'FeatureCollection',
        'features': features,
        'metadata': {
            'source': 'Open-Meteo Air Quality (CAMS)',
            'license': 'CC-BY 4.0',
            'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'count': len(features),
        },
    }
    out_path = 'public/data/aqi-snapshot.json'
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(fc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {len(features)} PM2.5 readings to {out_path}', file=sys.stderr)


if __name__ == '__main__':
    main()
