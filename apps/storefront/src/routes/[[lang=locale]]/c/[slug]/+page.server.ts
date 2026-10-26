import { error } from '@sveltejs/kit';
import { sf, fail, localeQuery } from '#lib/server/api.ts';
import { readDates } from '#lib/server/session.ts';
import { t } from '#lib/i18n/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { shop } = await event.parent();
  const category = shop.categories.find((c) => c.slug === event.params.slug);
  if (!category) error(404, t('error.category_not_found', {}, shop.locale));
  const d = readDates(event.cookies);
  const qs = d.from && d.to ? `&from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}` : '';
  try {
    const r = await sf(event, `/catalog/products?category=${encodeURIComponent(event.params.slug)}&limit=100${qs}${localeQuery(event, '&')}`);
    return { category, products: r.data };
  } catch (e) {
    fail(e);
  }
};
