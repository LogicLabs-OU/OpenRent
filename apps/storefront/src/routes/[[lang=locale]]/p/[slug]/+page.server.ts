import type { Product } from '@openrent/theme-sdk';
import { sf, fail, localeOf, localPath } from '#lib/server/api.ts';
import { breadcrumbLd, productLd, shorten, type PageMeta } from '#lib/meta.ts';
import { readDates } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const d = readDates(event.cookies);
  const params = new URLSearchParams();
  if (d.from && d.to) {
    params.set('from', d.from);
    params.set('to', d.to);
  }
  const locale = localeOf(event);
  if (locale) params.set('locale', locale);
  const qs = params.size ? `?${params}` : '';
  try {
    const [product, { shop, seo }] = await Promise.all([sf<Product>(event, `/catalog/products/${encodeURIComponent(event.params.slug)}${qs}`), event.parent()]);
    const base = seo.base_url.replace(/\/$/, '');
    const url = base + localPath(event, `/p/${product.slug}`);
    const category = shop.categories.find((c) => product.category_ids.includes(c.id));
    const crumbs = [{ name: shop.tenant.name, url: base + localPath(event, '/') }, ...(category ? [{ name: category.name, url: base + localPath(event, `/c/${category.slug}`) }] : []), { name: product.name, url }];
    const meta: PageMeta = {
      title: product.seo?.title || product.name,
      description: product.seo?.description || shorten(product.description),
      image: product.images[0]?.url ?? null,
      type: 'product',
      jsonld: [productLd(product, url, base, shop.tenant.name), breadcrumbLd(crumbs)],
    };
    return { product, meta };
  } catch (e) {
    fail(e);
  }
};
