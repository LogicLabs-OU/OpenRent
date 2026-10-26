import { t as msg, withStrings } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { emit } from '../events.ts';
import { newId } from '../ids.ts';
import { many, must, one } from '../sql.ts';
import { overridesFor } from '../strings/index.ts';
import { makeHandlebars } from '../documents/index.ts';
import { textChannel } from '../plugins/index.ts';
import { DEFAULT_TEXTS } from './templates.ts';

/**
 * Text messages (FR-NOT-4): the booking updates of `notifyCustomer` also go by WhatsApp or SMS to
 * customers who asked for them, through the plugin the shop chose. WhatsApp wins when the customer
 * wants both. They are logged with the emails (FR-NOT-5) and sent by the same worker.
 */
export const MAX_TEXT = 640;

/** Where a messaging plugin's delivery reports go: /webhooks/notify/{plugin}/{tenant}. */
export function textWebhookUrl(ctx: Ctx, pluginId: string) {
  return `${ctx.config.publicUrl.replace(/\/$/, '')}/webhooks/notify/${pluginId}/${ctx.tenantId}`;
}

/** `+3725551234` from what people type (`+372 555 1234`, `00372…`); null without a country code. */
export function normalizePhone(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').replace(/[\s().\-/]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/** The shop's own text for an event in this language (or English), else the built-in one; null when off or none. */
async function textTemplate(ctx: Ctx, event: string, locale: string): Promise<string | null> {
  const own = await one<{ body: string; enabled: boolean }>(
    ctx,
    `SELECT body, enabled FROM notification_templates WHERE event = $1 AND channel = 'sms' AND (locale = $2 OR locale = 'en') ORDER BY (locale = $2) DESC LIMIT 1`,
    [event, locale],
  );
  if (own) return own.enabled && own.body.trim() ? own.body : null;
  return DEFAULT_TEXTS[event] ?? null;
}

/** Renders a text as plain text: no HTML escaping, whitespace folded, cut to MAX_TEXT. */
export async function renderText(ctx: Ctx, source: string, data: Record<string, any>, locale: string) {
  const tenant = await must<any>(ctx, `SELECT name, currency, timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const own = await overridesFor(ctx, 'email', locale);
  return withStrings(locale, own, async () => {
    const hb = makeHandlebars(tenant.currency.trim(), data.order?.timezone ?? tenant.timezone, locale);
    const text = hb.compile(source, { noEscape: true })({ ...data, tenant: { name: tenant.name, ...(data.tenant ?? {}) } });
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  });
}

/**
 * Queues the text version of a customer notification, when the event has one, the customer opted in
 * and the shop has a channel for it. A number without a country code is logged as failed, so staff see why.
 */
export async function queueText(ctx: Ctx, input: { template: string; orderId: string; data: Record<string, any>; dedupeKey?: string }) {
  const c = await one<any>(ctx, `SELECT c.phone, c.locale, c.sms_opt_in, c.whatsapp_opt_in FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [input.orderId]);
  if (!c?.phone || (!c.sms_opt_in && !c.whatsapp_opt_in)) return null;
  const kind = c.whatsapp_opt_in && (await textChannel(ctx, 'whatsapp')) ? 'whatsapp' : c.sms_opt_in && (await textChannel(ctx, 'sms')) ? 'sms' : null;
  if (!kind) return null;
  const tenant = await must<{ locale: string }>(ctx, `SELECT locale FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const locale = c.locale || tenant.locale || 'en';
  const source = await textTemplate(ctx, input.template, locale);
  if (!source) return null;
  const text = await renderText(ctx, source, input.data, locale);
  if (!text) return null;
  const phone = normalizePhone(c.phone);
  const id = newId('ntf');
  const r = await many(
    ctx,
    `INSERT INTO notifications (id, tenant_id, channel, template_key, recipient, audience, subject, body_html, body_text, order_id, dedupe_key, status, error)
     VALUES ($1,$2,$3,$4,$5,'customer','','',$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
    [id, ctx.tenantId, kind, input.template, phone ?? String(c.phone), text, input.orderId, input.dedupeKey ? `${input.dedupeKey}:${kind}` : null, phone ? 'queued' : 'failed', phone ? null : msg('notifications.phone_needs_country_code')],
  );
  if (!r.length) return null;
  if (phone) await emit(ctx, 'internal.notification.queued', { type: 'notification', id }, { id });
  return id;
}
