/**
 * Per-state RSS feed renderer (Story 17.2 — plan PRO_GRATIS E17).
 *
 * `/rss/<estado>.xml` is prerendered from public/data/smn-by-state.json
 * so readers, IFTTT-style automations and mail-a-feed services can
 * follow one state's SMN avisos without our site storing anything.
 * Pure: takes the index records, returns RSS 2.0 XML.
 */
export interface StateAviso {
  title: string;
  link: string;
  pubDate: string;
  category?: string;
  severity?: string;
}

export interface StateFeedMeta {
  /** Display name, e.g. "Jalisco" or "Nacional". */
  name: string;
  /** Absolute URL of the page this feed belongs to. */
  pageUrl: string;
  /** Absolute URL of the feed itself. */
  feedUrl: string;
  /** ntfy topic mirroring this feed (shown in the description). */
  topic: string;
  /** RFC 822 build date; falls back to now when absent. */
  lastBuildDate?: string;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderStateFeed(
  items: readonly StateAviso[],
  meta: StateFeedMeta,
  now: Date = new Date(),
): string {
  const build = meta.lastBuildDate?.trim() || now.toUTCString();
  const body = items
    .map((it) => {
      const desc = [it.severity, it.category].filter(Boolean).join(' · ');
      const guid = `${it.link}#${it.pubDate}`;
      return (
        `    <item>\n` +
        `      <title>${escapeXml(it.title)}</title>\n` +
        `      <link>${escapeXml(it.link)}</link>\n` +
        `      <guid isPermaLink="false">${escapeXml(guid)}</guid>\n` +
        (it.pubDate ? `      <pubDate>${escapeXml(it.pubDate)}</pubDate>\n` : '') +
        (it.category ? `      <category>${escapeXml(it.category)}</category>\n` : '') +
        (desc ? `      <description>${escapeXml(desc)}</description>\n` : '') +
        `    </item>`
      );
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `  <channel>\n` +
    `    <title>${escapeXml(`Avisos SMN — ${meta.name} · Clima México`)}</title>\n` +
    `    <link>${escapeXml(meta.pageUrl)}</link>\n` +
    `    <atom:link href="${escapeXml(meta.feedUrl)}" rel="self" type="application/rss+xml" />\n` +
    `    <description>${escapeXml(
      `Avisos meteorológicos del SMN / CONAGUA para ${meta.name}. Mismo canal por notificación push: tópico ntfy "${meta.topic}".`,
    )}</description>\n` +
    `    <language>es-MX</language>\n` +
    `    <lastBuildDate>${escapeXml(build)}</lastBuildDate>\n` +
    (body ? body + '\n' : '') +
    `  </channel>\n` +
    `</rss>\n`
  );
}
