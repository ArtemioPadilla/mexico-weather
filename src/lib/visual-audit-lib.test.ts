import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LAYERS,
  TRANSPARENT_PNG_BASE64,
  VIEWPORTS,
  buildPlan,
  captureFileName,
  classifyMockRequest,
  fieldResponseForUrl,
  isLocalUrl,
  localMapUrl,
  parseArgs,
  rainviewerManifest,
  renderSheet,
  sheetFileName,
  zoomEarthPlaceholderHtml,
  zoomEarthUrl,
} from '../../scripts/visual-audit-lib.mjs';
import type { CaptureResult } from '../../scripts/visual-audit-lib.mjs';

describe('visual-audit-lib — plan', () => {
  it('covers 3 layers × 3 viewports × 2 sites, in pairs', () => {
    const plan = buildPlan({ base: 'http://localhost:4399/mexico-weather/' });
    expect(plan).toHaveLength(18);
    const pairs = new Set(plan.map((p) => p.pair));
    expect(pairs.size).toBe(9);
    for (const pair of pairs) {
      const sites = plan.filter((p) => p.pair === pair).map((p) => p.site);
      expect(sites.sort()).toEqual(['mexico-weather', 'zoom-earth']);
    }
    expect(VIEWPORTS.map((v) => [v.width, v.height])).toEqual([
      [1280, 800],
      [768, 1024],
      [360, 640],
    ]);
    expect(LAYERS.map((l) => l.id)).toEqual([
      'satellite',
      'radar',
      'temperature',
    ]);
  });

  it('--skip-zoom drops the zoom.earth half only', () => {
    const plan = buildPlan({ base: 'http://x/', skipZoom: true });
    expect(plan).toHaveLength(9);
    expect(plan.every((p) => p.site === 'mexico-weather')).toBe(true);
  });

  it('builds deep links both sites understand', () => {
    expect(localMapUrl('http://localhost:4399/mexico-weather/', 'radar')).toBe(
      'http://localhost:4399/mexico-weather/mapa/#view=23.6,-102.5,5z&layer=radar'
    );
    // A base without the trailing slash still lands on /mapa/.
    expect(
      localMapUrl('http://localhost:4399/mexico-weather', 'satellite')
    ).toContain('/mexico-weather/mapa/#');
    expect(zoomEarthUrl('temperature')).toBe(
      'https://zoom.earth/maps/temperature/#view=23.6,-102.5,5z'
    );
    expect(zoomEarthUrl('radar', { lat: 19.43, lng: -99.13, zoom: 6.5 })).toBe(
      'https://zoom.earth/maps/radar/#view=19.43,-99.13,6.5z'
    );
  });

  it('names files so pairs sort together', () => {
    const vp = { name: 'phone', width: 360, height: 640 };
    expect(captureFileName('satellite', vp, 'mexico-weather')).toBe(
      'satellite-360w-mexico-weather.png'
    );
    expect(captureFileName('satellite', vp, 'zoom-earth')).toBe(
      'satellite-360w-zoom-earth.png'
    );
    expect(sheetFileName('2026-09-27')).toBe('UX_AUDIT_2026-09-27.md');
  });
});

describe('visual-audit-lib — parseArgs', () => {
  it('defaults to a real-network run on port 4399 into audit-out/', () => {
    const o = parseArgs([]);
    expect(o).toMatchObject({
      mock: false,
      base: null,
      port: 4399,
      out: 'audit-out',
      date: null,
      skipZoom: false,
      help: false,
    });
  });

  it('parses every flag', () => {
    const o = parseArgs([
      '--mock',
      '--base',
      'http://localhost:4321/mexico-weather/',
      '--port',
      '5000',
      '--out',
      'tmp/audit',
      '--date',
      '2026-09-27',
      '--chromium',
      '/opt/pw-browsers/chromium',
      '--proxy',
      'http://proxy:3128',
      '--skip-zoom',
      '--settle-ms',
      '250',
    ]);
    expect(o).toEqual({
      mock: true,
      base: 'http://localhost:4321/mexico-weather/',
      port: 5000,
      out: 'tmp/audit',
      date: '2026-09-27',
      chromium: '/opt/pw-browsers/chromium',
      proxy: 'http://proxy:3128',
      skipZoom: true,
      settleMs: 250,
      help: false,
    });
  });

  it('rejects typos and bad values loudly', () => {
    expect(() => parseArgs(['--mok'])).toThrow(/Unknown flag --mok/);
    expect(() => parseArgs(['--port'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/TCP port/);
    expect(() => parseArgs(['--date', '27/09/2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--out', '--mock'])).toThrow(/needs a value/);
  });
});

describe('visual-audit-lib — mock tile PNG', () => {
  // Decoded the way a browser would (atob throws on non-strict base64,
  // Node's Buffer.from silently skips the bad character), so the assertions
  // below fail on the corrupted 449-char copy that once shipped.
  const decode = (b64: string) =>
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bytes = decode(TRANSPARENT_PNG_BASE64);
  const view = new DataView(bytes.buffer);
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));

  it('is strict base64 (browser atob accepts it and it round-trips)', () => {
    expect(TRANSPARENT_PNG_BASE64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(TRANSPARENT_PNG_BASE64.length % 4).toBe(0);
    expect(btoa(String.fromCharCode(...bytes))).toBe(TRANSPARENT_PNG_BASE64);
  });

  it('decodes to a 334-byte PNG whose IHDR says 256×256', () => {
    expect(bytes).toHaveLength(334);
    expect(
      Array.from(bytes.subarray(0, 8), (b) =>
        b.toString(16).padStart(2, '0')
      ).join('')
    ).toBe('89504e470d0a1a0a');
    expect(ascii(12, 16)).toBe('IHDR');
    expect(view.getUint32(16)).toBe(256); // width
    expect(view.getUint32(20)).toBe(256); // height
    // The last chunk is IEND, so the tail was not truncated.
    expect(ascii(bytes.length - 8, bytes.length - 4)).toBe('IEND');
  });

  it('is byte-identical to the tile e2e/mapa.spec.ts serves', () => {
    const spec = readFileSync(
      fileURLToPath(new URL('../../e2e/mapa.spec.ts', import.meta.url)),
      'utf-8'
    );
    const m =
      /const TRANSPARENT_PNG = Buffer\.from\(\s*'([A-Za-z0-9+/=]+)'/.exec(spec);
    expect(
      m,
      'TRANSPARENT_PNG literal not found in e2e/mapa.spec.ts'
    ).not.toBeNull();
    expect(TRANSPARENT_PNG_BASE64).toBe(m![1]);
  });
});

describe('visual-audit-lib — mock network', () => {
  it('lets only the preview server through', () => {
    expect(isLocalUrl('http://localhost:4399/mexico-weather/mapa/')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:4399/x')).toBe(true);
    expect(isLocalUrl('https://zoom.earth/')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
    expect(
      classifyMockRequest(
        'http://localhost:4399/mexico-weather/data/field-grids/temperature_2m.json'
      )
    ).toBe('pass');
  });

  it('classifies tiles, APIs and zoom.earth', () => {
    expect(
      classifyMockRequest(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/5/12/7'
      )
    ).toBe('png');
    expect(
      classifyMockRequest(
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/x/1/2/3.png'
      )
    ).toBe('png');
    expect(
      classifyMockRequest(
        'https://tilecache.rainviewer.com/v2/radar/1/256/5/7/12/2/1_1.png'
      )
    ).toBe('png');
    expect(
      classifyMockRequest('https://api.rainviewer.com/public/weather-maps.json')
    ).toBe('rainviewer-manifest');
    expect(
      classifyMockRequest(
        'https://api.open-meteo.com/v1/forecast?latitude=1,2&longitude=3,4'
      )
    ).toBe('open-meteo-field');
    expect(
      classifyMockRequest('https://zoom.earth/maps/satellite/#view=1,2,3z')
    ).toBe('zoom-earth');
    expect(classifyMockRequest('https://tiles.zoom.earth/a/b.jpg')).toBe(
      'zoom-earth'
    );
    expect(
      classifyMockRequest('https://demotiles.maplibre.org/font/x/0-255.pbf')
    ).toBe('empty');
    expect(classifyMockRequest('garbage')).toBe('empty');
  });

  it('serves a RainViewer manifest anchored just before now', () => {
    const now = 1_790_000_000;
    const m = rainviewerManifest(now);
    expect(m.host).toBe('https://tilecache.rainviewer.com');
    expect(m.radar.past).toHaveLength(6);
    const times = m.radar.past.map((f) => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times.at(-1)!).toBeLessThan(now);
    expect(now - times.at(-1)!).toBeLessThanOrEqual(1200);
    expect(m.radar.nowcast[0]!.time).toBeGreaterThan(times.at(-1)!);
    expect(m.satellite.infrared).toHaveLength(1);
  });

  it('sizes the Open-Meteo field response from the request', () => {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=1,2,3&longitude=4,5,6&forecast_days=2&past_days=1&temporal_resolution=hourly_3';
    const res = fieldResponseForUrl(
      url,
      new Date('2026-09-27T15:00:00Z')
    ) as Array<{
      hourly: { time: string[]; temperature_2m: number[] };
    }>;
    expect(res).toHaveLength(3);
    const { time, temperature_2m } = res[0]!.hourly;
    expect(time[0]).toBe('2026-09-26T00:00');
    expect(time).toHaveLength(24); // 3 days × 8 three-hourly steps
    expect(temperature_2m).toHaveLength(24);
  });

  it('escapes the URL echoed into the placeholder page', () => {
    const html = zoomEarthPlaceholderHtml(
      'https://zoom.earth/?a=<script>&b="x"'
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<!doctype html>');
  });
});

describe('visual-audit-lib — sheet', () => {
  const vp = { name: 'desktop', width: 1280, height: 800 };
  const base = {
    pair: 'satellite-1280w',
    layer: 'satellite',
    label: 'Satélite',
    viewport: vp,
  };
  const results: CaptureResult[] = [
    {
      ...base,
      site: 'mexico-weather',
      url: 'http://l/mapa/#layer=satellite',
      file: 'satellite-1280w-mexico-weather.png',
      ok: true,
      ms: 1200,
      painted: true,
    },
    {
      ...base,
      site: 'zoom-earth',
      url: 'https://zoom.earth/maps/satellite/',
      file: 'satellite-1280w-zoom-earth.png',
      ok: false,
      ms: 60_000,
      note: 'navegación incompleta: timeout',
    },
  ];
  const template =
    '# {{date}} ({{mode}})\n{{pairs}}\n---\n{{notes}}\n{{unknown}}';

  it('renders one row per pair with both images and keeps failures visible', () => {
    const out = renderSheet(template, {
      date: '2026-09-27',
      mode: 'red real',
      results,
    });
    expect(out).toContain('# 2026-09-27 (red real)');
    expect(out).toContain(
      '| Satélite · 1280×800 | ![mexico-weather satellite-1280w](./satellite-1280w-mexico-weather.png) | _sin captura_ (navegación incompleta: timeout) |'
    );
    expect(out).toContain(
      '- **satellite-1280w / zoom-earth** — navegación incompleta: timeout'
    );
    // Unknown placeholders are left alone so a template typo shows up.
    expect(out).toContain('{{unknown}}');
  });

  it('flags a blank canvas on our side and says when nothing went wrong', () => {
    const blank = renderSheet(template, {
      date: 'd',
      mode: 'm',
      results: [{ ...results[0]!, painted: false }],
    });
    expect(blank).toContain('el canvas seguía vacío');
    const clean = renderSheet(template, {
      date: 'd',
      mode: 'm',
      results: [results[0]!],
    });
    expect(clean).toContain('Sin incidencias durante la captura.');
  });
});
