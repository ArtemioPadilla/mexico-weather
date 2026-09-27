import { describe, expect, it } from 'vitest';
import { renderStateFeed } from './state-feed';

const meta = {
  name: 'Jalisco',
  pageUrl: 'https://artemiop.com/mexico-weather/estado/jalisco/',
  feedUrl: 'https://artemiop.com/mexico-weather/rss/jalisco.xml',
  topic: 'climamx-smn-jalisco',
  lastBuildDate: 'Sun, 27 Sep 2026 06:00:00 +0000',
};

describe('renderStateFeed', () => {
  it('renders a valid RSS 2.0 skeleton with self link and ntfy topic', () => {
    const xml = renderStateFeed([], meta);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<title>Avisos SMN — Jalisco · Clima México</title>');
    expect(xml).toContain('rel="self"');
    expect(xml).toContain('climamx-smn-jalisco');
    expect(xml).toContain('<lastBuildDate>Sun, 27 Sep 2026 06:00:00 +0000</lastBuildDate>');
    expect(xml).not.toContain('<item>');
  });

  it('renders one item per aviso, escaped, with a stable guid', () => {
    const xml = renderStateFeed(
      [
        {
          title: 'Lluvias & rachas en Jalisco (centro)',
          link: 'https://smn.conagua.gob.mx/es/?a=1&b=2',
          pubDate: 'Sun, 27 Sep 2026 05:00:00 +0000',
          category: 'Aviso',
          severity: 'Alerta naranja',
        },
      ],
      meta,
    );
    expect(xml).toContain('<title>Lluvias &amp; rachas en Jalisco (centro)</title>');
    expect(xml).toContain('<link>https://smn.conagua.gob.mx/es/?a=1&amp;b=2</link>');
    expect(xml).toContain('<guid isPermaLink="false">');
    expect(xml).toContain('<description>Alerta naranja · Aviso</description>');
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });
});
