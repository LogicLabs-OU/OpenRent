import { shop, readDates } from '#lib/server/openrent.ts';
import type { PageServerLoad } from './$types';

/** Every public product; with a chosen period, how many are free then. */
export const load: PageServerLoad = async (event) => {
  const { shop: s } = await event.parent();
  const dates = readDates(event.cookies);
  const products = await shop(event, s.lang).products({ limit: 48, ...(dates ? { from: dates.from, to: dates.to } : {}) });
  return { products: products.data, dates };
};
