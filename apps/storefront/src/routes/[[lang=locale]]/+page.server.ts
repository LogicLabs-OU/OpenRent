import { sf, fail, localeQuery } from '#lib/server/api.ts';
import { readDates } from '#lib/server/session.ts';
import { themeFor } from '#lib/themes.ts';
import { resolveSections } from '@openrent/theme-sdk';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { themeId, themeSections, themeContent } = await event.parent();
  const sections = resolveSections(themeFor(themeId), themeSections, themeContent);
  const d = readDates(event.cookies);
  const qs = d.from && d.to ? `&from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}` : '';
  try {
    const r = await sf(event, `/catalog/products?limit=100${qs}${localeQuery(event, '&')}`);
    return { products: r.data, sections };
  } catch (e) {
    fail(e);
  }
};
