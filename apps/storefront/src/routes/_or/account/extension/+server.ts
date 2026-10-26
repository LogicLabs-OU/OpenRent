import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * Requests to keep a booking longer. With `token` (the order page) the private order link is the proof;
 * without it the signed-in account must own the order.
 */
export const POST: RequestHandler = async (event) => {
  const { order_id, token, ends_at, reason } = await event.request.json().catch(() => ({}));
  const id = encodeURIComponent(String(order_id ?? ''));
  const body = { ends_at: String(ends_at ?? ''), reason: String(reason ?? '') };
  return relay(() =>
    token
      ? sf(event, `/orders/${id}/extension_request`, { method: 'POST', body: { ...body, token: String(token) } })
      : sf(event, `/account/orders/${id}/extension_request`, { method: 'POST', body }),
  );
};

export const DELETE: RequestHandler = async (event) => {
  const { order_id, token } = await event.request.json().catch(() => ({}));
  const id = encodeURIComponent(String(order_id ?? ''));
  return relay(() =>
    token
      ? sf(event, `/orders/${id}/extension_request?token=${encodeURIComponent(String(token))}`, { method: 'DELETE' })
      : sf(event, `/account/orders/${id}/extension_request`, { method: 'DELETE' }),
  );
};
