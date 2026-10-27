import { json } from '@sveltejs/kit';
import { sf, SfError } from '#lib/server/api.ts';
import { setCart } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** A new cart with the items of one of the customer's bookings; it replaces the current cart. */
export const POST: RequestHandler = async (event) => {
  const { order_id } = await event.request.json().catch(() => ({}));
  try {
    const r = await sf<{ cart_id: string; skipped: string[] }>(event, `/account/orders/${encodeURIComponent(String(order_id ?? ''))}/actions/book_again`, { method: 'POST', body: {} });
    setCart(event.cookies, r.cart_id, event.url.protocol === 'https:');
    return json({ skipped: r.skipped });
  } catch (e) {
    if (e instanceof SfError) return json({ message: e.message, code: e.code, errors: e.body?.errors ?? [] }, { status: e.status });
    throw e;
  }
};
