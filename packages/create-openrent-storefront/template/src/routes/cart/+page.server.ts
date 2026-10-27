import { shop, shopInfo, cartId, setCart } from '#lib/server/openrent.ts';
import { refused } from '#lib/server/errors.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { shop: s } = await event.parent();
  const id = cartId(event.cookies);
  const cart = id ? await shop(event, s.lang).cart.get(id).catch(() => null) : null;
  return { cart: cart?.status === 'open' ? cart : null };
};

export const actions: Actions = {
  /** New quantities for the lines; 0 or the line's remove button takes it out. */
  update: async (event) => {
    const s = await shopInfo(event);
    const id = cartId(event.cookies);
    if (!id) return;
    const form = await event.request.formData();
    const sf = shop(event, s.lang);
    try {
      const cart = await sf.cart.get(id);
      // Not "remove": a form field of that name would hide the form's own remove().
      const drop = form.get('drop');
      const lines = cart.lines
        .map((l) => ({ variant_id: l.variant_id, quantity: l.variant_id === drop ? 0 : Math.max(0, Number(form.get(`qty:${l.variant_id}`) ?? l.quantity) || 0) }))
        .filter((l) => l.quantity > 0);
      await sf.cart.update(id, { lines });
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && e.status === 404) return setCart(event, null);
      return refused(e);
    }
  },
};
