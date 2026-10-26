import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * Cancellation requests. With `token` (the order page) the private order link is the proof;
 * without it the signed-in account must own the order.
 */
export const POST: RequestHandler = async (event) => {
  const { order_id, token, reason } = await event.request.json().catch(() => ({}));
  const id = encodeURIComponent(String(order_id ?? ''));
  return relay(() =>
    token
      ? sf(event, `/orders/${id}/cancellation_request`, {
          method: 'POST',
          body: { token: String(token), reason: String(reason ?? '') },
        })
      : sf(event, `/account/orders/${id}/cancellation_request`, {
          method: 'POST',
          body: { reason: String(reason ?? '') },
        }),
  );
};

export const DELETE: RequestHandler = async (event) => {
  const { order_id, token } = await event.request.json().catch(() => ({}));
  const id = encodeURIComponent(String(order_id ?? ''));
  return relay(() =>
    token
      ? sf(event, `/orders/${id}/cancellation_request?token=${encodeURIComponent(String(token))}`, {
          method: 'DELETE',
        })
      : sf(event, `/account/orders/${id}/cancellation_request`, { method: 'DELETE' }),
  );
};
