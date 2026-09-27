#!/usr/bin/env python3
"""Publish pending alert events to ntfy.sh topics — the "push without a
backend" channel of plan PRO_GRATIS E17 (Story 17.1 / 17.2).

Why ntfy: it needs no server of ours and stores no user data on our
side. A GitHub Action POSTs a message to a public topic; anyone who
subscribed to that topic (ntfy app on iOS/Android, or ntfy.sh in a
browser with Web Push) gets a notification. The topic name is the only
"identity" involved, and it is public by design (see /alertas/ for the
caveat that public topics can be posted to by anyone).

Input file shape (owned by the snapshot script that produces it):
  {
    "updated": "...",
    "events": [ {"id": "...", "topic": "climamx-…", "title": "...",
                 "body": "...", "click": "https://…", "tags": "cyclone",
                 "priority": 3, "ts": "2026-09-27T05:10:00Z"}, … ],
    "published": ["id", …]          # rolling list of already-sent ids
  }

Events without a `topic` go to --default-topic. Already-published ids
are skipped; new ones are POSTed oldest-first, at most --max per run
(a burst after an outage should not spam phones), then recorded back
into the file. Exit code 0 unless the file is unreadable — a failed
POST is logged and retried on the next run because its id is only
recorded on success.

Env: NTFY_BASE_URL (default https://ntfy.sh); NTFY_DISABLED=1 skips
network entirely (used by --dry-run too).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

PUBLISHED_KEEP = 500


def post(base: str, topic: str, ev: dict) -> bool:
    url = f'{base.rstrip("/")}/{topic}'
    body = (ev.get('body') or '').encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    # ntfy reads the metadata from headers; non-ASCII titles must be
    # RFC 2047 encoded or ntfy rejects the header — it also accepts
    # the `X-Title` form with UTF-8 when we base64-encode via `=?UTF-8?B?…?=`.
    title = ev.get('title') or ''
    try:
        title.encode('ascii')
        req.add_header('Title', title)
    except UnicodeEncodeError:
        import base64

        b64 = base64.b64encode(title.encode('utf-8')).decode('ascii')
        req.add_header('Title', f'=?UTF-8?B?{b64}?=')
    if ev.get('click'):
        req.add_header('Click', str(ev['click']))
    if ev.get('tags'):
        req.add_header('Tags', str(ev['tags']))
    if ev.get('priority'):
        req.add_header('Priority', str(ev['priority']))
    req.add_header('Content-Type', 'text/plain; charset=utf-8')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        print(f'  ntfy {topic}: HTTP {e.code}', file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f'  ntfy {topic}: {e}', file=sys.stderr)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--default-topic', required=True)
    ap.add_argument('--max', type=int, default=10)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    try:
        with open(args.file, encoding='utf-8') as f:
            doc = json.load(f)
    except FileNotFoundError:
        print(f'{args.file} missing — nothing to publish', file=sys.stderr)
        return 0
    except json.JSONDecodeError as e:
        print(f'{args.file} unreadable: {e}', file=sys.stderr)
        return 1

    events = [e for e in doc.get('events') or [] if isinstance(e, dict) and e.get('id')]
    published = list(doc.get('published') or [])
    seen = set(published)
    pending = [e for e in events if e['id'] not in seen]
    # Oldest first so a phone reads them in order.
    pending.sort(key=lambda e: str(e.get('ts') or ''))
    disabled = args.dry_run or os.environ.get('NTFY_DISABLED') == '1'
    base = os.environ.get('NTFY_BASE_URL', 'https://ntfy.sh')

    sent = 0
    for ev in pending[: args.max]:
        topic = str(ev.get('topic') or args.default_topic)
        if disabled:
            print(f'  [dry-run] {topic}: {ev.get("title")}', file=sys.stderr)
            ok = True
        else:
            ok = post(base, topic, ev)
        if ok:
            published.append(ev['id'])
            sent += 1
    skipped = max(0, len(pending) - args.max)
    if skipped:
        print(f'  {skipped} event(s) deferred to the next run (--max {args.max})', file=sys.stderr)

    doc['published'] = published[-PUBLISHED_KEEP:]
    with open(args.file, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'published {sent}/{len(pending)} pending event(s) from {args.file}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
