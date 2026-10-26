import { relay, sf } from '#lib/server/api.ts';
import { setAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) =>
  relay(async () => {
    await sf(event, '/account/logout', { method: 'POST', body: {} }).catch(() => undefined);
    setAccount(event.cookies, null, event.url.protocol === 'https:');
    return { ok: true };
  });
