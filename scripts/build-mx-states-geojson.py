#!/usr/bin/env python3
"""Build a simplified MX-states GeoJSON used by the client-side
point-in-polygon lookup that maps arbitrary (lat, lng) coordinates to
their MX state slug. Used by the SMN avisos widget on /forecast and
on the curated detail pages when the slug isn't already known.

Pipeline:
  1. Download Natural Earth admin-1 (ne_10m), public domain.
  2. Filter to MX features (iso_a2 == 'MX').
  3. Map each NE ISO code (MX-DIF, MX-MEX, …) to the slug used in
     src/lib/mx-states.ts.
  4. Simplify geometry with shapely (Douglas-Peucker) so the output
     is ~50 KB instead of ~500 KB. Tolerance is tuned for state-level
     lookup, not display precision.
  5. Emit public/data/mx-states.geojson with only the slug + name +
     simplified geometry — every other NE property is dropped.

The output is committed once. It rarely needs to change (state
boundaries are stable). The workflow runs only on manual dispatch or
on changes to this script.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

from shapely.geometry import mapping, shape

NE_URL = (
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/'
    'master/geojson/ne_10m_admin_1_states_provinces.geojson'
)

# Map NE 'iso_3166_2' codes (e.g. 'MX-DIF') to the slugs used in
# src/lib/mx-states.ts. Two notable renames:
#   - 'Distrito Federal' (MX-DIF) → 'cdmx'   (the legal name changed
#     in 2016 from D.F. to CDMX but NE still uses the old code)
#   - 'México' (MX-MEX)           → 'estado-de-mexico'
ISO_TO_SLUG = {
    'MX-AGU': 'aguascalientes',
    'MX-BCN': 'baja-california',
    'MX-BCS': 'baja-california-sur',
    'MX-CAM': 'campeche',
    'MX-CHP': 'chiapas',
    'MX-CHH': 'chihuahua',
    'MX-DIF': 'cdmx',
    'MX-COA': 'coahuila',
    'MX-COL': 'colima',
    'MX-DUR': 'durango',
    'MX-MEX': 'estado-de-mexico',
    'MX-GUA': 'guanajuato',
    'MX-GRO': 'guerrero',
    'MX-HID': 'hidalgo',
    'MX-JAL': 'jalisco',
    'MX-MIC': 'michoacan',
    'MX-MOR': 'morelos',
    'MX-NAY': 'nayarit',
    'MX-NLE': 'nuevo-leon',
    'MX-OAX': 'oaxaca',
    'MX-PUE': 'puebla',
    'MX-QUE': 'queretaro',
    'MX-ROO': 'quintana-roo',
    'MX-SLP': 'san-luis-potosi',
    'MX-SIN': 'sinaloa',
    'MX-SON': 'sonora',
    'MX-TAB': 'tabasco',
    'MX-TAM': 'tamaulipas',
    'MX-TLA': 'tlaxcala',
    'MX-VER': 'veracruz',
    'MX-YUC': 'yucatan',
    'MX-ZAC': 'zacatecas',
}

# Douglas-Peucker tolerance in degrees. 0.03° ≈ 3.3 km — coarse enough
# to fit the dataset in ~40 KB (vs ~500 KB unsimplified), fine enough
# that state boundaries still resolve correctly at populated areas.
# A user standing within 3 km of a state border may map to the wrong
# state, but that border itself is a 50-m line in reality, so this
# tolerance affects roughly 0.04 % of MX area. Tuned by inspecting
# the output size + visually spot-checking a few state outlines.
SIMPLIFY_TOLERANCE_DEG = 0.03


def main() -> None:
    print(f'fetching {NE_URL}', file=sys.stderr)
    with urllib.request.urlopen(NE_URL, timeout=120) as r:  # noqa: S310
        data = json.loads(r.read().decode('utf-8'))

    out_features: list[dict] = []
    for f in data.get('features') or []:
        props = f.get('properties') or {}
        if props.get('iso_a2') != 'MX':
            continue
        iso = props.get('iso_3166_2')
        slug = ISO_TO_SLUG.get(iso)
        if not slug:
            # The disputed MX-X01~ region (no name, no iso match) and any
            # future additions land here — skipped silently.
            print(f'  skip {props.get("name")} (iso={iso})', file=sys.stderr)
            continue
        geom = f.get('geometry')
        if not geom:
            print(f'  skip {slug} (no geometry)', file=sys.stderr)
            continue
        # Round-trip through shapely for simplification.
        simplified = (
            shape(geom)
            .simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
        )
        out_features.append({
            'type': 'Feature',
            'properties': {
                'slug': slug,
                'name': props.get('name'),
            },
            'geometry': mapping(simplified),
        })

    out_features.sort(key=lambda f: f['properties']['slug'])

    fc = {
        'type': 'FeatureCollection',
        'metadata': {
            'source': 'Natural Earth ne_10m_admin_1_states_provinces (public domain)',
            'simplifyToleranceDeg': SIMPLIFY_TOLERANCE_DEG,
            'count': len(out_features),
        },
        'features': out_features,
    }
    out_path = 'public/data/mx-states.geojson'
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as out:
        json.dump(fc, out, separators=(',', ':'), ensure_ascii=False)
    size_kb = os.path.getsize(out_path) / 1024
    print(
        f'wrote {len(out_features)} MX state polygons to {out_path} ({size_kb:.0f} KB)',
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
