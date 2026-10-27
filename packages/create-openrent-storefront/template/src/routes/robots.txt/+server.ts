import type { RequestHandler } from './$types';

/** Keeps the cart, checkout and booking pages out of search engines and points them to the sitemap. */
export const GET: RequestHandler = ({ url }) =>
  new Response(['User-agent: *', 'Disallow: /cart', 'Disallow: /checkout', 'Disallow: /order', '', `Sitemap: ${url.origin}/sitemap.xml`, ''].join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
