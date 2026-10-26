import { sf, fail, localeOf } from '#lib/server/api.ts';
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
    return { product: await sf(event, `/catalog/products/${encodeURIComponent(event.params.slug)}${qs}`) };
  } catch (e) {
    fail(e);
  }
};
