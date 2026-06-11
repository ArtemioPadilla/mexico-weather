#!/usr/bin/env python3
"""Pre-bake the default Open-Meteo field grids consumed by the /mapa
field layers (temperatura, humedad, presión, nubes).

Without this snapshot, every /mapa visit makes one ~5-KB-URL bulk
Open-Meteo request per active layer — 32×24 = 768 points each. Pre-
baking hourly lets the initial map paint hydrate from a 200-KB static
JSON, then live API takes over only when the user changes sub-option
or model.

Output (one file per default hourly variable):
  public/data/field-grids/temperature_2m.json
  public/data/field-grids/relative_humidity_2m.json
  public/data/field-grids/surface_pressure.json
  public/data/field-grids/cloud_cover.json

Each file mirrors parseFieldResponse()'s FieldGrid output shape so
loadFieldGrid() / createCloudsOverlay() can substitute it for the
live response with zero shape conversion.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Mirror of MX_FIELD_BOUNDS in src/lib/interactive-map.ts.
BOUNDS = {'west': -130, 'south': -5, 'east': -60, 'north': 50}
COLS = 32
ROWS = 24

# Default hourly variables we pre-bake. Sub-options (apparent_temperature,
# dew_point_2m, pressure_msl, wet_bulb_temperature_2m) still hit live
# because their static cache would balloon the snapshot count for
# limited value — the defaults are what 90% of map opens use.
LAYERS = [
    'temperature_2m',
    'relative_humidity_2m',
    'pressure_msl',
    'cloud_cover',
]


def viewport_grid(b, cols, rows):
    """Mirror of viewportGrid() in src/lib/mapfields.ts. Round to 4 dp
    so the output matches the runtime URL bytes exactly."""
    c = max(2, int(cols))
    r = max(2, int(rows))
    pts = []
    for j in range(r):
        lat = b['south'] + ((b['north'] - b['south']) * j) / (r - 1)
        for i in range(c):
            lng = b['west'] + ((b['east'] - b['west']) * i) / (c - 1)
            pts.append({'lat': round(lat, 4), 'lng': round(lng, 4)})
    return pts


def build_url(points, hourly_var):
    lats = ','.join(str(p['lat']) for p in points)
    lngs = ','.join(str(p['lng']) for p in points)
    qs = urllib.parse.urlencode({
        'latitude': lats,
        'longitude': lngs,
        'hourly': hourly_var,
        'forecast_days': 2,
        'timezone': 'UTC',
    })
    return f'https://api.open-meteo.com/v1/forecast?{qs}'


# Open-Meteo's GET URL limit is ~8 KB (nginx default). A 32x24=768
# point grid with 4-dp coords builds an ~11 KB URL — that's what was
# triggering HTTP 414 in CI. Chunk at 200 points so each URL stays
# under ~3 KB with comfortable margin.
CHUNK_SIZE = 200


def fetch_chunk(chunk, hourly_var):
    """Fetch one ≤200-point batch. Retries on transient failures.

    429s get a much longer backoff than other errors: Open-Meteo's
    free-tier rate limit is per-minute, so 1-2s retries (the old
    behaviour) burned all attempts inside the same limit window and
    the hourly run failed. Honour Retry-After when present.
    """
    url = build_url(chunk, hourly_var)
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'mexico-weather/static-snapshot'},
    )
    attempts = 5
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:  # noqa: S310
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001
            if attempt == attempts - 1:
                raise
            if isinstance(e, urllib.error.HTTPError) and e.code == 429:
                retry_after = e.headers.get('Retry-After') if e.headers else None
                try:
                    wait = max(int(retry_after), 30) if retry_after else 60
                except ValueError:
                    wait = 60
            else:
                wait = 2 ** attempt
            print(
                f'  retry {attempt + 1}/{attempts} in {wait}s ({e})',
                file=sys.stderr,
            )
            time.sleep(wait)


def fetch_json(points, hourly_var):
    """Fetch all points in chunks and concatenate the per-point
    response arrays. Open-Meteo returns an array when the request had
    multiple lat/lng — preserving that shape across chunks lets the
    existing parse_response() work unchanged."""
    out = []
    for i in range(0, len(points), CHUNK_SIZE):
        chunk = points[i:i + CHUNK_SIZE]
        data = fetch_chunk(chunk, hourly_var)
        arr = data if isinstance(data, list) else [data]
        out.extend(arr)
        # Be polite between chunks — 1s keeps the whole run well under
        # Open-Meteo's per-minute free-tier budget (we saw 429s at 0.3s).
        if i + CHUNK_SIZE < len(points):
            time.sleep(1.0)
    return out


def parse_response(raw, points, hourly_var):
    """Mirror parseFieldResponse() — emit { times, points } where
    each point has { lat, lng, values }."""
    if not raw:
        return None
    arr = raw if isinstance(raw, list) else [raw]
    if len(arr) != len(points):
        return None
    first = arr[0] if arr else None
    times = ((first or {}).get('hourly') or {}).get('time') if first else None
    if not isinstance(times, list) or not times:
        return None

    def pick_values(h):
        if not h:
            return None
        if hourly_var in h:
            return h[hourly_var]
        prefix = hourly_var + '_'
        for k in h:
            if k.startswith(prefix):
                return h[k]
        return None

    out_points = []
    for i, pt in enumerate(points):
        h = (arr[i] or {}).get('hourly') or {}
        values = pick_values(h)
        if not isinstance(values, list):
            return None
        # The browser shape allows null; preserve that.
        cleaned = [
            (v if isinstance(v, (int, float)) and not isinstance(v, bool) else None)
            for v in values
        ]
        out_points.append({'lat': pt['lat'], 'lng': pt['lng'], 'values': cleaned})

    return {'times': times, 'points': out_points}


def main():
    out_dir = 'public/data/field-grids'
    os.makedirs(out_dir, exist_ok=True)
    points = viewport_grid(BOUNDS, COLS, ROWS)
    print(f'grid = {COLS}x{ROWS} = {len(points)} points', file=sys.stderr)

    ok = 0
    for var in LAYERS:
        try:
            raw = fetch_json(points, var)
        except Exception as e:  # noqa: BLE001
            print(f'  ! {var}: fetch failed: {e}', file=sys.stderr)
            continue
        grid = parse_response(raw, points, var)
        if not grid:
            print(f'  ! {var}: parse failed', file=sys.stderr)
            continue
        # Stamp into the JSON so the client can decide if the snapshot
        # is too stale to use (>2h would be a red flag).
        grid['_meta'] = {
            'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'source': 'Open-Meteo Forecast API',
            'license': 'CC-BY 4.0',
            'cols': COLS,
            'rows': ROWS,
            'bounds': BOUNDS,
            'hourlyVar': var,
        }
        out_path = os.path.join(out_dir, f'{var}.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(grid, f, separators=(',', ':'), ensure_ascii=False)
        print(f'  wrote {var} ({len(grid["points"])} pts, {len(grid["times"])} hrs)', file=sys.stderr)
        ok += 1
        # Be polite — small gap between calls.
        time.sleep(0.5)

    print(f'wrote {ok}/{len(LAYERS)} field grids to {out_dir}/', file=sys.stderr)


if __name__ == '__main__':
    main()
