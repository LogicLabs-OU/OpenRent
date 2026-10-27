import { switchLocalePath } from '../runtime.ts';

/** One sitemap file holds at most this many addresses (the sitemaps.org limit). */
export const PER_FILE = 50_000;

export interface SitemapPage {
  base_url: string;
  default_locale: string;
  locales: string[];
  total: number;
  data: { path: string; updated_at: string | null }[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const trim = (base: string) => base.replace(/\/$/, '');

/** Paths per sitemap file: every path is listed once per language. */
export const pathsPerFile = (locales: number) => Math.max(1, Math.floor(PER_FILE / Math.max(1, locales)));

/** A `<urlset>`: each path in each language, with the other languages as alternates. */
export function urlset(page: SitemapPage): string {
  const base = trim(page.base_url);
  const multi = page.locales.length > 1;
  const urls = page.data.flatMap((e) =>
    page.locales.map((l) => {
      const loc = base + switchLocalePath(l, page.default_locale, e.path);
      const alternates = multi
        ? [...page.locales.map((a) => `<xhtml:link rel="alternate" hreflang="${esc(a)}" href="${esc(base + switchLocalePath(a, page.default_locale, e.path))}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(base + switchLocalePath(page.default_locale, page.default_locale, e.path))}"/>`].join('')
        : '';
      return `<url><loc>${esc(loc)}</loc>${e.updated_at ? `<lastmod>${esc(e.updated_at)}</lastmod>` : ''}${alternates}</url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${multi ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}>\n${urls.join('\n')}\n</urlset>\n`;
}

/** A sitemap index pointing to `/sitemap-1.xml` … `/sitemap-<files>.xml`. */
export function sitemapIndex(baseUrl: string, files: number): string {
  const base = trim(baseUrl);
  const items = Array.from({ length: files }, (_, i) => `<sitemap><loc>${esc(`${base}/sitemap-${i + 1}.xml`)}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`;
}

const PRIVATE = ['/cart', '/checkout', '/order/', '/sign/', '/account', '/search', '/_or/'];

/**
 * The shop's own address may be crawled, apart from carts, private links, the account and search (in
 * every language); any other host serving this shop (previews, the platform address) may not.
 */
export function robotsTxt(o: { baseUrl: string; host: string; locales: string[]; defaultLocale: string }): string {
  let own: boolean;
  try {
    own = new URL(o.baseUrl).host === o.host;
  } catch {
    own = false;
  }
  if (!own) return 'User-agent: *\nDisallow: /\n';
  const prefixes = ['', ...o.locales.filter((l) => l !== o.defaultLocale).map((l) => `/${l}`)];
  const lines = prefixes.flatMap((p) => PRIVATE.filter((x) => !(p && x === '/_or/')).map((x) => `Disallow: ${p}${x}`));
  return `User-agent: *\n${lines.join('\n')}\n\nSitemap: ${trim(o.baseUrl)}/sitemap.xml\n`;
}
