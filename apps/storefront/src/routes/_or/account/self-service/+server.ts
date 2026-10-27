import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Cancelling or moving one of the customer's bookings themselves, as the shop allows. */
export const POST: RequestHandler = async (event) => {
  const b = await event.request.json().catch(() => ({}));
  const id = encodeURIComponent(String(b.order_id ?? ''));
  if (b.action === 'cancel') return relay(() => sf(event, `/account/orders/${id}/actions/cancel`, { method: 'POST', body: { reason: String(b.reason ?? '').slice(0, 500) } }));
  return relay(() =>
    sf(event, `/account/orders/${id}/actions/change_dates`, {
      method: 'POST',
      body: { starts_at: String(b.starts_at ?? ''), ends_at: String(b.ends_at ?? ''), reason: String(b.reason ?? '').slice(0, 1000), dry_run: b.dry_run === true },
    }),
  );
};
