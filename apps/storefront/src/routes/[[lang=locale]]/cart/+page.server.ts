import { redirect } from '@sveltejs/kit';
import { loadCart } from '#lib/server/cart.ts';
import { sf, localPath } from '#lib/server/api.ts';
import { setCart, writeDates } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  event.depends('or:cart');
  // The embeddable widget hands over a server-created cart: /cart?session=cs_...
  const handoff = event.url.searchParams.get('session');
  if (handoff && /^cs_[0-9A-Za-z]+$/.test(handoff)) {
    const s = await sf(event, `/checkout_sessions/${handoff}`).catch(() => null);
    if (s?.status === 'open') {
      const secure = event.url.protocol === 'https:';
      setCart(event.cookies, s.id, secure);
      if (s.starts_at && s.ends_at) writeDates(event.cookies, s.starts_at, s.ends_at, secure);
    }
    redirect(303, localPath(event, '/cart'));
  }
  return { cart: await loadCart(event) };
};
