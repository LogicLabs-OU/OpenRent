import { sf } from '#lib/server/api.ts';
import { robotsTxt, type SitemapPage } from '#lib/server/sitemap.ts';
import type { RequestHandler } from './$types';

/** Crawling rules for this host: the shop's own address is open apart from private pages, other hosts are closed. */
export const GET: RequestHandler = async (event) => {
  const head = await sf<SitemapPage>(event, '/sitemap?limit=1').catch(() => null);
  const body = head ? robotsTxt({ baseUrl: head.base_url, host: event.url.host, locales: head.locales, defaultLocale: head.default_locale }) : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
};
