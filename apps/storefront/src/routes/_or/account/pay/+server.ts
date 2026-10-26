import { portal, relay } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * Starts paying what is left on one of the signed-in customer's bookings (FR-CUS-6). The answer names
 * the booking's own page, where the payment form takes over.
 */
export const POST: RequestHandler = async (event) => {
  const { order_id } = await event.request.json().catch(() => ({}));
  const id = encodeURIComponent(String(order_id ?? ''));
  return relay(async () => {
    await portal(event, `/orders/${id}/payment_intents`, { method: 'POST' });
    const o = await portal<{ token: string }>(event, `/orders/${id}`);
    return { ok: true, order_url: `/order/${o.token}` };
  });
};
