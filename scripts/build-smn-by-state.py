#!/usr/bin/env python3
"""Post-process the SMN RSS feed into a per-state index used by the
<SmnAvisos> widget on every detail page.

SMN avisos don't carry structured geographic data — each <item> just
mentions one or more states in its title/description as free text
("Lluvias muy fuertes... Oaxaca (norte y sur), Chiapas (centro y
sur), Yucatán (oeste)"). We scan that text against the canonical 32
state names + their common aliases (Edo. Mex., CDMX, D.F., …) and
file each aviso under every state it mentions. Avisos that don't
name any specific state (national pronósticos) go in a _global bucket
so they appear on every page.

Input:  src/data/smn-feed.xml (refreshed every 30 min by smn-rss.yml)
Output: public/data/smn-by-state.json shaped:
  {
    metadata: { updated, total_items, with_state, global_only },
    byState:  { <slug>: [ {title, link, pubDate, category, severity} ] },
    global:   [ ... avisos that didn't match any state ]
  }

Runs as an extra step in smn-rss.yml right after the feed is
refreshed, so the JSON index is always in sync.
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET

FEED_PATH = 'src/data/smn-feed.xml'
OUT_PATH = 'public/data/smn-by-state.json'
ALERTS_PATH = 'public/data/smn-alerts.json'
ALERTS_KEEP = 200
# Emoji tag ntfy renders on the notification (kept out of the
# alias dict literal shape so the TS parity test doesn't read it as a slug).
NTFY_TAG = 'warning'
SITE = 'https://artemiop.com/mexico-weather'

# slug → display name for notification titles (Story 17.2). Keep in
# sync with src/lib/mx-states.ts.
STATE_NAMES = {
    'aguascalientes': 'Aguascalientes', 'baja-california': 'Baja California',
    'baja-california-sur': 'Baja California Sur', 'campeche': 'Campeche',
    'chiapas': 'Chiapas', 'chihuahua': 'Chihuahua', 'cdmx': 'Ciudad de México',
    'coahuila': 'Coahuila', 'colima': 'Colima', 'durango': 'Durango',
    'estado-de-mexico': 'Estado de México', 'guanajuato': 'Guanajuato',
    'guerrero': 'Guerrero', 'hidalgo': 'Hidalgo', 'jalisco': 'Jalisco',
    'michoacan': 'Michoacán', 'morelos': 'Morelos', 'nayarit': 'Nayarit',
    'nuevo-leon': 'Nuevo León', 'oaxaca': 'Oaxaca', 'puebla': 'Puebla',
    'queretaro': 'Querétaro', 'quintana-roo': 'Quintana Roo',
    'san-luis-potosi': 'San Luis Potosí', 'sinaloa': 'Sinaloa', 'sonora': 'Sonora',
    'tabasco': 'Tabasco', 'tamaulipas': 'Tamaulipas', 'tlaxcala': 'Tlaxcala',
    'veracruz': 'Veracruz', 'yucatan': 'Yucatán', 'zacatecas': 'Zacatecas',
}


def _load_json(path: str):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def detect_events(prev: dict | None, by_state: dict, global_avisos: list, now_iso: str) -> list[dict]:
    """New avisos since the previous index, as ntfy events. One event
    per (state, aviso); national ones go to the `climamx-smn` topic.
    Pure — exercised offline by the workflow's dry run."""
    import hashlib

    def key(rec):
        # Title only: the scraper stamps `now()` on undated items, so a
        # pubDate-based key would re-notify the same aviso every hour.
        # SMN titles carry the date for the periodic reports anyway.
        return (rec.get('title') or '').strip()

    prev_states = {k: {key(r) for r in v} for k, v in ((prev or {}).get('byState') or {}).items()}
    prev_global = {key(r) for r in ((prev or {}).get('global') or [])}
    events = []

    def make(slug, rec, topic, where):
        h = hashlib.sha1((slug + '|' + key(rec)).encode('utf-8')).hexdigest()[:16]
        sev = (rec.get('severity') or '').strip()
        head = f'⚠️ SMN {where}' + (f' · {sev}' if sev else '')
        return {
            'id': h,
            'ts': now_iso,
            'state': slug,
            'topic': topic,
            'title': head,
            'body': (rec.get('title') or '')[:220],
            'click': f'{SITE}/estado/{slug}/' if slug != '_global' else f'{SITE}/',
            'tags': NTFY_TAG,
            'priority': 4 if 'alerta' in sev.lower() or 'rojo' in sev.lower() else 3,
        }

    for slug, recs in by_state.items():
        seen = prev_states.get(slug, set())
        for r in recs:
            if key(r) not in seen:
                events.append(make(slug, r, f'climamx-smn-{slug}', STATE_NAMES.get(slug, slug)))
    for r in global_avisos:
        if key(r) not in prev_global:
            events.append(make('_global', r, 'climamx-smn', 'nacional'))
    return events


# state name → slug.  Each name MUST stay in sync with src/lib/mx-states.ts.
# Aliases handle the punctuation/abbreviation variants SMN uses ("Edo.
# Méx.", "CDMX", "D.F.", "BCS", etc.). The matching is diacritic-
# insensitive so we don't need separate entries for "Yucatán" vs
# "Yucatan".
STATE_ALIASES = {
    'aguascalientes': 'aguascalientes',
    'baja california': 'baja-california',
    'bc': 'baja-california',
    'baja california sur': 'baja-california-sur',
    'bcs': 'baja-california-sur',
    'campeche': 'campeche',
    'chiapas': 'chiapas',
    'chihuahua': 'chihuahua',
    'ciudad de mexico': 'cdmx',
    'cdmx': 'cdmx',
    'distrito federal': 'cdmx',
    'd f': 'cdmx',
    'df': 'cdmx',
    'coahuila': 'coahuila',
    'colima': 'colima',
    'durango': 'durango',
    'estado de mexico': 'estado-de-mexico',
    'edo de mexico': 'estado-de-mexico',
    'edo mex': 'estado-de-mexico',
    'edomex': 'estado-de-mexico',
    'mexico (estado)': 'estado-de-mexico',
    'guanajuato': 'guanajuato',
    'guerrero': 'guerrero',
    'hidalgo': 'hidalgo',
    'jalisco': 'jalisco',
    'michoacan': 'michoacan',
    'morelos': 'morelos',
    'nayarit': 'nayarit',
    'nuevo leon': 'nuevo-leon',
    'oaxaca': 'oaxaca',
    'puebla': 'puebla',
    'queretaro': 'queretaro',
    'quintana roo': 'quintana-roo',
    'san luis potosi': 'san-luis-potosi',
    'slp': 'san-luis-potosi',
    'sinaloa': 'sinaloa',
    'sonora': 'sonora',
    'tabasco': 'tabasco',
    'tamaulipas': 'tamaulipas',
    'tlaxcala': 'tlaxcala',
    'veracruz': 'veracruz',
    'yucatan': 'yucatan',
    'zacatecas': 'zacatecas',
}

# Bare 'Mexico' must NOT match Estado de México because SMN avisos use
# 'México' freely in country-context ("Centro de México", "norte de
# México"). The 'Mexico' alias is intentionally absent here.

DIACRITICS_RE = re.compile(r'[̀-ͯ]')


def normalize(s: str) -> str:
    """Diacritic-insensitive, lowercase, punctuation-stripped form."""
    s = unicodedata.normalize('NFD', s).lower()
    s = DIACRITICS_RE.sub('', s)
    # Collapse all non-letter runs into single spaces; preserves word
    # boundaries while ignoring punctuation differences.
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return s.strip()


# Pre-build a sorted alias list (longest first) so that 'baja california sur'
# matches before 'baja california' on substrings.
SORTED_ALIASES = sorted(STATE_ALIASES.keys(), key=len, reverse=True)


def classify_severity(title: str, category: str) -> str:
    """Rough severity tag for UI styling. 'critical' = red, 'warn' =
    amber, 'info' = default."""
    t = title.lower()
    if 'alerta' in t or category.lower() == 'alerta':
        return 'critical'
    if 'potencial' in t or 'tormenta' in t or 'huracan' in t or 'lluvia' in t:
        return 'warn'
    return 'info'


def states_in(text: str) -> set[str]:
    """Return the set of slugs whose alias appears in `text` as a
    whole-word substring. Word-bounded so 'Veracruz' doesn't match
    inside arbitrary characters, and the diacritic strip means
    'Yucatán' and 'Yucatan' both hit."""
    n = ' ' + normalize(text) + ' '
    found: set[str] = set()
    matched_spans: list[tuple[int, int]] = []
    for alias in SORTED_ALIASES:
        # Use a regex to find whole-word occurrences. We also avoid
        # double-counting overlapping aliases ('baja california' inside
        # 'baja california sur').
        for m in re.finditer(r'(?<![a-z0-9])' + re.escape(alias) + r'(?![a-z0-9])', n):
            span = (m.start(), m.end())
            # Skip if any previously matched span fully contains this one.
            if any(a <= span[0] and b >= span[1] for a, b in matched_spans):
                continue
            matched_spans.append(span)
            found.add(STATE_ALIASES[alias])
    return found


def main() -> None:
    if not os.path.exists(FEED_PATH):
        print(f'  {FEED_PATH} not found; nothing to index', file=sys.stderr)
        # Emit an empty doc so the page widgets still load gracefully.
        empty = {'metadata': {'total_items': 0}, 'byState': {}, 'global': []}
        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        with open(OUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(empty, f, separators=(',', ':'), ensure_ascii=False)
        return

    tree = ET.parse(FEED_PATH)
    root = tree.getroot()
    by_state: dict[str, list[dict]] = {}
    global_avisos: list[dict] = []
    total = 0

    for item in root.iter('item'):
        title = (item.findtext('title') or '').strip()
        desc = (item.findtext('description') or '').strip()
        link = (item.findtext('link') or '').strip()
        pub = (item.findtext('pubDate') or '').strip()
        category = (item.findtext('category') or '').strip()
        total += 1

        # Look in title + first ~500 chars of description (long
        # bodies dilute the match; SMN puts the affected states up
        # front).
        text = title + '\n' + desc[:500]
        slugs = states_in(text)

        record = {
            'title': title,
            'link': link,
            'pubDate': pub,
            'category': category,
            'severity': classify_severity(title, category),
        }
        if slugs:
            for slug in slugs:
                by_state.setdefault(slug, []).append(record)
        else:
            global_avisos.append(record)

    # Sort each bucket by pubDate descending (most recent first) using
    # a string sort on the email-date strings. Email dates aren't
    # naturally orderable as strings, so we re-parse for the sort key.
    import email.utils

    def sort_key(rec):
        try:
            return -email.utils.parsedate_to_datetime(rec['pubDate']).timestamp()
        except Exception:
            return 0

    for k in by_state:
        by_state[k].sort(key=sort_key)
    global_avisos.sort(key=sort_key)

    doc = {
        'metadata': {
            'updated': root.findtext('channel/lastBuildDate', default='').strip(),
            'total_items': total,
            'with_state': sum(len(v) for v in by_state.values()),
            'global_only': len(global_avisos),
            'source': 'src/data/smn-feed.xml (SMN / Conagua, vía smn-rss.yml)',
        },
        'byState': dict(sorted(by_state.items())),
        'global': global_avisos,
    }

    prev = _load_json(OUT_PATH)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)

    # Story 17.2 — per-state alert events for scripts/publish-ntfy.py.
    import time as _time
    now_iso = _time.strftime('%Y-%m-%dT%H:%M:%SZ', _time.gmtime())
    alerts = _load_json(ALERTS_PATH) or {'events': [], 'published': []}
    fresh_all = detect_events(prev, by_state, global_avisos, now_iso)
    known = {e.get('id') for e in alerts.get('events') or []}
    fresh = [e for e in fresh_all if e['id'] not in known]
    alerts['events'] = (fresh + list(alerts.get('events') or []))[:ALERTS_KEEP]
    alerts['updated'] = now_iso
    if prev is None:
        # First run: seed as published so nobody gets the whole backlog.
        alerts['published'] = list({*(alerts.get('published') or []), *(e['id'] for e in fresh)})
    with open(ALERTS_PATH, 'w', encoding='utf-8') as f:
        json.dump(alerts, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{len(fresh)} new SMN alert event(s) → {ALERTS_PATH}', file=sys.stderr)
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(
        f'indexed {total} avisos: {doc["metadata"]["with_state"]} state-tagged, '
        f'{doc["metadata"]["global_only"]} global → {OUT_PATH} ({size_kb:.0f} KB)',
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
