import type { Ctx } from '../context.ts';
import { AppError, conflict, invalid, notFound } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId, randomToken, sha256 } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { exec, many, one } from '../sql.ts';
import { customerAttachmentFile, customerAttachments } from '../attachments/index.ts';
import { money } from '../crud.ts';
import { normalizeEmail, updateCustomer } from '../customers/index.ts';
import { notifyCustomer, notifyStaff, queue, storefrontBase } from '../notifications/index.ts';
import { currentLocale } from '../i18n/index.ts';
import { isLocale } from '@openrent/i18n';
import { extendOrder, rescheduleOrder, runAction } from '../orders/index.ts';
import { resolveSettings, type TenantSettings } from '../tenancy/settings.ts';

/**
 * Storefront customer accounts. An account is a tenant plus an email: it sees every booking made
 * with that email, and signs in with a one-time link (no password). Only emails that already have
 * a booking get a link, and the answer never says whether one was sent.
 */

const LOGIN_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;
/** Statuses a customer may ask to cancel; the order's own `cancel` action allows the same ones. */
const CANCELLABLE = ['quote', 'reserved', 'prepared'];
/** Staff-only paperwork stays out of the customer's view. */
const CUSTOMER_DOCUMENTS = [
  'quote',
  'confirmation',
  'contract',
  'invoice',
  'credit_note',
  'receipt',
  'deposit_receipt',
  'delivery_note',
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function customersFor(ctx: Ctx, email: string) {
  return many(
    ctx,
    `SELECT * FROM customers WHERE lower(email) = $1 AND deleted_at IS NULL AND merged_into_id IS NULL AND anonymized_at IS NULL ORDER BY created_at`,
    [email],
  );
}

/** The customer record a signed-in account keeps its details on: the oldest with its email. */
export async function accountCustomer(ctx: Ctx, email: string): Promise<{ id: string }> {
  const primary = (await customersFor(ctx, normalizeEmail(email) ?? ''))[0];
  if (!primary) throw new AppError('unauthenticated', 401, t('account.signed_out'));
  return primary;
}

/** Acts as the customer for audit entries and events. */
export function asCustomerCtx(ctx: Ctx, customerId: string | null): Ctx {
  return asCustomer(ctx, customerId);
}

/** Acts as the customer for audit entries and events. */
function asCustomer(ctx: Ctx, customerId: string | null): Ctx {
  return { ...ctx, actor: { type: 'customer', id: customerId } };
}

// --- Sign-in ---------------------------------------------------------------

export async function requestLogin(ctx: Ctx, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!email || !EMAIL.test(email))
    throw invalid(t('account.invalid_email'), [
      { field: 'email', code: 'invalid', message: t('account.invalid_email') },
    ]);
  const customers = await customersFor(ctx, email);
  const booked = customers.length
    ? await one(ctx, `SELECT 1 FROM orders WHERE customer_id = ANY($1) AND status <> 'draft' LIMIT 1`, [
        customers.map((c) => c.id),
      ])
    : null;
  if (booked) {
    const c = customers[0]!;
    // In the language the customer asked from, so the email matches the page.
    const link = await loginLink(ctx, email, LOGIN_TTL_MIN, currentLocale());
    await queue(ctx, { template: 'customer_login', to: email, audience: 'customer', data: { customer: { name: c.name, email, locale: currentLocale() }, link, minutes: LOGIN_TTL_MIN } });
  }
  return { object: 'account_login', sent: true };
}

async function loginLink(ctx: Ctx, email: string, minutes: number, locale?: string | null) {
  const token = randomToken(24);
  await exec(
    ctx,
    `INSERT INTO customer_login_tokens (id, tenant_id, email, token_hash, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5))`,
    [newId('cltk'), ctx.tenantId, email, sha256(token), minutes],
  );
  return `${await storefrontBase(ctx, locale ?? undefined)}/account/verify?token=${token}`;
}

/** Days a link staff send stays valid. */
const INVITATION_DAYS = 7;

/**
 * Staff send a customer a link to their account (PRD §5.4 send_portal_link), also before their first
 * booking, e.g. a business customer who will book online. It is valid for a week and works once.
 */
export async function sendPortalLink(ctx: Ctx, customerId: string) {
  const c = await one<any>(ctx, `SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL AND anonymized_at IS NULL`, [customerId]);
  if (!c) throw notFound('customer', customerId);
  const email = normalizeEmail(c.email);
  if (!email) throw invalid(t('account.needs_email'), [{ field: 'email', code: 'required', message: t('account.needs_email') }]);
  const link = await loginLink(ctx, email, INVITATION_DAYS * 24 * 60, c.locale);
  await queue(ctx, { template: 'portal_invitation', to: email, audience: 'customer', data: { customer: { name: c.name, email, locale: c.locale }, link, days: INVITATION_DAYS } });
  await audit(ctx, { entity_type: 'customer', entity_id: c.id, action: 'portal_link_sent' });
  return { object: 'portal_link', sent: true, email };
}

/** Consumes a sign-in link once and opens a session. */
export async function verifyLogin(ctx: Ctx, token: string) {
  const row = await one<{ email: string }>(
    ctx,
    `UPDATE customer_login_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email`,
    [sha256(token ?? '')],
  );
  if (!row) throw new AppError('invalid_token', 401, t('account.invalid_link'));
  const session = randomToken(32);
  const expires = new Date(ctx.now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await exec(
    ctx,
    `INSERT INTO customer_sessions (id, tenant_id, email, token_hash, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId('cses'),
      ctx.tenantId,
      row.email,
      sha256(session),
      expires,
      ctx.ip ?? null,
      ctx.userAgent?.slice(0, 300) ?? null,
    ],
  );
  const primary = (await customersFor(ctx, row.email))[0];
  if (primary)
    await audit(asCustomer(ctx, primary.id), {
      entity_type: 'customer',
      entity_id: primary.id,
      action: 'sign_in',
    });
  return { object: 'account_session', token: session, expires_at: expires, email: row.email };
}

/** The signed-in email for a session token, or a 401. */
export async function resolveSession(ctx: Ctx, token: string | undefined | null) {
  if (!token) throw new AppError('unauthenticated', 401, t('account.signed_out'));
  const s = await one<{ id: string; email: string; last_seen_at: string | null }>(
    ctx,
    `SELECT id, email, last_seen_at FROM customer_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  if (!s) throw new AppError('unauthenticated', 401, t('account.signed_out'));
  // Touch at most every five minutes so browsing does not write on every page.
  if (!s.last_seen_at || ctx.now.getTime() - new Date(s.last_seen_at).getTime() > 300_000)
    await exec(ctx, `UPDATE customer_sessions SET last_seen_at = now() WHERE id = $1`, [s.id]);
  return { id: s.id, email: s.email };
}

export async function logout(ctx: Ctx, token: string | undefined | null) {
  if (token)
    await exec(
      ctx,
      `UPDATE customer_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [sha256(token)],
    );
  return { object: 'account_session', revoked: true };
}

/** Staff view of a customer's open sessions (admin customer page). */
export async function listSessions(ctx: Ctx, email: string | null) {
  if (!email) return [];
  const rows = await many(
    ctx,
    `SELECT id, created_at, last_seen_at, expires_at, user_agent FROM customer_sessions WHERE email = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    [normalizeEmail(email)],
  );
  return rows.map((r) => ({
    id: r.id,
    object: 'customer_session',
    created_at: r.created_at,
    last_seen_at: r.last_seen_at,
    expires_at: r.expires_at,
    user_agent: r.user_agent,
  }));
}

export async function revokeSessions(ctx: Ctx, customerId: string, email: string | null) {
  const n = email
    ? await exec(
        ctx,
        `UPDATE customer_sessions SET revoked_at = now() WHERE email = $1 AND revoked_at IS NULL`,
        [normalizeEmail(email)],
      )
    : 0;
  await audit(ctx, {
    entity_type: 'customer',
    entity_id: customerId,
    action: 'sign_out_everywhere',
    extra: { sessions: n },
  });
  return { object: 'list', revoked: n };
}

// --- Overview and profile ----------------------------------------------------

export function requestToApi(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    object: 'cancellation_request',
    order_id: r.order_id,
    status: r.status,
    reason: r.reason,
    decision_note: r.decision_note,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}

/** Latest cancellation request per order. */
export async function latestRequests(ctx: Ctx, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, any>();
  const rows = await many(
    ctx,
    `SELECT DISTINCT ON (order_id) * FROM cancellation_requests WHERE order_id = ANY($1) ORDER BY order_id, created_at DESC`,
    [orderIds],
  );
  return new Map(rows.map((r) => [r.order_id as string, r]));
}

export async function cancellationRequestFor(ctx: Ctx, orderId: string) {
  return requestToApi((await latestRequests(ctx, [orderId])).get(orderId));
}

/** Customer-facing documents of these orders. */
export async function orderDocuments(ctx: Ctx, orderIds: string[]) {
  if (!orderIds.length) return [];
  return many<{
    id: string;
    order_id: string;
    type: string;
    number: string | null;
    issued_at: string | null;
  }>(
    ctx,
    `SELECT id, order_id, type, number, issued_at FROM documents WHERE order_id = ANY($1) AND status <> 'voided' AND type = ANY($2) ORDER BY issued_at NULLS LAST, created_at`,
    [orderIds, CUSTOMER_DOCUMENTS],
  );
}

export function canRequestCancel(ctx: Ctx, o: any, request: any) {
  return CANCELLABLE.includes(o.status) && new Date(o.starts_at) > ctx.now && request?.status !== 'pending';
}

function profileToApi(c: any, email: string) {
  return {
    object: 'account',
    email,
    name: c?.name ?? '',
    phone: c?.phone ?? null,
    locale: c?.locale ?? null,
    marketing_consent: !!c?.marketing_consent,
    sms_opt_in: !!c?.sms_opt_in,
    whatsapp_opt_in: !!c?.whatsapp_opt_in,
  };
}

export async function overview(ctx: Ctx, email: string) {
  const customers = await customersFor(ctx, email);
  if (!customers.length) throw new AppError('unauthenticated', 401, t('account.signed_out'));
  const orders = await many(
    ctx,
    `SELECT * FROM orders WHERE customer_id = ANY($1) AND status <> 'draft' ORDER BY starts_at DESC LIMIT 200`,
    [customers.map((c) => c.id)],
  );
  const ids = orders.map((o) => o.id as string);
  const requests = await latestRequests(ctx, ids);
  const extensions = await latestExtensions(ctx, ids);
  const docs = await orderDocuments(ctx, ids);
  const files = await customerAttachments(ctx, ids);
  const now = ctx.now.getTime();
  const done = ['cancelled', 'expired', 'closed', 'returned', 'inspected'];
  const settings = await shopSettings(ctx);
  return {
    ...profileToApi(customers[0], email),
    orders: orders.map((o) => {
      const c = String(o.currency).trim();
      const req = requests.get(o.id);
      return {
        id: o.id,
        object: 'order',
        number: o.number,
        status: o.status,
        starts_at: o.starts_at,
        ends_at: o.ends_at,
        timezone: o.timezone,
        total: money(o.totals?.total, c),
        token: o.public_token,
        upcoming: !done.includes(o.status) && new Date(o.ends_at).getTime() > now,
        // What the customer may change themselves (ADR 0012); asking stays for what they may not.
        self_service: selfServiceFor(ctx, o, settings),
        can_request_cancellation: canRequestCancel(ctx, o, req) && !selfServiceFor(ctx, o, settings).cancel,
        cancellation_request: requestToApi(req),
        can_request_extension: canRequestExtension(ctx, o, extensions.get(o.id)),
        extension_request: extensionToApi(extensions.get(o.id)),
        documents: docs
          .filter((d) => d.order_id === o.id)
          .map((d) => ({ id: d.id, type: d.type, number: d.number })),
        attachments: files.filter((a) => a.order_id === o.id).map(({ order_id: _o, ...a }) => a),
      };
    }),
  };
}

export async function updateProfile(
  ctx: Ctx,
  email: string,
  patch: { name?: string; phone?: string | null; locale?: string | null; marketing_consent?: boolean; sms_opt_in?: boolean; whatsapp_opt_in?: boolean },
) {
  const primary = (await customersFor(ctx, email))[0];
  if (!primary) throw new AppError('unauthenticated', 401, t('account.signed_out'));
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name)
      throw invalid(t('account.name_required'), [
        { field: 'name', code: 'required', message: t('account.name_required') },
      ]);
    data.name = name.slice(0, 200);
  }
  if (patch.phone !== undefined)
    data.phone = patch.phone ? String(patch.phone).trim().slice(0, 40) || null : null;
  if (patch.locale !== undefined) data.locale = isLocale(patch.locale) ? patch.locale : null;
  if (patch.marketing_consent !== undefined) data.marketing_consent = !!patch.marketing_consent;
  if (patch.sms_opt_in !== undefined) data.sms_opt_in = !!patch.sms_opt_in;
  if (patch.whatsapp_opt_in !== undefined) data.whatsapp_opt_in = !!patch.whatsapp_opt_in;
  const c = Object.keys(data).length
    ? await updateCustomer(asCustomer(ctx, primary.id), primary.id, data)
    : primary;
  return profileToApi(c, email);
}

// --- Cancellation requests ---------------------------------------------------

export async function ownedOrder(ctx: Ctx, email: string, orderId: string) {
  const customers = await customersFor(ctx, email);
  const o = customers.length
    ? await one(ctx, `SELECT * FROM orders WHERE id = $1 AND customer_id = ANY($2) FOR UPDATE`, [
        orderId,
        customers.map((c) => c.id),
      ])
    : null;
  if (!o) throw notFound('order', orderId);
  return { order: o, customerId: customers[0]!.id as string };
}

/** The order behind a public order link (the link itself proves the customer). */
async function tokenOrder(ctx: Ctx, orderId: string, token: string) {
  const o =
    token && token.length >= 16
      ? await one(
          ctx,
          `SELECT * FROM orders WHERE (id = $1 OR public_token = $1) AND public_token = $2 FOR UPDATE`,
          [orderId, token],
        )
      : null;
  if (!o) throw notFound('order', orderId);
  return { order: o, customerId: o.customer_id as string };
}

export async function requestCancellation(ctx: Ctx, email: string, orderId: string, reason = '') {
  return createRequest(ctx, await ownedOrder(ctx, email, orderId), reason);
}

export async function requestCancellationByToken(ctx: Ctx, orderId: string, token: string, reason = '') {
  return createRequest(ctx, await tokenOrder(ctx, orderId, token), reason);
}

async function createRequest(
  ctx: Ctx,
  { order, customerId }: { order: any; customerId: string },
  reason: string,
) {
  const pending = (await latestRequests(ctx, [order.id])).get(order.id);
  if (pending?.status === 'pending') throw conflict('cancellation_pending', t('account.cancel_pending'));
  if (!canRequestCancel(ctx, order, pending))
    throw conflict('cancellation_not_allowed', t('account.cancel_not_allowed'));
  const text = String(reason ?? '')
    .trim()
    .slice(0, 1000);
  const row = await one(
    ctx,
    `INSERT INTO cancellation_requests (id, tenant_id, order_id, customer_id, reason) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (order_id) WHERE status = 'pending' DO NOTHING RETURNING *`,
    [newId('creq'), ctx.tenantId, order.id, customerId, text],
  );
  if (!row) throw conflict('cancellation_pending', t('account.cancel_pending'));
  const c = asCustomer(ctx, customerId);
  await audit(c, {
    entity_type: 'order',
    entity_id: order.id,
    action: 'cancellation_requested',
    extra: { request_id: row.id, reason: text },
  });
  await emit(c, 'order.cancellation_requested', { type: 'order', id: order.id }, requestToApi(row));
  await notifyCustomer(c, order.id, 'cancellation_request_received', { reason: text });
  await notifyStaff(c, order.id, 'staff_cancellation_requested', { reason: text });
  return requestToApi(row);
}

export async function withdrawCancellation(ctx: Ctx, email: string, orderId: string) {
  return withdraw(ctx, await ownedOrder(ctx, email, orderId));
}

export async function withdrawCancellationByToken(ctx: Ctx, orderId: string, token: string) {
  return withdraw(ctx, await tokenOrder(ctx, orderId, token));
}

async function withdraw(ctx: Ctx, { order, customerId }: { order: any; customerId: string }) {
  const row = await one(
    ctx,
    `UPDATE cancellation_requests SET status = 'withdrawn', decided_at = now() WHERE order_id = $1 AND status = 'pending' RETURNING *`,
    [order.id],
  );
  if (!row) throw notFound('cancellation_request');
  await audit(asCustomer(ctx, customerId), {
    entity_type: 'order',
    entity_id: order.id,
    action: 'cancellation_withdrawn',
    extra: { request_id: row.id },
  });
  return requestToApi(row);
}

/** Staff decision. Approving runs the order's `cancel` action, which refunds by the shop's tiers and tells the customer. */
export async function decideCancellation(
  ctx: Ctx,
  requestId: string,
  input: { approve: boolean; refund_pct?: number; note?: string },
) {
  const req = await one(ctx, `SELECT * FROM cancellation_requests WHERE id = $1 FOR UPDATE`, [requestId]);
  if (!req) throw notFound('cancellation_request', requestId);
  if (req.status !== 'pending') throw conflict('cancellation_decided', t('account.cancel_decided'));
  const note = input.note?.trim().slice(0, 1000) || null;
  if (input.approve) {
    await runAction(ctx, req.order_id, 'cancel', {
      reason: req.reason || t('account.cancel_reason_default'),
      refund_pct: input.refund_pct,
      notify: true,
    });
  }
  const row = await one(
    ctx,
    `UPDATE cancellation_requests SET status = $2, decision_note = $3, decided_by = $4, decided_at = now() WHERE id = $1 RETURNING *`,
    [requestId, input.approve ? 'approved' : 'declined', note, ctx.actor.id],
  );
  if (!input.approve) await notifyCustomer(ctx, req.order_id, 'cancellation_declined', { note });
  await audit(ctx, {
    entity_type: 'order',
    entity_id: req.order_id,
    action: input.approve ? 'cancellation_approved' : 'cancellation_declined',
    extra: { request_id: requestId, note },
  });
  await emit(ctx, 'order.cancellation_decided', { type: 'order', id: req.order_id }, requestToApi(row));
  return requestToApi(row);
}

export async function listCancellationRequests(ctx: Ctx, filter: { status?: string } = {}) {
  const rows = await many(
    ctx,
    `SELECT r.*, o.number, o.starts_at, c.name AS customer_name FROM cancellation_requests r JOIN orders o ON o.id = r.order_id LEFT JOIN customers c ON c.id = r.customer_id
      WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`,
    [filter.status ?? null],
  );
  return rows.map((r) => ({
    ...requestToApi(r),
    order_number: r.number,
    starts_at: r.starts_at,
    customer_name: r.customer_name,
  }));
}

export async function countPending(ctx: Ctx) {
  const r = await one<{ n: number }>(
    ctx,
    `SELECT count(*)::int AS n FROM cancellation_requests WHERE status = 'pending'`,
  );
  return r?.n ?? 0;
}

// --- Self-service changes (ADR 0012) -------------------------------------------

async function shopSettings(ctx: Ctx) {
  return resolveSettings((await one<{ settings: unknown }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId]))?.settings);
}

/** The share of the rental refunded when cancelling now, by the shop's cancellation tiers. */
export function refundPctAt(s: TenantSettings, startsAt: Date, now: Date) {
  const hoursBefore = (startsAt.getTime() - now.getTime()) / 3_600_000;
  return [...s.cancellation_policy].sort((a, b) => b.hours_before - a.hours_before).find((t) => hoursBefore >= t.hours_before)?.refund_pct ?? 0;
}

/**
 * What the customer may change on a booking themselves, by the shop's rules: cancel (with the refund
 * that would apply now) and move the dates, directly or by asking.
 */
export function selfServiceFor(ctx: Ctx, o: any, s: TenantSettings) {
  const hoursBefore = (new Date(o.starts_at).getTime() - ctx.now.getTime()) / 3_600_000;
  const ss = s.self_service;
  const cancel = ss.cancel === 'self' && CANCELLABLE.includes(o.status) && hoursBefore >= ss.cancel_until_hours ? { refund_pct: refundPctAt(s, new Date(o.starts_at), ctx.now) } : null;
  const change = ss.change_dates !== 'off' && ['reserved', 'prepared'].includes(o.status) && !o.billing_cycle && hoursBefore >= ss.change_until_hours ? ss.change_dates : null;
  return { cancel, change_dates: change as 'self' | 'request' | null, cancel_until_hours: ss.cancel_until_hours, change_until_hours: ss.change_until_hours };
}

/** The customer cancels a booking themselves, when the shop allows it; the refund follows the cancellation tiers. */
export async function cancelByCustomer(ctx: Ctx, email: string, orderId: string, input: { reason?: string } = {}) {
  const { order, customerId } = await ownedOrder(ctx, email, orderId);
  if (!selfServiceFor(ctx, order, await shopSettings(ctx)).cancel) throw conflict('self_cancel_not_allowed', t('account.self_cancel_not_allowed'));
  const c = asCustomer(ctx, customerId);
  const reason = String(input.reason ?? '').trim().slice(0, 500);
  const result = await runAction(c, order.id, 'cancel', { reason: reason || t('account.cancelled_by_customer'), notify: true });
  await notifyStaff(c, order.id, 'staff_customer_cancelled', { reason });
  return result;
}

/**
 * The customer moves a booking to other dates: directly when the shop allows it (priced and checked
 * like a change by staff), or as a request staff approve. `dry_run` answers with the price and
 * whether the dates are free, without changing anything.
 */
export async function changeDatesByCustomer(ctx: Ctx, email: string, orderId: string, input: { starts_at: string; ends_at: string; reason?: string; dry_run?: boolean }) {
  const { order, customerId } = await ownedOrder(ctx, email, orderId);
  const mode = selfServiceFor(ctx, order, await shopSettings(ctx)).change_dates;
  if (!mode) throw conflict('date_change_not_allowed', t('account.date_change_not_allowed'));
  const c = asCustomer(ctx, customerId);
  if (mode === 'self' || input.dry_run) {
    const r = await rescheduleOrder(c, order.id, { starts_at: input.starts_at, ends_at: input.ends_at, dry_run: input.dry_run, notify: true });
    if (!input.dry_run) await notifyStaff(c, order.id, 'staff_customer_rescheduled', {});
    return { ...r, mode };
  }
  const pending = (await latestExtensions(ctx, [order.id])).get(order.id);
  if (pending?.status === 'pending') throw conflict('extension_pending', t('account.extension_pending'));
  // The dates must at least be possible; staff decide on the rest.
  await rescheduleOrder(c, order.id, { starts_at: input.starts_at, ends_at: input.ends_at, dry_run: true });
  const reason = String(input.reason ?? '').trim().slice(0, 1000);
  const row = await one(
    ctx,
    `INSERT INTO extension_requests (id, tenant_id, order_id, customer_id, requested_starts_at, requested_ends_at, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (order_id) WHERE status = 'pending' DO NOTHING RETURNING *`,
    [newId('xreq'), ctx.tenantId, order.id, customerId, new Date(input.starts_at), new Date(input.ends_at), reason],
  );
  if (!row) throw conflict('extension_pending', t('account.extension_pending'));
  await audit(c, { entity_type: 'order', entity_id: order.id, action: 'date_change_requested', extra: { request_id: row.id, starts_at: input.starts_at, ends_at: input.ends_at, reason } });
  await emit(c, 'order.extension_requested', { type: 'order', id: order.id }, extensionToApi(row));
  await notifyStaff(c, order.id, 'staff_date_change_requested', { reason });
  return { ...extensionToApi(row), mode };
}

// --- Extension requests (FR-CUS-6, FR-OR-9) -----------------------------------

const EXTENDABLE = ['reserved', 'prepared', 'out'];

export function extensionToApi(r: any) {
  if (!r) return null;
  return {
    id: r.id, object: 'extension_request', order_id: r.order_id, status: r.status, requested_starts_at: r.requested_starts_at ?? null, requested_ends_at: r.requested_ends_at, reason: r.reason,
    decision_note: r.decision_note, created_at: r.created_at, decided_at: r.decided_at,
  };
}

/** Latest extension request per order. */
export async function latestExtensions(ctx: Ctx, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, any>();
  const rows = await many(ctx, `SELECT DISTINCT ON (order_id) * FROM extension_requests WHERE order_id = ANY($1) ORDER BY order_id, created_at DESC`, [orderIds]);
  return new Map(rows.map((r) => [r.order_id as string, r]));
}

export async function extensionRequestFor(ctx: Ctx, orderId: string) {
  return extensionToApi((await latestExtensions(ctx, [orderId])).get(orderId));
}

/** A booking that is confirmed or out, not yet over, and without a request waiting. */
export function canRequestExtension(ctx: Ctx, o: any, request: any) {
  return EXTENDABLE.includes(o.status) && new Date(o.ends_at) > ctx.now && request?.status !== 'pending';
}

export async function requestExtension(ctx: Ctx, email: string, orderId: string, input: { ends_at: string; reason?: string }) {
  return createExtension(ctx, await ownedOrder(ctx, email, orderId), input);
}

export async function requestExtensionByToken(ctx: Ctx, orderId: string, token: string, input: { ends_at: string; reason?: string }) {
  return createExtension(ctx, await tokenOrder(ctx, orderId, token), input);
}

async function createExtension(ctx: Ctx, { order, customerId }: { order: any; customerId: string }, input: { ends_at: string; reason?: string }) {
  const pending = (await latestExtensions(ctx, [order.id])).get(order.id);
  if (pending?.status === 'pending') throw conflict('extension_pending', t('account.extension_pending'));
  if (!canRequestExtension(ctx, order, pending)) throw conflict('extension_not_allowed', t('account.extension_not_allowed'));
  const end = new Date(input.ends_at);
  if (Number.isNaN(end.getTime()) || end <= new Date(order.ends_at)) {
    throw invalid(t('account.extension_after_end'), [{ field: 'ends_at', code: 'invalid', message: t('account.extension_after_end') }]);
  }
  const reason = String(input.reason ?? '').trim().slice(0, 1000);
  const row = await one(
    ctx,
    `INSERT INTO extension_requests (id, tenant_id, order_id, customer_id, requested_ends_at, reason) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (order_id) WHERE status = 'pending' DO NOTHING RETURNING *`,
    [newId('xreq'), ctx.tenantId, order.id, customerId, end, reason],
  );
  if (!row) throw conflict('extension_pending', t('account.extension_pending'));
  const c = asCustomer(ctx, customerId);
  await audit(c, { entity_type: 'order', entity_id: order.id, action: 'extension_requested', extra: { request_id: row.id, ends_at: end.toISOString(), reason } });
  await emit(c, 'order.extension_requested', { type: 'order', id: order.id }, extensionToApi(row));
  await notifyCustomer(c, order.id, 'extension_request_received', { requested_end: end.toISOString(), reason });
  await notifyStaff(c, order.id, 'staff_extension_requested', { requested_end: end.toISOString(), reason });
  return extensionToApi(row);
}

export async function withdrawExtension(ctx: Ctx, email: string, orderId: string) {
  return withdrawExt(ctx, await ownedOrder(ctx, email, orderId));
}

export async function withdrawExtensionByToken(ctx: Ctx, orderId: string, token: string) {
  return withdrawExt(ctx, await tokenOrder(ctx, orderId, token));
}

async function withdrawExt(ctx: Ctx, { order, customerId }: { order: any; customerId: string }) {
  const row = await one(ctx, `UPDATE extension_requests SET status = 'withdrawn', decided_at = now() WHERE order_id = $1 AND status = 'pending' RETURNING *`, [order.id]);
  if (!row) throw notFound('extension_request');
  await audit(asCustomer(ctx, customerId), { entity_type: 'order', entity_id: order.id, action: 'extension_withdrawn', extra: { request_id: row.id } });
  return extensionToApi(row);
}

/**
 * Staff decision. Approving extends the order to the requested (or a staff-chosen) time, which checks
 * availability, adds the price difference and emails the customer; if the stock is taken it fails with a 409.
 */
export async function decideExtension(ctx: Ctx, requestId: string, input: { approve: boolean; ends_at?: string; note?: string }) {
  const req = await one(ctx, `SELECT * FROM extension_requests WHERE id = $1 FOR UPDATE`, [requestId]);
  if (!req) throw notFound('extension_request', requestId);
  if (req.status !== 'pending') throw conflict('extension_decided', t('account.extension_decided'));
  const note = input.note?.trim().slice(0, 1000) || null;
  // A request for other dates altogether moves the booking; one for a later return extends it.
  if (input.approve && req.requested_starts_at) await rescheduleOrder(ctx, req.order_id, { starts_at: new Date(req.requested_starts_at).toISOString(), ends_at: input.ends_at ?? new Date(req.requested_ends_at).toISOString(), notify: true });
  else if (input.approve) await extendOrder(ctx, req.order_id, { ends_at: input.ends_at ?? new Date(req.requested_ends_at).toISOString(), notify: true });
  const row = await one(
    ctx,
    `UPDATE extension_requests SET status = $2, decision_note = $3, decided_by = $4, decided_at = now() WHERE id = $1 RETURNING *`,
    [requestId, input.approve ? 'approved' : 'declined', note, ctx.actor.id],
  );
  if (!input.approve) await notifyCustomer(ctx, req.order_id, 'extension_declined', { note });
  await audit(ctx, { entity_type: 'order', entity_id: req.order_id, action: input.approve ? 'extension_approved' : 'extension_declined', extra: { request_id: requestId, note } });
  await emit(ctx, 'order.extension_decided', { type: 'order', id: req.order_id }, extensionToApi(row));
  return extensionToApi(row);
}

export async function listExtensionRequests(ctx: Ctx, filter: { status?: string } = {}) {
  const rows = await many(
    ctx,
    `SELECT r.*, o.number, o.ends_at, c.name AS customer_name FROM extension_requests r JOIN orders o ON o.id = r.order_id LEFT JOIN customers c ON c.id = r.customer_id
      WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`,
    [filter.status ?? null],
  );
  return rows.map((r) => ({ ...extensionToApi(r), order_number: r.number, ends_at: r.ends_at, customer_name: r.customer_name }));
}

// --- Documents -----------------------------------------------------------------

async function customerDocument(ctx: Ctx, docId: string, orderIds: string[]) {
  const d = orderIds.length
    ? await one(
        ctx,
        `SELECT * FROM documents WHERE id = $1 AND order_id = ANY($2) AND status <> 'voided' AND type = ANY($3)`,
        [docId, orderIds, CUSTOMER_DOCUMENTS],
      )
    : null;
  if (!d) throw notFound('document', docId);
  return d;
}

/** A document of one of the signed-in customer's bookings. */
export async function documentForEmail(ctx: Ctx, email: string, docId: string) {
  const customers = await customersFor(ctx, email);
  const orders = customers.length
    ? await many<{ id: string }>(ctx, `SELECT id FROM orders WHERE customer_id = ANY($1)`, [
        customers.map((c) => c.id),
      ])
    : [];
  return customerDocument(
    ctx,
    docId,
    orders.map((o) => o.id),
  );
}

async function orderIdsFor(ctx: Ctx, email: string) {
  const customers = await customersFor(ctx, email);
  return customers.length ? (await many<{ id: string }>(ctx, `SELECT id FROM orders WHERE customer_id = ANY($1)`, [customers.map((c) => c.id)])).map((o) => o.id) : [];
}

async function orderIdForToken(ctx: Ctx, orderId: string, token: string) {
  const o = token && token.length >= 16 ? await one<{ id: string }>(ctx, `SELECT id FROM orders WHERE (id = $1 OR public_token = $1) AND public_token = $2`, [orderId, token]) : null;
  return o ? [o.id] : [];
}

/** A customer-visible attachment on one of the signed-in customer's bookings. */
export async function attachmentForEmail(ctx: Ctx, email: string, attachmentId: string) {
  return customerAttachmentFile(ctx, attachmentId, await orderIdsFor(ctx, email));
}

/** A customer-visible attachment of the booking behind a public order link. */
export async function attachmentForToken(ctx: Ctx, orderId: string, token: string, attachmentId: string) {
  return customerAttachmentFile(ctx, attachmentId, await orderIdForToken(ctx, orderId, token));
}

/** A document of the booking behind a public order link. */
export async function documentForToken(ctx: Ctx, orderId: string, token: string, docId: string) {
  const o =
    token && token.length >= 16
      ? await one<{ id: string }>(
          ctx,
          `SELECT id FROM orders WHERE (id = $1 OR public_token = $1) AND public_token = $2`,
          [orderId, token],
        )
      : null;
  return customerDocument(ctx, docId, o ? [o.id] : []);
}
