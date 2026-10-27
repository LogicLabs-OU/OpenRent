import { json } from '@sveltejs/kit';
import { setCurrency } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** Remembers the currency the visitor wants to see prices in (FR-I18N-7); the shop's own is still charged. */
export const POST: RequestHandler = async (event) => {
  const { currency } = await event.request.json().catch(() => ({}));
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return json({ message: 'currency' }, { status: 422 });
  setCurrency(event.cookies, currency, event.url.protocol === 'https:');
  return json({ currency });
};
