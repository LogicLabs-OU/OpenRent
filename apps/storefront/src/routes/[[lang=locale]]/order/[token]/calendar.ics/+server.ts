import { error } from '@sveltejs/kit';
import { sfRaw, localeOf } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** The booking's pickup and return for the customer's calendar; the private order link is the proof. */
export const GET: RequestHandler = async (event) => {
  const token = encodeURIComponent(event.params.token);
  const locale = localeOf(event);
  const res = await sfRaw(event, `/orders/${token}/calendar?token=${token}${locale ? `&locale=${locale}` : ''}`);
  if (!res.ok) error(res.status === 401 ? 404 : res.status, t('error.page_not_found'));
  return new Response(res.body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': res.headers.get('content-disposition') ?? 'attachment; filename="booking.ics"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
};
