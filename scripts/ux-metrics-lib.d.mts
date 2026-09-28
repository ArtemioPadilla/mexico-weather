/** Type surface of scripts/ux-metrics-lib.mjs for the vitest suite and the
 *  e2e spec. */

export interface Threshold {
  max?: number;
  min?: number;
}

export const UX_METRICS_SCHEMA: number;
export const UX_METRICS_FILE: string;
export const UX_COMMENT_MARKER: string;
export const FPS_WINDOW_MS: number;
export const WIND_FPS_WINDOW_MS: number;
export const LONG_TASK_SAMPLE_SIZE: number;
export const UX_THRESHOLDS: {
  firstSatelliteFrameMs: Threshold;
  loopFps: Threshold;
  controlsDesktop: Threshold;
  controlsMobile: Threshold;
  newTilesPerFrame: Threshold;
  fieldFrameMs: Threshold;
  windFps: Threshold;
};

export interface FpsStats {
  fps: number;
  frames: number;
  maxGapMs: number;
  windowMs: number;
}

export interface IndexEvent {
  t: number;
  index: number;
  playing: boolean;
}

export interface TileRequest {
  t: number;
  url: string;
}

export interface SecondLoopStats {
  frames: number;
  requests: number;
  newTiles: number;
  requestsPerFrame: number;
  newTilesPerFrame: number;
  msPerFrame: number;
}

export interface UxMetrics {
  schema: number;
  generatedAt: string | null;
  commit: string | null;
  tilesMocked: boolean;
  firstSatelliteFrameMs: number | null;
  loopFps: number | null;
  controls: { desktop: number | null; mobile: number | null };
  secondLoop: SecondLoopStats | null;
  extra: {
    fpsWindowMs: number;
    maxFrameGapMs: number | null;
    longTasks: number | null;
    longTaskMs: number | null;
    /** Story 23.2 — optional: absent in documents from before it. */
    longTaskMaxMs?: number | null;
    longTaskSample?: LongTaskSampleEntry[] | null;
    loopStepMedianMs?: number | null;
    loopStepMaxMs?: number | null;
    /** Story 24.1 — optional: absent in documents from before it. */
    fieldFrameMedianMs?: number | null;
    fieldFrameMaxMs?: number | null;
    fieldFrames?: number | null;
    fieldRenderer?: string | null;
    /** Story 24.4 — optional: absent in documents from before it. */
    windFpsDesktop?: number | null;
    windFpsMobile?: number | null;
    windRenderFpsDesktop?: number | null;
    windRenderFpsMobile?: number | null;
  };
}

export interface LongTaskEntry {
  start: number;
  duration: number;
  name?: string;
}

export interface LongTaskSampleEntry {
  atMs: number;
  durationMs: number;
  name: string | null;
}

export interface LongTaskSample {
  count: number;
  totalMs: number;
  maxMs: number;
  longest: LongTaskSampleEntry[];
}

export interface LoopStepStats {
  steps: number;
  medianMs: number;
  maxMs: number;
}

export interface UxMetricsParts {
  generatedAt?: string | null;
  commit?: string | null;
  firstSatelliteFrameMs?: number | null;
  fps?: FpsStats | null;
  controls?: { desktop?: number | null; mobile?: number | null };
  secondLoop?: SecondLoopStats | null;
  longTasks?: {
    count: number;
    totalMs: number;
    maxMs?: number;
    longest?: LongTaskSampleEntry[];
  } | null;
  steps?: LoopStepStats | null;
  fieldFrame?: FieldFrameStats | null;
  windFps?: { desktop?: WindFpsStats | null; mobile?: WindFpsStats | null };
}

/** Story 24.4 — frame rate while the wind particles animate. */
export interface WindFpsStats {
  fps: number;
  renderFps: number;
  maxGapMs: number;
  windowMs: number;
}

export function windFpsStats(
  raf: number[],
  renders: number[],
  startMs: number,
  windowMs?: number
): WindFpsStats | null;

/** Story 24.1 — per-frame field render time. */
export interface FieldFrameStats {
  frames: number;
  medianMs: number;
  maxMs: number;
  renderer: string;
}

export function fieldFrameStats(
  samples: { duration: number; renderer?: string | null }[]
): FieldFrameStats | null;

export function isSatelliteTileRequest(url: string): boolean;
export function fpsStats(
  timestamps: number[],
  startMs: number,
  windowMs?: number
): FpsStats | null;
export function longTaskSample(
  entries: LongTaskEntry[],
  startMs: number,
  windowMs?: number,
  size?: number
): LongTaskSample;
export function loopStepStats(
  events: IndexEvent[],
  startT: number,
  windowMs?: number
): LoopStepStats | null;
export function loopPassStarts(events: IndexEvent[]): number[];
export function secondLoopStats(
  events: IndexEvent[],
  requests: TileRequest[]
): SecondLoopStats | null;
export function buildUxMetrics(parts?: UxMetricsParts): UxMetrics;
export function mergeUxMetrics(
  base: UxMetrics | null,
  next: UxMetrics
): UxMetrics;
export function uxWarnings(metrics: UxMetrics | null): string[];
export function formatDelta(
  cur: number | null | undefined,
  prev: number | null | undefined,
  opts?: { unit?: string; better?: 'lower' | 'higher' }
): string;
export function parseUxComment(body: unknown): UxMetrics | null;
export function renderUxComment(
  metrics: UxMetrics | null,
  ctx?: { previous?: UxMetrics | null; sha?: string; runUrl?: string }
): string;
