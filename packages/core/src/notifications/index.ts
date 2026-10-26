import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import * as domains from '../domains/index.ts';
import { overridesFor } from '../strings/index.ts';
import { withStrings } from '../i18n/index.ts';
import { AppError, invalid } from '../errors.ts';
import { emit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { addStaffNotices, emailRecipients } from './staff.ts';
import { makeHandlebars, buildOrderData } from '../documents/index.ts';
import { resolveSettings } from '../tenancy/settings.ts';
import { DEFAULT_NOTIFICATIONS } from './templates.ts';
import { t, tAny, type MessageKey } from '../i18n/index.ts';

export { DEFAULT_NOTIFICATIONS };

export function notificationToApi(n: any) {
  return {
    id: n.id, object: 'notification', channel: n.channel, template: n.template_key, recipient: n.recipient, audience: n.audience, subject: n.subject, order_id: n.order_id,
    attachments: n.attachments ?? [], status: n.status, error: n.error, attempts: n.attempts ?? 0, next_attempt_at: n.next_attempt_at ?? null, sent_at: n.sent_at, created_at: n.created_at,
  };
}

async function template(ctx: Ctx, key: string, locale: string) {
  const t = await one(ctx, `SELECT * FROM notification_templates WHERE event = $1 AND channel = 'email' AND enabled AND (locale = $2 OR locale = 'en') ORDER BY (locale = $2) DESC LIMIT 1`, [key, locale]);
  if (t) return { subject: t.subject as string, body: t.body as string };
  const d = DEFAULT_NOTIFICATIONS[key];
  if (!d) throw invalid(msg('error.unknown_notification_template', { key }));
  return d;
}

/**
 * Renders a message. Customer messages use the customer's language, staff messages the shop's;
 * `locale` overrides both (previews and test sends).
 */
export async function render(ctx: Ctx, key: string, data: Record<string, any>, opts: { audience?: 'customer' | 'staff'; locale?: string | null } = {}) {
  const tenant = await must<any>(ctx, `SELECT * FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const audience = opts.audience ?? DEFAULT_NOTIFICATIONS[key]?.audience ?? 'customer';
  const locale = opts.locale || (audience === 'customer' ? data.customer?.locale : null) || tenant.locale || 'en';
  // The shop's own wording of server texts in emails (built-in templates and {{t "email.…"}}) applies.
  const own = await overridesFor(ctx, 'email', locale);
  return withStrings(locale, own, async () => {
    const tpl = await template(ctx, key, locale);
    const hb = makeHandlebars(tenant.currency.trim(), data.order?.timezone ?? tenant.timezone, locale);
    const full = { ...data, tenant: { name: tenant.name, ...(data.tenant ?? {}) }, brand: tenant.branding?.primary_color ?? '#0891b2' };
    return { subject: hb.compile(tpl.subject)(full), html: hb.compile(tpl.body)(full) };
  });
}

export interface QueueInput {
  template: string;
  to: string | null | undefined;
  audience?: 'customer' | 'staff';
  orderId?: string | null;
  data: Record<string, any>;
  /** At most one message per dedupe key (reminders, FR-NOT-5). */
  dedupeKey?: string;
  /** Document ids attached as PDFs when the message is sent. */
  attachments?: string[];
  /** Render in this language instead of the customer's or the shop's (test sends). */
  locale?: string | null;
}

/** Logs the message as queued and emits an internal event; the worker sends it after commit. */
export async function queue(ctx: Ctx, input: QueueInput): Promise<string | null> {
  if (!input.to) return null;
  const msg = await render(ctx, input.template, input.data, { audience: input.audience, locale: input.locale });
  const id = newId('ntf');
  const r = await many(
    ctx,
    `INSERT INTO notifications (id, tenant_id, channel, template_key, recipient, audience, subject, body_html, order_id, dedupe_key, attachments)
     VALUES ($1,$2,'email',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
    [id, ctx.tenantId, input.template, input.to, input.audience ?? DEFAULT_NOTIFICATIONS[input.template]?.audience ?? 'customer', msg.subject, msg.html, input.orderId ?? null, input.dedupeKey ?? null, json(input.attachments ?? [])],
  );
  if (!r.length) return null;
  await emit(ctx, 'internal.notification.queued', { type: 'notification', id }, { id });
  return id;
}

/** The storefront's base URL in a customer's language (`https://shop/de` when German is not the default). */
export async function storefrontBase(ctx: Ctx, locale?: string | null) {
  const base = await domains.storefrontBase(ctx);
  if (!locale) return base;
  const t = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const sf = resolveSettings(t.settings).storefront;
  return sf.locales.includes(locale as never) && locale !== sf.default_locale ? `${base}/${locale}` : base;
}

export async function orderMessageData(ctx: Ctx, orderId: string, extra: Record<string, any> = {}) {
  const data = await buildOrderData(ctx, orderId);
  return {
    ...data,
    order_url: `${await storefrontBase(ctx, data.customer?.locale)}/order/${data.order.public_token}`,
    admin_url: `${ctx.config.adminUrl.replace(/\/$/, '')}/orders/${orderId}`,
    ...extra,
  };
}

export async function notifyCustomer(ctx: Ctx, orderId: string, template: string, extra: Record<string, any> = {}, dedupeKey?: string, opts: { attachments?: string[] } = {}) {
  const data = await orderMessageData(ctx, orderId, extra);
  return queue(ctx, { template, to: data.customer?.email, audience: 'customer', orderId, data, dedupeKey, attachments: opts.attachments });
}

export async function staffRecipients(ctx: Ctx): Promise<string[]> {
  const t = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const s = resolveSettings(t.settings);
  if (s.staff_email) return [s.staff_email];
  const rows = await many<{ email: string }>(ctx, `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role IN ('owner','admin') AND u.status = 'active'`);
  return rows.map((r) => r.email);
}

/**
 * Tells staff: an in-app notice for each member who wants it, and email to the shop's staff address or
 * to owners and admins who did not turn this kind of email off (FR-NOT-3).
 */
export async function notifyStaff(ctx: Ctx, orderId: string | null, template: string, extra: Record<string, any> = {}, dedupeKey?: string) {
  const data = orderId ? await orderMessageData(ctx, orderId, extra) : extra;
  await addStaffNotices(ctx, template, extra, data, orderId ? { type: 'order', id: orderId } : null, dedupeKey);
  const optedIn = new Set(await emailRecipients(ctx, template));
  const t = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const shared = resolveSettings(t.settings).staff_email;
  for (const to of await staffRecipients(ctx)) {
    if (!shared && !optedIn.has(to)) continue;
    await queue(ctx, { template, to, audience: 'staff', orderId, data, dedupeKey: dedupeKey ? `${dedupeKey}:${to}` : undefined });
  }
}

export async function listNotifications(ctx: Ctx, filter: { order_id?: string; status?: string; limit?: number } = {}) {
  const rows = await many(
    ctx,
    `SELECT * FROM notifications WHERE ($1::text IS NULL OR order_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT $3`,
    [filter.order_id ?? null, filter.status ?? null, Math.min(filter.limit ?? 50, 200)],
  );
  return rows.map(notificationToApi);
}

export async function markNotification(ctx: Ctx, id: string, status: 'sent' | 'failed' | 'bounced' | 'delivered', info: { ref?: string | null; error?: string | null } = {}) {
  await exec(ctx, `UPDATE notifications SET status = $2, provider_ref = coalesce($3, provider_ref), error = $4, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`, [id, status, info.ref ?? null, info.error ?? null]);
  const n = await one(ctx, `SELECT * FROM notifications WHERE id = $1`, [id]);
  if (n && (status === 'sent' || status === 'bounced')) await emit(ctx, `notification.${status}`, { type: 'notification', id }, notificationToApi(n));
}

/** Marks sent messages delivered or bounced from an email plugin's delivery reports (FR-NOT-5). */
export async function applyDeliveryReports(ctx: Ctx, pluginId: string, reports: { ref: string; status: 'delivered' | 'bounced' | 'complained'; error?: string | null }[]) {
  let updated = 0;
  for (const r of reports) {
    const n = await one<{ id: string; status: string }>(ctx, `SELECT id, status FROM notifications WHERE provider = $1 AND provider_ref = $2`, [pluginId, r.ref]);
    // A bounce is final; a late "delivered" never undoes it.
    if (!n || n.status === 'bounced' || (n.status === 'delivered' && r.status === 'delivered')) continue;
    await markNotification(ctx, n.id, r.status === 'delivered' ? 'delivered' : 'bounced', { error: r.status === 'complained' ? (r.error ?? 'complaint') : (r.error ?? null) });
    updated++;
  }
  return updated;
}

export function notificationTemplateToApi(t: any) {
  return { id: t.id, object: 'notification_template', event: t.event, channel: t.channel, locale: t.locale, subject: t.subject, body: t.body, enabled: t.enabled, builtin: !!t.builtin };
}

/**
 * A built-in template as plain text in one language, for editing: each `{{t "key" a=b}}` becomes the
 * catalogue sentence with its parameters written back as Handlebars (`{{order.number}}`).
 */
export function expandBuiltin(source: string, locale: string): string {
  return source.replace(/\{\{t "([\w.]+)"((?:\s+\w+=(?:\([^)]*\)|[\w.]+))*)\s*\}\}/g, (_, key: string, hash: string) => {
    const params: Record<string, string> = {};
    for (const m of hash.matchAll(/(\w+)=(\([^)]*\)|[\w.]+)/g)) {
      const expr = m[2]!.startsWith('(') ? m[2]!.slice(1, -1) : m[2]!;
      params[m[1]!] = `{{${expr}}}`;
    }
    return tAny(key, params, locale);
  });
}

/** Message templates in one language: the shop's own version if it has one, else the built-in text. */
export async function listNotificationTemplates(ctx: Ctx, locale?: string | null) {
  const tenant = await must<any>(ctx, `SELECT locale FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const l = locale || tenant.locale || 'en';
  const custom = await many(ctx, `SELECT * FROM notification_templates WHERE locale = $1 ORDER BY event`, [l]);
  return Object.entries(DEFAULT_NOTIFICATIONS).map(([event, d]) => {
    const own = custom.find((c) => c.event === event);
    return notificationTemplateToApi(own ?? { id: `builtin:${event}`, event, channel: 'email', locale: l, subject: expandBuiltin(d.subject, l), body: expandBuiltin(d.body, l), enabled: true, builtin: true });
  });
}

export async function upsertNotificationTemplate(ctx: Ctx, event: string, input: { subject: string; body: string; locale?: string; enabled?: boolean }) {
  if (!DEFAULT_NOTIFICATIONS[event]) throw invalid(msg('notifications.unknown_event', { event }));
  const row = (
    await many(
      ctx,
      `INSERT INTO notification_templates (id, tenant_id, event, channel, locale, subject, body, enabled) VALUES ($1,$2,$3,'email',$4,$5,$6,$7)
       ON CONFLICT (tenant_id, event, channel, locale) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, enabled = EXCLUDED.enabled RETURNING *`,
      [newId('ntp'), ctx.tenantId, event, input.locale ?? 'en', input.subject, input.body, input.enabled ?? true],
    )
  )[0];
  return notificationTemplateToApi(row);
}

/**
 * Renders a template draft without saving it (FR-NOT-2 preview). Uses the given order, else the most
 * recent order, so the preview shows real names, dates and totals.
 */
export async function previewNotification(ctx: Ctx, input: { event: string; subject: string; body: string; order_id?: string | null; locale?: string | null }) {
  if (!DEFAULT_NOTIFICATIONS[input.event]) throw invalid(t('notifications.unknown_event', { event: input.event }));
  const tenant = await must<any>(ctx, `SELECT * FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const orderId = input.order_id ?? (await one<{ id: string }>(ctx, `SELECT id FROM orders WHERE customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`))?.id ?? null;
  const data: Record<string, any> = orderId ? await orderMessageData(ctx, orderId) : { order: { number: 1001 }, customer: { name: 'Alex Example' }, totals: { total: 0 }, lines: [] };
  const hb = makeHandlebars(tenant.currency.trim(), data.order?.timezone ?? tenant.timezone, input.locale || tenant.locale || 'en');
  const full = { ...data, tenant: { name: tenant.name, ...(data.tenant ?? {}) }, brand: tenant.branding?.primary_color ?? '#0891b2' };
  try {
    return { object: 'notification_preview', order_id: orderId, subject: hb.compile(input.subject)(full), html: hb.compile(input.body)(full) };
  } catch (err: any) {
    throw invalid(t('notifications.template_error'), [{ field: 'body', code: 'template_error', message: String(err?.message ?? err) }]);
  }
}

// ---------------------------------------------------------------------------
// Delivery (FR-NOT-5): retries with backoff, readable errors and staff actions.
// ---------------------------------------------------------------------------

/** Minutes to wait after the 1st, 2nd, … failed attempt. After the last one the message fails. */
export const RETRY_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480];
/** Queued messages older than this are given up. */
export const MAX_QUEUE_DAYS = 7;

const DELIVERY_CODES = new Set(['not_configured', 'tls_mismatch', 'certificate', 'auth_failed', 'connection_failed', 'host_not_found', 'timeout', 'recipient_rejected', 'rejected']);

/** A failure as the shop owner reads it: the likely cause, then the server's own words. */
export function deliveryErrorMessage(err: any): string {
  // OpenSSL prefixes ("80A1…:error:0A00010B:") and source paths say nothing to a shop owner.
  const detail = String(err?.message ?? err)
    .replace(/\b[0-9A-F]{8,}:error:[0-9A-F]+:/g, '')
    .replace(/:[^\s:]*\/deps\/openssl\/\S*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  const code = String(err?.code ?? '');
  if (!DELIVERY_CODES.has(code)) return detail;
  const cause = t(`email.error.${code}` as MessageKey);
  return code === 'not_configured' ? cause : `${cause} (${detail})`;
}

/** Records a failed attempt: schedules the next one, or fails the message for good. */
export async function recordDeliveryFailure(ctx: Ctx, id: string, err: any) {
  const n = await one<{ attempts: number }>(ctx, `SELECT attempts FROM notifications WHERE id = $1`, [id]);
  if (!n) return;
  const message = deliveryErrorMessage(err);
  // Missing settings are not the message's fault: keep it waiting without using up attempts.
  if (err?.code === 'not_configured') {
    await exec(ctx, `UPDATE notifications SET error = $2, next_attempt_at = now() + interval '5 minutes' WHERE id = $1`, [id, message]);
    return;
  }
  const attempts = n.attempts + 1;
  if (err?.permanent || attempts >= RETRY_MINUTES.length) {
    await exec(ctx, `UPDATE notifications SET status = 'failed', attempts = $2, error = $3, next_attempt_at = NULL WHERE id = $1`, [id, attempts, message]);
    return;
  }
  await exec(ctx, `UPDATE notifications SET attempts = $2, error = $3, next_attempt_at = now() + make_interval(mins => $4) WHERE id = $1`, [id, attempts, message, RETRY_MINUTES[attempts - 1]]);
}

export async function getNotification(ctx: Ctx, id: string) {
  const n = await must<any>(ctx, `SELECT * FROM notifications WHERE id = $1`, [id], 'notification', id);
  return { ...notificationToApi(n), body_html: n.body_html };
}

/** Sends a queued or failed message at the next worker tick. */
export async function retryNotification(ctx: Ctx, id: string) {
  const n = await must<any>(ctx, `SELECT status FROM notifications WHERE id = $1`, [id], 'notification', id);
  if (!['queued', 'failed'].includes(n.status)) throw new AppError('not_retryable', 409, t('notifications.not_retryable'));
  await exec(ctx, `UPDATE notifications SET status = 'queued', next_attempt_at = NULL, attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END, created_at = CASE WHEN status = 'failed' THEN now() ELSE created_at END WHERE id = $1`, [id]);
  await emit(ctx, 'internal.notification.queued', { type: 'notification', id }, { id });
  return getNotification(ctx, id);
}

/** Stops a message that has not been sent. */
export async function cancelNotification(ctx: Ctx, id: string) {
  const n = await must<any>(ctx, `SELECT status FROM notifications WHERE id = $1`, [id], 'notification', id);
  if (!['queued', 'failed'].includes(n.status)) throw new AppError('not_cancellable', 409, t('notifications.not_cancellable'));
  await exec(ctx, `UPDATE notifications SET status = 'cancelled', next_attempt_at = NULL WHERE id = $1`, [id]);
  return getNotification(ctx, id);
}

/** Queues a fresh copy of any message (same recipient, text and attachments). */
export async function resendNotification(ctx: Ctx, id: string) {
  const n = await must<any>(ctx, `SELECT * FROM notifications WHERE id = $1`, [id], 'notification', id);
  const copy = newId('ntf');
  await exec(
    ctx,
    `INSERT INTO notifications (id, tenant_id, channel, template_key, recipient, audience, subject, body_html, order_id, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [copy, ctx.tenantId, n.channel, n.template_key, n.recipient, n.audience, n.subject, n.body_html, n.order_id, json(n.attachments ?? [])],
  );
  await emit(ctx, 'internal.notification.queued', { type: 'notification', id: copy }, { id: copy });
  return getNotification(ctx, copy);
}

/** Sends every waiting message now (after fixing email settings) or requeues every failed one. */
export async function retryAllNotifications(ctx: Ctx, which: 'queued' | 'failed') {
  const n =
    which === 'queued'
      ? await exec(ctx, `UPDATE notifications SET next_attempt_at = NULL WHERE status = 'queued'`)
      : await exec(ctx, `UPDATE notifications SET status = 'queued', attempts = 0, next_attempt_at = NULL, created_at = now() WHERE status = 'failed'`);
  if (n) await emit(ctx, 'internal.notification.queued', { type: 'notification', id: 'bulk' }, { count: n });
  return { object: 'notification_retry', status: which, count: n };
}

/** Delivery overview for the email settings (last 30 days). */
export async function notificationStats(ctx: Ctx) {
  const rows = await many<{ status: string; n: number }>(ctx, `SELECT status, count(*)::int AS n FROM notifications WHERE created_at > now() - interval '30 days' GROUP BY status`);
  const counts: Record<string, number> = { queued: 0, sent: 0, delivered: 0, failed: 0, bounced: 0, cancelled: 0 };
  for (const r of rows) counts[r.status] = r.n;
  const lastSent = await one<{ sent_at: Date }>(ctx, `SELECT sent_at FROM notifications WHERE status IN ('sent', 'delivered') ORDER BY sent_at DESC NULLS LAST LIMIT 1`);
  const lastError = await one<{ error: string; updated_at: Date }>(ctx, `SELECT error, updated_at FROM notifications WHERE status IN ('queued', 'failed') AND error IS NOT NULL ORDER BY updated_at DESC LIMIT 1`);
  return { object: 'notification_stats', period_days: 30, counts, last_sent_at: lastSent?.sent_at ?? null, last_error: lastError ? { message: lastError.error, at: lastError.updated_at } : null };
}

