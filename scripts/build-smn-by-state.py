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

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(
        f'indexed {total} avisos: {doc["metadata"]["with_state"]} state-tagged, '
        f'{doc["metadata"]["global_only"]} global → {OUT_PATH} ({size_kb:.0f} KB)',
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
