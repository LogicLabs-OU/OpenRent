import { json } from '@sveltejs/kit';
import { sf, SfError, localeOf, localeQuery } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import { cartId, setCart, writeDates } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** Places the order from the cart. Terms are accepted against the hash of the exact text shown. */
export const POST: RequestHandler = async (event) => {
  const body = await event.request.json();
  const id = cartId(event.cookies);
  if (!id) return json({ message: t('error.cart_empty', {}, localeOf(event) ?? undefined) }, { status: 409 });
  try {
    // The terms shown were in the page's language; emails and documents follow it too.
    const settings = await sf(event, `/settings${localeQuery(event)}`);
    const locale = localeOf(event) ?? settings.default_locale;
    const result = await sf(event, `/checkout_sessions/${id}/actions/complete`, {
      method: 'POST',
      body: { customer: { ...body.customer, locale }, terms_accepted: !!body.terms_accepted, terms_hash: settings.terms.hash, notes: body.notes, extra: body.extra ?? {} },
    });
    setCart(event.cookies, null, event.url.protocol === 'https:');
    writeDates(event.cookies, null, null, event.url.protocol === 'https:');
    return json(result);
  } catch (e) {
    if (e instanceof SfError) return json({ message: e.message, code: e.code, errors: e.body?.errors ?? [] }, { status: e.status });
    throw e;
  }
};
