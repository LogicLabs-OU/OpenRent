import { error, redirect } from '@sveltejs/kit';
import { OpenRentError } from '@openrent/sdk';
import { shop, shopInfo, cartId, readDates, setCart, setDates } from '#lib/server/openrent.ts';
import { refused } from '#lib/server/errors.ts';
import { defaultPeriod, isoToShopTime, shopTimeToIso } from '#lib/dates.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { shop: s } = await event.parent();
  const dates = readDates(event.cookies);
  try {
    const product = await shop(event, s.lang).product(event.params.slug, dates ?? {});
    const period = dates ? { from: isoToShopTime(dates.from, s.timezone), to: isoToShopTime(dates.to, s.timezone) } : defaultPeriod(s.timezone);
    return { product, period, checked: !!dates };
  } catch (e) {
    if (e instanceof OpenRentError && e.status === 404) error(404, e.message);
    throw e;
  }
};

/** The period from the form, in UTC; null when it is not a period. */
async function period(form: FormData, timezone: string) {
  const from = shopTimeToIso(String(form.get('from') ?? ''), timezone);
  const to = shopTimeToIso(String(form.get('to') ?? ''), timezone);
  return from && to && from < to ? { from, to } : null;
}

export const actions: Actions = {
  /** Shows how many are free in the period. */
  check: async (event) => {
    const s = await shopInfo(event);
    const p = await period(await event.request.formData(), s.timezone);
    if (p) setDates(event, p);
    return { dateError: !p };
  },
  /** Puts it in the cart for the period, starting a cart when there is none. */
  add: async (event) => {
    const s = await shopInfo(event);
    const form = await event.request.formData();
    const p = await period(form, s.timezone);
    if (!p) return { dateError: true };
    setDates(event, p);
    const sf = shop(event, s.lang);
    try {
      let id = cartId(event.cookies);
      const current = id ? await sf.cart.get(id).catch(() => null) : null;
      if (!current || current.status !== 'open') {
        id = (await sf.cart.create({ starts_at: p.from, ends_at: p.to })).id;
        setCart(event, id);
      } else if (current.starts_at !== p.from || current.ends_at !== p.to) {
        await sf.cart.update(id!, { starts_at: p.from, ends_at: p.to });
      }
      await sf.cart.add(id!, String(form.get('variant_id')), Math.max(1, Number(form.get('quantity')) || 1));
    } catch (e) {
      return refused(e);
    }
    redirect(303, '/cart');
  },
};
