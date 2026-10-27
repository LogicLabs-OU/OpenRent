import { localPath, sf } from '#lib/server/api.ts';
import { redirect } from '@sveltejs/kit';
import { loadCart } from '#lib/server/cart.ts';
import { accountToken } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const cart = await loadCart(event);
  if (!cart.lines.length || !cart.starts_at) redirect(303, localPath(event, '/cart'));
  // A signed-in business customer may book on account (FR-CUS-7); the checkout slot offers it.
  const b2b = accountToken(event.cookies) ? await sf(event, '/account/b2b').catch(() => null) : null;
  // A signed-in customer picks saved billing details (ADR 0012) in the checkout slot.
  const billingProfiles = accountToken(event.cookies) ? ((await sf(event, '/account/billing_profiles').catch(() => null))?.data ?? []) : null;
  // Saved delivery addresses, to deliver to without typing.
  const savedAddresses = accountToken(event.cookies) ? ((await sf(event, '/account/addresses').catch(() => null))?.data ?? []) : [];
  return { cart, b2b, billingProfiles, savedAddresses };
};
