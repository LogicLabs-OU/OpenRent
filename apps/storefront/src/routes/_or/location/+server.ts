import { json } from '@sveltejs/kit';
import { sf, SfError } from '#lib/server/api.ts';
import { cartId, setLocation } from '#lib/server/session.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** The location the visitor picks up from: one of the shop's; the cart moves along and is checked there. */
export const POST: RequestHandler = async (event) => {
  const { location_id } = await event.request.json().catch(() => ({}));
  const settings = await sf<{ locations: { id: string }[] }>(event, '/settings');
  if (typeof location_id !== 'string' || !settings.locations.some((l) => l.id === location_id)) {
    return json({ message: t('error.location_unknown'), code: 'invalid_location', errors: [{ field: 'location_id', code: 'invalid', message: t('error.location_unknown') }] }, { status: 422 });
  }
  setLocation(event.cookies, location_id, event.url.protocol === 'https:');
  const id = cartId(event.cookies);
  if (id) {
    try {
      await sf(event, `/checkout_sessions/${id}`, { method: 'PATCH', body: { location_id } });
    } catch (e) {
      if (!(e instanceof SfError)) throw e;
    }
  }
  return json({ location_id });
};
