import { error } from '@sveltejs/kit';
import { sf, fail, localeQuery, localPath } from '#lib/server/api.ts';
import { categoryMeta } from '#lib/meta.ts';
import { readDates } from '#lib/server/session.ts';
import { t } from '#lib/i18n/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { shop, seo } = await event.parent();
  const category = shop.categories.find((c) => c.slug === event.params.slug);
  if (!category) error(404, t('error.category_not_found', {}, shop.locale));
  const d = readDates(event.cookies);
  const qs = d.from && d.to ? `&from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}` : '';
  try {
    const r = await sf(event, `/catalog/products?category=${encodeURIComponent(event.params.slug)}&limit=100${qs}${localeQuery(event, '&')}`);
    const base = seo.base_url.replace(/\/$/, '');
    const meta = categoryMeta(category, [
      { name: shop.tenant.name, url: base + localPath(event, '/') },
      { name: category.name, url: base + localPath(event, `/c/${category.slug}`) },
    ]);
    return { category, products: r.data, meta };
  } catch (e) {
    fail(e);
  }
};
