import { shop } from '#lib/server/openrent.ts';
import type { RequestHandler } from './$types';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The home page and every public product page, for search engines. The API also lists categories and content pages;
 * the starter has no pages for them, so add them here once it does.
 */
export const GET: RequestHandler = async (event) => {
  const sf = shop(event);
  const urls: string[] = [];
  for (let offset = 0; ; ) {
    const page = await sf.sitemap({ offset, limit: 5000 });
    for (const p of page.data) {
      if (p.path !== '/' && !p.path.startsWith('/p/')) continue;
      const lastmod = p.updated_at ? `<lastmod>${p.updated_at}</lastmod>` : '';
      urls.push(`<url><loc>${xml(event.url.origin + p.path)}</loc>${lastmod}</url>`);
    }
    offset += page.data.length;
    if (!page.data.length || offset >= page.total) break;
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
