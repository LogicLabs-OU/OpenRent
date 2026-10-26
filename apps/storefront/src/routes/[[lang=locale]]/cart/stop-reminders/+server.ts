import { redirect } from '@sveltejs/kit';
import { localPath, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** "No more cart reminders" from a reminder email (FR-SF-9). */
export const GET: RequestHandler = async (event) => {
  const token = event.url.searchParams.get('token') ?? '';
  const ok = await sf(event, '/cart_reminders/opt_out', { method: 'POST', body: { token } }).then(() => true, () => false);
  redirect(303, `${localPath(event, '/')}?notice=${ok ? 'reminders_stopped' : 'cart_link_expired'}`);
};
