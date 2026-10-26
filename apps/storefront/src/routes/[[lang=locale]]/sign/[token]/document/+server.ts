import { error } from '@sveltejs/kit';
import { sfRaw } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** The document to sign, as the shop issued it, shown in a frame on the signing page. */
export const GET: RequestHandler = async (event) => {
  const res = await sfRaw(event, `/signatures/${encodeURIComponent(event.params.token)}/document`);
  if (!res.ok) error(res.status === 401 ? 404 : res.status, t('error.document'));
  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:",
    },
  });
};
