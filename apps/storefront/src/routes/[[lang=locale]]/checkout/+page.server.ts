import { localPath } from '#lib/server/api.ts';
import { redirect } from '@sveltejs/kit';
import { loadCart } from '#lib/server/cart.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const cart = await loadCart(event);
  if (!cart.lines.length || !cart.starts_at) redirect(303, localPath(event, '/cart'));
  return { cart };
};
