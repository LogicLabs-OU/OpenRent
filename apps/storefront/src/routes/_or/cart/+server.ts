import { json } from '@sveltejs/kit';
import { sf, SfError } from '#lib/server/api.ts';
import { cartId, readDates, setCart } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** Adds, sets or removes a cart line, applies a coupon or sets the options. The cart is a server-side checkout session. */
export const POST: RequestHandler = async (event) => {
  const body = await event.request.json();
  const secure = event.url.protocol === 'https:';
  const dates = readDates(event.cookies);
  try {
    let id = cartId(event.cookies);
    let session = id ? await sf(event, `/checkout_sessions/${id}`).catch(() => null) : null;
    if (!session || session.status !== 'open') {
      session = await sf(event, '/checkout_sessions', { method: 'POST', body: { starts_at: dates.from ?? undefined, ends_at: dates.to ?? undefined, lines: [] } });
      id = session.id;
      setCart(event.cookies, id, secure);
    }
    if (body.options !== undefined) {
      // Optional fees and the delivery postcode (theme API 1.5); the API keeps only fees the shop offers.
      const current = session.options ?? { fees: [], postcode: null };
      const options = { fees: Array.isArray(body.options.fees) ? body.options.fees.map(String) : current.fees, postcode: body.options.postcode !== undefined ? body.options.postcode : current.postcode, address: body.options.address !== undefined ? body.options.address : (current.address ?? null) };
      const s = await sf(event, `/checkout_sessions/${id}`, { method: 'PATCH', body: { options } });
      return json({ ok: true, lines: s.lines.length });
    }
    if (body.coupon !== undefined) {
      const s = await sf(event, `/checkout_sessions/${id}`, { method: 'PATCH', body: { coupon_codes: body.coupon ? [String(body.coupon)] : [] } });
      return json({ ok: true, lines: s.lines.length });
    }
    type Line = { variant_id: string; quantity: number; picks?: Record<string, string> | null };
    const lines: Line[] = session.lines.map((l: Line) => ({ variant_id: l.variant_id, quantity: l.quantity, picks: l.picks ?? null }));
    const i = lines.findIndex((l) => l.variant_id === body.variant_id);
    const qty = Math.max(0, Math.floor(Number(body.quantity ?? 1)));
    // A choice bundle's picks (FR-CAT-6); adding it again with other picks keeps the newest.
    const picks = body.picks && typeof body.picks === 'object' ? (body.picks as Record<string, string>) : undefined;
    if (body.mode === 'set') {
      if (i >= 0) lines[i] = { ...lines[i]!, quantity: qty, ...(picks ? { picks } : {}) };
      else if (qty > 0) lines.push({ variant_id: body.variant_id, quantity: qty, picks: picks ?? null });
    } else if (i >= 0) lines[i] = { ...lines[i]!, quantity: lines[i]!.quantity + qty, ...(picks ? { picks } : {}) };
    else lines.push({ variant_id: body.variant_id, quantity: qty, picks: picks ?? null });
    const s = await sf(event, `/checkout_sessions/${id}`, { method: 'PATCH', body: { lines: lines.filter((l) => l.quantity > 0), ...(dates.from ? { starts_at: dates.from, ends_at: dates.to } : {}) } });
    return json({ ok: true, lines: s.lines.length });
  } catch (e) {
    if (e instanceof SfError) return json({ message: e.message, code: e.code, errors: e.body?.errors ?? [] }, { status: e.status });
    throw e;
  }
};
