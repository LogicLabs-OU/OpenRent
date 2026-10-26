import type { SearchData } from '@openrent/theme-sdk';
import { sf, fail, localeOf } from '#lib/server/api.ts';
import { readDates } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

const SORTS = ['relevance', 'name', 'newest'] as const;

/** Catalogue search: `?q=&category=&available=1&sort=`. The availability filter needs chosen dates. */
export const load: PageServerLoad = async (event) => {
  const p = event.url.searchParams;
  const query = (p.get('q') ?? '').trim().slice(0, 100);
  const category = p.get('category') || null;
  const sort = (SORTS as readonly string[]).includes(p.get('sort') ?? '')
    ? (p.get('sort') as SearchData['sort'])
    : 'relevance';
  const d = readDates(event.cookies);
  const available = ['1', 'on', 'true'].includes(p.get('available') ?? '') && !!d.from && !!d.to;
  const qs = new URLSearchParams({ limit: '100', sort });
  if (query) qs.set('q', query);
  if (category) qs.set('category', category);
  if (d.from && d.to) {
    qs.set('from', d.from);
    qs.set('to', d.to);
  }
  if (available) qs.set('available', 'true');
  const locale = localeOf(event);
  if (locale) qs.set('locale', locale);
  try {
    const r = await sf(event, `/catalog/products?${qs}`);
    return { query, category, available, sort, products: r.data } satisfies SearchData;
  } catch (e) {
    fail(e);
  }
};
