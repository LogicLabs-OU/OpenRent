import { json } from '@sveltejs/kit';
import { writeDates, cartId } from '#lib/server/session.ts';
import { sf } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const { from, to } = await event.request.json();
  const valid = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
  if ((from || to) && (!valid(from) || !valid(to) || Date.parse(to) <= Date.parse(from))) return json({ message: t('error.dates_invalid'), code: 'invalid_dates', errors: [{ field: 'dates', code: 'invalid', message: t('error.dates_invalid') }] }, { status: 422 });
  writeDates(event.cookies, from ?? null, to ?? null, event.url.protocol === 'https:');
  const id = cartId(event.cookies);
  if (id && from && to) await sf(event, `/checkout_sessions/${id}`, { method: 'PATCH', body: { starts_at: from, ends_at: to } }).catch(() => undefined);
  return json({ from, to });
};
