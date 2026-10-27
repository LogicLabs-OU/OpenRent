import { describe, expect, it } from 'vitest';
import { pathsPerFile, robotsTxt, sitemapIndex, urlset } from './sitemap.ts';

describe('sitemap', () => {
  it('lists each page once per language, with every language as an alternate', () => {
    const xml = urlset({ base_url: 'https://rent.example/', default_locale: 'en', locales: ['en', 'de'], total: 2, data: [{ path: '/', updated_at: null }, { path: '/p/tent&poles', updated_at: '2026-10-27T10:00:00.000Z' }] });
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain('<loc>https://rent.example/</loc>');
    expect(xml).toContain('<loc>https://rent.example/de</loc>');
    expect(xml).toContain('<loc>https://rent.example/de/p/tent&amp;poles</loc><lastmod>2026-10-27T10:00:00.000Z</lastmod>');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="de" href="https://rent.example/de/p/tent&amp;poles"/>');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://rent.example/p/tent&amp;poles"/>');
    expect(xml.match(/<url>/g)).toHaveLength(4);
  });

  it('has no alternates for a shop in one language', () => {
    const xml = urlset({ base_url: 'https://rent.example', default_locale: 'en', locales: ['en'], total: 1, data: [{ path: '/c/lenses', updated_at: null }] });
    expect(xml).not.toContain('xhtml');
    expect(xml).toContain('<url><loc>https://rent.example/c/lenses</loc></url>');
  });

  it('splits into numbered files past 50,000 addresses', () => {
    expect(pathsPerFile(1)).toBe(50_000);
    expect(pathsPerFile(3)).toBe(16_666);
    const idx = sitemapIndex('https://rent.example', 2);
    expect(idx).toContain('<sitemapindex');
    expect(idx).toContain('<loc>https://rent.example/sitemap-2.xml</loc>');
  });
});

describe('robots.txt', () => {
  it('opens the shop’s own address apart from private pages in every language, and names the sitemap', () => {
    const txt = robotsTxt({ baseUrl: 'https://rent.example', host: 'rent.example', locales: ['en', 'de'], defaultLocale: 'en' });
    for (const line of ['Disallow: /cart', 'Disallow: /checkout', 'Disallow: /order/', 'Disallow: /account', 'Disallow: /de/cart', 'Disallow: /de/search', 'Disallow: /_or/']) expect(txt).toContain(line);
    expect(txt).not.toContain('Disallow: /\n');
    expect(txt).toContain('Sitemap: https://rent.example/sitemap.xml');
  });

  it('closes every other host that serves the shop', () => {
    expect(robotsTxt({ baseUrl: 'https://rent.example', host: 'acme.shops.example', locales: ['en'], defaultLocale: 'en' })).toBe('User-agent: *\nDisallow: /\n');
  });
});
