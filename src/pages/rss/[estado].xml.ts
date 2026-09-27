import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import { MX_STATES } from '../../lib/mx-states';
import { renderStateFeed, type StateAviso } from '../../lib/state-feed';

export const prerender = true;

/**
 * `/rss/<estado>.xml` — one RSS 2.0 feed per state, plus `/rss/nacional.xml`
 * for the avisos that name no state (Story 17.2, plan PRO_GRATIS E17).
 *
 * Prerendered at build time from public/data/smn-by-state.json, the
 * per-state index that smn-rss.yml regenerates hourly (and which then
 * dispatches CD, so these feeds refresh with it). Each feed mirrors an
 * ntfy topic (`climamx-smn-<estado>` / `climamx-smn`) — same events,
 * two delivery channels, nothing stored about the reader.
 */

interface StateIndex {
  metadata?: { updated?: string };
  byState?: Record<string, StateAviso[]>;
  global?: StateAviso[];
}

function loadIndex(): StateIndex {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '../../../public/data/smn-by-state.json');
    return JSON.parse(readFileSync(path, 'utf-8')) as StateIndex;
  } catch {
    return {};
  }
}

const SITE = 'https://artemiop.com/mexico-weather';

export const getStaticPaths: GetStaticPaths = () => [
  { params: { estado: 'nacional' } },
  ...MX_STATES.map((s) => ({ params: { estado: s.slug } })),
];

export const GET: APIRoute = ({ params }) => {
  const slug = String(params.estado ?? '');
  const index = loadIndex();
  const state = MX_STATES.find((s) => s.slug === slug);
  const isNational = slug === 'nacional';
  if (!state && !isNational) {
    return new Response('Not found', { status: 404 });
  }
  const items = isNational
    ? (index.global ?? [])
    : (index.byState?.[slug] ?? []);
  const xml = renderStateFeed(items, {
    name: isNational ? 'Nacional' : state!.name,
    pageUrl: isNational ? `${SITE}/` : `${SITE}/estado/${slug}/`,
    feedUrl: `${SITE}/rss/${slug}.xml`,
    topic: isNational ? 'climamx-smn' : `climamx-smn-${slug}`,
    lastBuildDate: index.metadata?.updated,
  });
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
};
