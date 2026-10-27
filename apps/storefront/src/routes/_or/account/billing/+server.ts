import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Saved billing details (`what: 'profile'`) and delivery addresses (`what: 'address'`) of the signed-in customer. */
const base = (what: unknown) => (what === 'address' ? '/account/addresses' : '/account/billing_profiles');
const id = (v: unknown) => (typeof v === 'string' && /^[a-z]{3}_[0-9A-Za-z]+$/.test(v) ? v : '');

export const POST: RequestHandler = async (event) => {
  const b = await event.request.json().catch(() => ({}));
  const path = id(b.id) ? `${base(b.what)}/${id(b.id)}` : base(b.what);
  return relay(() => sf(event, path, { method: id(b.id) ? 'PATCH' : 'POST', body: b.data ?? {} }));
};

export const DELETE: RequestHandler = async (event) => {
  const b = await event.request.json().catch(() => ({}));
  return relay(() => sf(event, `${base(b.what)}/${id(b.id)}`, { method: 'DELETE' }));
};
