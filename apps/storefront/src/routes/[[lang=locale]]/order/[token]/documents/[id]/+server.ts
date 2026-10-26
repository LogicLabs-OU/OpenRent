import { error } from '@sveltejs/kit';
import { sfRaw } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** PDF of a document of the booking behind this private order link. */
export const GET: RequestHandler = async (event) => {
  const token = encodeURIComponent(event.params.token);
  const res = await sfRaw(
    event,
    `/orders/${token}/documents/${encodeURIComponent(event.params.id)}/pdf?token=${token}`,
  );
  if (!res.ok) error(res.status === 401 ? 404 : res.status, t('error.document'));
  return new Response(res.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': res.headers.get('content-disposition') ?? 'attachment',
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
