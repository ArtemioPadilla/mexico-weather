import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FPS_WINDOW_MS,
  UX_METRICS_FILE,
  buildUxMetrics,
  fieldFrameStats,
  fpsStats,
  isSatelliteTileRequest,
  longTaskSample,
  loopStepStats,
  mergeUxMetrics,
  secondLoopStats,
  uxWarnings,
} from '../scripts/ux-metrics-lib.mjs';
import type {
  IndexEvent,
  LongTaskEntry,
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
 *     10 s of the boot loop (plus the longest gap, the loop's step cadence
 *     and a sample of the long tasks a PerformanceObserver started with
 *     the loop sees in that window — Story 23.2);
 *  3. visible controls over the map, desktop 1280×800 and phone 360×640
 *     (the chrome-budget count; chrome-budget.spec asserts its baseline);
 *  4. tile requests per frame on the loop's second pass, and how many hit
 *     a URL never requested before (a second lap should add none).
 *     Request interception disables Chromium's HTTP cache, so the raw
 *     count includes MapLibre re-fetching URLs it already had. On the
 *     real network GIBS serves satellite tiles `no-store`, so each of
 *     those re-fetches is a download there too (which is why Story 21.3
 *     prefetches radar only) — this counts URLs, not bytes.
 *
 * Plus, as context (Story 24.1): the main-thread time per field frame on
 * the temperature layer — the `mw:field-frame` User Timing measures the
 * app records per frame (WebGL: packing + upload + draw call; canvas:
 * the bicubic raster + PNG encode), collected by a PerformanceObserver
 * while the timeline steps through 24 frames.
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
  /** Story 23.2 — long tasks seen by the loop-scoped observer. */
  longTasks: LongTaskEntry[];
  /** performance.now() when that observer started (null: not yet, or
   *  no Long Tasks API). */
  longTaskObserverAt: number | null;
}

declare global {
  interface Window {
    __uxm?: Recorder;
    __uxmField?: { duration: number; renderer: string | null }[];
  }
}

/** In-page recorder, installed before any app script: every rAF
 *  timestamp, every change of the timeline index (with ▶'s state, in epoch
 *  ms to line up with the request log) and — Story 23.2 — a sample of the
 *  long tasks during the loop: a PerformanceObserver started on the
 *  loop's first playing frame and disconnected once the fps window (plus
 *  a second for a task still running at its end) has passed. */
async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript((windowMs: number) => {
    const rec: Recorder = {
      origin: performance.timeOrigin,
      raf: [],
      index: [],
      longTasks: [],
      longTaskObserverAt: null,
    };
    window.__uxm = rec;
    let sampling = false;
    const sampleLongTasks = (): void => {
      if (sampling) return;
      sampling = true;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            rec.longTasks.push({
              start: e.startTime,
              duration: e.duration,
              name: e.name,
            });
        });
        obs.observe({ type: 'longtask' });
        rec.longTaskObserverAt = performance.now();
        setTimeout(() => obs.disconnect(), windowMs + 1000);
      } catch {
        /* no Long Tasks API: the long-task numbers stay null */
      }
    };
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
          const playing =
            document.getElementById('tl-play')?.dataset.state === 'playing';
          rec.index.push({
            t: performance.timeOrigin + performance.now(),
            index: i,
            playing,
          });
          if (playing) sampleLongTasks();
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, FPS_WINDOW_MS);
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
      longTaskObserverAt: r.longTaskObserverAt,
    };
  });
}

function metricsPath(testInfo: TestInfo): string {
  return join(testInfo.project.outputDir, UX_METRICS_FILE);
}

/** Merge this test's numbers into test-results/ux-metrics.json. */
async function recordMetrics(
  testInfo: TestInfo,
  parts: UxMetricsParts,
  /** The warnings about numbers this test measured (the others are the
   *  other tests' to print). */
  owns: (warning: string) => boolean
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
    // Only the numbers this test owns; the other tests report their own.
    if (owns(w)) console.warn(`[ux-metrics] ${w}`);
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
      // Story 23.2 — the loop-scoped long-task sample and the loop's step
      // cadence (median / longest time between frames) in that window.
      parts.steps = loopStepStats(rec.index, loopStart + rec.origin);
      parts.longTasks =
        rec.longTaskObserverAt === null
          ? null
          : longTaskSample(rec.longTasks, loopStart);
    } finally {
      const m = await recordMetrics(
        testInfo,
        parts,
        (w) => !/mobile|field frame/.test(w)
      );
      console.log(
        `[ux-metrics] desktop: first satellite frame ${m.firstSatelliteFrameMs} ms · ` +
          `loop ${m.loopFps} fps · controls ${m.controls.desktop} · ` +
          `2nd loop ${m.secondLoop?.newTilesPerFrame ?? 'n/a'} new tiles/frame ` +
          `(${m.secondLoop?.requestsPerFrame ?? 'n/a'} requests/frame over ${m.secondLoop?.frames ?? 'n/a'} frames)`
      );
      console.log(
        `[ux-metrics] desktop loop (first ${FPS_WINDOW_MS / 1000} s): ` +
          `longest rAF gap ${m.extra.maxFrameGapMs ?? 'n/a'} ms · ` +
          `step every ${m.extra.loopStepMedianMs ?? 'n/a'} ms (median; longest ${m.extra.loopStepMaxMs ?? 'n/a'} ms) · ` +
          `${m.extra.longTasks ?? 'n/a'} long tasks, ${m.extra.longTaskMs ?? 'n/a'} ms in all, ` +
          `longest ${m.extra.longTaskMaxMs ?? 'n/a'} ms`
      );
      if (m.extra.longTaskSample?.length)
        console.log(
          '[ux-metrics] longest long tasks during the loop: ' +
            m.extra.longTaskSample
              .map(
                (lt) =>
                  `${lt.durationMs} ms at +${lt.atMs} ms (${lt.name ?? '?'})`
              )
              .join(', ')
        );
    }
  });
});

// Story 24.1 — per-frame render time of a field layer (temperature, from
// the pre-baked static grid, so no Open-Meteo call). Plan §E24 target:
// < 4 ms per frame on desktop.
test.describe('ux metrics · field frame', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const FIELD_FRAMES = 24;

  test('@ux-metrics /mapa desktop: field frame render time on temperature', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    // Every `mw:field-frame` measure, before any app script runs (the app
    // keeps only the last one in the performance buffer).
    await page.addInitScript(() => {
      const out: { duration: number; renderer: string | null }[] = [];
      window.__uxmField = out;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.name !== 'mw:field-frame') continue;
            const detail = (e as PerformanceMeasure).detail as {
              renderer?: string;
            } | null;
            out.push({
              duration: e.duration,
              renderer: detail?.renderer ?? null,
            });
          }
        }).observe({ type: 'measure' });
      } catch {
        /* no PerformanceObserver: the number stays null */
      }
    });
    const read = () => page.evaluate(() => (window.__uxmField ?? []).slice());
    let fieldFrame: UxMetricsParts['fieldFrame'] = null;
    try {
      await bootMap(page);
      // T = Temperatura (a visitor's pick: the satellite loop stops).
      await page.keyboard.press('t');
      await expect(page.locator('#layerbtn-temperature')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect.poll(async () => (await read()).length).toBeGreaterThan(0);
      const range = page.locator('#tl-range');
      await expect(range).toHaveAttribute('max', /^[1-9]\d+$/);
      const before = (await read()).length;
      for (let i = 0; i < FIELD_FRAMES; i++) {
        const idx = Number(await range.inputValue());
        await range.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
        // One frame per step: wait until it was drawn and measured.
        await expect
          .poll(async () => (await read()).length)
          .toBeGreaterThan(before + i);
        expect(Number(await range.inputValue())).not.toBe(idx);
      }
      const samples = (await read()).slice(before);
      fieldFrame = fieldFrameStats(samples);
      expect(fieldFrame, 'no mw:field-frame measures').not.toBeNull();
    } finally {
      const m = await recordMetrics(testInfo, { fieldFrame }, (w) =>
        /field frame/.test(w)
      );
      console.log(
        `[ux-metrics] field frame (temperature): ${m.extra.fieldFrameMedianMs ?? 'n/a'} ms median, ` +
          `longest ${m.extra.fieldFrameMaxMs ?? 'n/a'} ms over ${m.extra.fieldFrames ?? 'n/a'} frames ` +
          `(${m.extra.fieldRenderer ?? 'n/a'})`
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
      const m = await recordMetrics(testInfo, { controls: { mobile } }, (w) =>
        /mobile/.test(w)
      );
      console.log(`[ux-metrics] mobile: controls ${m.controls.mobile}`);
    }
  });
});
