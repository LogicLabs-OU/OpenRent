import { redirect } from '@sveltejs/kit';
import { shop, shopInfo, cartId, setCart, setDates } from '#lib/server/openrent.ts';
import { refused } from '#lib/server/errors.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { shop: s } = await event.parent();
  const id = cartId(event.cookies);
  const sf = shop(event, s.lang);
  const cart = id ? await sf.cart.get(id).catch(() => null) : null;
  if (!cart || cart.status !== 'open' || !cart.lines.length) redirect(303, '/cart');
  const settings = await sf.settings();
  return { cart, terms: settings.terms };
};

export const actions: Actions = {
  /** Places the booking, accepting the exact terms shown; online payment goes on to the shop's payment page. */
  place: async (event) => {
    const s = await shopInfo(event);
    const id = cartId(event.cookies);
    if (!id) redirect(303, '/cart');
    const form = await event.request.formData();
    const values = { name: String(form.get('name') ?? ''), email: String(form.get('email') ?? ''), phone: String(form.get('phone') ?? ''), notes: String(form.get('notes') ?? '') };
    const sf = shop(event, s.lang);
    let result;
    try {
      const { terms } = await sf.settings();
      result = await sf.cart.complete(id, {
        customer: { name: values.name, email: values.email, ...(values.phone ? { phone: values.phone } : {}), locale: s.lang },
        terms_accepted: form.get('terms') === 'on',
        terms_hash: terms.hash,
        ...(values.notes ? { notes: values.notes } : {}),
        return_url: `${event.url.origin}/order`,
      });
    } catch (e) {
      return refused(e, values);
    }
    setCart(event, null);
    setDates(event, null);
    if (result.payment?.object === 'payment_redirect') redirect(303, result.payment.url);
    redirect(303, `/order/${result.order.token}`);
  },
};
