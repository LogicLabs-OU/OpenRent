import { expect, type Page } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

/** The structured data of the open page, parsed. */
async function jsonLd(page: Page): Promise<any[]> {
  return (await page.locator('script[type="application/ld+json"]').allTextContents()).map((s) => JSON.parse(s));
}

test('staff write search engine texts, and shoppers’ pages carry titles, previews, structured data and a sitemap', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const n = Date.now() % 100000;
  const homeTitle = `Rentals by the lake ${n}`;
  const outdoor = (await call(page, 'GET', '/categories?limit=200')).data.find((c: { slug: string }) => c.slug === 'outdoor');
  try {
    // The home page's texts and the picture for shared links.
    await page.goto(`${ADMIN}/themes`);
    const card = page.getByTestId('seo-settings');
    await card.getByLabel('Search title').first().fill(homeTitle);
    await card.getByLabel('Search description').first().fill('Kayaks, bikes and cameras by the day.');
    await card.getByLabel('Picture for shared links').fill('http://cdn.example/share.jpg');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByText('Enter the address of an image, starting with https://')).toBeVisible();
    await card.getByLabel('Picture for shared links').fill('https://cdn.example/share.jpg');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();

    // A category's own title.
    await page.goto(`${ADMIN}/categories`);
    await page.getByRole('button', { name: 'Edit Outdoor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Search title').first().fill(`Outdoor gear ${n}`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    const shopper = await browser.newPage();
    try {
      await shopper.goto(`${STORE}/`);
      await expect(shopper).toHaveTitle(homeTitle);
      await expect(shopper.locator('meta[name="description"]')).toHaveAttribute('content', 'Kayaks, bikes and cameras by the day.');
      await expect(shopper.locator('link[rel="canonical"]')).toHaveAttribute('href', `${STORE}/`);
      await expect(shopper.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://cdn.example/share.jpg');
      const home = await jsonLd(shopper);
      expect(home.map((x) => x['@type'])).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
      expect(home.find((x) => x['@type'] === 'WebSite').potentialAction.target.urlTemplate).toBe(`${STORE}/search?q={search_term_string}`);

      await shopper.goto(`${STORE}/c/outdoor`);
      await expect(shopper).toHaveTitle(new RegExp(`^Outdoor gear ${n} · `));
      expect((await jsonLd(shopper)).find((x) => x['@type'] === 'BreadcrumbList').itemListElement.map((i: any) => i.item)).toEqual([`${STORE}/`, `${STORE}/c/outdoor`]);

      await shopper.goto(`${STORE}/p/sea-kayak`);
      await expect(shopper).toHaveTitle(/^Sea kayak · /);
      await expect(shopper.locator('meta[property="og:type"]')).toHaveAttribute('content', 'product');
      await expect(shopper.locator('link[rel="canonical"]')).toHaveAttribute('href', `${STORE}/p/sea-kayak`);
      const product = (await jsonLd(shopper)).find((x) => x['@type'] === 'Product');
      expect(product).toMatchObject({ name: 'Sea kayak', url: `${STORE}/p/sea-kayak`, offers: { '@type': 'Offer', businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut' } });
      expect(Number(product.offers.price)).toBeGreaterThan(0);

      // Carts and search stay out of search engines, by meta tag and header.
      const cart = await shopper.goto(`${STORE}/cart`);
      expect(cart!.headers()['x-robots-tag']).toBe('noindex, nofollow');
      await expect(shopper.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      expect(await shopper.locator('link[rel="canonical"]').count()).toBe(0);

      const sitemap = await shopper.request.get(`${STORE}/sitemap.xml`);
      expect(sitemap.headers()['content-type']).toContain('application/xml');
      const xml = await sitemap.text();
      expect(xml).toContain(`<loc>${STORE}/p/sea-kayak</loc>`);
      expect(xml).toContain(`<loc>${STORE}/c/outdoor</loc>`);
      const robots = await (await shopper.request.get(`${STORE}/robots.txt`)).text();
      expect(robots).toContain('Disallow: /checkout');
      expect(robots).toContain(`Sitemap: ${STORE}/sitemap.xml`);
    } finally {
      await shopper.close();
    }
  } finally {
    await call(page, 'PATCH', '/tenant/settings', { seo: { title: null, description: null, image_url: null } });
    if (outdoor) await call(page, 'PATCH', `/categories/${outdoor.id}`, { seo: outdoor.seo ?? {} });
  }
  expect(errors).toEqual([]);
});
