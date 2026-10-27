import { error } from '@sveltejs/kit';
import { sf, fail } from '#lib/server/api.ts';
import { pathsPerFile, urlset, type SitemapPage } from '#lib/server/sitemap.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** One numbered file of a large shop's sitemap (see /sitemap.xml). */
export const GET: RequestHandler = async (event) => {
  const n = Number(event.params.n);
  if (!Number.isInteger(n) || n < 1) error(404, t('error.page_not_found'));
  let page: SitemapPage;
  try {
    const head = await sf<SitemapPage>(event, '/sitemap?limit=1');
    const per = pathsPerFile(head.locales.length);
    if ((n - 1) * per >= head.total) error(404, t('error.page_not_found'));
    page = await sf<SitemapPage>(event, `/sitemap?offset=${(n - 1) * per}&limit=${per}`);
  } catch (e) {
    fail(e);
  }
  return new Response(urlset(page), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
};
