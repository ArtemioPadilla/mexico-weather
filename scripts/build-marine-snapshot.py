#!/usr/bin/env python3
"""Pre-compute the current wave height + SST for the 14 MX beach
destinations featured in the Playas (oleaje + SST) overlay.

Replaces the live Open-Meteo marine API call on every overlay toggle
with a hourly static snapshot. Output: public/data/marine-snapshot.json.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

MX_BEACHES = [
    {'name': 'Cancún',           'lng': -86.85,  'lat': 21.16},
    {'name': 'Playa del Carmen', 'lng': -87.07,  'lat': 20.63},
    {'name': 'Cozumel',          'lng': -86.95,  'lat': 20.42},
    {'name': 'Veracruz',         'lng': -96.13,  'lat': 19.18},
    {'name': 'Tampico',          'lng': -97.86,  'lat': 22.25},
    {'name': 'Acapulco',         'lng': -99.82,  'lat': 16.85},
    {'name': 'Puerto Vallarta',  'lng': -105.23, 'lat': 20.65},
    {'name': 'Mazatlán',         'lng': -106.42, 'lat': 23.22},
    {'name': 'Los Cabos',        'lng': -109.70, 'lat': 22.89},
    {'name': 'La Paz',           'lng': -110.31, 'lat': 24.14},
    {'name': 'Huatulco',         'lng': -96.13,  'lat': 15.77},
    {'name': 'Puerto Escondido', 'lng': -97.07,  'lat': 15.86},
    {'name': 'Manzanillo',       'lng': -104.32, 'lat': 19.11},
    {'name': 'Ensenada',         'lng': -116.60, 'lat': 31.86},
]


def sst_color(sst: float) -> str:
    """5-stop cool→warm ramp matching the overlay's runtime ramp."""
    if sst <= 18:
        return '#5b8ff9'
    if sst <= 22:
        return '#7dd1c8'
    if sst <= 26:
        return '#7ad151'
    if sst <= 29:
        return '#f9d423'
    return '#f08a24'


def fetch_marine() -> list[dict]:
    lats = ','.join(str(c['lat']) for c in MX_BEACHES)
    lngs = ','.join(str(c['lng']) for c in MX_BEACHES)
    params = urllib.parse.urlencode({
        'latitude': lats,
        'longitude': lngs,
        'current': 'wave_height,sea_surface_temperature',
        'timezone': 'UTC',
    })
    url = f'https://marine-api.open-meteo.com/v1/marine?{params}'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310
                data = json.loads(r.read().decode('utf-8'))
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f'  marine fetch failed: {e}', file=sys.stderr)
                return []
            time.sleep(2 ** attempt)
    return data if isinstance(data, list) else [data]


def main() -> None:
    arr = fetch_marine()
    features = []
    for i, c in enumerate(MX_BEACHES):
        try:
            cur = arr[i].get('current') if i < len(arr) else None
        except AttributeError:
            cur = None
        if not cur:
            continue
        hs_raw = cur.get('wave_height')
        sst_raw = cur.get('sea_surface_temperature')
        hs = float(hs_raw) if isinstance(hs_raw, (int, float)) else None
        sst = float(sst_raw) if isinstance(sst_raw, (int, float)) else None
        if hs is None and sst is None:
            continue
        parts = [c['name']]
        if hs is not None:
            parts.append(f'🌊 {round(hs, 1):.1f} m')
        if sst is not None:
            parts.append(f'🌡 {round(sst)}°')
        features.append({
            'type': 'Feature',
            'properties': {
                'name': c['name'],
                'hs': round(hs, 1) if hs is not None else 0,
                'color': '#94a3b8' if sst is None else sst_color(sst),
                'label': '\n'.join(parts),
            },
            'geometry': {'type': 'Point', 'coordinates': [c['lng'], c['lat']]},
        })

    fc = {
        'type': 'FeatureCollection',
        'features': features,
        'metadata': {
            'source': 'Open-Meteo Marine API',
            'license': 'CC-BY 4.0',
            'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'count': len(features),
        },
    }
    out_path = 'public/data/marine-snapshot.json'
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(fc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {len(features)} marine snapshots to {out_path}', file=sys.stderr)


if __name__ == '__main__':
    main()
