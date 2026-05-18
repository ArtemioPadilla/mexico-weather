import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { APIRoute } from 'astro';

export const prerender = true;

/**
 * RSS 2.0 feed of meteorological alerts ("avisos meteorológicos") for Mexico.
 *
 * Source chooser (primary: scraped feed)
 * --------------------------------------
 * This endpoint is the single producer of `/rss.xml`. It first tries to serve
 * the committed `src/data/smn-feed.xml`, which a scheduled GitHub Action
 * (`.github/workflows/smn-rss.yml`) regenerates hourly by scraping the SMN
 * site with Playwright (`scripts/smn-rss/smn_rss.py`). That file is read from
 * disk at build time (it is in-repo, so a synchronous `readFileSync` is
 * fine). It is served verbatim ONLY if it exists, is non-empty, and is fresh:
 * its embedded `<lastBuildDate>` must be within ~3 hours of build time (if
 * that date is missing/unparseable we fall back to the file's mtime). If the
 * scraped feed is missing or stale, the endpoint falls back to the existing
 * build-time CA Open-Meteo derivation described below. Any failure anywhere
 * is caught and degrades to that same fallback, so the build never breaks.
 *
 * SMN source (fallback derivation)
 * --------------------------------
 * The Servicio Meteorológico Nacional (SMN/CONAGUA) does NOT publish a
 * structured (CAP/RSS/JSON) feed of its "avisos meteorológicos" — those are
 * only available as HTML pages and PDFs. Its single stable, machine-readable
 * source is the official municipal-forecast Web Service documented at
 * https://smn.conagua.gob.mx/es/web-service-api :
 *
 *   GET https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1
 *   -> gzip-compressed JSON ("DailyForecast_MX"), ~10k municipalities,
 *      refreshed hourly. Fields include probprec (precipitation probability),
 *      desciel (sky description), prec, raf (wind gusts), etc. The response is
 *      decompressed with the standard Web `DecompressionStream` API (no
 *      Node-only modules, so no extra dependencies / type packages).
 *
 * TLS note (important)
 * --------------------
 * `smn.conagua.gob.mx` serves an INCOMPLETE certificate chain: only the leaf
 * (`*.conagua.gob.mx`) is sent, the `GeoTrust TLS RSA CA G1` intermediate is
 * omitted. curl/browsers recover via AIA fetching, but Node's fetch/undici
 * does not and rejects with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. We do NOT
 * weaken TLS. Instead the genuine intermediate (issued by the Node-trusted
 * `DigiCert Global Root G2`) is committed at `src/data/smn-ca.pem` and the
 * build/CI workflows export `NODE_EXTRA_CA_CERTS=src/data/smn-ca.pem`, which
 * COMPLETES the chain with verification fully enabled. Without that env var
 * (e.g. a plain local `npm run build`) the fetch still fails cleanly and the
 * fallback below is used — the build never breaks.
 *
 * Encoding note: the SMN web service returns a gzip-compressed body but
 * advertises neither `Content-Encoding: gzip` nor a JSON content type
 * (`application/octet-stream`). We therefore detect gzip by its magic bytes
 * (0x1f 0x8b) rather than trusting the response header.
 *
 * We consume that official SMN data and derive build-time "avisos" from the
 * municipalities whose forecast for today indicates significant weather
 * (high precipitation probability or notable wind gusts). Each becomes one
 * RSS <item>.
 *
 * Fallback (critical)
 * -------------------
 * The upstream fetch + gunzip + parse is wrapped in a timeout + try/catch.
 * If anything fails (network, timeout, bad data, nothing significant), the
 * build still succeeds and the feed is still valid RSS 2.0 containing a
 * single informational item pointing to the official SMN avisos page. The
 * feed is therefore never 404 and never invalid, and a network failure can
 * never break `npm run build`.
 */

// Derived from Astro's build-time env (astro.config.mjs `site` + `base`) so
// the feed URL can never drift from the deployed site configuration.
const SITE_URL =
  (import.meta.env.SITE ?? '').replace(/\/$/, '') +
  (import.meta.env.BASE_URL ?? '').replace(/\/$/, '');
const SMN_FORECAST_URL =
  'https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1';
const SMN_AVISOS_URL =
  'https://smn.conagua.gob.mx/es/pronosticos/avisos/aviso-de-ciclon-tropical-en-el-oceano-pacifico';
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS = 60;
// A municipality is "noteworthy" if heavy rain is likely or wind gusts are strong.
// Exported (read-only) so the threshold logic can be unit-tested against the
// real constants without duplicating their values.
export const MIN_PRECIP_PROBABILITY = 80;
export const MIN_WIND_GUST_KMH = 50;

export interface SmnForecast {
  nes: string; // estado
  nmun: string; // municipio
  ndia: string; // forecast day index ("0" = today)
  probprec: string; // precipitation probability (%)
  prec: string; // precipitation (l/m2)
  raf: string; // wind gusts (km/h)
  desciel: string; // sky description
  tmax: string;
  tmin: string;
}

export interface FeedItem {
  title: string;
  description: string;
  link: string;
  guid: string;
  pubDate: string;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function fetchSmnForecast(): Promise<SmnForecast[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(SMN_FORECAST_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'mexico-weather-site (build-time RSS)' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`SMN responded with HTTP ${response.status}`);
    }
    // SMN gzip-compresses the payload but does NOT set `Content-Encoding`
    // (and serves it as `application/octet-stream`), so the header cannot be
    // trusted. Buffer the body and detect gzip by its magic bytes
    // (0x1f 0x8b); decompress only then, otherwise treat it as plain text.
    const buffer = new Uint8Array(await response.arrayBuffer());
    const isGzip = buffer.length > 1 && buffer[0] === 0x1f && buffer[1] === 0x8b;
    const stream = isGzip
      ? new Response(buffer).body!.pipeThrough(new DecompressionStream('gzip'))
      : new Response(buffer).body!;
    const json = await new Response(stream).text();
    const data = JSON.parse(json) as SmnForecast[];
    if (!Array.isArray(data)) {
      throw new Error('SMN payload is not an array');
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildAvisoItems(forecasts: SmnForecast[]): FeedItem[] {
  const pubDate = new Date().toUTCString();
  return forecasts
    .filter((f) => f && f.ndia === '0')
    .filter(
      (f) =>
        toNumber(f.probprec) >= MIN_PRECIP_PROBABILITY ||
        toNumber(f.raf) >= MIN_WIND_GUST_KMH,
    )
    .sort((a, b) => toNumber(b.probprec) - toNumber(a.probprec))
    .slice(0, MAX_ITEMS)
    .map((f) => {
      const place = `${f.nmun}, ${f.nes}`;
      const probprec = toNumber(f.probprec);
      const gust = toNumber(f.raf);
      const title = `Aviso meteorológico — ${place}`;
      const description =
        `Pronóstico SMN para hoy en ${place}: ${f.desciel}, ` +
        `probabilidad de precipitación ${probprec}% ` +
        `(${toNumber(f.prec)} l/m²), rachas de viento de ${gust} km/h, ` +
        `temperatura ${toNumber(f.tmin)}°C a ${toNumber(f.tmax)}°C.`;
      return {
        title,
        description,
        link: SMN_AVISOS_URL,
        guid:
          `smn-aviso-${f.nes}-${f.nmun}-${new Date().toISOString().slice(0, 10)}`
            .toLowerCase()
            .replace(/\s+/g, '-'),
        pubDate,
      };
    });
}

export function fallbackItem(): FeedItem {
  return {
    title: 'Avisos meteorológicos del SMN',
    description:
      'No fue posible obtener los datos del Servicio Meteorológico ' +
      'Nacional al generar el sitio. Consulta los avisos meteorológicos ' +
      'oficiales y vigentes directamente en el portal del SMN/CONAGUA.',
    link: SMN_AVISOS_URL,
    guid: 'smn-aviso-fallback',
    pubDate: new Date().toUTCString(),
  };
}

export function renderFeed(items: FeedItem[]): string {
  const lastBuildDate = new Date().toUTCString();
  const itemsXml = items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <description>${escapeXml(item.description)}</description>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <pubDate>${escapeXml(item.pubDate)}</pubDate>
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Clima México — Avisos del SMN</title>
    <link>${escapeXml(SITE_URL)}</link>
    <description>Avisos meteorológicos para México derivados de los datos oficiales del Servicio Meteorológico Nacional (SMN/CONAGUA).</description>
    <language>es-MX</language>
    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
    <generator>mexico-weather-site (Astro)</generator>
${itemsXml}
  </channel>
</rss>
`;
}

// Max age of the committed scraped feed for it to be served verbatim.
const SCRAPED_FEED_MAX_AGE_MS = 3 * 60 * 60 * 1000; // ~3 hours

/**
 * Resolve the on-disk path of the committed scraped feed. Under Astro's
 * static build `process.cwd()` is the project root, so that is preferred;
 * if for any reason that file is absent we also derive the path relative to
 * this module via `import.meta.url` (src/pages -> src/data).
 */
function resolveScrapedFeedCandidates(): string[] {
  const candidates: string[] = [];
  try {
    candidates.push(resolve(process.cwd(), 'src/data/smn-feed.xml'));
  } catch {
    /* process.cwd unavailable — ignore */
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, '..', 'data', 'smn-feed.xml'));
  } catch {
    /* import.meta.url unavailable — ignore */
  }
  return candidates;
}

/**
 * Read the committed scraped SMN feed and return its XML verbatim when it is
 * present, non-empty and fresh (embedded `<lastBuildDate>` within
 * SCRAPED_FEED_MAX_AGE_MS of now, or — if that date is missing/unparseable —
 * the file mtime within the same window). Returns null otherwise so the
 * caller falls back to the build-time CA derivation.
 */
function readFreshScrapedFeed(): string | null {
  for (const path of resolveScrapedFeedCandidates()) {
    let xml: string;
    try {
      xml = readFileSync(path, 'utf-8');
    } catch {
      continue; // not at this candidate path
    }
    if (!xml || xml.trim().length === 0) {
      continue;
    }
    const now = Date.now();
    const match = xml.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/i);
    let referenceMs: number | null = null;
    if (match) {
      const parsed = Date.parse(match[1].trim());
      if (!Number.isNaN(parsed)) {
        referenceMs = parsed;
      }
    }
    if (referenceMs === null) {
      // No parseable lastBuildDate: fall back to the file's mtime.
      try {
        referenceMs = statSync(path).mtimeMs;
      } catch {
        referenceMs = null;
      }
    }
    if (referenceMs === null) {
      continue;
    }
    const age = now - referenceMs;
    // Accept if within the freshness window (and not absurdly future-dated).
    if (age <= SCRAPED_FEED_MAX_AGE_MS && age >= -SCRAPED_FEED_MAX_AGE_MS) {
      return xml;
    }
  }
  return null;
}

export const GET: APIRoute = async () => {
  // Primary source: the committed feed produced by the scheduled scraper.
  // Wrapped so that ANY failure here degrades to the CA fallback below.
  try {
    const scraped = readFreshScrapedFeed();
    if (scraped) {
      return new Response(scraped, {
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[rss.xml] WARNING: could not use committed scraped feed ` +
        `(src/data/smn-feed.xml); falling back to build-time SMN ` +
        `derivation. Reason: ${message}.`,
    );
  }

  let items: FeedItem[];
  try {
    const forecasts = await fetchSmnForecast();
    items = buildAvisoItems(forecasts);
    // If SMN data is reachable but nothing is noteworthy, still emit a valid
    // feed with an informational item instead of an empty channel.
    if (items.length === 0) {
      items = [
        {
          title: 'Sin avisos meteorológicos relevantes',
          description:
            'Según los datos del SMN, no se prevén lluvias intensas ni ' +
            'vientos fuertes en el país al momento de generar el sitio. ' +
            'Consulta el portal del SMN/CONAGUA para avisos vigentes.',
          link: SMN_AVISOS_URL,
          guid: `smn-aviso-none-${new Date().toISOString().slice(0, 10)}`,
          pubDate: new Date().toUTCString(),
        },
      ];
    }
  } catch (error) {
    // Never let an upstream failure break the build: emit a valid feed.
    const message = error instanceof Error ? error.message : String(error);
    // `fetch failed` hides the real reason; surface the underlying cause
    // (notably TLS `UNABLE_TO_VERIFY_LEAF_SIGNATURE` when the SMN CA chain
    // is incomplete and NODE_EXTRA_CA_CERTS was not supplied).
    const cause =
      error instanceof Error && error.cause
        ? ((error.cause as { code?: string; message?: string }).code ??
          (error.cause as { message?: string }).message ??
          String(error.cause))
        : undefined;
    console.warn(
      `[rss.xml] WARNING: SMN source unavailable, RSS feed will contain ` +
        `only the informational fallback item (NOT real avisos). Reason: ` +
        `${message}${cause ? ` (cause: ${cause})` : ''}. If this is a ` +
        `TLS error, ensure NODE_EXTRA_CA_CERTS points at src/data/smn-ca.pem.`,
    );
    items = [fallbackItem()];
  }

  return new Response(renderFeed(items), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
};
