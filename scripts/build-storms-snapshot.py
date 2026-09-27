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
OUT_PATH = 'public/data/storms-snapshot.json'
ALERTS_PATH = 'public/data/storms-alerts.json'
ALERTS_KEEP = 50
SITE = 'https://artemiop.com/mexico-weather'

# Only systems that can matter to Mexico ring phones (Story 17.1):
# both basins, roughly the Caribbean/Gulf/EPac box.
MX_BOX = {'west': -125.0, 'east': -75.0, 'south': 5.0, 'north': 35.0}

# NHC classification → rank, so a change reads as upgrade/downgrade.
RANK = {'TD': 1, 'STD': 1, 'PTC': 1, 'PC': 1, 'TS': 2, 'STS': 2, 'HU': 3, 'MH': 4}
LABEL = {
    'TD': 'Depresión tropical',
    'STD': 'Depresión subtropical',
    'PTC': 'Ciclón tropical potencial',
    'PC': 'Ciclón post-tropical',
    'TS': 'Tormenta tropical',
    'STS': 'Tormenta subtropical',
    'HU': 'Huracán',
    'MH': 'Huracán mayor',
}


def near_mx(s: dict) -> bool:
    return (
        MX_BOX['west'] <= s['lng'] <= MX_BOX['east']
        and MX_BOX['south'] <= s['lat'] <= MX_BOX['north']
    )


def load_json(path: str) -> dict | None:
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def describe(s: dict) -> str:
    kt = int(round(s['intensityKt']))
    kmh = int(round(s['intensityKt'] * 1.852))
    ns = 'N' if s['lat'] >= 0 else 'S'
    ew = 'O' if s['lng'] < 0 else 'E'
    return (
        f"{LABEL.get(s['classification'], s['classification'])} {s['name']} · "
        f"{kt} kt ({kmh} km/h) · {abs(s['lat']):.1f}°{ns} {abs(s['lng']):.1f}°{ew}"
    )


def detect_events(prev: dict | None, storms: list[dict], now_iso: str) -> list[dict]:
    """Diff the previous snapshot against the new one. Returns ntfy-ready
    events for storms inside MX_BOX: new system, up/downgrade, or an
    intensity jump of ≥15 kt. Pure so it can be exercised offline."""
    prev_by_name = {s['name']: s for s in ((prev or {}).get('storms') or [])}
    day = now_iso[:10].replace('-', '')
    events = []
    for s in storms:
        if not near_mx(s):
            continue
        p = prev_by_name.get(s['name'])
        kind = None
        if p is None:
            kind = 'new'
        else:
            r0, r1 = RANK.get(p['classification'], 0), RANK.get(s['classification'], 0)
            if r1 > r0:
                kind = 'upgrade'
            elif r1 < r0:
                kind = 'downgrade'
            elif s['intensityKt'] - p['intensityKt'] >= 15:
                kind = 'intensify'
        if not kind:
            continue
        head = {
            'new': 'Nuevo sistema tropical cerca de México',
            'upgrade': 'Se intensifica',
            'downgrade': 'Se debilita',
            'intensify': 'Vientos en aumento',
        }[kind]
        events.append({
            'id': f"{s['name']}-{kind}-{s['classification']}-{day}",
            'ts': now_iso,
            'kind': kind,
            'name': s['name'],
            'classification': s['classification'],
            'intensityKt': s['intensityKt'],
            'lat': s['lat'],
            'lng': s['lng'],
            'topic': 'climamx-huracanes',
            'title': f"🌀 {head}: {s['name']}",
            'body': describe(s) + '. Detalle y trayectoria en Clima México.',
            'click': f'{SITE}/huracanes/',
            'tags': 'cyclone',
            'priority': 4 if kind in ('new', 'upgrade') else 3,
        })
    return events



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

    now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    prev = load_json(OUT_PATH)
    doc = {
        'updated': now_iso,
        'source': 'NOAA NHC CurrentStorms.json',
        'storms': storms,
    }
    out_path = OUT_PATH
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'wrote {len(storms)} active storms to {out_path}', file=sys.stderr)

    # Story 17.1 — alert events for scripts/publish-ntfy.py. Keep the
    # rolling event list + published ids in one file so the workflow
    # commits a single artefact and other workflows never touch it.
    alerts = load_json(ALERTS_PATH) or {'events': [], 'published': []}
    new_events = detect_events(prev, storms, now_iso)
    known = {e.get('id') for e in alerts.get('events') or []}
    fresh = [e for e in new_events if e['id'] not in known]
    alerts['events'] = (fresh + list(alerts.get('events') or []))[:ALERTS_KEEP]
    alerts['updated'] = now_iso
    if prev is None:
        # First run ever: never flood phones with the whole current list.
        alerts['published'] = list({*(alerts.get('published') or []), *(e['id'] for e in fresh)})
    with open(ALERTS_PATH, 'w', encoding='utf-8') as f:
        json.dump(alerts, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{len(fresh)} new tropical alert event(s) → {ALERTS_PATH}', file=sys.stderr)


if __name__ == '__main__':
    main()
