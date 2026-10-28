import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Starts the ID check the shop needs before pickup (FR-PAY-9); answers where the customer does it. */
export const POST: RequestHandler = async (event) =>
  relay(() => sf(event, '/account/id_check', { method: 'POST', body: { return_url: `${event.url.origin}/account` } }));
