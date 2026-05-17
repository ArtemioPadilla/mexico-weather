import type { APIRoute } from 'astro';

/**
 * Hand-built sitemap (no @astrojs/sitemap dependency — follows the
 * project's pattern of hand-rolled XML endpoints).
 */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL;
  // Ensure base ends with a single trailing slash for clean joins.
  const basePath = base.endsWith('/') ? base : `${base}/`;

  const pages = ['', 'privacidad/'];
  const urls = pages
    .map((page) => new URL(`${basePath}${page}`, site).href)
    .map((loc) => `  <url>\n    <loc>${loc}</loc>\n  </url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
    },
  });
};
