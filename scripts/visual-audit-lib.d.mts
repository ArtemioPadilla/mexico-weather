/** Type surface of scripts/visual-audit-lib.mjs for the vitest suite. */

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface LayerDef {
  id: string;
  ours: string;
  zoom: string;
  label: string;
}

export interface View {
  lat: number;
  lng: number;
  zoom: number;
}

export interface AuditOptions {
  mock: boolean;
  base: string | null;
  port: number;
  out: string;
  date: string | null;
  chromium: string | null;
  proxy: string | null;
  skipZoom: boolean;
  settleMs: number | null;
  help: boolean;
}

export type Site = 'mexico-weather' | 'zoom-earth';

export interface PlanEntry {
  pair: string;
  layer: string;
  label: string;
  viewport: Viewport;
  site: Site;
  url: string;
  file: string;
}

export interface CaptureResult extends PlanEntry {
  ok: boolean;
  ms?: number;
  note?: string;
  painted?: boolean | null;
}

export type MockKind =
  | 'pass'
  | 'png'
  | 'rainviewer-manifest'
  | 'open-meteo-field'
  | 'zoom-earth'
  | 'empty';

export const VIEWPORTS: Viewport[];
export const LAYERS: LayerDef[];
export const DEFAULT_VIEW: View;
export const DEFAULT_PORT: number;
export const DEFAULT_BASE_PATH: string;
export const DEFAULT_OUT_DIR: string;
export const TRANSPARENT_PNG_BASE64: string;
export const USAGE: string;

export function parseArgs(argv: string[]): AuditOptions;
export function viewHash(view?: View): string;
export function localMapUrl(base: string, layerId: string, view?: View): string;
export function zoomEarthUrl(zoomSegment: string, view?: View): string;
export function captureFileName(
  layerId: string,
  viewport: Viewport,
  site: Site
): string;
export function buildPlan(cfg: {
  base: string;
  skipZoom?: boolean;
  view?: View;
}): PlanEntry[];
export function isoDate(now?: Date): string;
export function sheetFileName(date: string): string;
export function rainviewerManifest(nowSec?: number): {
  version: string;
  generated: number;
  host: string;
  radar: {
    past: { time: number; path: string }[];
    nowcast: { time: number; path: string }[];
  };
  satellite: { infrared: { time: number; path: string }[] };
};
export function fieldResponseForUrl(url: string, now?: Date): unknown[];
export function zoomEarthPlaceholderHtml(url: string): string;
export function isLocalUrl(url: string): boolean;
export function classifyMockRequest(url: string): MockKind;
export function renderSheet(
  template: string,
  data: { date: string; mode: string; results: CaptureResult[] }
): string;
