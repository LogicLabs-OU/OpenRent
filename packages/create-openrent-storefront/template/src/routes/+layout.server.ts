import { shop, shopInfo, cartId, setCart } from '#lib/server/openrent.ts';
import type { LayoutServerLoad } from './$types';

/** The shop's name, currency, time zone and language, and how much is in the cart. */
export const load: LayoutServerLoad = async (event) => {
  const info = await shopInfo(event);
  const lang = info.lang;
  event.locals.lang = lang;
  let cartCount = 0;
  const id = cartId(event.cookies);
  if (id) {
    const cart = await shop(event, lang).cart.get(id).catch(() => null);
    if (cart?.status === 'open') cartCount = cart.lines.reduce((n, l) => n + l.quantity, 0);
    else setCart(event, null);
  }
  return { shop: info, cartCount };
};
