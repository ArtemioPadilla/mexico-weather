/**
 * Pure helpers for scripts/visual-audit.mjs (Story 26.1).
 *
 * Everything here is side-effect free so it can be unit-tested with vitest
 * (src/lib/visual-audit-lib.test.ts). The runner imports these to build its
 * capture plan, its mock responses and the Markdown audit sheet.
 */

/** Viewports from the plan (§E26, Story 26.1): desktop, tablet, phone. */
export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 360, height: 640 },
];

/**
 * Layers compared side by side. `ours` is the `/mapa#layer=` id; `zoom` is
 * the path segment zoom.earth uses under /maps/ for the matching product.
 */
export const LAYERS = [
  { id: 'satellite', ours: 'satellite', zoom: 'satellite', label: 'Satélite' },
  { id: 'radar', ours: 'radar', zoom: 'radar', label: 'Radar' },
  {
    id: 'temperature',
    ours: 'temperature',
    zoom: 'temperature',
    label: 'Temperatura',
  },
];

/** Country-level view shared by both sites so the pairs line up. */
export const DEFAULT_VIEW = { lat: 23.6, lng: -102.5, zoom: 5 };

export const DEFAULT_PORT = 4399;
export const DEFAULT_BASE_PATH = '/mexico-weather/';
export const DEFAULT_OUT_DIR = 'audit-out';

/**
 * 256×256 fully transparent PNG. The same bytes e2e/mapa.spec.ts uses: a
 * 1×1 PNG is rejected by Chromium's createImageBitmap, every tile errors
 * and MapLibre never fires `load`.
 */
export const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAABPO1TCQAAAABJRU5ErkJggg==';

/**
 * Parse CLI flags. Unknown flags throw so a typo in the workflow fails
 * loudly instead of silently running a real-network audit.
 *
 * @param {string[]} argv process.argv.slice(2)
 */
export function parseArgs(argv) {
  const opts = {
    mock: false,
    base: null,
    port: DEFAULT_PORT,
    out: DEFAULT_OUT_DIR,
    date: null,
    chromium: null,
    proxy: null,
    skipZoom: false,
    settleMs: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`Flag ${arg} needs a value`);
      }
      i += 1;
      return v;
    };
    switch (arg) {
      case '--mock':
        opts.mock = true;
        break;
      case '--skip-zoom':
        opts.skipZoom = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--base':
        opts.base = next();
        break;
      case '--port': {
        const p = Number(next());
        if (!Number.isInteger(p) || p <= 0 || p > 65535) {
          throw new Error(`--port must be a TCP port, got ${p}`);
        }
        opts.port = p;
        break;
      }
      case '--out':
        opts.out = next();
        break;
      case '--date': {
        const d = next();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          throw new Error(`--date must be YYYY-MM-DD, got ${d}`);
        }
        opts.date = d;
        break;
      }
      case '--chromium':
        opts.chromium = next();
        break;
      case '--proxy':
        opts.proxy = next();
        break;
      case '--settle-ms': {
        const ms = Number(next());
        if (!Number.isFinite(ms) || ms < 0) {
          throw new Error(
            `--settle-ms must be a non-negative number, got ${ms}`
          );
        }
        opts.settleMs = ms;
        break;
      }
      default:
        throw new Error(`Unknown flag ${arg} (see --help)`);
    }
  }
  return opts;
}

export const USAGE = `Usage: node scripts/visual-audit.mjs [flags]

Captures /mapa (satellite, radar, temperature) at 1280×800, 768×1024 and
360×640 next to the same state on https://zoom.earth, then writes PNG pairs,
manifest.json and UX_AUDIT_<date>.md to the output directory.

  --mock             Stub tiles/APIs (256×256 transparent PNG) and replace
                     zoom.earth with a placeholder; for smoke tests offline.
  --base <url>       Use an already running site (e.g. http://localhost:4321/mexico-weather/)
                     instead of spawning "astro preview" on dist/.
  --port <n>         Port for the spawned preview server (default ${DEFAULT_PORT}).
  --out <dir>        Output directory (default ${DEFAULT_OUT_DIR}).
  --date YYYY-MM-DD  Date used in the sheet name (default: today, UTC).
  --chromium <path>  Chromium executable (sandboxes without the Playwright browser).
  --proxy <server>   HTTP(S) proxy for the browser; localhost is bypassed.
  --skip-zoom        Only capture our side (no zoom.earth requests).
  --settle-ms <n>    Extra wait after the map paints (default 1500 mock / 6000 real).
`;

/** Format the map hash both sites understand: view=<lat>,<lng>,<zoom>z */
export function viewHash(view = DEFAULT_VIEW) {
  return `view=${view.lat},${view.lng},${view.zoom}z`;
}

/** Deep link into our map on a given layer. `base` ends with '/'. */
export function localMapUrl(base, layerId, view = DEFAULT_VIEW) {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}mapa/#${viewHash(view)}&layer=${layerId}`;
}

/** zoom.earth's URL for the matching product and the same view. */
export function zoomEarthUrl(zoomSegment, view = DEFAULT_VIEW) {
  return `https://zoom.earth/maps/${zoomSegment}/#${viewHash(view)}`;
}

/** File name for one capture: <layer>-<width>w-<site>.png */
export function captureFileName(layerId, viewport, site) {
  return `${layerId}-${viewport.width}w-${site}.png`;
}

/**
 * Build the ordered list of captures. Each entry is one screenshot; the
 * `pair` key groups our capture with its zoom.earth counterpart.
 *
 * @param {{ base: string, skipZoom?: boolean, view?: typeof DEFAULT_VIEW }} cfg
 */
export function buildPlan(cfg) {
  const view = cfg.view ?? DEFAULT_VIEW;
  const plan = [];
  for (const layer of LAYERS) {
    for (const viewport of VIEWPORTS) {
      const pair = `${layer.id}-${viewport.width}w`;
      plan.push({
        pair,
        layer: layer.id,
        label: layer.label,
        viewport,
        site: 'mexico-weather',
        url: localMapUrl(cfg.base, layer.ours, view),
        file: captureFileName(layer.id, viewport, 'mexico-weather'),
      });
      if (!cfg.skipZoom) {
        plan.push({
          pair,
          layer: layer.id,
          label: layer.label,
          viewport,
          site: 'zoom-earth',
          url: zoomEarthUrl(layer.zoom, view),
          file: captureFileName(layer.id, viewport, 'zoom-earth'),
        });
      }
    }
  }
  return plan;
}

/** Today's date in UTC as YYYY-MM-DD. */
export function isoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Name of the audit sheet for a given date. */
export function sheetFileName(date) {
  return `UX_AUDIT_${date}.md`;
}

/**
 * Minimal RainViewer manifest (radar past/nowcast + one IR frame) whose
 * timestamps sit just before `nowSec`, so the radar timeline is populated
 * and no frame is treated as stale.
 */
export function rainviewerManifest(nowSec = Math.floor(Date.now() / 1000)) {
  const step = 600;
  const latest = nowSec - (nowSec % step) - step;
  const past = [];
  for (let k = 5; k >= 0; k -= 1) {
    const time = latest - k * step;
    past.push({ time, path: `/v2/radar/${time}` });
  }
  return {
    version: '2.0',
    generated: nowSec,
    host: 'https://tilecache.rainviewer.com',
    radar: {
      past,
      nowcast: [
        { time: latest + step, path: `/v2/radar/nowcast_${latest + step}` },
      ],
    },
    satellite: {
      infrared: [{ time: latest, path: `/v2/satellite/${latest}` }],
    },
  };
}

/**
 * Open-Meteo multi-point field response sized from the request URL, in the
 * same shape e2e/mapa.spec.ts serves (see fieldResponseForUrl there). Only
 * used when a static field-grid snapshot is missing from dist/.
 */
export function fieldResponseForUrl(url, now = new Date()) {
  const m = /[?&]latitude=([^&]+)/.exec(url);
  const n = m ? m[1].split(',').length : 32 * 24;
  const days = Number(/[?&]forecast_days=(\d+)/.exec(url)?.[1] ?? 2);
  const past = Number(/[?&]past_days=(\d+)/.exec(url)?.[1] ?? 0);
  const stepH = /temporal_resolution=hourly_3/.test(url) ? 3 : 1;
  const t0 = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const time = [];
  for (let h = -past * 24; h < days * 24; h += stepH) {
    time.push(new Date(t0 + h * 3_600_000).toISOString().slice(0, 16));
  }
  const series = (base) => time.map((_, i) => base + (i % 3));
  const point = {
    hourly: {
      time,
      temperature_2m: series(22),
      relative_humidity_2m: series(60),
      pressure_msl: series(1013),
      surface_pressure: series(1010),
      apparent_temperature: series(22),
      dew_point_2m: series(15),
      wet_bulb_temperature_2m: series(18),
      precipitation: time.map((_, i) => (i % 4 === 0 ? 2.5 : 0)),
      snowfall: time.map(() => 0),
      precipitation_probability: series(20),
    },
  };
  return Array.from({ length: n }, () => point);
}

/** Placeholder document served instead of zoom.earth in --mock mode. */
export function zoomEarthPlaceholderHtml(url) {
  const safe = String(url).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>zoom.earth (mock)</title>
<style>html,body{margin:0;height:100%;background:#0b1320;color:#dbe4f0;font:16px/1.4 system-ui,sans-serif}
main{display:grid;place-items:center;height:100%;text-align:center;padding:24px}</style></head>
<body><main><div><h1>zoom.earth placeholder</h1><p>--mock run: the real page was not requested.</p><p><code>${safe}</code></p></div></main></body></html>`;
}

/**
 * Is this request allowed to leave the machine in --mock mode? Only the
 * preview server (localhost) is; everything else is stubbed or dropped.
 */
export function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
}

/**
 * Decide how a request is answered in --mock mode.
 * @returns {'pass'|'png'|'rainviewer-manifest'|'open-meteo-field'|'zoom-earth'|'empty'}
 */
export function classifyMockRequest(url) {
  if (isLocalUrl(url)) return 'pass';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'empty';
  }
  const { hostname: host, pathname } = parsed;
  if (
    host === 'api.rainviewer.com' &&
    pathname === '/public/weather-maps.json'
  ) {
    return 'rainviewer-manifest';
  }
  if (
    host.endsWith('arcgisonline.com') ||
    host === 'gibs.earthdata.nasa.gov' ||
    host === 'tilecache.rainviewer.com'
  ) {
    return 'png';
  }
  if (host === 'api.open-meteo.com' && pathname.startsWith('/v1/forecast')) {
    return 'open-meteo-field';
  }
  if (host === 'zoom.earth' || host.endsWith('.zoom.earth'))
    return 'zoom-earth';
  return 'empty';
}

/**
 * Fill the Markdown sheet template.
 *
 * Placeholders: {{date}}, {{mode}}, {{pairs}} (one table row per pair with
 * both images), {{notes}} (bulleted capture notes / errors). Any other
 * {{token}} in the template is left untouched so a typo is visible.
 *
 * @param {string} template
 * @param {{ date: string, mode: string, results: Array<{pair:string,layer:string,label:string,viewport:{name:string,width:number,height:number},site:string,file:string,url:string,ok:boolean,ms?:number,note?:string,painted?:boolean|null}> }} data
 */
export function renderSheet(template, data) {
  const byPair = new Map();
  for (const r of data.results) {
    if (!byPair.has(r.pair)) byPair.set(r.pair, []);
    byPair.get(r.pair).push(r);
  }
  const rows = [];
  for (const [pair, items] of byPair) {
    const ours = items.find((r) => r.site === 'mexico-weather');
    const zoom = items.find((r) => r.site === 'zoom-earth');
    const cell = (r) => {
      if (!r) return '—';
      if (!r.ok) return `_sin captura_ (${r.note ?? 'error'})`;
      return `![${r.site} ${pair}](./${r.file})`;
    };
    const vp = items[0].viewport;
    rows.push(
      `| ${items[0].label} · ${vp.width}×${vp.height} | ${cell(ours)} | ${cell(zoom)} |`
    );
  }
  const notes = data.results
    .filter((r) => r.note)
    .map((r) => `- **${r.pair} / ${r.site}** — ${r.note}`);
  const painted = data.results.filter(
    (r) => r.site === 'mexico-weather' && r.painted === false
  );
  for (const r of painted) {
    notes.push(
      `- **${r.pair} / mexico-weather** — el canvas seguía vacío al capturar (revisar first paint).`
    );
  }
  const notesMd = notes.length
    ? notes.join('\n')
    : '- Sin incidencias durante la captura.';
  return template
    .replaceAll('{{date}}', data.date)
    .replaceAll('{{mode}}', data.mode)
    .replaceAll('{{pairs}}', rows.join('\n'))
    .replaceAll('{{notes}}', notesMd);
}
