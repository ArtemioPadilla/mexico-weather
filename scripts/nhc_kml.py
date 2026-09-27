#!/usr/bin/env python3
"""NHC KMZ → plain dicts / GeoJSON, with no dependencies beyond the
standard library (Stories 18.1 / 18.2, plan PRO_GRATIS E18).

NHC publishes, per active system, a `…_CONE.kmz` (one polygon), a
`…_TRACK.kmz` (72 h + 120 h line strings plus one point per forecast
hour, styled `initial_point`, `m_point`, `h_point`, `s_point`,
`d_point`, `l_point` and the `x…` variants for days 4–5) and a
`…_WW.kmz` (coastal segments styled HWA / HWR / TWA / TWR). The
Tropical Weather Outlook ships as `xgtwo/gtwo_atl.kmz` and
`gtwo_pac.kmz`: a polygon + a point per disturbance with 2-day / 7-day
percentages in ExtendedData. All of them are a zip holding one KML.

Run `python3 scripts/nhc_kml.py --selftest` to exercise the parser on
the inline samples (the vitest suite does that in CI).
"""
from __future__ import annotations

import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

COORD_DP = 3


def kml_from_kmz(blob: bytes) -> str:
    """The first .kml inside a KMZ; raises on a non-zip (NHC answers
    404s with an HTML page and a 200-looking body sometimes)."""
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = [n for n in z.namelist() if n.lower().endswith('.kml')]
        if not names:
            raise ValueError('KMZ without a .kml inside')
        return z.read(names[0]).decode('utf-8', 'replace')


def _local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _coords(text: str | None) -> list[list[float]]:
    out: list[list[float]] = []
    for tok in (text or '').split():
        parts = tok.split(',')
        if len(parts) < 2:
            continue
        try:
            lng = round(float(parts[0]), COORD_DP)
            lat = round(float(parts[1]), COORD_DP)
        except ValueError:
            continue
        out.append([lng, lat])
    return out


def _geometries(el: ET.Element) -> list[dict]:
    """GeoJSON geometries under a Placemark (MultiGeometry flattened)."""
    geoms: list[dict] = []
    for node in el.iter():
        t = _local(node.tag)
        if t == 'Point':
            c = _coords(_find_text(node, 'coordinates'))
            if c:
                geoms.append({'type': 'Point', 'coordinates': c[0]})
        elif t == 'LineString':
            c = _coords(_find_text(node, 'coordinates'))
            if len(c) >= 2:
                geoms.append({'type': 'LineString', 'coordinates': c})
        elif t == 'Polygon':
            rings: list[list[list[float]]] = []
            for ring in node.iter():
                if _local(ring.tag) == 'LinearRing':
                    c = _coords(_find_text(ring, 'coordinates'))
                    if len(c) >= 4:
                        rings.append(c)
            if rings:
                geoms.append({'type': 'Polygon', 'coordinates': rings})
    return geoms


def _find_text(el: ET.Element, local: str) -> str | None:
    for node in el.iter():
        if _local(node.tag) == local:
            return node.text
    return None


def parse_kml(text: str) -> list[dict]:
    """Every Placemark as {name, style, description, data, geometries}."""
    root = ET.fromstring(text)
    out: list[dict] = []
    for pm in root.iter():
        if _local(pm.tag) != 'Placemark':
            continue
        rec = {
            'name': '',
            'style': '',
            'description': '',
            'data': {},
            'geometries': _geometries(pm),
        }
        for child in pm:
            t = _local(child.tag)
            if t == 'name':
                rec['name'] = (child.text or '').strip()
            elif t == 'styleUrl':
                rec['style'] = (child.text or '').strip().lstrip('#')
            elif t == 'description':
                rec['description'] = child.text or ''
            elif t == 'ExtendedData':
                for d in child.iter():
                    if _local(d.tag) == 'Data':
                        key = d.get('name') or ''
                        val = _find_text(d, 'value')
                        if key:
                            rec['data'][key] = (val or '').strip()
        out.append(rec)
    return out


# --- per-product distillers -------------------------------------------------

POINT_KIND = {
    'initial_point': 'initial',
    'm_point': 'major',
    'h_point': 'hurricane',
    's_point': 'storm',
    'd_point': 'depression',
    'l_point': 'low',
}


def track_points(placemarks: list[dict]) -> list[dict]:
    """Forecast points in order, with hour / wind / valid-at pulled out
    of the HTML description NHC embeds in each point."""
    pts: list[dict] = []
    for pm in placemarks:
        geoms = [g for g in pm['geometries'] if g['type'] == 'Point']
        if not geoms:
            continue
        style = pm['style']
        extended = style.startswith('x')
        kind = POINT_KIND.get(style[1:] if extended else style, 'storm')
        desc = pm['description']
        hour = 0
        m = re.search(r'(\d+)\s*hr\s*Forecast', desc)
        if m:
            hour = int(m.group(1))
        wind = None
        m = re.search(r'Maximum Wind:\s*(\d+)\s*knots', desc)
        if m:
            wind = int(m.group(1))
        valid = None
        m = re.search(r'Valid at:\s*([^<\n]+)', desc)
        if m:
            valid = m.group(1).strip()
        lng, lat = geoms[0]['coordinates']
        pts.append({
            'hour': hour if style != 'initial_point' else 0,
            'kind': kind,
            'extended': extended,
            'lng': lng,
            'lat': lat,
            'windKt': wind,
            'validAt': valid,
        })
    pts.sort(key=lambda p: p['hour'])
    return pts


def track_lines(placemarks: list[dict]) -> list[dict]:
    out = []
    for pm in placemarks:
        for g in pm['geometries']:
            if g['type'] == 'LineString':
                out.append({
                    'hours': int(pm['data'].get('fcstpd') or 0) or (120 if '120' in pm['style'] else 72),
                    'coordinates': g['coordinates'],
                })
    out.sort(key=lambda l: l['hours'])
    return out


def cone_polygon(placemarks: list[dict]) -> dict | None:
    for pm in placemarks:
        for g in pm['geometries']:
            if g['type'] == 'Polygon':
                return g
    return None


WW_LABEL = {
    'HWA': ('Vigilancia de huracán', 'Hurricane Watch'),
    'HWR': ('Aviso de huracán', 'Hurricane Warning'),
    'TWA': ('Vigilancia de tormenta tropical', 'Tropical Storm Watch'),
    'TWR': ('Aviso de tormenta tropical', 'Tropical Storm Warning'),
}


def watches_warnings(placemarks: list[dict]) -> list[dict]:
    out = []
    for pm in placemarks:
        code = pm['style'].upper()
        if code not in WW_LABEL:
            continue
        for g in pm['geometries']:
            if g['type'] == 'LineString':
                out.append({
                    'type': code,
                    'label': WW_LABEL[code][0],
                    'labelEn': WW_LABEL[code][1],
                    'coordinates': g['coordinates'],
                })
    return out


def _pct(v: str) -> int | None:
    m = re.search(r'(\d+)', v or '')
    return int(m.group(1)) if m else None


def outlook_areas(placemarks: list[dict], basin: str) -> list[dict]:
    """One record per disturbance: polygon + point + 2 d / 7 d chances."""
    by_id: dict[str, dict] = {}
    for pm in placemarks:
        d = pm['data']
        key = d.get('Disturbance') or str(len(by_id) + 1)
        rec = by_id.setdefault(key, {
            'basin': basin,
            'disturbance': key,
            'pct2': _pct(d.get('2day_percentage', '')),
            'pct7': _pct(d.get('7day_percentage', '')),
            'cat2': d.get('2day_category', ''),
            'cat7': d.get('7day_category', ''),
            'discussion': re.sub(r'\s+', ' ', d.get('Discussion', '')).strip()[:600],
            'area': None,
            'point': None,
        })
        for g in pm['geometries']:
            if g['type'] == 'Polygon' and rec['area'] is None:
                rec['area'] = g
            elif g['type'] == 'Point' and rec['point'] is None:
                rec['point'] = g['coordinates']
    return list(by_id.values())


# --- self-test ----------------------------------------------------------------

_SAMPLE_TRACK = """<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><styleUrl>#72_line</styleUrl><LineString><coordinates>-113.4,19.8,0 -113.8,20.7,0</coordinates></LineString>
<ExtendedData><Data name="fcstpd"><value>72</value></Data></ExtendedData></Placemark>
<Placemark><description><![CDATA[<tr><td>Advisory #26A</td></tr>]]></description><styleUrl>#initial_point</styleUrl>
<Point><coordinates>-113.4,19.8,0</coordinates></Point></Placemark>
<Placemark><description><![CDATA[<tr><td nowrap>12 hr Forecast</td></tr><tr><td nowrap>Valid at: 5:00 AM MST September 27, 2026 </td></tr>
<tr><td nowrap>Maximum Wind: 100 knots (115 mph) </td></tr>]]></description><styleUrl>#m_point</styleUrl>
<Point><coordinates>-113.8,20.7,0</coordinates></Point></Placemark>
<Placemark><description><![CDATA[<tr><td nowrap>96 hr Forecast</td></tr><tr><td nowrap>Maximum Wind: 30 knots (35 mph) </td></tr>]]></description>
<styleUrl>#xd_point</styleUrl><Point><coordinates>-108.4,29.7,0</coordinates></Point></Placemark>
</Document></kml>"""

_SAMPLE_WW = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Hurricane Watch</name>
<styleUrl>#HWA</styleUrl><LineString><coordinates>-110.7,24.91,0 -111.35,26.02,0</coordinates></LineString></Placemark>
<Placemark><name>Tropical Storm Warning</name><styleUrl>#TWR</styleUrl><LineString><coordinates>-1,1,0 -2,2,0 -3,3,0</coordinates></LineString></Placemark>
</Document></kml>"""

_SAMPLE_TWO = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><styleUrl>#3</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>-100,10,0 -95,10,0 -95,15,0 -100,15,0 -100,10,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
<ExtendedData><Data name="Disturbance"><value>1</value></Data><Data name="2day_percentage"><value>90%</value></Data><Data name="2day_category"><value>High</value></Data>
<Data name="7day_percentage"><value>90%</value></Data><Data name="7day_category"><value>High</value></Data><Data name="Discussion"><value>1. Southwest of  Tehuantepec: …</value></Data></ExtendedData></Placemark>
<Placemark><styleUrl>#higx</styleUrl><Point><coordinates>-97.5,12.5,0</coordinates></Point><ExtendedData><Data name="Disturbance"><value>1</value></Data></ExtendedData></Placemark>
</Document></kml>"""


def _selftest() -> int:
    pts = track_points(parse_kml(_SAMPLE_TRACK))
    assert [p['hour'] for p in pts] == [0, 12, 96], pts
    assert pts[1]['kind'] == 'major' and pts[1]['windKt'] == 100 and pts[1]['validAt'].startswith('5:00 AM'), pts[1]
    assert pts[2]['kind'] == 'depression' and pts[2]['extended'] is True
    lines = track_lines(parse_kml(_SAMPLE_TRACK))
    assert lines == [{'hours': 72, 'coordinates': [[-113.4, 19.8], [-113.8, 20.7]]}], lines
    ww = watches_warnings(parse_kml(_SAMPLE_WW))
    assert [w['type'] for w in ww] == ['HWA', 'TWR'] and ww[0]['label'] == 'Vigilancia de huracán', ww
    two = outlook_areas(parse_kml(_SAMPLE_TWO), 'pac')
    assert len(two) == 1 and two[0]['pct2'] == 90 and two[0]['pct7'] == 90 and two[0]['point'] == [-97.5, 12.5], two
    assert two[0]['area']['type'] == 'Polygon' and len(two[0]['area']['coordinates'][0]) == 5
    assert two[0]['discussion'].startswith('1. Southwest of Tehuantepec')
    # kmz round trip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('doc.kml', _SAMPLE_WW)
    assert len(parse_kml(kml_from_kmz(buf.getvalue()))) == 2
    try:
        kml_from_kmz(b'<html>404</html>')
    except zipfile.BadZipFile:
        pass
    else:
        raise AssertionError('non-zip accepted')
    print('nhc_kml selftest ok')
    return 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    print(__doc__)
