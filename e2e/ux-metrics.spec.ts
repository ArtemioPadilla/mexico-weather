import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FPS_WINDOW_MS,
  UX_METRICS_FILE,
  buildUxMetrics,
  fpsStats,
  isSatelliteTileRequest,
  mergeUxMetrics,
  secondLoopStats,
  uxWarnings,
} from '../scripts/ux-metrics-lib.mjs';
import type {
  IndexEvent,
  TileRequest,
  UxMetrics,
  UxMetricsParts,
} from '../scripts/ux-metrics-lib.mjs';
import { CHROME_BUDGET } from '../src/lib/map/chrome/chrome-budget';
import { FIRST_SATELLITE_FRAME_MARK } from '../src/lib/map/chrome/first-frame-mark';
import { bootMap, measureStable } from './chrome-budget-helpers';

/**
 * Story 26.2 — the UX numbers of plan PARIDAD_VISUAL §5, measured on every
 * PR by the `ux-metrics` workflow (which posts them as one PR comment).
 *
 * Same cold /mapa boot as the chrome budget (e2e/chrome-budget-helpers.ts):
 * welcome card dismissed, Esri/GIBS/RainViewer tiles served as the 256×256
 * transparent PNG, quiet SMN feed, no storms — so the numbers depend on the
 * app and the runner, never on the network or the week's weather.
 *
 *  1. time to first satellite frame: the `mw:first-satellite-frame` User
 *     Timing mark the app sets when the first GeoColor frame's tiles are
 *     all loaded (src/lib/map/chrome/first-frame-mark.ts);
 *  2. loop fps: requestAnimationFrame callbacks per second over the first
 *     10 s of the boot loop (plus the longest gap and the long tasks);
 *  3. visible controls over the map, desktop 1280×800 and phone 360×640
 *     (the chrome-budget count; chrome-budget.spec asserts its baseline);
 *  4. tile requests per frame on the loop's second pass, and how many hit
 *     a URL never requested before (Story 21.3's prefetch should leave
 *     none). Request interception disables Chromium's HTTP cache, so the
 *     raw count includes MapLibre re-fetching URLs it already had.
 *
 * Writes test-results/ux-metrics.json (each test merges what it measured)
 * and attaches it. Thresholds are soft: printed as warnings, never failed
 * here — the workflow turns them into `core.warning`. The spec fails only
 * when a number cannot be measured at all (the mark is gone, the loop
 * never wraps).
 *
 * Tagged @ux-metrics: the main E2E job skips it, the ux-metrics job runs
 * only it.
 */

interface Recorder {
  origin: number;
  raf: number[];
  index: IndexEvent[];
  longTasks: { start: number; duration: number }[];
}

declare global {
  interface Window {
    __uxm?: Recorder;
  }
}

/** In-page recorder, installed before any app script: every rAF
 *  timestamp, every change of the timeline index (with ▶'s state, in epoch
 *  ms to line up with the request log) and the long tasks. */
async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const rec: Recorder = {
      origin: performance.timeOrigin,
      raf: [],
      index: [],
      longTasks: [],
    };
    window.__uxm = rec;
    let last: number | null = null;
    const tick = (ts: number): void => {
      rec.raf.push(ts);
      const range = document.getElementById(
        'tl-range'
      ) as HTMLInputElement | null;
      if (range) {
        const i = Number(range.value);
        if (i !== last) {
          last = i;
          rec.index.push({
            t: performance.timeOrigin + performance.now(),
            index: i,
            playing:
              document.getElementById('tl-play')?.dataset.state === 'playing',
          });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          rec.longTasks.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* no Long Tasks API: the extra stays null */
    }
  });
}

async function readRecorder(page: Page): Promise<Recorder> {
  return page.evaluate(() => {
    const r = window.__uxm;
    if (!r) throw new Error('ux-metrics recorder missing');
    return {
      origin: r.origin,
      raf: r.raf.slice(),
      index: r.index.slice(),
      longTasks: r.longTasks.slice(),
    };
  });
}

function metricsPath(testInfo: TestInfo): string {
  return join(testInfo.project.outputDir, UX_METRICS_FILE);
}

/** Merge this test's numbers into test-results/ux-metrics.json. */
async function recordMetrics(
  testInfo: TestInfo,
  parts: UxMetricsParts
): Promise<UxMetrics> {
  const file = metricsPath(testInfo);
  let existing: UxMetrics | null = null;
  try {
    existing = JSON.parse(readFileSync(file, 'utf8')) as UxMetrics;
  } catch {
    existing = null;
  }
  const merged = mergeUxMetrics(
    existing,
    buildUxMetrics({
      generatedAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA ?? null,
      ...parts,
    })
  );
  mkdirSync(testInfo.project.outputDir, { recursive: true });
  writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  await testInfo.attach(UX_METRICS_FILE, {
    body: JSON.stringify(merged, null, 2),
    contentType: 'application/json',
  });
  for (const w of uxWarnings(merged)) {
    // Only the numbers this test owns; the other test reports its own.
    if (parts.controls?.mobile === undefined && /mobile/.test(w)) continue;
    if (parts.controls?.mobile !== undefined && !/mobile/.test(w)) continue;
    console.warn(`[ux-metrics] ${w}`);
  }
  return merged;
}

test.describe('ux metrics · desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('@ux-metrics /mapa desktop: first satellite frame, loop fps, controls, tiles per frame on the 2nd loop', async ({
    page,
  }, testInfo) => {
    // Boot (≤ 20 s) + two full loop passes (15 frames at ~0.7–0.9 s) +
    // the fps window, with margin for a slow runner.
    test.setTimeout(150_000);
    const requests: TileRequest[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (isSatelliteTileRequest(url)) requests.push({ t: Date.now(), url });
    });
    await installRecorder(page);
    const parts: UxMetricsParts = { controls: {} };
    try {
      await bootMap(page);

      // 1 — the app's mark (ms since navigation start).
      const mark = await page.evaluate(
        (name) =>
          performance.getEntriesByName(name, 'mark')[0]?.startTime ?? null,
        FIRST_SATELLITE_FRAME_MARK
      );
      parts.firstSatelliteFrameMs = mark;
      expect
        .soft(mark, `performance mark ${FIRST_SATELLITE_FRAME_MARK} missing`)
        .not.toBeNull();

      // 3 — the chrome-budget count, right after the boot.
      const over = await measureStable(
        page,
        {
          name: 'desktop',
          viewport: { width: 1280, height: 800 },
          budget: CHROME_BUDGET.desktop,
        },
        testInfo
      );
      parts.controls = { desktop: over.length };

      // 2 + 4 — let the loop run until pass 3 starts and the fps window
      // (the first 10 s from the loop's first frame) has closed.
      let rec = await readRecorder(page);
      await expect
        .poll(
          async () => {
            rec = await readRecorder(page);
            const loopStart = rec.index.find((e) => e.playing)?.t;
            if (loopStart === undefined) return 'loop not started';
            if (!fpsStats(rec.raf, loopStart - rec.origin))
              return 'fps window open';
            if (!secondLoopStats(rec.index, requests))
              return 'second pass not complete';
            return 'done';
          },
          {
            message: 'the boot loop did not complete two passes',
            timeout: 110_000,
            intervals: [1000],
          }
        )
        .toBe('done');

      const loopStart = rec.index.find((e) => e.playing)!.t - rec.origin;
      parts.fps = fpsStats(rec.raf, loopStart);
      parts.secondLoop = secondLoopStats(rec.index, requests);
      const inWindow = rec.longTasks.filter(
        (lt) => lt.start >= loopStart && lt.start < loopStart + FPS_WINDOW_MS
      );
      parts.longTasks = {
        count: inWindow.length,
        totalMs: Math.round(inWindow.reduce((s, lt) => s + lt.duration, 0)),
      };
    } finally {
      const m = await recordMetrics(testInfo, parts);
      console.log(
        `[ux-metrics] desktop: first satellite frame ${m.firstSatelliteFrameMs} ms · ` +
          `loop ${m.loopFps} fps · controls ${m.controls.desktop} · ` +
          `2nd loop ${m.secondLoop?.newTilesPerFrame ?? 'n/a'} new tiles/frame ` +
          `(${m.secondLoop?.requestsPerFrame ?? 'n/a'} requests/frame over ${m.secondLoop?.frames ?? 'n/a'} frames)`
      );
    }
  });
});

test.describe('ux metrics · mobile', () => {
  test.use({
    viewport: { width: 360, height: 640 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('@ux-metrics /mapa mobile: visible controls', async ({
    page,
  }, testInfo) => {
    let mobile: number | null = null;
    try {
      await bootMap(page);
      const over = await measureStable(
        page,
        {
          name: 'mobile',
          viewport: { width: 360, height: 640 },
          budget: CHROME_BUDGET.mobile,
        },
        testInfo
      );
      mobile = over.length;
    } finally {
      const m = await recordMetrics(testInfo, { controls: { mobile } });
      console.log(`[ux-metrics] mobile: controls ${m.controls.mobile}`);
    }
  });
});
