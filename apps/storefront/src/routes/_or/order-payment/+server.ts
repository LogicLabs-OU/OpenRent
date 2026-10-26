import { json } from '@sveltejs/kit';
import { sf, SfError } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** New online payment attempt for an unpaid order, identified by its public token. */
export const POST: RequestHandler = async (event) => {
  const { token } = await event.request.json();
  if (typeof token !== 'string' || token.length < 16) return json({ message: t('error.invalid_token'), code: 'invalid_token' }, { status: 422 });
  try {
    return json(await sf(event, `/orders/${encodeURIComponent(token)}/payment_intents`, { method: 'POST', body: { token } }));
  } catch (e) {
    if (e instanceof SfError) return json({ message: e.message, code: e.code, errors: e.body?.errors ?? [] }, { status: e.status });
    throw e;
  }
};
