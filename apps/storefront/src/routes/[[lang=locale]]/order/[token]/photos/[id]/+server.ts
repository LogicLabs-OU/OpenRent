import { error } from '@sveltejs/kit';
import { sfRaw } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** A photo of a damage charge on the booking behind this private order link. */
export const GET: RequestHandler = async (event) => {
  const token = encodeURIComponent(event.params.token);
  const res = await sfRaw(event, `/orders/${token}/damage_photos/${encodeURIComponent(event.params.id)}?token=${token}`);
  if (!res.ok) error(res.status === 401 ? 404 : res.status, t('error.document'));
  return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/webp', 'Cache-Control': 'private, max-age=3600' } });
};
