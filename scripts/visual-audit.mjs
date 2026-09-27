#!/usr/bin/env node
/**
 * Story 26.1 — side-by-side visual audit against zoom.earth.
 *
 *   npm run build
 *   node scripts/visual-audit.mjs            # real network (CI: visual-audit.yml)
 *   node scripts/visual-audit.mjs --mock     # offline smoke test, stubbed tiles
 *
 * Serves dist/ with `astro preview`, opens /mapa on satellite, radar and
 * temperature at 1280×800, 768×1024 and 360×640, opens zoom.earth in the
 * same state, and writes to audit-out/:
 *
 *   <layer>-<width>w-mexico-weather.png / <layer>-<width>w-zoom-earth.png
 *   manifest.json   (urls, timings, paint check, notes per capture)
 *   UX_AUDIT_<date>.md   (sheet from visual-audit-template.md, §0 checklist
 *                         to fill by hand, then copy to docs/)
 *
 * A zoom.earth state that fails to load is not fatal: whatever rendered is
 * captured and the failure is noted in the sheet. Run with --help for flags.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  DEFAULT_BASE_PATH,
  TRANSPARENT_PNG_BASE64,
  USAGE,
  buildPlan,
  classifyMockRequest,
  fieldResponseForUrl,
  isoDate,
  parseArgs,
  rainviewerManifest,
  renderSheet,
  sheetFileName,
  zoomEarthPlaceholderHtml,
} from './visual-audit-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `url` answers any HTTP status (the preview server is up). */
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch (e) {
      lastErr = e;
    }
    await sleep(250);
  }
  throw new Error(
    `Preview server did not answer at ${url}: ${lastErr?.message ?? 'timeout'}`
  );
}

/** Spawn `astro preview` on dist/ and resolve once it serves the base URL. */
async function startPreview(port) {
  const astroBin = join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');
  const child = spawn(
    process.execPath,
    [astroBin, 'preview', '--port', String(port)],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group so stop() can kill the whole tree, never anything else.
      detached: process.platform !== 'win32',
    }
  );
  let log = '';
  child.stdout.on('data', (d) => {
    log += d.toString();
  });
  child.stderr.on('data', (d) => {
    log += d.toString();
  });
  const exited = new Promise((res) => child.once('exit', res));
  const base = `http://localhost:${port}${DEFAULT_BASE_PATH}`;
  try {
    await Promise.race([
      waitForHttp(base, 30_000),
      exited.then((code) => {
        throw new Error(`astro preview exited early (code ${code}):\n${log}`);
      }),
    ]);
  } catch (e) {
    stop();
    throw e;
  }
  function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  return { base, stop };
}

/**
 * Install the --mock network: nothing leaves the machine except requests to
 * the preview server. Playwright matches the most recently added route first,
 * so the catch-all goes in before the specific handlers.
 */
async function installMocks(context) {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    switch (classifyMockRequest(url)) {
      case 'pass':
        return route.continue();
      case 'png':
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: TRANSPARENT_PNG,
        });
      case 'rainviewer-manifest':
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(rainviewerManifest()),
        });
      case 'open-meteo-field':
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fieldResponseForUrl(url)),
        });
      case 'zoom-earth':
        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: zoomEarthPlaceholderHtml(url),
        });
      default:
        return route.fulfill({ status: 204, body: '' });
    }
  });
}

/**
 * Luminance variance of a 64×64 downsample of the MapLibre canvas — the same
 * probe e2e/map-first-paint.spec.ts uses. ~0 means blank or solid fill.
 * Returns null when there is no canvas yet.
 */
async function canvasVariance(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas.maplibregl-canvas');
    if (!c) return null;
    const off = document.createElement('canvas');
    off.width = 64;
    off.height = 64;
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(c, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let n = 0;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      n += 1;
      sum += l;
      sumSq += l * l;
    }
    const mean = sum / n;
    return sumSq / n - mean * mean;
  });
}

/** Our side: wait for the layer to be active and the canvas to paint. */
async function waitForOurMap(page, entry, { mock, settleMs }) {
  const notes = [];
  const btn = page.locator(`#layerbtn-${entry.layer}`);
  try {
    await btn.waitFor({ state: 'attached', timeout: 20_000 });
    await page.waitForFunction(
      (id) =>
        document.getElementById(id)?.getAttribute('aria-pressed') === 'true',
      `layerbtn-${entry.layer}`,
      { timeout: 25_000 }
    );
  } catch {
    notes.push(`la capa ${entry.layer} no quedó activa (aria-pressed) en 25 s`);
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
  } catch {
    notes.push('la red no quedó ociosa en 20 s (teselas aún cargando)');
  }
  // In --mock mode the tiles are transparent, so a blank canvas is expected
  // on satellite/radar; the paint probe only means something with real tiles.
  let painted = null;
  if (!mock) {
    const deadline = Date.now() + 15_000;
    painted = false;
    while (Date.now() < deadline) {
      const v = await canvasVariance(page);
      if (v !== null && v > 40) {
        painted = true;
        break;
      }
      await sleep(500);
    }
  }
  await sleep(settleMs);
  return { notes, painted };
}

/** zoom.earth: best effort — load, let tiles stream in, capture whatever is there. */
async function waitForZoomEarth(page, { mock, settleMs }) {
  const notes = [];
  try {
    await page.waitForLoadState('networkidle', {
      timeout: mock ? 5_000 : 30_000,
    });
  } catch {
    notes.push(
      'zoom.earth siguió cargando tras 30 s; se capturó el estado parcial'
    );
  }
  await sleep(mock ? 250 : settleMs);
  return { notes, painted: null };
}

async function capture(browser, entry, opts) {
  const context = await browser.newContext({
    viewport: { width: entry.viewport.width, height: entry.viewport.height },
    deviceScaleFactor: 1,
    locale: 'es-MX',
    colorScheme: 'light',
    ignoreHTTPSErrors: !!opts.proxy,
    ...(opts.proxy
      ? { proxy: { server: opts.proxy, bypass: 'localhost,127.0.0.1' } }
      : {}),
  });
  if (opts.mock) await installMocks(context);
  const page = await context.newPage();
  const started = Date.now();
  const result = { ...entry, ok: false, painted: null };
  const notes = [];
  try {
    try {
      await page.goto(entry.url, {
        waitUntil: 'load',
        timeout: opts.mock ? 30_000 : 60_000,
      });
    } catch (e) {
      // Capture what did load (if anything) and say so in the sheet.
      notes.push(`navegación incompleta: ${e.message.split('\n')[0]}`);
    }
    const ready =
      entry.site === 'mexico-weather'
        ? await waitForOurMap(page, entry, opts)
        : await waitForZoomEarth(page, opts);
    notes.push(...ready.notes);
    result.painted = ready.painted;
    await page.screenshot({
      path: join(opts.outDir, entry.file),
      fullPage: false,
    });
    result.ok = true;
  } catch (e) {
    notes.push(`sin captura: ${e.message.split('\n')[0]}`);
  } finally {
    result.ms = Date.now() - started;
    if (notes.length) result.note = notes.join('; ');
    await context.close();
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const outDir = resolve(ROOT, opts.out);
  await mkdir(outDir, { recursive: true });
  const date = opts.date ?? isoDate();
  const settleMs = opts.settleMs ?? (opts.mock ? 1_500 : 6_000);

  let preview = null;
  let base = opts.base;
  if (!base) {
    preview = await startPreview(opts.port);
    base = preview.base;
    console.log(`preview: ${base}`);
  }
  const plan = buildPlan({ base, skipZoom: opts.skipZoom });
  console.log(
    `mode: ${opts.mock ? 'mock' : 'real network'} · ${plan.length} captures → ${outDir}`
  );

  const browser = await chromium.launch({
    ...(opts.chromium ? { executablePath: opts.chromium } : {}),
  });
  const results = [];
  try {
    for (const entry of plan) {
      const r = await capture(browser, entry, { ...opts, outDir, settleMs });
      results.push(r);
      const status = r.ok ? 'ok ' : 'ERR';
      console.log(
        `${status} ${r.pair.padEnd(18)} ${r.site.padEnd(14)} ${String(r.ms).padStart(6)} ms${r.note ? `  · ${r.note}` : ''}`
      );
    }
  } finally {
    await browser.close();
    preview?.stop();
  }

  const template = await readFile(
    join(HERE, 'visual-audit-template.md'),
    'utf8'
  );
  const sheet = renderSheet(template, {
    date,
    mode: opts.mock
      ? 'mock (teselas y APIs simuladas, zoom.earth sustituido)'
      : 'red real',
    results,
  });
  const sheetPath = join(outDir, sheetFileName(date));
  await writeFile(sheetPath, sheet);
  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        date,
        generatedAt: new Date().toISOString(),
        mode: opts.mock ? 'mock' : 'real',
        base,
        captures: results,
      },
      null,
      2
    )
  );
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nsheet: ${sheetPath}\n${results.length - failed.length}/${results.length} captures written`
  );
  // Our own captures must exist; a missing zoom.earth capture is reported, not fatal.
  const oursFailed = failed.filter((r) => r.site === 'mexico-weather');
  return oursFailed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
