#!/usr/bin/env python3
"""Cache USGS earthquake feed every 5 min via GitHub Action so the
Sismos overlay reads from our CDN instead of hitting USGS directly.

Source: USGS earthquake.usgs.gov 2.5_week.geojson (M≥2.5 past 7 days,
worldwide). We filter to a generous MX bbox and re-emit. Output:
public/data/quakes-snapshot.json.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

QUAKES_URL = (
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'
)

# MX-relevant bbox: covers all of Mexico, the Caribbean subduction zone,
# and the southern US border where felt quakes affect MX users.
MX_BBOX = {'west': -120, 'east': -85, 'south': 12, 'north': 35}


def main() -> None:
    for attempt in range(3):
        try:
            with urllib.request.urlopen(QUAKES_URL, timeout=60) as r:  # noqa: S310
                data = json.loads(r.read().decode('utf-8'))
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f'  USGS fetch failed: {e}', file=sys.stderr)
                sys.exit(1)
            time.sleep(2 ** attempt)

    features = []
    for f in data.get('features') or []:
        geom = f.get('geometry') or {}
        coords = geom.get('coordinates') or []
        if len(coords) < 2:
            continue
        lng, lat = coords[0], coords[1]
        if not (
            MX_BBOX['west'] <= lng <= MX_BBOX['east']
            and MX_BBOX['south'] <= lat <= MX_BBOX['north']
        ):
            continue
        # Keep only the props we render — drops big-by-default fields like
        # 'place', 'url', 'updated' down to the essentials.
        props = f.get('properties') or {}
        features.append({
            'type': 'Feature',
            'properties': {
                'mag': props.get('mag'),
                'time': props.get('time'),
                'place': props.get('place') or '',
            },
            'geometry': geom,
        })

    fc = {
        'type': 'FeatureCollection',
        'features': features,
        'metadata': {
            'source': 'USGS earthquake.usgs.gov 2.5_week',
            'license': 'Public domain',
            'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'bbox': MX_BBOX,
            'count': len(features),
        },
    }
    out_path = 'public/data/quakes-snapshot.json'
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(fc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {len(features)} MX-bbox quakes to {out_path}', file=sys.stderr)


if __name__ == '__main__':
    main()
