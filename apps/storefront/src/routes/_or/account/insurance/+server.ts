import { json } from '@sveltejs/kit';
import { portal, relay } from '#lib/server/api.ts';
import { t } from '#lib/i18n/index.ts';
import type { RequestHandler } from './$types';

/** Uploads an insurance certificate for the signed-in customer (FR-PAY-8), as multipart/form-data. */
export const POST: RequestHandler = async (event) => {
  const form = await event.request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !file.size) return json({ message: t('account.insurance.choose'), code: 'validation_error', errors: [{ field: 'file', code: 'required', message: t('account.insurance.choose') }] }, { status: 422 });
  const out = new FormData();
  out.set('label', String(form?.get('label') ?? ''));
  out.set('file', file, file.name);
  return relay(() => portal(event, '/insurance', { method: 'POST', body: out }));
};
