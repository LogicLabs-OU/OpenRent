import { json } from '@sveltejs/kit';
import { sf, SfError, localeOf } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  try {
    // Line names in the page's language.
    return json(await sf(event, '/price_quote', { method: 'POST', body: { ...(await event.request.json()), locale: localeOf(event) ?? undefined } }));
  } catch (e) {
    if (e instanceof SfError) return json({ message: e.body?.errors?.[0]?.message ?? e.message }, { status: e.status });
    throw e;
  }
};
