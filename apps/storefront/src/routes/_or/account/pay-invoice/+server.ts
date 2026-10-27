import { portal, relay } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Starts paying one of the customer's monthly invoices as a whole (ADR 0012). */
export const POST: RequestHandler = async (event) => {
  const { invoice_id } = await event.request.json().catch(() => ({}));
  return relay(() => portal(event, `/invoices/${encodeURIComponent(String(invoice_id ?? ''))}/payment_intents`, { method: 'POST' }));
};
