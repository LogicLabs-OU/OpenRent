import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError } from '../errors.ts';
import { newId } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { addMinutes } from '../time.ts';
import { queue, storefrontBase } from '../notifications/index.ts';
import { resolveSettings } from '../tenancy/settings.ts';

/**
 * Abandoned-cart reminders (FR-SF-9). When the shop turns them on, a cart left with an email and items
 * gets one email after `after_hours`, with a link that brings the cart back. The link is the cart id
 * sealed with the installation key, so it shows nothing about the customer and cannot be made up; it
 * stops working after a week. The same email can ask for no more reminders; nobody who booked since,
 * or asked not to be reminded, gets one.
 */
const KIND = 'cart_reminder';
const LINK_DAYS = 7;

function seal(ctx: Ctx, sessionId: string) {
  return ctx.secrets.encrypt(JSON.stringify({ k: KIND, s: sessionId, e: ctx.now.getTime() + LINK_DAYS * 86_400_000 }));
}

/** The cart a reminder link names, or a 404 for a link that is wrong or too old. */
async function opened(ctx: Ctx, token: string) {
  let v: { k?: string; s?: string; e?: number };
  try {
    v = JSON.parse(ctx.secrets.decrypt(token));
  } catch {
    v = {};
  }
  const s = v.k === KIND && v.s && Number(v.e) > ctx.now.getTime() ? await one<any>(ctx, `SELECT * FROM checkout_sessions WHERE id = $1`, [v.s]) : null;
  if (!s) throw new AppError('link_expired', 404, msg('checkout.reminder_link_invalid'));
  return s;
}

/** Worker: one reminder per cart left long enough with an email and something in it. */
export async function sendCartReminders(ctx: Ctx): Promise<number> {
  const t = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const s = resolveSettings(t.settings).cart_reminders;
  if (!s.enabled) return 0;
  const due = await many<any>(
    ctx,
    `SELECT cs.* FROM checkout_sessions cs
      WHERE cs.status IN ('open', 'expired') AND cs.reminder_sent_at IS NULL AND cs.order_id IS NULL
        AND jsonb_array_length(cs.lines) > 0 AND coalesce(cs.customer->>'email', '') <> ''
        AND cs.updated_at < $1 AND cs.updated_at > $2
        AND NOT EXISTS (SELECT 1 FROM email_optouts o WHERE o.email = lower(cs.customer->>'email') AND o.kind = '${KIND}')
        AND NOT EXISTS (SELECT 1 FROM orders x JOIN customers c ON c.id = x.customer_id WHERE lower(c.email) = lower(cs.customer->>'email') AND x.created_at > cs.created_at)
      ORDER BY cs.updated_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
    [addMinutes(ctx.now, -s.after_hours * 60), addMinutes(ctx.now, -LINK_DAYS * 24 * 60)],
  );
  for (const cs of due) {
    const email = String(cs.customer.email).trim().toLowerCase();
    const locale = typeof cs.customer.locale === 'string' ? cs.customer.locale : null;
    const base = await storefrontBase(ctx, locale);
    const token = encodeURIComponent(seal(ctx, cs.id));
    const names = await many<{ name: string }>(ctx, `SELECT DISTINCT p.name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1)`, [cs.lines.map((l: any) => l.variant_id)]);
    await queue(ctx, {
      template: 'cart_reminder', to: email, audience: 'customer',
      data: { customer: { name: cs.customer.name ?? '', email, locale }, items: names.map((n) => n.name).join(', '), link: `${base}/cart/restore?token=${token}`, stop_link: `${base}/cart/stop-reminders?token=${token}` },
    });
    await exec(ctx, `UPDATE checkout_sessions SET reminder_sent_at = $2 WHERE id = $1`, [cs.id, ctx.now]);
  }
  return due.length;
}

/**
 * Brings back the cart a reminder names, as a new cart (the old one may have expired). Dates that have
 * passed are dropped, so the customer picks new ones.
 */
export async function restoreCart(ctx: Ctx, token: string) {
  const s = await opened(ctx, token);
  const future = s.starts_at && new Date(s.starts_at) > ctx.now;
  const row = (
    await many(
      ctx,
      `INSERT INTO checkout_sessions (id, tenant_id, location_id, starts_at, ends_at, lines, customer, coupon_codes, options, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [newId('cs'), ctx.tenantId, s.location_id, future ? s.starts_at : null, future ? s.ends_at : null, json(s.lines), json({ name: s.customer.name, email: s.customer.email }), s.coupon_codes, json(s.options ?? {}), addMinutes(ctx.now, 180)],
    )
  )[0];
  // A cart brought back does not get a second reminder.
  await exec(ctx, `UPDATE checkout_sessions SET reminder_sent_at = coalesce(reminder_sent_at, $2) WHERE id = $1`, [row.id, ctx.now]);
  return { object: 'checkout_session', id: row.id as string, dates_kept: !!future };
}

/** The email behind a reminder link gets no more reminders from this shop. */
export async function stopCartReminders(ctx: Ctx, token: string) {
  const s = await opened(ctx, token);
  const email = String(s.customer?.email ?? '').trim().toLowerCase();
  if (email) await exec(ctx, `INSERT INTO email_optouts (tenant_id, email, kind) VALUES ($1, $2, '${KIND}') ON CONFLICT DO NOTHING`, [ctx.tenantId, email]);
  return { object: 'reminder_optout', stopped: true };
}
