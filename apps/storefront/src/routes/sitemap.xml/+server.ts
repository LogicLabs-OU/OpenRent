import { sf, fail } from '#lib/server/api.ts';
import { pathsPerFile, sitemapIndex, urlset, type SitemapPage } from '#lib/server/sitemap.ts';
import type { RequestHandler } from './$types';

const XML = { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' };

/** The sitemap: every page in every language; past 50,000 addresses, an index of numbered files. */
export const GET: RequestHandler = async (event) => {
  try {
    const head = await sf<SitemapPage>(event, '/sitemap?limit=1');
    const per = pathsPerFile(head.locales.length);
    if (head.total > per) return new Response(sitemapIndex(head.base_url, Math.ceil(head.total / per)), { headers: XML });
    return new Response(urlset(await sf<SitemapPage>(event, `/sitemap?limit=${per}`)), { headers: XML });
  } catch (e) {
    fail(e);
  }
};
