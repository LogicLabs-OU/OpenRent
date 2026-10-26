import { relay, sf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Signing page actions: send the emailed code, or sign with it. */
export const POST: RequestHandler = async (event) => {
  const { action, token, code, name, image, consent } = await event.request.json().catch(() => ({}));
  const base = `/signatures/${encodeURIComponent(String(token ?? ''))}/actions`;
  return relay(() =>
    action === 'send_code'
      ? sf(event, `${base}/send_code`, { method: 'POST', body: {} })
      : sf(event, `${base}/sign`, { method: 'POST', body: { code: String(code ?? ''), name: String(name ?? ''), image: image ?? null, consent: consent === true } }),
  );
};
