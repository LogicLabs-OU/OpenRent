import { redirect } from '@sveltejs/kit';
import { localPath, sf } from '#lib/server/api.ts';
import { setCart, writeDates } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The link in an abandoned-cart reminder (FR-SF-9): the cart comes back and the customer lands on it. */
export const GET: RequestHandler = async (event) => {
  const token = event.url.searchParams.get('token') ?? '';
  const secure = event.url.protocol === 'https:';
  const restored = await sf<{ id: string }>(event, '/checkout_sessions/restore', { method: 'POST', body: { token } }).catch(() => null);
  if (!restored) redirect(303, `${localPath(event, '/cart')}?notice=cart_link_expired`);
  setCart(event.cookies, restored.id, secure);
  const cart = await sf<{ starts_at: string | null; ends_at: string | null }>(event, `/checkout_sessions/${restored.id}`);
  writeDates(event.cookies, cart.starts_at, cart.ends_at, secure);
  redirect(303, `${localPath(event, '/cart')}?notice=${cart.starts_at ? 'cart_restored' : 'cart_restored_pick_dates'}`);
};
