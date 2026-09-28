import { describe, expect, it } from 'vitest';
import {
  FPS_WINDOW_MS,
  UX_COMMENT_MARKER,
  buildUxMetrics,
  formatDelta,
  fpsStats,
  isSatelliteTileRequest,
  loopPassStarts,
  mergeUxMetrics,
  parseUxComment,
  renderUxComment,
  secondLoopStats,
  uxWarnings,
} from '../../scripts/ux-metrics-lib.mjs';
import type {
  IndexEvent,
  TileRequest,
  UxMetrics,
} from '../../scripts/ux-metrics-lib.mjs';

const GIBS =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/';

function metrics(): UxMetrics {
  return buildUxMetrics({
    generatedAt: '2026-09-28T00:00:00.000Z',
    commit: 'abcdef1234567',
    firstSatelliteFrameMs: 812.4,
    fps: { fps: 59.8, frames: 598, maxGapMs: 33.4, windowMs: 10_000 },
    controls: { desktop: 8, mobile: 5 },
    secondLoop: {
      frames: 15,
      requests: 465,
      newTiles: 0,
      requestsPerFrame: 31,
      newTilesPerFrame: 0,
      msPerFrame: 785,
    },
    longTasks: { count: 2, totalMs: 140 },
  });
}

describe('isSatelliteTileRequest', () => {
  it('matches GIBS WMTS tiles only', () => {
    expect(
      isSatelliteTileRequest(`${GIBS}2026-09-28T12:00:00Z/L7/4/6/3.jpg`)
    ).toBe(true);
    expect(
      isSatelliteTileRequest(
        'https://server.arcgisonline.com/ArcGIS/rest/services/x/MapServer/tile/4/6/3'
      )
    ).toBe(false);
    expect(
      isSatelliteTileRequest('https://gibs.earthdata.nasa.gov/other')
    ).toBe(false);
    expect(isSatelliteTileRequest('not a url')).toBe(false);
  });
});

describe('fpsStats', () => {
  it('counts frames inside the window and the longest gap', () => {
    // 60 Hz for 10 s from t=1000, one 100 ms hitch at t≈5000.
    const ts: number[] = [];
    for (let t = 1000; t < 11_100; t += 1000 / 60) {
      if (t > 5000 && t < 5100) continue;
      ts.push(t);
    }
    const s = fpsStats(ts, 1000);
    expect(s).not.toBeNull();
    expect(s!.windowMs).toBe(FPS_WINDOW_MS);
    expect(s!.fps).toBeGreaterThan(58);
    expect(s!.fps).toBeLessThan(60.1);
    expect(s!.maxGapMs).toBeGreaterThan(100);
    expect(s!.maxGapMs).toBeLessThan(120);
  });

  it('is null until the window has closed', () => {
    expect(fpsStats([], 0)).toBeNull();
    expect(fpsStats([0, 16, 32, 9_000], 0)).toBeNull();
    expect(fpsStats([0, 500, 10_000], 0)).toEqual({
      fps: 0.2,
      frames: 2,
      maxGapMs: 500,
      windowMs: 10_000,
    });
  });
});

/** Boot frame 17 (paused), then `passes` loops over 3..17 at 100 ms. */
function loopEvents(passes: number): IndexEvent[] {
  const ev: IndexEvent[] = [
    { t: 0, index: 0, playing: false },
    { t: 10, index: 17, playing: false },
  ];
  let t = 1000;
  for (let p = 0; p < passes; p += 1) {
    for (let i = 3; i <= 17; i += 1) {
      ev.push({ t, index: i, playing: true });
      t += 100;
    }
  }
  return ev;
}

describe('loopPassStarts', () => {
  it('starts pass 1 at the first playing frame and a pass at every wrap', () => {
    expect(loopPassStarts(loopEvents(3))).toEqual([1000, 2500, 4000]);
  });

  it('ignores paused index changes (boot frame, a scrub while paused)', () => {
    const ev = loopEvents(2);
    ev.push({ t: 9000, index: 2, playing: false });
    ev.push({ t: 9100, index: 3, playing: true });
    expect(loopPassStarts(ev)).toEqual([1000, 2500]);
  });

  it('counts a loop that starts from a lower index without a step back', () => {
    const ev: IndexEvent[] = [
      { t: 0, index: 1, playing: false },
      { t: 100, index: 3, playing: true },
      { t: 200, index: 4, playing: true },
      { t: 300, index: 3, playing: true },
    ];
    expect(loopPassStarts(ev)).toEqual([100, 300]);
  });
});

describe('secondLoopStats', () => {
  const url = (i: number, tile: number) => `${GIBS}T${i}/L7/4/6/${tile}.jpg`;

  it('is null until the third pass has started', () => {
    expect(secondLoopStats(loopEvents(2), [])).toBeNull();
  });

  it('counts requests and never-seen URLs between pass 2 and pass 3', () => {
    const ev = loopEvents(3);
    const req: TileRequest[] = [];
    // Pass 1 (1000–2499): every frame's 2 tiles, fetched once.
    for (let i = 3; i <= 17; i += 1) {
      const t = 1000 + (i - 3) * 100;
      req.push({ t, url: url(i, 0) }, { t: t + 1, url: url(i, 1) });
    }
    // Pass 2 (2500–3999): MapLibre re-fetches both tiles of each frame
    // (no HTTP cache under interception) and one frame brings a new tile.
    for (let i = 3; i <= 17; i += 1) {
      const t = 2500 + (i - 3) * 100;
      req.push({ t, url: url(i, 0) }, { t: t + 1, url: url(i, 1) });
    }
    req.push({ t: 3000, url: url(8, 2) });
    // Pass 3 is outside the window.
    req.push({ t: 4000, url: url(3, 9) });
    const s = secondLoopStats(ev, req);
    expect(s).toEqual({
      frames: 15,
      requests: 31,
      newTiles: 1,
      requestsPerFrame: 2.07,
      newTilesPerFrame: 0.07,
      msPerFrame: 100,
    });
  });

  it('sorts requests by time before deciding what is new', () => {
    const ev = loopEvents(3);
    const req: TileRequest[] = [
      { t: 3000, url: url(5, 0) },
      { t: 1200, url: url(5, 0) },
    ];
    expect(secondLoopStats(ev, req)?.newTiles).toBe(0);
  });
});

describe('buildUxMetrics', () => {
  it('rounds the mark and nulls what was not measured', () => {
    const m = buildUxMetrics({ firstSatelliteFrameMs: 812.6 });
    expect(m.schema).toBe(1);
    expect(m.tilesMocked).toBe(true);
    expect(m.firstSatelliteFrameMs).toBe(813);
    expect(m.loopFps).toBeNull();
    expect(m.controls).toEqual({ desktop: null, mobile: null });
    expect(m.secondLoop).toBeNull();
    expect(m.extra.fpsWindowMs).toBe(FPS_WINDOW_MS);
    expect(
      buildUxMetrics({ firstSatelliteFrameMs: NaN }).firstSatelliteFrameMs
    ).toBeNull();
  });
});

describe('mergeUxMetrics', () => {
  it('fills the numbers one test measured into what the other wrote', () => {
    const desktop = buildUxMetrics({
      firstSatelliteFrameMs: 700,
      fps: { fps: 60, frames: 600, maxGapMs: 20, windowMs: 10_000 },
      controls: { desktop: 8 },
      longTasks: { count: 1, totalMs: 60 },
    });
    const mobile = buildUxMetrics({ controls: { mobile: 5 } });
    const merged = mergeUxMetrics(desktop, mobile);
    expect(merged.firstSatelliteFrameMs).toBe(700);
    expect(merged.loopFps).toBe(60);
    expect(merged.controls).toEqual({ desktop: 8, mobile: 5 });
    expect(merged.extra.longTasks).toBe(1);
    expect(mergeUxMetrics(null, mobile)).toBe(mobile);
    // Order does not matter for the numbers.
    expect(mergeUxMetrics(mobile, desktop).controls).toEqual({
      desktop: 8,
      mobile: 5,
    });
  });
});

describe('uxWarnings', () => {
  it('is empty when every number meets its soft target', () => {
    expect(uxWarnings(metrics())).toEqual([]);
  });

  it('warns per number over / under target and per missing number', () => {
    const m = metrics();
    m.firstSatelliteFrameMs = 2500;
    m.loopFps = 24;
    m.controls.mobile = 7;
    m.secondLoop = null;
    const w = uxWarnings(m);
    expect(w).toHaveLength(4);
    expect(w[0]).toContain('2500 ms is above the target ≤ 2000 ms');
    expect(w[1]).toContain('24 is below the target ≥ 30');
    expect(w[2]).toContain('visible controls (mobile) 7');
    expect(w[3]).toContain(
      'new tiles per frame on the 2nd loop was not measured'
    );
  });

  it('warns once when the file is missing', () => {
    expect(uxWarnings(null)).toHaveLength(1);
  });
});

describe('formatDelta', () => {
  it('signs the change and says whether it is better', () => {
    expect(formatDelta(800, 900, { unit: ' ms' })).toBe('−100 ms (better)');
    expect(formatDelta(950, 900, { unit: ' ms' })).toBe('+50 ms (worse)');
    expect(formatDelta(58, 60, { better: 'higher' })).toBe('−2 (worse)');
    expect(formatDelta(0.33, 0.33)).toBe('=');
    expect(formatDelta(null, 3)).toBe('—');
    expect(formatDelta(3, undefined)).toBe('—');
  });
});

describe('renderUxComment / parseUxComment', () => {
  it('carries the marker, the four numbers and round-trips the data', () => {
    const m = metrics();
    const body = renderUxComment(m, {
      sha: 'abcdef1234567',
      runUrl: 'https://github.com/o/r/actions/runs/1',
    });
    expect(body.startsWith(UX_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('| Time to first satellite frame | 812 ms |');
    expect(body).toContain('| Loop fps (first 10 s) | 59.8 |');
    expect(body).toContain('| Visible controls (desktop / mobile) | 8 / 5 |');
    expect(body).toContain(
      '| New tiles per frame, 2nd loop | 0 (31 requests/frame'
    );
    expect(body).toContain('Commit `abcdef1`');
    expect(body).toContain('[Run](https://github.com/o/r/actions/runs/1)');
    expect(parseUxComment(body)).toEqual(m);
  });

  it('shows the change since the previous run', () => {
    const prev = metrics();
    const cur = metrics();
    cur.firstSatelliteFrameMs = 900;
    cur.controls.desktop = 9;
    const body = renderUxComment(cur, { previous: prev });
    expect(body).toContain('+88 ms (worse)');
    expect(body).toContain('+1 (worse) / =');
    expect(body).toMatch(/\| 9 \/ 5 \|.*\*\*warn\*\* \/ ok \|/);
  });

  it('keeps the previous numbers when this run produced none', () => {
    const prev = metrics();
    const body = renderUxComment(null, { previous: prev });
    expect(body).toContain('did not produce `ux-metrics.json`');
    expect(parseUxComment(body)).toEqual(prev);
  });

  it('cannot be closed early by a string in the data', () => {
    const m = metrics();
    m.commit = 'evil --> <b>';
    const body = renderUxComment(m);
    expect(body.match(/-->/g)).toHaveLength(2); // marker + data comment
    expect(parseUxComment(body)?.commit).toBe('evil --> <b>');
  });

  it('parses nothing from unrelated or broken bodies', () => {
    expect(parseUxComment('hello')).toBeNull();
    expect(parseUxComment(undefined)).toBeNull();
    expect(parseUxComment('<!-- ux-metrics-data:{nope -->')).toBeNull();
  });
});
