#!/usr/bin/env python3
"""Open-Meteo daily-call budget audit (Story 20.2, plan PRO_GRATIS E20).

Open-Meteo's non-commercial tier allows < 10 000 calls/day. Our
scheduled workflows are the only predictable consumer (browsers hit
the API too, but that traffic is per-visitor and cached), so the
budget is deterministic: calls per run × runs per day, taken straight
from the snapshot scripts' constants and the workflows' cron lines.
Nothing here touches the network.

Exit 1 when the projected total exceeds --threshold-pct (default 70)
of the daily allowance — CI runs it on every PR so a change that, say,
adds a field variable or tightens a cron cannot silently blow the
budget; quota-audit.yml runs it daily and opens an issue on failure.
"""
from __future__ import annotations

import argparse
import importlib.util
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY_ALLOWANCE = 10_000


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, 'scripts', f'{name}.py'))
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def cron_of(workflow: str) -> str:
    path = os.path.join(ROOT, '.github', 'workflows', workflow)
    with open(path, encoding='utf-8') as f:
        m = re.search(r"cron:\s*'([^']+)'", f.read())
    if not m:
        raise SystemExit(f'{workflow}: no cron line')
    return m.group(1)


def _slots(field: str, span: int) -> int:
    """How many values of a 5-field cron entry fire within its range."""
    total = 0
    for part in field.split(','):
        step = 1
        if '/' in part:
            part, s = part.split('/', 1)
            step = int(s)
        if part == '*':
            lo, hi = 0, span - 1
        elif '-' in part:
            lo, hi = (int(x) for x in part.split('-', 1))
        else:
            lo = hi = int(part)
        total += len(range(lo, hi + 1, step))
    return total


def runs_per_day(cron: str) -> float:
    minute, hour, dom, month, dow = cron.split()
    per_day = _slots(minute, 60) * _slots(hour, 24)
    # Day filters scale the daily average down (rough but monotonic).
    if dow != '*':
        per_day *= _slots(dow, 7) / 7
    if dom != '*':
        per_day *= _slots(dom, 31) / 30
    if month != '*':
        per_day *= _slots(month, 12) / 12
    return per_day


def budget() -> list[dict]:
    fg = load_script('build-field-grids')
    cf = load_script('build-city-forecasts')
    cb = load_script('build-climate-baseline-mx')
    chunks = math.ceil(fg.COLS * fg.ROWS / fg.CHUNK_SIZE)
    rows = [
        ('field-grids.yml', 'build-field-grids.py', len(fg.LAYERS) * chunks,
         f'{len(fg.LAYERS)} variables × {chunks} chunks of ≤{fg.CHUNK_SIZE} points'),
        ('city-forecasts.yml', 'build-city-forecasts.py', len(cf.TOP_CITIES),
         f'{len(cf.TOP_CITIES)} cities, one /v1/forecast each'),
        ('aqi-snapshot.yml', 'build-aqi-snapshot.py', 1, 'one bulk air-quality call'),
        ('marine-snapshot.yml', 'build-marine-snapshot.py', 1, 'one bulk marine call'),
        ('climate-baseline.yml', 'build-climate-baseline-mx.py', len(cb.CITIES),
         f'{len(cb.CITIES)} cities, one archive call each'),
    ]
    out = []
    for wf, script, per_run, why in rows:
        cron = cron_of(wf)
        rpd = runs_per_day(cron)
        out.append({
            'workflow': wf, 'script': script, 'cron': cron, 'runsPerDay': rpd,
            'callsPerRun': per_run, 'callsPerDay': per_run * rpd, 'why': why,
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--threshold-pct', type=float, default=70.0)
    args = ap.parse_args()
    rows = budget()
    total = sum(r['callsPerDay'] for r in rows)
    pct = 100 * total / DAILY_ALLOWANCE
    print(f'{"workflow":24} {"cron":16} {"runs/d":>7} {"calls/run":>9} {"calls/d":>8}  why')
    for r in rows:
        print(f'{r["workflow"]:24} {r["cron"]:16} {r["runsPerDay"]:7.1f} {r["callsPerRun"]:9d} {r["callsPerDay"]:8.0f}  {r["why"]}')
    print(f'\nprojected Open-Meteo calls/day from workflows: {total:.0f} of {DAILY_ALLOWANCE} ({pct:.1f} %)')
    print('browser traffic (per visitor, cached 10 min) is on top of this and is not counted.')
    if pct > args.threshold_pct:
        print(f'::error::Open-Meteo budget at {pct:.1f} % of the daily allowance (threshold {args.threshold_pct:.0f} %)')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
