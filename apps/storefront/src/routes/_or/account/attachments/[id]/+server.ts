import { error } from '@sveltejs/kit';
import { sfRaw } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** A file the shop shared on one of the signed-in customer's bookings. */
export const GET: RequestHandler = async (event) => {
  const res = await sfRaw(event, `/account/attachments/${encodeURIComponent(event.params.id)}/file`);
  if (!res.ok) error(res.status === 401 ? 404 : res.status, t('error.document'));
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') ?? 'attachment',
      'Cache-Control': 'private, max-age=300',
    },
  });
};
