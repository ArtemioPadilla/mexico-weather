/**
 * Pure helpers for the UX metrics of plan PARIDAD_VISUAL §5 (Story 26.2).
 *
 * Shared by e2e/ux-metrics.spec.ts (which measures /mapa and writes
 * test-results/ux-metrics.json) and the `ux-metrics` workflow (whose
 * actions/github-script step imports this file to raise the threshold
 * warnings and render the one PR comment it keeps up to date). Side-effect
 * free so it is unit-tested with vitest (src/lib/ux-metrics-lib.test.ts).
 *
 * The four numbers:
 *  1. time to first satellite frame — the `mw:first-satellite-frame` User
 *     Timing mark (src/lib/map/chrome/first-frame-mark.ts), ms from
 *     navigation start;
 *  2. loop fps — requestAnimationFrame callbacks per second over the first
 *     10 s of the boot loop (plus, as context, the long tasks a
 *     PerformanceObserver sampled in that window and the loop's step
 *     cadence — Story 23.2);
 *  3. visible controls over the map, desktop / mobile (chrome-budget
 *     helper, e2e/chrome-budget-helpers.ts);
 *  4. new satellite tiles per frame on the loop's second pass (URLs never
 *     requested before), next to the raw tile requests per frame.
 *
 * Plus, as context (Story 24.1): the main-thread time per field frame on
 * the temperature layer — the `mw:field-frame` User Timing measures the
 * app records for each frame it draws, WebGL or canvas.
 */

export const UX_METRICS_SCHEMA = 1;
export const UX_METRICS_FILE = 'ux-metrics.json';

/** HTML comment that identifies the one PR comment the workflow edits. */
export const UX_COMMENT_MARKER = '<!-- ux-metrics:story-26.2 -->';
const DATA_PREFIX = '<!-- ux-metrics-data:';
const DATA_SUFFIX = ' -->';

/** Length of the fps window, from the first frame the loop plays. */
export const FPS_WINDOW_MS = 10_000;

/**
 * Soft targets from plan §5 (warnings only until E21–E23 close). `max`
 * means "warn above", `min` "warn below".
 */
export const UX_THRESHOLDS = {
  firstSatelliteFrameMs: { max: 2000 },
  loopFps: { min: 30 },
  controlsDesktop: { max: 8 },
  controlsMobile: { max: 5 },
  newTilesPerFrame: { max: 1 },
  /** Story 24.1 — plan §E24 acceptance: < 4 ms per field frame on
   *  desktop. Context only: warned when measured and over, never when
   *  missing (it is not one of the four numbers). */
  fieldFrameMs: { max: 4 },
};

/**
 * Median and longest of the per-frame field render times (Story 24.1),
 * with the renderer the app reported. Null without samples.
 *
 * @param {{ duration: number, renderer?: string | null }[]} samples
 */
export function fieldFrameStats(samples) {
  const ok = (samples ?? []).filter(
    (s) => typeof s?.duration === 'number' && Number.isFinite(s.duration)
  );
  if (!ok.length) return null;
  const d = ok.map((s) => s.duration).sort((a, b) => a - b);
  const mid = d.length >> 1;
  const median = d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
  const kinds = new Set(ok.map((s) => s.renderer ?? 'unknown'));
  return {
    frames: d.length,
    medianMs: round(median, 2),
    maxMs: round(d[d.length - 1], 2),
    renderer: kinds.size === 1 ? [...kinds][0] : [...kinds].sort().join('+'),
  };
}

/** A GIBS WMTS tile (the satellite raster, its prefetch and the boot
 *  probe) — the requests that change with every frame of the loop. */
export function isSatelliteTileRequest(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'gibs.earthdata.nasa.gov' &&
      u.pathname.startsWith('/wmts/')
    );
  } catch {
    return false;
  }
}

const round = (n, digits) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * rAF callbacks per second over `[startMs, startMs + windowMs)`, plus the
 * longest gap between two callbacks (a dropped-frame / jank proxy). Null
 * while the window is not complete (no timestamp at or past its end).
 *
 * @param {number[]} timestamps rAF timestamps (ms, ascending)
 */
export function fpsStats(timestamps, startMs, windowMs = FPS_WINDOW_MS) {
  const end = startMs + windowMs;
  if (!timestamps.length || timestamps[timestamps.length - 1] < end)
    return null;
  let frames = 0;
  let maxGapMs = 0;
  let prev = null;
  for (const t of timestamps) {
    if (t < startMs) continue;
    if (t >= end) break;
    frames += 1;
    if (prev !== null) maxGapMs = Math.max(maxGapMs, t - prev);
    prev = t;
  }
  return {
    fps: round(frames / (windowMs / 1000), 1),
    frames,
    maxGapMs: round(maxGapMs, 1),
    windowMs,
  };
}

/** How many of the longest long tasks the loop sample keeps. */
export const LONG_TASK_SAMPLE_SIZE = 5;

/**
 * Story 23.2 — the long tasks a PerformanceObserver sampled during the
 * loop (the spec observes from the loop's first frame for the fps window):
 * how many, their total and the longest, plus the N longest with their
 * start relative to the loop start and the entry's `name` (`self`,
 * `same-origin-descendant`, `unknown`…), to see what blocks the frames.
 *
 * @param {{ start: number, duration: number, name?: string }[]} entries
 * @param {number} startMs loop start (same clock as `entries[].start`)
 */
export function longTaskSample(
  entries,
  startMs,
  windowMs = FPS_WINDOW_MS,
  size = LONG_TASK_SAMPLE_SIZE
) {
  const inWindow = entries.filter(
    (e) => e.start >= startMs && e.start < startMs + windowMs
  );
  const total = inWindow.reduce((s, e) => s + e.duration, 0);
  const longest = [...inWindow]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, size)
    .map((e) => ({
      atMs: Math.round(e.start - startMs),
      durationMs: Math.round(e.duration),
      name: e.name ?? null,
    }));
  return {
    count: inWindow.length,
    totalMs: Math.round(total),
    maxMs: longest.length ? longest[0].durationMs : 0,
    longest,
  };
}

/**
 * Story 23.2 — the loop's cadence: time between consecutive frame steps
 * while ▶ plays inside `[startT, startT + windowMs)` (median and longest).
 * With a steady cadence the median is the "velocidad" setting and the
 * longest shows the steps that waited (gate, long task, stall). Null with
 * fewer than two steps in the window.
 *
 * @param {{ t: number, index: number, playing: boolean }[]} events
 */
export function loopStepStats(events, startT, windowMs = FPS_WINDOW_MS) {
  const ts = events
    .filter((e) => e.playing && e.t >= startT && e.t < startT + windowMs)
    .map((e) => e.t)
    .sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    steps: gaps.length,
    medianMs: Math.round(median),
    maxMs: Math.round(sorted[sorted.length - 1]),
  };
}

/**
 * Start times of the loop passes. `events` are the timeline index changes
 * (`#tl-range` value) with whether ▶ was playing. Events before the loop
 * plays (the boot frame) are ignored; the first playing event starts pass
 * 1, and every later step back to a lower index (the wrap from the newest
 * frame to the loop's first) starts the next pass.
 *
 * @param {{ t: number, index: number, playing: boolean }[]} events
 * @returns {number[]} the `t` of each pass start, ascending
 */
export function loopPassStarts(events) {
  const starts = [];
  let prev = null;
  for (const e of events) {
    if (!e.playing) {
      prev = null;
      continue;
    }
    if (prev === null) {
      if (!starts.length) starts.push(e.t);
    } else if (e.index < prev) {
      starts.push(e.t);
    }
    prev = e.index;
  }
  return starts;
}

/**
 * Tile traffic of the loop's second pass: frames shown between the start
 * of pass 2 and the start of pass 3, satellite tile requests in that
 * window, and how many of them hit a URL never requested before (the plan
 * §5 metric — the prefetch of Story 21.3 should leave none). Null until
 * pass 3 has started.
 *
 * @param {{ t: number, index: number, playing: boolean }[]} events
 * @param {{ t: number, url: string }[]} requests satellite tile requests
 */
export function secondLoopStats(events, requests) {
  const starts = loopPassStarts(events);
  if (starts.length < 3) return null;
  const [, from, to] = starts;
  const frames = events.filter(
    (e) => e.playing && e.t >= from && e.t < to
  ).length;
  if (frames === 0) return null;
  const seen = new Set();
  let inWindow = 0;
  let fresh = 0;
  for (const r of [...requests].sort((a, b) => a.t - b.t)) {
    if (r.t >= to) break;
    const isNew = !seen.has(r.url);
    seen.add(r.url);
    if (r.t < from) continue;
    inWindow += 1;
    if (isNew) fresh += 1;
  }
  return {
    frames,
    requests: inWindow,
    newTiles: fresh,
    requestsPerFrame: round(inWindow / frames, 2),
    newTilesPerFrame: round(fresh / frames, 2),
    msPerFrame: Math.round((to - from) / frames),
  };
}

/**
 * The ux-metrics.json document: the four numbers plus context. Every
 * number is null when its measurement did not complete (the spec writes
 * what it has even when a later step fails).
 */
export function buildUxMetrics(parts = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    schema: UX_METRICS_SCHEMA,
    generatedAt: parts.generatedAt ?? null,
    commit: parts.commit ?? null,
    tilesMocked: true,
    firstSatelliteFrameMs:
      num(parts.firstSatelliteFrameMs) === null
        ? null
        : Math.round(parts.firstSatelliteFrameMs),
    loopFps: num(parts.fps?.fps),
    controls: {
      desktop: num(parts.controls?.desktop),
      mobile: num(parts.controls?.mobile),
    },
    secondLoop: parts.secondLoop ?? null,
    extra: {
      fpsWindowMs: num(parts.fps?.windowMs) ?? FPS_WINDOW_MS,
      maxFrameGapMs: num(parts.fps?.maxGapMs),
      longTasks: num(parts.longTasks?.count),
      longTaskMs: num(parts.longTasks?.totalMs),
      longTaskMaxMs: num(parts.longTasks?.maxMs),
      longTaskSample: Array.isArray(parts.longTasks?.longest)
        ? parts.longTasks.longest
        : null,
      loopStepMedianMs: num(parts.steps?.medianMs),
      loopStepMaxMs: num(parts.steps?.maxMs),
      fieldFrameMedianMs: num(parts.fieldFrame?.medianMs),
      fieldFrameMaxMs: num(parts.fieldFrame?.maxMs),
      fieldFrames: num(parts.fieldFrame?.frames),
      fieldRenderer: parts.fieldFrame?.renderer ?? null,
    },
  };
}

/**
 * Merge two partial ux-metrics.json documents (the desktop and the mobile
 * test each write what they measured): a number in `next` wins, a null in
 * `next` keeps the one already in `base`.
 */
export function mergeUxMetrics(base, next) {
  if (!base) return next;
  const pick = (a, b) => (b === null || b === undefined ? (a ?? null) : b);
  return {
    ...next,
    firstSatelliteFrameMs: pick(
      base.firstSatelliteFrameMs,
      next.firstSatelliteFrameMs
    ),
    loopFps: pick(base.loopFps, next.loopFps),
    controls: {
      desktop: pick(base.controls?.desktop, next.controls?.desktop),
      mobile: pick(base.controls?.mobile, next.controls?.mobile),
    },
    secondLoop: pick(base.secondLoop, next.secondLoop),
    extra: {
      fpsWindowMs: next.extra?.fpsWindowMs ?? base.extra?.fpsWindowMs,
      maxFrameGapMs: pick(base.extra?.maxFrameGapMs, next.extra?.maxFrameGapMs),
      longTasks: pick(base.extra?.longTasks, next.extra?.longTasks),
      longTaskMs: pick(base.extra?.longTaskMs, next.extra?.longTaskMs),
      longTaskMaxMs: pick(base.extra?.longTaskMaxMs, next.extra?.longTaskMaxMs),
      longTaskSample: pick(
        base.extra?.longTaskSample,
        next.extra?.longTaskSample
      ),
      loopStepMedianMs: pick(
        base.extra?.loopStepMedianMs,
        next.extra?.loopStepMedianMs
      ),
      loopStepMaxMs: pick(base.extra?.loopStepMaxMs, next.extra?.loopStepMaxMs),
      fieldFrameMedianMs: pick(
        base.extra?.fieldFrameMedianMs,
        next.extra?.fieldFrameMedianMs
      ),
      fieldFrameMaxMs: pick(
        base.extra?.fieldFrameMaxMs,
        next.extra?.fieldFrameMaxMs
      ),
      fieldFrames: pick(base.extra?.fieldFrames, next.extra?.fieldFrames),
      fieldRenderer: pick(base.extra?.fieldRenderer, next.extra?.fieldRenderer),
    },
  };
}

/** Threshold warnings for `metrics` (a missing number is a warning too:
 *  the measurement broke). */
export function uxWarnings(metrics) {
  if (!metrics) return ['UX metrics: no ux-metrics.json (spec failed?)'];
  const out = [];
  const check = (value, label, threshold, unit = '') => {
    if (value === null || value === undefined) {
      out.push(`UX metrics: ${label} was not measured`);
      return;
    }
    if (threshold.max !== undefined && value > threshold.max)
      out.push(
        `UX metrics: ${label} ${value}${unit} is above the target ≤ ${threshold.max}${unit}`
      );
    if (threshold.min !== undefined && value < threshold.min)
      out.push(
        `UX metrics: ${label} ${value}${unit} is below the target ≥ ${threshold.min}${unit}`
      );
  };
  check(
    metrics.firstSatelliteFrameMs,
    'time to first satellite frame',
    UX_THRESHOLDS.firstSatelliteFrameMs,
    ' ms'
  );
  check(metrics.loopFps, 'loop fps', UX_THRESHOLDS.loopFps);
  check(
    metrics.controls?.desktop,
    'visible controls (desktop)',
    UX_THRESHOLDS.controlsDesktop
  );
  check(
    metrics.controls?.mobile,
    'visible controls (mobile)',
    UX_THRESHOLDS.controlsMobile
  );
  check(
    metrics.secondLoop?.newTilesPerFrame,
    'new tiles per frame on the 2nd loop',
    UX_THRESHOLDS.newTilesPerFrame
  );
  // Story 24.1 — context number: only warn when it was measured.
  const field = metrics.extra?.fieldFrameMedianMs;
  if (field !== null && field !== undefined)
    check(
      field,
      'field frame render time (median)',
      UX_THRESHOLDS.fieldFrameMs,
      ' ms'
    );
  return out;
}

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = (n, unit = '') =>
  n === null || n === undefined ? 'n/a' : `${NUM.format(n)}${unit}`;

/**
 * Signed change from `prev` to `cur` ("+120 ms", "−0.5", "="), or "—" when
 * either side is missing. `better` ('lower' | 'higher') adds "(better)" /
 * "(worse)" so a regression reads as one.
 */
export function formatDelta(cur, prev, { unit = '', better = 'lower' } = {}) {
  if (cur === null || cur === undefined || prev === null || prev === undefined)
    return '—';
  const d = round(cur - prev, 2);
  if (d === 0) return '=';
  const sign = d > 0 ? '+' : '−';
  const improved = better === 'lower' ? d < 0 : d > 0;
  return `${sign}${NUM.format(Math.abs(d))}${unit} (${improved ? 'better' : 'worse'})`;
}

const status = (value, threshold) => {
  if (value === null || value === undefined) return '**not measured**';
  if (threshold.max !== undefined && value > threshold.max) return '**warn**';
  if (threshold.min !== undefined && value < threshold.min) return '**warn**';
  return 'ok';
};

/** Metrics embedded in a comment body by {@link renderUxComment}, or null. */
export function parseUxComment(body) {
  if (typeof body !== 'string') return null;
  const at = body.indexOf(DATA_PREFIX);
  if (at < 0) return null;
  const end = body.indexOf(DATA_SUFFIX, at + DATA_PREFIX.length);
  if (end < 0) return null;
  try {
    const data = JSON.parse(body.slice(at + DATA_PREFIX.length, end));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Markdown of the one PR comment: the four numbers, the change since the
 * previous run (numbers carried in the previous comment), the soft
 * targets and the raw JSON for the next run to diff against.
 *
 * @param {object|null} metrics contents of ux-metrics.json (null: missing)
 * @param {{ previous?: object|null, sha?: string, runUrl?: string }} [ctx]
 */
export function renderUxComment(metrics, ctx = {}) {
  const { previous = null, sha = '', runUrl = '' } = ctx;
  const lines = [UX_COMMENT_MARKER, '## UX metrics · /mapa (Story 26.2)', ''];
  if (!metrics) {
    lines.push(
      'The UX metrics spec did not produce `ux-metrics.json` on this run' +
        (runUrl ? ` ([logs](${runUrl}))` : '') +
        '. The previous numbers, if any, are kept below.'
    );
    if (previous) lines.push('', embed(previous));
    return lines.join('\n') + '\n';
  }
  const m = metrics;
  const p = previous;
  const T = UX_THRESHOLDS;
  const controls = `${fmt(m.controls?.desktop)} / ${fmt(m.controls?.mobile)}`;
  const controlsDelta = p
    ? `${formatDelta(m.controls?.desktop, p.controls?.desktop)} / ${formatDelta(m.controls?.mobile, p.controls?.mobile)}`
    : '—';
  const controlsStatus = [
    status(m.controls?.desktop, T.controlsDesktop),
    status(m.controls?.mobile, T.controlsMobile),
  ];
  const loop = m.secondLoop;
  const loopDetail = loop
    ? ` (${fmt(loop.requestsPerFrame)} requests/frame, ${loop.frames} frames, ${fmt(loop.msPerFrame, ' ms')}/frame)`
    : '';
  lines.push(
    '| Metric | This run | Δ vs previous run | Target (soft) | Status |',
    '|---|---|---|---|---|',
    `| Time to first satellite frame | ${fmt(m.firstSatelliteFrameMs, ' ms')} | ${p ? formatDelta(m.firstSatelliteFrameMs, p.firstSatelliteFrameMs, { unit: ' ms' }) : '—'} | ≤ ${T.firstSatelliteFrameMs.max} ms | ${status(m.firstSatelliteFrameMs, T.firstSatelliteFrameMs)} |`,
    `| Loop fps (first ${fmt((m.extra?.fpsWindowMs ?? FPS_WINDOW_MS) / 1000)} s) | ${fmt(m.loopFps)} | ${p ? formatDelta(m.loopFps, p.loopFps, { better: 'higher' }) : '—'} | ≥ ${T.loopFps.min} | ${status(m.loopFps, T.loopFps)} |`,
    `| Visible controls (desktop / mobile) | ${controls} | ${controlsDelta} | ≤ ${T.controlsDesktop.max} / ≤ ${T.controlsMobile.max} | ${controlsStatus[0] === controlsStatus[1] ? controlsStatus[0] : controlsStatus.join(' / ')} |`,
    `| New tiles per frame, 2nd loop | ${fmt(loop?.newTilesPerFrame)}${loopDetail} | ${p ? formatDelta(loop?.newTilesPerFrame, p.secondLoop?.newTilesPerFrame) : '—'} | ≤ ${T.newTilesPerFrame.max} | ${status(loop?.newTilesPerFrame, T.newTilesPerFrame)} |`,
    ''
  );
  const extra = [];
  if (m.extra?.maxFrameGapMs !== undefined && m.extra?.maxFrameGapMs !== null)
    extra.push(`longest rAF gap ${fmt(m.extra.maxFrameGapMs, ' ms')}`);
  if (m.extra?.longTasks !== undefined && m.extra?.longTasks !== null)
    extra.push(
      `${m.extra.longTasks} long tasks (${fmt(m.extra.longTaskMs, ' ms')}` +
        (m.extra.longTaskMaxMs !== undefined && m.extra.longTaskMaxMs !== null
          ? `, longest ${fmt(m.extra.longTaskMaxMs, ' ms')}`
          : '') +
        ') during the fps window'
    );
  if (
    m.extra?.loopStepMedianMs !== undefined &&
    m.extra?.loopStepMedianMs !== null
  )
    extra.push(
      `loop step every ${fmt(m.extra.loopStepMedianMs, ' ms')} (median; longest ${fmt(m.extra.loopStepMaxMs, ' ms')})`
    );
  if (
    m.extra?.fieldFrameMedianMs !== undefined &&
    m.extra?.fieldFrameMedianMs !== null
  )
    extra.push(
      `field frame ${fmt(m.extra.fieldFrameMedianMs, ' ms')} (median of ${fmt(m.extra.fieldFrames)}, ` +
        `longest ${fmt(m.extra.fieldFrameMaxMs, ' ms')}, ${m.extra.fieldRenderer ?? '?'}; ` +
        `target < ${T.fieldFrameMs.max} ms) on temperature` +
        (p?.extra?.fieldFrameMedianMs !== undefined &&
        p?.extra?.fieldFrameMedianMs !== null
          ? ` [${formatDelta(m.extra.fieldFrameMedianMs, p.extra.fieldFrameMedianMs, { unit: ' ms' })}]`
          : '')
    );
  if (extra.length) lines.push(`Also measured: ${extra.join(' · ')}.`, '');
  lines.push(
    '<sub>Headless Chromium on the CI runner, desktop 1280×800 (controls also at 360×640), ' +
      'Esri/GIBS tiles served as a 256×256 transparent PNG so the numbers are deterministic. ' +
      "Playwright's request interception bypasses the HTTP cache, so requests/frame counts " +
      'MapLibre re-fetching URLs it already had; "new tiles" is the plan §5 metric. ' +
      'Targets are warnings only for now (hard once E21–E23 close).' +
      (sha ? ` Commit \`${sha.slice(0, 7)}\`.` : '') +
      (runUrl ? ` [Run](${runUrl}).` : '') +
      '</sub>',
    '',
    embed(m)
  );
  return lines.join('\n') + '\n';
}

function embed(metrics) {
  // `>` only appears inside JSON strings, where > is equivalent: the
  // HTML comment can never be closed early.
  return `${DATA_PREFIX}${JSON.stringify(metrics).replace(/>/g, '\\u003e')}${DATA_SUFFIX}`;
}
