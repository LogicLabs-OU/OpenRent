import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const body = await event.request.json().catch(() => ({}));
  const pick = Object.fromEntries(
    ['name', 'phone', 'locale', 'marketing_consent'].filter((k) => k in body).map((k) => [k, body[k]]),
  );
  return relay(() => sf(event, '/account', { method: 'PATCH', body: pick }));
};
