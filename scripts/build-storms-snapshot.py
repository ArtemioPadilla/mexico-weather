#!/usr/bin/env python3
"""Cache the NHC active-storms feed via GitHub Action so the
Sistemas tropicales overlay reads from our CDN instead of hitting
NHC directly. Refresh cadence: every 15 min during hurricane season.

Source: NHC CurrentStorms.json (CORS-enabled, public, refreshes a
few times per hour). Output: public/data/storms-snapshot.json.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

NHC_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json'


def main() -> None:
    for attempt in range(3):
        try:
            with urllib.request.urlopen(NHC_URL, timeout=60) as r:  # noqa: S310
                data = json.loads(r.read().decode('utf-8'))
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f'  NHC fetch failed: {e}', file=sys.stderr)
                sys.exit(1)
            time.sleep(2 ** attempt)

    raw_storms = data.get('activeStorms') or []
    storms = []
    for s in raw_storms:
        # Distill to only what the overlay renders. Keys taken from
        # src/lib/map/sources/nhc.ts.
        name = (s.get('name') or 'UNNAMED').strip()
        try:
            lat = float(s.get('latitudeNumeric') or 0)
            lng = float(s.get('longitudeNumeric') or 0)
        except (TypeError, ValueError):
            continue
        if lat == 0 and lng == 0:
            continue
        classification = (s.get('classification') or 'TS').strip().upper()
        intensity_kt: float = 0
        try:
            intensity_kt = float(s.get('intensity') or 0)
        except (TypeError, ValueError):
            pass
        storms.append({
            'name': name,
            'lat': round(lat, 2),
            'lng': round(lng, 2),
            'classification': classification,
            'intensityKt': intensity_kt,
        })

    doc = {
        'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': 'NOAA NHC CurrentStorms.json',
        'storms': storms,
    }
    out_path = 'public/data/storms-snapshot.json'
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {len(storms)} active storms to {out_path}', file=sys.stderr)


if __name__ == '__main__':
    main()
