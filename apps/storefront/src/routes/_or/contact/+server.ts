import { redirect } from '@sveltejs/kit';
import { relay, sf, SfError } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * The contact form section. The runtime sends JSON and shows errors next to the fields; without
 * JavaScript the browser posts the form and comes back to the page with a notice.
 */
export const POST: RequestHandler = async (event) => {
  const type = event.request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const b = await event.request.json().catch(() => ({}));
    return relay(() => sf(event, '/contact', { method: 'POST', body: body(b) }));
  }
  const f = Object.fromEntries(await event.request.formData());
  const back = String(f.back ?? '/');
  const path = back.startsWith('/') && !back.startsWith('//') ? back : '/';
  try {
    await sf(event, '/contact', { method: 'POST', body: body(f) });
  } catch (e) {
    if (!(e instanceof SfError)) throw e;
    redirect(303, `${path}${path.includes('?') ? '&' : '?'}notice=contact_failed`);
  }
  redirect(303, `${path}${path.includes('?') ? '&' : '?'}notice=contact_sent`);
};

function body(b: Record<string, unknown>) {
  const s = (v: unknown, max: number) => String(v ?? '').slice(0, max);
  return { name: s(b.name, 200), email: s(b.email, 254), message: s(b.message, 5000), consent: b.consent ? s(b.consent, 300) : null, consent_required: b.consent_required === true || b.consent_required === '1', website: s(b.website, 200) || null };
}
