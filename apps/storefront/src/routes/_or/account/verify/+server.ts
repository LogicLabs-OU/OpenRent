import { relay, sf } from '#lib/server/api.ts';
import { setAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** Completes sign-in with the emailed token and keeps the session in an httpOnly cookie. */
export const POST: RequestHandler = async (event) => {
  const { token } = await event.request.json().catch(() => ({}));
  return relay(async () => {
    const s = await sf<{ token: string }>(event, '/account/verify', {
      method: 'POST',
      body: { token: String(token ?? '') },
    });
    setAccount(event.cookies, s.token, event.url.protocol === 'https:');
    return { ok: true };
  });
};
