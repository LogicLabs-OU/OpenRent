import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Asks the API to email a sign-in link; the answer is the same whether or not the email has bookings. */
export const POST: RequestHandler = async (event) => {
  const { email } = await event.request.json().catch(() => ({}));
  return relay(() => sf(event, '/account/login', { method: 'POST', body: { email: String(email ?? '') } }));
};
