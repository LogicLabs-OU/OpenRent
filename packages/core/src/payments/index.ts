import { t as msg } from '../i18n/index.ts';
import type { PaymentProvider, ProviderContext, ProviderEvent } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { hookContext } from '../plugins/scope.ts';
import { money } from '../crud.ts';
import { AppError, invalid } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { addMinutes } from '../time.ts';
import { notifyCustomer, notifyStaff, storefrontBase } from '../notifications/index.ts';
import { issueDocument } from '../documents/index.ts';
import { resolveSettings } from '../tenancy/settings.ts';
import { t } from '../i18n/index.ts';
import { tenantLocale } from '../i18n/context.ts';
import { isPluginEnabled } from '../plugins/index.ts';
import { photosOf } from '../maintenance/index.ts';
import { invoicePaid } from './customer.ts';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export async function providerContext(ctx: Ctx, providerId: string): Promise<{ provider: PaymentProvider; pctx: ProviderContext; enabled: boolean; mode: string }> {
  const provider = ctx.plugins.paymentProvider(providerId);
  if (!provider) throw new AppError('provider_not_installed', 422, msg('error.payment_provider_is_not_installed', { providerId }));
  const pluginId = ctx.plugins.pluginIdOf(providerId) ?? providerId;
  const row = await one(ctx, `SELECT * FROM payment_providers WHERE plugin_id = $1`, [providerId]);
  const stored = row?.config_encrypted ? JSON.parse(ctx.secrets.decrypt(row.config_encrypted)) : {};
  const config = { ...ctx.plugins.defaultConfig(pluginId), ...stored };
  // Off when the tenant disabled the plugin (Settings → Plugins) or the provider (Settings → Payments).
  const pluginOn = await isPluginEnabled(ctx, pluginId);
  return {
    provider,
    enabled: pluginOn && (row ? row.enabled : true),
    mode: row?.mode ?? (String(config.secret_key ?? '').startsWith('sk_live') ? 'live' : 'test'),
    pctx: { tenantId: ctx.tenantId, config, logger: ctx.logger, idempotencyKey: ctx.idempotencyKey, webhookUrl: `${ctx.config.publicUrl.replace(/\/$/, '')}/webhooks/${providerId}/${ctx.tenantId}` },
  };
}

/** The online provider used for storefront checkout and card deposits, if one is configured. */
export async function activeProvider(ctx: Ctx) {
  for (const p of ctx.plugins.paymentProviders()) {
    const pc = await providerContext(ctx, p.id);
    if (pc.enabled && p.isConfigured(pc.pctx)) return pc;
  }
  return null;
}

/**
 * Installed providers with their state. With the plugins' settings fields (`installed`), each also lists
 * its fields, the values of the plain ones and whether each secret is set; secrets never leave the server.
 */
export async function listPaymentProviders(ctx: Ctx, installed: { id: string; settings?: { key: string; type: string }[] }[] = []) {
  const out = [];
  for (const p of ctx.plugins.paymentProviders()) {
    const pc = await providerContext(ctx, p.id);
    const row = await one(ctx, `SELECT id FROM payment_providers WHERE plugin_id = $1`, [p.id]);
    const pluginId = ctx.plugins.pluginIdOf(p.id) ?? p.id;
    const fields = (installed.find((x) => x.id === pluginId)?.settings ?? []).filter((f) => !/base_url$/.test(f.key));
    const values: Record<string, unknown> = {};
    const secrets: Record<string, boolean> = {};
    for (const f of fields) {
      if (f.type === 'secret') secrets[f.key] = !!pc.pctx.config[f.key];
      else values[f.key] = pc.pctx.config[f.key] ?? null;
    }
    out.push({
      id: p.id, object: 'payment_provider', plugin_id: pluginId, record_id: row?.id ?? null, display_name: p.displayName, configured: p.isConfigured(pc.pctx),
      enabled: pc.enabled, mode: pc.mode, authorization_window_days: p.authorizationWindowDays, public_config: p.isConfigured(pc.pctx) ? p.publicConfig(pc.pctx) : {},
      webhook_url: `${ctx.config.publicUrl.replace(/\/$/, '')}/webhooks/${p.id}/${ctx.tenantId}`, settings: fields, values, secrets,
    });
  }
  return out;
}

export async function updatePaymentProvider(ctx: Ctx, providerId: string, patch: { enabled?: boolean; mode?: 'test' | 'live'; config?: Record<string, unknown> }) {
  if (!ctx.plugins.paymentProvider(providerId)) throw new AppError('not_found', 404, msg('error.payment_provider_is_not_installed', { providerId }));
  const row = await one(ctx, `SELECT * FROM payment_providers WHERE plugin_id = $1`, [providerId]);
  const current = row?.config_encrypted ? JSON.parse(ctx.secrets.decrypt(row.config_encrypted)) : {};
  const merged = { ...current, ...(patch.config ?? {}) };
  for (const [k, v] of Object.entries(merged)) if (v === null || v === '') delete merged[k];
  const sealed = ctx.secrets.encrypt(JSON.stringify(merged));
  if (row) {
    await exec(ctx, `UPDATE payment_providers SET config_encrypted = $2, enabled = coalesce($3, enabled), mode = coalesce($4, mode) WHERE id = $1`, [row.id, sealed, patch.enabled ?? null, patch.mode ?? null]);
  } else {
    await exec(ctx, `INSERT INTO payment_providers (id, tenant_id, plugin_id, config_encrypted, enabled, mode) VALUES ($1,$2,$3,$4,$5,$6)`, [
      newId('ppr'), ctx.tenantId, providerId, sealed, patch.enabled ?? true, patch.mode ?? 'test',
    ]);
  }
  await audit(ctx, { entity_type: 'payment_provider', entity_id: providerId, action: 'update', extra: { keys: Object.keys(patch.config ?? {}), enabled: patch.enabled, mode: patch.mode } });
  return (await listPaymentProviders(ctx)).find((p) => p.id === providerId);
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export function paymentToApi(p: any) {
  return {
    id: p.id, object: 'payment', order_id: p.order_id, customer_id: p.customer_id ?? null, document_id: p.document_id ?? null, provider: p.provider, kind: p.kind, purpose: p.purpose, method: p.method,
    amount: money(p.amount, p.currency), status: p.status, provider_ref: p.provider_ref, parent_payment_id: p.parent_payment_id,
    note: p.note, created_at: p.created_at,
  };
}

const BALANCE_PURPOSES = ['rental', 'late_fee'];

export async function orderLedger(ctx: Ctx, orderId: string) {
  const r = await one<{ paid: number; refunded: number }>(
    ctx,
    `SELECT coalesce(sum(amount) FILTER (WHERE kind IN ('charge','manual') AND status = 'succeeded'), 0)::bigint AS paid,
            coalesce(sum(amount) FILTER (WHERE kind = 'refund' AND status IN ('succeeded','pending')), 0)::bigint AS refunded
       FROM payments WHERE order_id = $1 AND purpose = ANY($2)`,
    [orderId, BALANCE_PURPOSES],
  );
  return { paid: Number(r?.paid ?? 0), refunded: Number(r?.refunded ?? 0) };
}

/** FR-PAY-3: payment status is derived from ledger rows, never edited by hand. */
export async function recomputePaymentStatus(ctx: Ctx, orderId: string) {
  const o = await must<any>(ctx, `SELECT id, status, totals, ends_at, payment_status FROM orders WHERE id = $1`, [orderId], 'order', orderId);
  const { paid, refunded } = await orderLedger(ctx, orderId);
  const total = Number(o.totals?.total ?? 0);
  const net = paid - refunded;
  let status: string;
  if (refunded > 0 && net <= 0 && paid > 0) status = 'refunded';
  else if (net >= total) status = 'paid';
  else if (net > 0) status = 'partially_paid';
  else status = 'unpaid';
  if ((status === 'unpaid' || status === 'partially_paid') && !['draft', 'quote', 'cancelled', 'expired'].includes(o.status) && new Date(o.ends_at) < ctx.now) status = 'overdue';
  const totals = { ...o.totals, paid: net, refunded, balance: Math.max(0, total - net) };
  await exec(ctx, `UPDATE orders SET payment_status = $2, totals = $3 WHERE id = $1`, [orderId, status, json(totals)]);
  return { status, totals, previous: o.payment_status as string };
}

async function orderForPayment(ctx: Ctx, orderId: string) {
  return must<any>(ctx, `SELECT * FROM orders WHERE id = $1`, [orderId], 'order', orderId);
}

export async function listPayments(ctx: Ctx, filter: { order_id?: string; limit?: number } = {}) {
  const rows = await many(ctx, `SELECT * FROM payments WHERE ($1::text IS NULL OR order_id = $1) ORDER BY created_at DESC LIMIT $2`, [filter.order_id ?? null, Math.min(filter.limit ?? 100, 200)]);
  return rows.map(paymentToApi);
}

export async function getPayment(ctx: Ctx, id: string) {
  return paymentToApi(await must(ctx, `SELECT * FROM payments WHERE id = $1`, [id], 'payment', id));
}

/** FR-PAY-2: cash, bank transfer, card terminal recorded by staff. */
export async function recordManualPayment(ctx: Ctx, orderId: string, input: { amount: number; method: string; purpose?: 'rental' | 'deposit' | 'damage' | 'late_fee'; note?: string }) {
  const o = await orderForPayment(ctx, orderId);
  if (['cancelled', 'expired'].includes(o.status)) throw new AppError('order_closed', 409, msg('error.cannot_take_payments_on_a_cancelled_order'));
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw invalid(msg('error.amount_must_be_a_positive_integer_in'));
  // A plugin may refuse a payment taken by staff (HookVeto), e.g. above a till limit.
  await ctx.plugins.runHook('before', 'payments.record', { order_id: orderId, ...input, provider: 'manual' }, hookContext(ctx));
  const row = (
    await many(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, note, idempotency_key, created_by)
       VALUES ($1,$2,$3,'manual','manual',$4,$5,$6,$7,'succeeded',$8,$9,$10) RETURNING *`,
      [newId('pay'), ctx.tenantId, orderId, input.purpose ?? 'rental', input.method, input.amount, o.currency, input.note ?? null, ctx.idempotencyKey ?? null, ctx.actor.id],
    )
  )[0];
  await audit(ctx, { entity_type: 'payment', entity_id: row.id, action: 'create', after: row });
  await afterPaymentSucceeded(ctx, o, row);
  return paymentToApi(row);
}

async function afterPaymentSucceeded(ctx: Ctx, order: any, payment: any) {
  await ctx.plugins.runHook('after', 'payments.record', paymentToApi(payment), hookContext(ctx));
  const status = await recomputePaymentStatus(ctx, order.id);
  await emit(ctx, 'payment.succeeded', { type: 'payment', id: payment.id }, paymentToApi(payment));
  if (status.previous !== status.status) {
    await emit(ctx, 'order.updated', { type: 'order', id: order.id }, { id: order.id, object: 'order', payment_status: status.status }, { payment_status: status.previous });
  }
  await notifyCustomer(ctx, order.id, 'payment_received', { payment: { amount: Number(payment.amount) } });
}

/** Creates a provider payment intent for the order balance (or a given amount). */
export async function createPaymentIntent(ctx: Ctx, orderId: string, input: { amount?: number; purpose?: 'rental' | 'damage' | 'late_fee'; paymentRequestId?: string | null } = {}) {
  const o = await orderForPayment(ctx, orderId);
  const pc = await activeProvider(ctx);
  if (!pc) throw new AppError('no_payment_provider', 409, msg('error.no_online_payment_provider_is_configured'));
  const amount = input.amount ?? Number(o.totals?.balance ?? o.totals?.total ?? 0);
  if (amount <= 0) throw new AppError('nothing_to_pay', 409, msg('error.this_order_has_no_balance_due'));
  const customer = o.customer_id ? await one(ctx, `SELECT * FROM customers WHERE id = $1`, [o.customer_id]) : null;
  if (!customer) throw new AppError('customer_required', 422, msg('error.add_a_customer_before_taking_an_online'));
  const result = await pc.provider.createPaymentIntent(pc.pctx, {
    amount,
    currency: o.currency.trim(),
    orderId,
    orderNumber: o.number,
    reference: orderId,
    purpose: input.purpose ?? 'rental',
    customer: { id: customer.id, name: customer.name, email: customer.email, providerRef: customer.provider_refs?.[pc.provider.id] ?? null },
    savePaymentMethod: Number(o.totals?.deposit ?? 0) > 0,
    description: msg('payment.description.order', { number: o.number }, await tenantLocale(ctx)),
    metadata: { order_id: orderId, tenant_id: ctx.tenantId, purpose: input.purpose ?? 'rental', ...(input.paymentRequestId ? { payment_request_id: input.paymentRequestId } : {}) },
    returnUrl: `${(await storefrontBase(ctx, customer.locale)).replace(/\/$/, '')}/order/${o.public_token}`,
  });
  if (result.customerRef && customer.provider_refs?.[pc.provider.id] !== result.customerRef) {
    await exec(ctx, `UPDATE customers SET provider_refs = provider_refs || $2 WHERE id = $1`, [customer.id, json({ [pc.provider.id]: result.customerRef })]);
  }
  const row = (
    await many(
      ctx,
      `INSERT INTO payment_intents (id, tenant_id, order_id, provider, purpose, amount, currency, status, provider_ref, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount, status = EXCLUDED.status
       RETURNING *`,
      [newId('pin'), ctx.tenantId, orderId, pc.provider.id, input.purpose ?? 'rental', amount, o.currency, result.status, result.ref, addMinutes(ctx.now, 60 * 24)],
    )
  )[0];
  await emit(ctx, 'payment_intent.created', { type: 'payment_intent', id: row.id }, { id: row.id, object: 'payment_intent', order_id: orderId, amount: money(amount, o.currency), provider: pc.provider.id });
  return {
    id: row.id, object: 'payment_intent', order_id: orderId, provider: pc.provider.id, amount: money(amount, o.currency), status: result.status,
    client_secret: result.clientSecret, redirect_url: result.redirectUrl ?? null, public_config: pc.provider.publicConfig(pc.pctx),
  };
}

/**
 * Cancels a payment that has not settled (PRD §5.4 /payments/{id}/actions/void): a pending online payment
 * or an authorisation not captured. The provider cancels it too; money that settled is refunded instead.
 */
export async function voidPayment(ctx: Ctx, paymentId: string, input: { reason?: string } = {}) {
  const p = await must<any>(ctx, `SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [paymentId], 'payment', paymentId);
  const voidable = p.kind !== 'refund' && (p.status === 'pending' || (p.kind === 'authorization' && p.status === 'succeeded'));
  if (!voidable) throw new AppError('not_voidable', 409, msg('error.payment_not_voidable'));
  if (p.provider && p.provider !== 'manual' && p.provider_ref) {
    const pc = await providerContext(ctx, p.provider);
    await pc.provider.void({ ...pc.pctx, idempotencyKey: `void:${p.id}` }, p.provider_ref);
  }
  const note = input.reason?.trim() ? input.reason.trim().slice(0, 500) : p.note;
  const row = (await many(ctx, `UPDATE payments SET status = 'cancelled', note = $2 WHERE id = $1 RETURNING *`, [p.id, note]))[0];
  await audit(ctx, { entity_type: 'payment', entity_id: p.id, action: 'void', before: p, after: row });
  if (p.order_id) await recomputePaymentStatus(ctx, p.order_id);
  const api = paymentToApi(row);
  await emit(ctx, 'payment.voided', { type: 'payment', id: p.id }, api);
  return api;
}

export async function refundPayment(ctx: Ctx, paymentId: string, input: { amount?: number; reason?: string }) {
  const p = await must<any>(ctx, `SELECT * FROM payments WHERE id = $1`, [paymentId], 'payment', paymentId);
  if (p.kind === 'refund' || p.status !== 'succeeded') throw new AppError('not_refundable', 409, msg('error.only_succeeded_payments_can_be_refunded'));
  const done = Number((await one(ctx, `SELECT coalesce(sum(amount), 0)::bigint AS n FROM payments WHERE parent_payment_id = $1 AND kind = 'refund' AND status <> 'failed'`, [paymentId]))?.n ?? 0);
  const amount = input.amount ?? Number(p.amount) - done;
  if (amount <= 0 || amount > Number(p.amount) - done) throw invalid(msg('error.at_most_can_be_refunded', { done: Number(p.amount) - done }));
  let status: string = 'succeeded';
  let ref: string | null = null;
  if (p.provider !== 'manual') {
    const pc = await providerContext(ctx, p.provider);
    // A part of an invoice payment is refunded on the provider's payment it came from.
    const r = await pc.provider.refund(pc.pctx, p.metadata?.provider_payment_ref ?? p.provider_ref, amount);
    status = r.status === 'failed' ? 'failed' : r.status === 'pending' ? 'pending' : 'succeeded';
    ref = r.ref;
  }
  const row = (
    await many(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, customer_id, document_id, provider, kind, purpose, method, amount, currency, status, provider_ref, parent_payment_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'refund',$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [newId('pay'), ctx.tenantId, p.order_id, p.customer_id, p.document_id, p.provider, p.purpose, p.method, amount, p.currency, status, ref, p.id, input.reason ?? null, ctx.actor.id],
    )
  )[0];
  await audit(ctx, { entity_type: 'payment', entity_id: row.id, action: 'refund', after: row });
  if (p.order_id) await recomputePaymentStatus(ctx, p.order_id);
  if (status !== 'failed') await emit(ctx, 'payment.refunded', { type: 'payment', id: row.id }, paymentToApi(row));
  return paymentToApi(row);
}

// ---------------------------------------------------------------------------
// Deposits (FR-PAY-4, FR-PAY-5)
// ---------------------------------------------------------------------------

export function depositToApi(d: any) {
  return {
    id: d.id, object: 'deposit', order_id: d.order_id, amount: money(d.amount, d.currency), method: d.method, status: d.status, provider: d.provider,
    provider_ref: d.provider_ref, authorized_at: d.authorized_at, expires_at: d.expires_at, captured_amount: money(d.captured_amount, d.currency),
    released_at: d.released_at, created_at: d.created_at,
  };
}

export async function listDeposits(ctx: Ctx, filter: { order_id?: string; status?: string } = {}) {
  const rows = await many(ctx, `SELECT * FROM deposits WHERE ($1::text IS NULL OR order_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT 200`, [filter.order_id ?? null, filter.status ?? null]);
  return rows.map(depositToApi);
}

export async function getDeposit(ctx: Ctx, id: string) {
  return depositToApi(await must(ctx, `SELECT * FROM deposits WHERE id = $1`, [id], 'deposit', id));
}

/** Creates the pending deposit when an order is reserved. Card when a provider is configured, else cash. */
export async function ensureDeposit(ctx: Ctx, orderId: string): Promise<any | null> {
  const o = await orderForPayment(ctx, orderId);
  const amount = Number(o.totals?.deposit ?? 0);
  const existing = await one(ctx, `SELECT * FROM deposits WHERE order_id = $1 AND status NOT IN ('released','expired','failed') ORDER BY created_at DESC LIMIT 1`, [orderId]);
  if (existing) {
    if (existing.status === 'pending' && Number(existing.amount) !== amount) {
      await exec(ctx, `UPDATE deposits SET amount = $2 WHERE id = $1`, [existing.id, amount]);
    }
    return existing;
  }
  if (amount <= 0) return null;
  const pc = await activeProvider(ctx);
  const row = (
    await many(
      ctx,
      `INSERT INTO deposits (id, tenant_id, order_id, amount, currency, method, status, provider) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING *`,
      [newId('dep'), ctx.tenantId, orderId, amount, o.currency, pc ? 'card_auth' : 'cash', pc?.provider.id ?? null],
    )
  )[0];
  await audit(ctx, { entity_type: 'deposit', entity_id: row.id, action: 'create', after: row });
  return row;
}

export async function createDeposit(ctx: Ctx, orderId: string, input: { amount: number; method: 'card_auth' | 'charge' | 'cash' | 'waived' }) {
  const o = await orderForPayment(ctx, orderId);
  const open = await one(ctx, `SELECT 1 FROM deposits WHERE order_id = $1 AND status IN ('pending','held','partially_captured')`, [orderId]);
  if (open) throw new AppError('deposit_exists', 409, msg('error.this_order_already_has_an_open_deposit'));
  const row = (
    await many(ctx, `INSERT INTO deposits (id, tenant_id, order_id, amount, currency, method, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
      newId('dep'), ctx.tenantId, orderId, input.amount, o.currency, input.method, input.method === 'waived' ? 'released' : 'pending',
    ])
  )[0];
  await audit(ctx, { entity_type: 'deposit', entity_id: row.id, action: 'create', after: row });
  return depositToApi(row);
}

async function latestPaymentMethod(ctx: Ctx, orderId: string, providerId: string) {
  const p = await one(
    ctx,
    `SELECT metadata FROM payments WHERE order_id = $1 AND provider = $2 AND status = 'succeeded' AND metadata ? 'payment_method' ORDER BY created_at DESC LIMIT 1`,
    [orderId, providerId],
  );
  return p?.metadata ?? null;
}

/**
 * Charges a card the customer saved on this booking (or an earlier one) without them being there, e.g. a
 * period of a long rental (FR-OR-11): an authorisation captured at once. Null when there is no saved card;
 * a refused charge comes back as `{ failed }` so the caller can ask for payment another way.
 */
export async function chargeSavedCard(ctx: Ctx, orderId: string, input: { amount: number; purpose: 'rental'; description: string; key: string }): Promise<{ payment: any } | { failed: string } | null> {
  const pc = await activeProvider(ctx);
  if (!pc) return null;
  const o = await orderForPayment(ctx, orderId);
  const pm =
    (await latestPaymentMethod(ctx, orderId, pc.provider.id)) ??
    (o.customer_id
      ? (await one<any>(ctx, `SELECT p.metadata FROM payments p JOIN orders x ON x.id = p.order_id WHERE x.customer_id = $1 AND p.provider = $2 AND p.status = 'succeeded' AND p.metadata ? 'payment_method' ORDER BY p.created_at DESC LIMIT 1`, [o.customer_id, pc.provider.id]))?.metadata
      : null);
  if (!pm?.payment_method || !pm?.customer) return null;
  const pctx = { ...pc.pctx, idempotencyKey: input.key };
  const r = await pc.provider.authorize(pctx, { amount: input.amount, currency: o.currency.trim(), orderId, customerRef: pm.customer, paymentMethodRef: pm.payment_method, description: input.description, metadata: { order_id: orderId, tenant_id: ctx.tenantId, purpose: input.purpose } });
  if (r.status !== 'held') return { failed: r.error ?? r.status };
  const cap = await pc.provider.capture(pctx, r.ref, input.amount);
  if (cap.status === 'failed') {
    await pc.provider.void(pctx, r.ref).catch(() => undefined);
    return { failed: 'capture_failed' };
  }
  const payment = (
    await many(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, metadata, created_by) VALUES ($1,$2,$3,$4,'charge',$5,'card',$6,$7,'succeeded',$8,$9,$10) RETURNING *`,
      [newId('pay'), ctx.tenantId, orderId, pc.provider.id, input.purpose, input.amount, o.currency, r.ref, json({ payment_method: pm.payment_method, customer: pm.customer }), ctx.actor.id],
    )
  )[0];
  await recomputePaymentStatus(ctx, orderId);
  await emit(ctx, 'payment.succeeded', { type: 'payment', id: payment.id }, paymentToApi(payment));
  return { payment };
}

/** The provider and saved card for an order's deposit, when the customer paid online before. */
async function cardOnFile(ctx: Ctx, d: any) {
  const pc = d.provider ? await providerContext(ctx, d.provider) : await activeProvider(ctx);
  if (!pc) return null;
  const pm = await latestPaymentMethod(ctx, d.order_id, pc.provider.id);
  return pm?.payment_method && pm?.customer ? { pc, pm } : null;
}

async function depositFailed(ctx: Ctx, d: any, providerId: string, ref: string | null, error: string) {
  const row = (await many(ctx, `UPDATE deposits SET status = 'failed', provider_ref = $2, provider = $3 WHERE id = $1 RETURNING *`, [d.id, ref || null, providerId]))[0];
  await emit(ctx, 'deposit.failed', { type: 'deposit', id: d.id }, { ...depositToApi(row), error });
  await notifyStaff(ctx, d.order_id, 'staff_payment_failed', { error: msg('payment.error.deposit_authorisation', { error }, await tenantLocale(ctx)) });
  return depositToApi(row);
}

/**
 * Takes a deposit (FR-PAY-4): a card hold, a charge or cash. A charge goes through the payment provider
 * when the customer has a saved card (`via: 'provider'`), otherwise staff record it (`via: 'manual'`,
 * e.g. a card terminal).
 */
export async function authorizeDeposit(ctx: Ctx, id: string, input: { method?: 'card_auth' | 'cash' | 'charge'; via?: 'provider' | 'manual' } = {}) {
  const d = await must<any>(ctx, `SELECT * FROM deposits WHERE id = $1 FOR UPDATE`, [id], 'deposit', id);
  if (!['pending', 'expired', 'failed'].includes(d.status)) throw new AppError('invalid_transition', 409, msg('error.deposit_is', { status: d.status }));
  const method = input.method ?? d.method;
  const order = await orderForPayment(ctx, d.order_id);
  const card = method === 'cash' || input.via === 'manual' ? null : await cardOnFile(ctx, d);
  if (method === 'cash' || (method === 'charge' && !card && input.via !== 'provider')) {
    const pay = (
      await many(
        ctx,
        `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, created_by) VALUES ($1,$2,$3,'manual','manual','deposit',$4,$5,$6,'succeeded',$7) RETURNING *`,
        [newId('pay'), ctx.tenantId, d.order_id, method === 'cash' ? 'cash' : 'card', d.amount, d.currency, ctx.actor.id],
      )
    )[0];
    const row = (await many(ctx, `UPDATE deposits SET method = $2, status = 'held', authorized_at = now(), payment_id = $3, expires_at = NULL WHERE id = $1 RETURNING *`, [id, method, pay.id]))[0];
    await emit(ctx, 'deposit.authorized', { type: 'deposit', id }, depositToApi(row));
    await issueDocument(ctx, d.order_id, 'deposit_receipt');
    return depositToApi(row);
  }
  if (!card) {
    if (!(await activeProvider(ctx))) throw new AppError('no_payment_provider', 409, msg('error.no_card_provider_configured_take_the_deposit'));
    throw new AppError('no_saved_card', 409, msg('error.the_customer_has_no_saved_card_send'));
  }
  const { pc, pm } = card;
  // One key per attempt (the row changes after each): a retried job never holds or charges twice, a new attempt is fresh.
  const pctx = { ...pc.pctx, idempotencyKey: `dep:${id}:${method}:${new Date(d.updated_at).getTime()}` };
  const r = await pc.provider.authorize(pctx, {
    amount: Number(d.amount), currency: d.currency.trim(), orderId: d.order_id, customerRef: pm.customer, paymentMethodRef: pm.payment_method,
    description: msg('payment.description.deposit', { number: order.number }, await tenantLocale(ctx)), metadata: { order_id: d.order_id, tenant_id: ctx.tenantId, purpose: 'deposit', deposit_id: id },
  });
  if (r.status !== 'held') return depositFailed(ctx, d, pc.provider.id, r.ref, r.error ?? r.status);
  if (method === 'charge') {
    const cap = await pc.provider.capture(pctx, r.ref, Number(d.amount));
    if (cap.status === 'failed') {
      await pc.provider.void(pctx, r.ref).catch(() => undefined);
      return depositFailed(ctx, d, pc.provider.id, r.ref, 'capture_failed');
    }
    const pay = (
      await many(
        ctx,
        `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, created_by) VALUES ($1,$2,$3,$4,'charge','deposit','card',$5,$6,'succeeded',$7,$8) RETURNING *`,
        [newId('pay'), ctx.tenantId, d.order_id, pc.provider.id, d.amount, d.currency, r.ref, ctx.actor.id],
      )
    )[0];
    const row = (
      await many(ctx, `UPDATE deposits SET status = 'held', method = 'charge', provider = $2, provider_ref = $3, payment_id = $4, authorized_at = now(), expires_at = NULL WHERE id = $1 RETURNING *`, [id, pc.provider.id, r.ref, pay.id])
    )[0];
    await audit(ctx, { entity_type: 'deposit', entity_id: id, action: 'charge', before: d, after: row });
    await emit(ctx, 'deposit.authorized', { type: 'deposit', id }, depositToApi(row));
    await notifyCustomer(ctx, d.order_id, 'deposit_held', { deposit: { amount: Number(row.amount) } });
    return depositToApi(row);
  }
  const expires = r.expiresAt ?? addMinutes(ctx.now, pc.provider.authorizationWindowDays * 1440);
  const row = (
    await many(ctx, `UPDATE deposits SET status = 'held', method = 'card_auth', provider = $2, provider_ref = $3, authorized_at = now(), expires_at = $4 WHERE id = $1 RETURNING *`, [id, pc.provider.id, r.ref, expires])
  )[0];
  await audit(ctx, { entity_type: 'deposit', entity_id: id, action: 'authorize', before: d, after: row });
  await emit(ctx, 'deposit.authorized', { type: 'deposit', id }, depositToApi(row));
  await notifyCustomer(ctx, d.order_id, 'deposit_held', { deposit: { amount: Number(row.amount) } });
  return depositToApi(row);
}

/** Gives back `amount` of a deposit the shop already holds as money: through the provider for online charges, else recorded as paid back. */
async function refundHeldMoney(ctx: Ctx, d: any, amount: number, note: string) {
  if (amount <= 0) return;
  const paid = await must<any>(ctx, `SELECT * FROM payments WHERE id = $1`, [d.payment_id], 'payment', d.payment_id);
  if (paid.provider !== 'manual' && paid.provider_ref) {
    const pc = await providerContext(ctx, paid.provider);
    const r = await pc.provider.refund({ ...pc.pctx, idempotencyKey: `dep:${d.id}:refund:${amount}` }, paid.provider_ref, amount);
    if (r.status === 'failed') throw new AppError('refund_failed', 502, msg('error.the_payment_provider_refused_the_refund'));
    await exec(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, parent_payment_id, note, created_by)
       VALUES ($1,$2,$3,$4,'refund','deposit','card',$5,$6,$7,$8,$9,$10,$11)`,
      [newId('pay'), ctx.tenantId, d.order_id, paid.provider, amount, d.currency, r.status === 'succeeded' ? 'succeeded' : 'pending', r.ref, paid.id, note, ctx.actor.id],
    );
    return;
  }
  await exec(
    ctx,
    `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, parent_payment_id, note, created_by)
     VALUES ($1,$2,$3,'manual','refund','deposit',$4,$5,$6,'succeeded',$7,$8,$9)`,
    [newId('pay'), ctx.tenantId, d.order_id, d.method === 'cash' ? 'cash' : 'card', amount, d.currency, paid.id, note, ctx.actor.id],
  );
}

export async function captureDeposit(ctx: Ctx, id: string, input: { amount: number; reason?: string; damage_charge_ids?: string[] }) {
  const d = await must<any>(ctx, `SELECT * FROM deposits WHERE id = $1 FOR UPDATE`, [id], 'deposit', id);
  if (d.status !== 'held') throw new AppError('invalid_transition', 409, msg('error.only_held_deposits_can_be_captured_this', { status: d.status }));
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > Number(d.amount)) throw invalid(msg('error.capture_between_1_and', { amount: d.amount }));
  const locale = await tenantLocale(ctx);
  const reason = input.reason ?? msg('payment.note.deposit_capture', {}, locale);
  if (d.method === 'card_auth') {
    const pc = await providerContext(ctx, d.provider);
    const r = await pc.provider.capture({ ...pc.pctx, idempotencyKey: `dep:${id}:capture:${input.amount}` }, d.provider_ref, input.amount);
    if (r.status === 'failed') throw new AppError('capture_failed', 502, msg('error.the_payment_provider_refused_the_capture'));
    // The captured part becomes a damage payment in the ledger.
    await exec(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, note, created_by)
       VALUES ($1,$2,$3,$4,'charge','damage','card',$5,$6,'succeeded',$7,$8,$9)`,
      [newId('pay'), ctx.tenantId, d.order_id, d.provider, input.amount, d.currency, `${d.provider_ref}:capture`, reason, ctx.actor.id],
    );
  } else {
    // Money already taken (cash or a charge): the kept part moves from deposit to damage, the rest goes back.
    await exec(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, parent_payment_id, note, created_by)
       VALUES ($1,$2,$3,'manual','refund','deposit','deposit',$4,$5,'succeeded',$6,$7,$8), ($9,$2,$3,'manual','charge','damage','deposit',$4,$5,'succeeded',$6,$7,$8)`,
      [newId('pay'), ctx.tenantId, d.order_id, input.amount, d.currency, d.payment_id, reason, ctx.actor.id, newId('pay')],
    );
    await refundHeldMoney(ctx, d, Number(d.amount) - input.amount, msg('payment.note.deposit_returned', {}, locale));
  }
  const status = input.amount < Number(d.amount) ? 'partially_captured' : 'captured';
  const row = (await many(ctx, `UPDATE deposits SET status = $2, captured_amount = $3, released_at = CASE WHEN $2 = 'partially_captured' THEN now() ELSE released_at END WHERE id = $1 RETURNING *`, [id, status, input.amount]))[0];
  if (input.damage_charge_ids?.length) {
    await exec(ctx, `UPDATE damage_charges SET status = 'captured', deposit_id = $2 WHERE id = ANY($1) AND order_id = $3`, [input.damage_charge_ids, id, d.order_id]);
  }
  await audit(ctx, { entity_type: 'deposit', entity_id: id, action: 'capture', before: d, after: row, extra: { reason } });
  await emit(ctx, 'deposit.captured', { type: 'deposit', id }, depositToApi(row));
  if (status === 'partially_captured') await notifyCustomer(ctx, d.order_id, 'deposit_released', { deposit: { captured_amount: input.amount } });
  return depositToApi(row);
}

export async function releaseDeposit(ctx: Ctx, id: string) {
  const d = await must<any>(ctx, `SELECT * FROM deposits WHERE id = $1 FOR UPDATE`, [id], 'deposit', id);
  if (!['held', 'pending'].includes(d.status)) throw new AppError('invalid_transition', 409, msg('error.deposit_is', { status: d.status }));
  if (d.status === 'held' && d.method === 'card_auth') {
    const pc = await providerContext(ctx, d.provider);
    await pc.provider.void({ ...pc.pctx, idempotencyKey: `dep:${id}:void` }, d.provider_ref);
  }
  // Cash or charged deposits are paid back (online charges through the provider).
  if (d.status === 'held' && d.payment_id) await refundHeldMoney(ctx, d, Number(d.amount), msg('payment.note.deposit_returned', {}, await tenantLocale(ctx)));
  const row = (await many(ctx, `UPDATE deposits SET status = 'released', released_at = now() WHERE id = $1 RETURNING *`, [id]))[0];
  await audit(ctx, { entity_type: 'deposit', entity_id: id, action: 'release', before: d, after: row });
  await emit(ctx, 'deposit.released', { type: 'deposit', id }, depositToApi(row));
  if (d.status === 'held') await notifyCustomer(ctx, d.order_id, 'deposit_released', { deposit: { captured_amount: 0 } });
  return depositToApi(row);
}

export async function reauthorizeDeposit(ctx: Ctx, id: string) {
  const d = await must<any>(ctx, `SELECT * FROM deposits WHERE id = $1`, [id], 'deposit', id);
  if (d.status === 'held' && d.method === 'card_auth') {
    const pc = await providerContext(ctx, d.provider);
    await pc.provider.void(pc.pctx, d.provider_ref);
    await exec(ctx, `UPDATE deposits SET status = 'pending', provider_ref = NULL WHERE id = $1`, [id]);
  }
  return authorizeDeposit(ctx, id, { method: 'card_auth' });
}

/**
 * Turns a card hold into a charge before it lapses (FR-PAY-5): the full deposit is captured and later
 * refunded on release like any charged deposit.
 */
export async function convertHoldToCharge(ctx: Ctx, id: string) {
  const d = await must<any>(ctx, `SELECT * FROM deposits WHERE id = $1 FOR UPDATE`, [id], 'deposit', id);
  if (d.status !== 'held' || d.method !== 'card_auth') throw new AppError('invalid_transition', 409, msg('error.deposit_is', { status: d.status }));
  const pc = await providerContext(ctx, d.provider);
  const r = await pc.provider.capture({ ...pc.pctx, idempotencyKey: `dep:${id}:convert` }, d.provider_ref, Number(d.amount));
  if (r.status === 'failed') throw new AppError('capture_failed', 502, msg('error.the_payment_provider_refused_the_capture'));
  const pay = (
    await many(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, created_by) VALUES ($1,$2,$3,$4,'charge','deposit','card',$5,$6,'succeeded',$7,$8) RETURNING *`,
      [newId('pay'), ctx.tenantId, d.order_id, d.provider, d.amount, d.currency, d.provider_ref, ctx.actor.id],
    )
  )[0];
  const row = (await many(ctx, `UPDATE deposits SET method = 'charge', payment_id = $2, expires_at = NULL WHERE id = $1 RETURNING *`, [id, pay.id]))[0];
  await audit(ctx, { entity_type: 'deposit', entity_id: id, action: 'convert_to_charge', before: d, after: row });
  await emit(ctx, 'deposit.authorized', { type: 'deposit', id }, depositToApi(row));
  return depositToApi(row);
}

/** Job: authorise pending card deposits shortly before pickup, warn and expire old holds. */
export async function depositMaintenance(ctx: Ctx) {
  const t = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const s = resolveSettings(t.settings);
  const due = await many(
    ctx,
    `SELECT d.id FROM deposits d JOIN orders o ON o.id = d.order_id
      WHERE d.status = 'pending' AND d.method = 'card_auth' AND o.status IN ('reserved','prepared')
        AND o.starts_at <= now() + make_interval(days => $1)`,
    [s.deposit_authorize_days_before],
  );
  for (const d of due) {
    try {
      await authorizeDeposit(ctx, d.id);
    } catch (err) {
      ctx.logger.warn({ err, deposit: d.id }, 'deposit authorisation failed');
    }
  }
  const expiring = await many(
    ctx,
    `SELECT * FROM deposits WHERE status = 'held' AND expires_at IS NOT NULL AND expiring_notified_at IS NULL AND expires_at <= now() + make_interval(days => $1)`,
    [s.deposit_expiry_warning_days],
  );
  let renewed = 0;
  for (const d of expiring) {
    await exec(ctx, `UPDATE deposits SET expiring_notified_at = now() WHERE id = $1`, [d.id]);
    await emit(ctx, 'deposit.expiring', { type: 'deposit', id: d.id }, depositToApi(d));
    // The shop's policy decides; when it cannot be applied, staff are warned as before.
    if (d.method === 'card_auth' && s.deposit_expiry_policy !== 'notify') {
      try {
        const after = s.deposit_expiry_policy === 'reauthorize' ? await reauthorizeDeposit(ctx, d.id) : await convertHoldToCharge(ctx, d.id);
        if (after.status === 'held') {
          renewed++;
          continue;
        }
      } catch (err) {
        ctx.logger.warn({ err, deposit: d.id }, 'deposit expiry policy failed');
      }
    }
    await notifyStaff(ctx, d.order_id, 'deposit_expiring', { deposit: { amount: Number(d.amount), expires_at: d.expires_at } });
  }
  const expired = await many(ctx, `UPDATE deposits SET status = 'expired' WHERE status = 'held' AND expires_at < now() RETURNING *`);
  for (const d of expired) await emit(ctx, 'deposit.expired', { type: 'deposit', id: d.id }, depositToApi(d));
  return { authorized: due.length, warned: expiring.length - renewed, renewed, expired: expired.length };
}

// ---------------------------------------------------------------------------
// Damage charges (FR-PAY-6)
// ---------------------------------------------------------------------------

export function damageToApi(d: any) {
  return {
    id: d.id, object: 'damage_charge', order_id: d.order_id, stock_item_id: d.stock_item_id, description: d.description,
    amount: money(d.amount, d.currency ?? 'EUR'), covered_amount: money(d.covered_amount ?? 0, d.currency ?? 'EUR'),
    customer_amount: money(Number(d.amount) - Number(d.covered_amount ?? 0), d.currency ?? 'EUR'),
    status: d.status, deposit_id: d.deposit_id, document_id: d.document_id, notes: d.notes, created_at: d.created_at,
  };
}

export async function listDamageCharges(ctx: Ctx, orderId: string) {
  const rows = await many(ctx, `SELECT d.*, o.currency FROM damage_charges d JOIN orders o ON o.id = d.order_id WHERE d.order_id = $1 ORDER BY d.created_at`, [orderId]);
  const photos = await photosOf(ctx, 'damage_charge', rows.map((r) => r.id));
  return rows.map((r) => ({ ...damageToApi(r), photos: photos.get(r.id) ?? [] }));
}

/**
 * How much of a damage charge the order's damage waiver covers (FR-PAY-8): the customer pays at most the
 * shop's excess across all of the order's charges, the waiver the rest. Without a waiver nothing is covered.
 */
async function waiverCover(ctx: Ctx, orderId: string, amount: number, exceptId: string | null): Promise<number> {
  const waiver = await one(ctx, `SELECT 1 FROM order_lines WHERE order_id = $1 AND type = 'fee' AND price_snapshot->>'fee_kind' = 'damage_waiver' LIMIT 1`, [orderId]);
  if (!waiver) return 0;
  const t = await one<{ settings: any }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId]);
  const excess = resolveSettings(t?.settings).damage_waiver_excess;
  const owed = await one<{ n: number }>(
    ctx,
    `SELECT coalesce(sum(amount - covered_amount), 0)::bigint AS n FROM damage_charges WHERE order_id = $1 AND status <> 'waived' AND id IS DISTINCT FROM $2`,
    [orderId, exceptId],
  );
  const pays = Math.max(0, Math.min(amount, excess - Number(owed?.n ?? 0)));
  return amount - pays;
}

export async function createDamageCharge(ctx: Ctx, orderId: string, input: { description: string; amount: number; stock_item_id?: string | null; notes?: string }) {
  const o = await orderForPayment(ctx, orderId);
  if (!Number.isInteger(input.amount) || input.amount < 0) throw invalid(msg('error.amount_must_be_a_non_negative_integer'));
  const covered = await waiverCover(ctx, orderId, input.amount, null);
  const row = (
    await many(ctx, `INSERT INTO damage_charges (id, tenant_id, order_id, stock_item_id, description, amount, notes, covered_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
      newId('dmg'), ctx.tenantId, orderId, input.stock_item_id ?? null, input.description, input.amount, input.notes ?? '', covered,
    ])
  )[0];
  await audit(ctx, { entity_type: 'damage_charge', entity_id: row.id, action: 'create', after: row });
  const api = damageToApi({ ...row, currency: o.currency });
  await emit(ctx, 'damage_charge.created', { type: 'damage_charge', id: row.id }, api);
  return api;
}

export async function updateDamageCharge(ctx: Ctx, id: string, patch: { description?: string; amount?: number; notes?: string }) {
  const d = await must<any>(ctx, `SELECT d.*, o.currency FROM damage_charges d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`, [id], 'damage_charge', id);
  if (d.status !== 'open') throw new AppError('damage_charge_closed', 409, msg('error.this_charge_is', { status: d.status }));
  const covered = patch.amount != null ? await waiverCover(ctx, d.order_id, patch.amount, id) : Number(d.covered_amount);
  const row = (
    await many(ctx, `UPDATE damage_charges SET description = coalesce($2, description), amount = coalesce($3, amount), notes = coalesce($4, notes), covered_amount = $5 WHERE id = $1 RETURNING *`, [
      id, patch.description ?? null, patch.amount ?? null, patch.notes ?? null, covered,
    ])
  )[0];
  await audit(ctx, { entity_type: 'damage_charge', entity_id: id, action: 'update', before: d, after: row });
  return damageToApi({ ...row, currency: d.currency });
}

export async function deleteDamageCharge(ctx: Ctx, id: string) {
  const d = await must<any>(ctx, `SELECT * FROM damage_charges WHERE id = $1`, [id], 'damage_charge', id);
  if (d.status !== 'open') throw new AppError('damage_charge_closed', 409, msg('error.this_charge_is', { status: d.status }));
  await exec(ctx, `DELETE FROM damage_charges WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'damage_charge', entity_id: id, action: 'delete', before: d });
}

export async function waiveDamageCharge(ctx: Ctx, id: string) {
  const d = await must<any>(ctx, `SELECT d.*, o.currency FROM damage_charges d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`, [id], 'damage_charge', id);
  if (d.status !== 'open') throw new AppError('damage_charge_closed', 409, msg('error.this_charge_is', { status: d.status }));
  const row = (await many(ctx, `UPDATE damage_charges SET status = 'waived' WHERE id = $1 RETURNING *`, [id]))[0];
  await audit(ctx, { entity_type: 'damage_charge', entity_id: id, action: 'waive', before: d, after: row });
  const api = damageToApi({ ...row, currency: d.currency });
  await emit(ctx, 'damage_charge.waived', { type: 'damage_charge', id }, api);
  return api;
}

export async function invoiceDamageCharge(ctx: Ctx, id: string) {
  const d = await must<any>(ctx, `SELECT d.*, o.currency FROM damage_charges d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`, [id], 'damage_charge', id);
  if (d.status !== 'open') throw new AppError('damage_charge_closed', 409, msg('error.this_charge_is', { status: d.status }));
  // The customer is invoiced only for what the damage waiver does not cover.
  const amount = Number(d.amount) - Number(d.covered_amount ?? 0);
  const doc = await issueDocument(ctx, d.order_id, 'invoice', {
    overrides: {
      lines: [{ name: msg('order.line.damage', { description: d.description }), type: 'fee', quantity: 1, unit_price: amount, discount: 0, tax_rate_bp: 0, tax: 0, total: amount, units: [] }],
      totals: { subtotal: amount, discount: 0, fees: 0, tax: 0, total: amount, deposit: 0 },
      tax_breakdown: [],
    },
  });
  const row = (await many(ctx, `UPDATE damage_charges SET status = 'invoiced', document_id = $2 WHERE id = $1 RETURNING *`, [id, doc.id]))[0];
  const api = damageToApi({ ...row, currency: d.currency });
  await emit(ctx, 'damage_charge.invoiced', { type: 'damage_charge', id }, api);
  return { damage_charge: api, document: doc };
}

// ---------------------------------------------------------------------------
// Inbound provider events (FR-PAY-7). Idempotent on provider event id.
// ---------------------------------------------------------------------------

export async function recordProviderEvent(ctx: Ctx, provider: string, ev: ProviderEvent): Promise<boolean> {
  const r = await many(
    ctx,
    `INSERT INTO provider_events (id, tenant_id, provider, event_id, type, payload) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [newId('pev'), ctx.tenantId, provider, ev.eventId, ev.type, json(ev)],
  );
  return r.length > 0;
}

/**
 * Applies a provider-independent event. `onRentalPaid` is called after a rental payment succeeds
 * (orders module uses it to confirm storefront checkouts).
 */
export async function applyProviderEvent(ctx: Ctx, provider: string, ev: ProviderEvent, hooks: { onRentalPaid?: (orderId: string) => Promise<void> } = {}) {
  const fresh = await recordProviderEvent(ctx, provider, ev);
  if (!fresh) return { duplicate: true };
  switch (ev.type) {
    case 'payment.succeeded': {
      // No booking: a customer invoice paid through its payment request (ADR 0014).
      if (!ev.orderId) {
        await invoicePaid(ctx, provider, ev);
        break;
      }
      const order = await one(ctx, `SELECT * FROM orders WHERE id = $1`, [ev.orderId]);
      if (!order) break;
      const existing = await one(ctx, `SELECT * FROM payments WHERE provider = $1 AND provider_ref = $2 AND kind <> 'refund'`, [provider, ev.ref]);
      if (existing?.status === 'succeeded') break;
      const meta = { payment_method: ev.paymentMethodRef ?? null, customer: ev.customerRef ?? null };
      const row = existing
        ? (await many(ctx, `UPDATE payments SET status = 'succeeded', amount = $2, metadata = metadata || $3 WHERE id = $1 RETURNING *`, [existing.id, ev.amount, json(meta)]))[0]
        : (
            await many(
              ctx,
              `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, metadata)
               VALUES ($1,$2,$3,$4,'charge',$5,'card',$6,$7,'succeeded',$8,$9) RETURNING *`,
              [newId('pay'), ctx.tenantId, ev.orderId, provider, ev.purpose === 'deposit' ? 'deposit' : ev.purpose, ev.amount, order.currency, ev.ref, json(meta)],
            )
          )[0];
      await exec(ctx, `UPDATE payment_intents SET status = 'succeeded' WHERE provider = $1 AND provider_ref = $2`, [provider, ev.ref]);
      // A monthly invoice paid as a whole: the other bookings on it get their share.
      for (const part of await shareInvoicePayment(ctx, row, ev.paymentRequestId ?? null)) {
        await recomputePaymentStatus(ctx, part.order_id);
        await emit(ctx, 'payment.succeeded', { type: 'payment', id: part.id }, paymentToApi(part));
      }
      if (ev.customerRef && order.customer_id) {
        await exec(ctx, `UPDATE customers SET provider_refs = provider_refs || $2 WHERE id = $1`, [order.customer_id, json({ [provider]: ev.customerRef })]);
      }
      await settlePaymentRequest(ctx, ev.orderId, ev.paymentRequestId ?? null, ev.amount, row.id);
      await afterPaymentSucceeded(ctx, order, row);
      if (ev.purpose === 'rental') await hooks.onRentalPaid?.(ev.orderId);
      break;
    }
    case 'payment.failed': {
      await exec(ctx, `UPDATE payment_intents SET status = 'failed' WHERE provider = $1 AND provider_ref = $2`, [provider, ev.ref]);
      await emit(ctx, 'payment.failed', { type: 'payment_intent', id: ev.ref }, { object: 'payment', provider, provider_ref: ev.ref, order_id: ev.orderId, error: ev.error });
      if (ev.orderId) await notifyStaff(ctx, ev.orderId, 'staff_payment_failed', { error: ev.error });
      break;
    }
    case 'payment.cancelled':
      await exec(ctx, `UPDATE payment_intents SET status = 'cancelled' WHERE provider = $1 AND provider_ref = $2`, [provider, ev.ref]);
      break;
    case 'authorization.held': {
      const d = await one(ctx, `SELECT * FROM deposits WHERE provider_ref = $1`, [ev.ref]);
      if (d && d.status !== 'held') {
        const row = (await many(ctx, `UPDATE deposits SET status = 'held', authorized_at = coalesce(authorized_at, now()), expires_at = coalesce($2, expires_at) WHERE id = $1 RETURNING *`, [d.id, ev.expiresAt]))[0];
        await emit(ctx, 'deposit.authorized', { type: 'deposit', id: d.id }, depositToApi(row));
      }
      break;
    }
    case 'refund.succeeded':
      await exec(ctx, `UPDATE payments SET status = 'succeeded' WHERE provider = $1 AND provider_ref = $2 AND kind = 'refund'`, [provider, ev.ref]);
      break;
    case 'ignored':
      break;
  }
  await exec(ctx, `UPDATE provider_events SET processed_at = now() WHERE provider = $1 AND event_id = $2`, [provider, ev.eventId]);
  return { duplicate: false };
}

/**
 * Asks the provider for the state of an order's open payment intents and applies it (the customer is
 * back from the payment page; the webhook may still be on its way). Safe to repeat: events are deduped.
 */
export async function syncOrderPayments(ctx: Ctx, orderId: string, hooks: { onRentalPaid?: (orderId: string) => Promise<void> } = {}) {
  const open = await many<{ provider: string; provider_ref: string }>(
    ctx,
    `SELECT provider, provider_ref FROM payment_intents WHERE order_id = $1 AND provider_ref IS NOT NULL AND status IN ('requires_payment', 'processing', 'requires_capture') ORDER BY created_at DESC LIMIT 5`,
    [orderId],
  );
  let applied = 0;
  for (const pi of open) {
    const pc = await providerContext(ctx, pi.provider);
    if (!pc.provider.retrievePayment) continue;
    const ev = await pc.provider.retrievePayment(pc.pctx, pi.provider_ref);
    if (ev.type === 'ignored') continue;
    const r = await applyProviderEvent(ctx, pi.provider, ev, hooks);
    if (!r.duplicate) applied++;
  }
  return { applied };
}

// ---------------------------------------------------------------------------
// Payment requests: down payments, balances and staff payment links (FR-PAY-2)
// ---------------------------------------------------------------------------

export function paymentRequestToApi(r: any) {
  const c = String(r.currency).trim();
  return {
    id: r.id, object: 'payment_request', order_id: r.order_id, customer_id: r.customer_id ?? null, invoice_id: r.invoice_id ?? null, kind: r.kind, status: r.status, amount: money(r.amount, c), due_at: r.due_at, message: r.message, payment_id: r.payment_id,
    paid_at: r.paid_at, provider: r.provider ?? null, url: r.url ?? null, expires_at: r.expires_at ?? null, created_at: r.created_at,
  };
}

/** Part of a total paid at booking under the tenant's payment terms. */
export function upfrontAmount(terms: { upfront: string; percent_bp: number; fixed_amount: number }, total: number) {
  if (terms.upfront === 'percent') return Math.min(total, Math.max(0, Math.round((total * terms.percent_bp) / 10000)));
  if (terms.upfront === 'fixed') return Math.min(total, Math.max(0, terms.fixed_amount));
  return total;
}

export async function listPaymentRequests(ctx: Ctx, orderId: string) {
  return (await many(ctx, `SELECT * FROM payment_requests WHERE order_id = $1 ORDER BY created_at DESC`, [orderId])).map(paymentRequestToApi);
}

/** Asks the customer for a payment; with `notify` an email links to the order page where they pay. */
export async function createPaymentRequest(
  ctx: Ctx,
  orderId: string,
  input: { amount?: number; kind?: 'upfront' | 'balance' | 'custom'; message?: string | null; due_at?: string | null; notify?: boolean; returnUrl?: string },
) {
  const o = await orderForPayment(ctx, orderId);
  if (['cancelled', 'expired', 'closed'].includes(o.status)) throw new AppError('order_not_payable', 409, t('payments.order_not_payable'));
  const balance = Number(o.totals?.balance ?? o.totals?.total ?? 0);
  const amount = input.amount ?? balance;
  if (amount <= 0 || amount > balance) throw invalid(t('payments.request_amount', { max: balance }), [{ field: 'amount', code: 'out_of_range', message: t('payments.request_amount', { max: balance }) }]);
  // A new request replaces any open one: the customer always sees a single amount to pay.
  await exec(ctx, `UPDATE payment_requests SET status = 'cancelled' WHERE order_id = $1 AND status = 'open'`, [orderId]);
  const row = (
    await many(
      ctx,
      `INSERT INTO payment_requests (id, tenant_id, order_id, amount, currency, kind, due_at, message, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [newId('prq'), ctx.tenantId, orderId, amount, o.currency, input.kind ?? 'custom', input.due_at ?? null, input.message?.trim() || null, ctx.actor.id],
    )
  )[0];
  const linked = (await paymentLink(ctx, o, row, input.returnUrl)) ?? row;
  const api = paymentRequestToApi(linked);
  await audit(ctx, { entity_type: 'order', entity_id: orderId, action: 'request_payment', extra: { request_id: row.id, amount } });
  await emit(ctx, 'payment_request.created', { type: 'payment_request', id: row.id }, api);
  if (input.notify !== false) await notifyCustomer(ctx, orderId, 'payment_request', { request: { amount, message: row.message, due_at: row.due_at, url: linked.url ?? null } });
  return api;
}

/**
 * A provider-hosted payment page for the request (FR-PAY-1), when the active provider makes them.
 * Without one, or when the provider fails, customers pay on the shop's order page as before.
 * `returnUrl` (a checked widget page) replaces the order page as where the customer comes back to.
 */
async function paymentLink(ctx: Ctx, o: any, row: any, returnUrl?: string) {
  const pc = await activeProvider(ctx);
  if (!pc?.provider.createPaymentLink) return null;
  const customer = o.customer_id ? await one<any>(ctx, `SELECT id, name, email, locale, provider_refs FROM customers WHERE id = $1`, [o.customer_id]) : null;
  const orderUrl = `${(await storefrontBase(ctx, customer?.locale)).replace(/\/$/, '')}/order/${o.public_token}`;
  try {
    const r = await pc.provider.createPaymentLink(
      { ...pc.pctx, idempotencyKey: `prq:${row.id}` },
      {
        amount: Number(row.amount), currency: o.currency.trim(), orderId: o.id, orderNumber: o.number, reference: o.id,
        description: msg('payment.description.order', { number: o.number }, await tenantLocale(ctx)),
        customer: { id: customer?.id ?? o.id, name: customer?.name ?? '', email: customer?.email ?? null, providerRef: customer?.provider_refs?.[pc.provider.id] ?? null },
        ...(returnUrl ? widgetReturn(returnUrl, o) : { successUrl: `${orderUrl}?paid=1`, cancelUrl: orderUrl }),
        expiresAt: row.due_at ? new Date(row.due_at) : null,
        metadata: { payment_request_id: row.id },
      },
    );
    return (await many(ctx, `UPDATE payment_requests SET provider = $2, provider_ref = $3, url = $4, expires_at = $5 WHERE id = $1 RETURNING *`, [row.id, pc.provider.id, r.ref, r.url, r.expiresAt]))[0];
  } catch (err) {
    ctx.logger.warn({ err, request: row.id }, 'payment link not created; the order page takes the payment');
    return null;
  }
}

/** Back to the embedding page with the order named, so the widget can show the booking. */
function widgetReturn(returnUrl: string, o: { id: string; public_token: string }) {
  const url = (paid: boolean) => {
    const u = new URL(returnUrl);
    u.searchParams.set('openrent_order', o.id);
    u.searchParams.set('openrent_token', o.public_token);
    if (paid) u.searchParams.set('openrent_paid', '1');
    return u.toString();
  };
  return { successUrl: url(true), cancelUrl: url(false) };
}

export async function cancelPaymentRequest(ctx: Ctx, orderId: string, id: string) {
  const row = (await many(ctx, `UPDATE payment_requests SET status = 'cancelled' WHERE id = $1 AND order_id = $2 AND status = 'open' RETURNING *`, [id, orderId]))[0];
  if (!row) throw new AppError('not_open', 409, t('payments.request_not_open'));
  await audit(ctx, { entity_type: 'order', entity_id: orderId, action: 'cancel_payment_request', extra: { request_id: id } });
  return paymentRequestToApi(row);
}

/** Marks the request a payment settles: the one named in its metadata, else the open one with the same amount. */
/**
 * Shares a payment for a monthly invoice out over the invoice's bookings by what each still owes,
 * oldest first (ADR 0012). The first booking keeps the provider's payment and any rest; the others
 * get parts that name it (`<ref>:part<n>`, `metadata.provider_payment_ref`), so refunds and the
 * reconciliation still find the payment at the provider. Returns the new parts.
 */
async function shareInvoicePayment(ctx: Ctx, payment: any, requestId: string | null) {
  const req = requestId ? await one<any>(ctx, `SELECT invoice_id FROM payment_requests WHERE id = $1`, [requestId]) : null;
  if (!req?.invoice_id || !payment.provider_ref) return [];
  const orders = await many<any>(ctx, `SELECT id, totals FROM orders WHERE invoice_id = $1 ORDER BY starts_at, number`, [req.invoice_id]);
  let left = Number(payment.amount);
  const share = (o: any) => {
    const n = Math.max(0, Math.min(left, Number(o.totals?.balance ?? 0)));
    left -= n;
    return n;
  };
  const own = share(orders.find((o) => o.id === payment.order_id) ?? { totals: { balance: 0 } });
  const parts: any[] = [];
  let i = 0;
  for (const o of orders) {
    if (o.id === payment.order_id) continue;
    const amount = share(o);
    if (amount <= 0) continue;
    i++;
    parts.push(
      (
        await many(
          ctx,
          `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, metadata)
           VALUES ($1,$2,$3,$4,'charge','rental',$5,$6,$7,'succeeded',$8,$9) RETURNING *`,
          [newId('pay'), ctx.tenantId, o.id, payment.provider, payment.method, amount, payment.currency, `${payment.provider_ref}:part${i}`, json({ ...(payment.metadata ?? {}), provider_payment_ref: payment.provider_ref, invoice_id: req.invoice_id })],
        )
      )[0],
    );
  }
  if (parts.length) await exec(ctx, `UPDATE payments SET amount = $2, metadata = metadata || $3 WHERE id = $1`, [payment.id, own + left, json({ invoice_id: req.invoice_id })]);
  return parts;
}

async function settlePaymentRequest(ctx: Ctx, orderId: string, requestId: string | null, amount: number, paymentId: string) {
  const row = requestId
    ? (await many(ctx, `UPDATE payment_requests SET status = 'paid', paid_at = now(), payment_id = $3 WHERE id = $1 AND order_id = $2 AND status = 'open' RETURNING *`, [requestId, orderId, paymentId]))[0]
    : (await many(ctx, `UPDATE payment_requests SET status = 'paid', paid_at = now(), payment_id = $3 WHERE id = (SELECT id FROM payment_requests WHERE order_id = $1 AND status = 'open' AND amount = $2 ORDER BY created_at DESC LIMIT 1) RETURNING *`, [orderId, amount, paymentId]))[0];
  if (row) {
    await emit(ctx, 'payment_request.paid', { type: 'payment_request', id: row.id }, paymentRequestToApi(row));
    if (row.provider_ref) await emit(ctx, 'payment_link.paid', { type: 'payment_request', id: row.id }, paymentRequestToApi(row));
  }
}

/** What the customer can pay online right now: the open request, else nothing unless the order is still awaiting its first payment. */
export async function amountDue(ctx: Ctx, orderId: string): Promise<{ amount: number; request_id: string | null }> {
  const req = await one<any>(ctx, `SELECT * FROM payment_requests WHERE order_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [orderId]);
  if (req) return { amount: Number(req.amount), request_id: req.id };
  const o = await orderForPayment(ctx, orderId);
  const balance = Number(o.totals?.balance ?? o.totals?.total ?? 0);
  return { amount: o.status === 'quote' && o.payment_status === 'unpaid' ? balance : 0, request_id: null };
}

/** Worker: requests the remaining balance N days before pickup when only a down payment was taken. */
export async function requestDueBalances(ctx: Ctx) {
  const t0 = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const terms = resolveSettings(t0.settings).payment_terms;
  if (terms.upfront === 'full') return 0;
  const due = await many<{ id: string; starts_at: Date }>(
    ctx,
    `SELECT o.id, o.starts_at FROM orders o
      WHERE o.status IN ('reserved', 'prepared') AND o.payment_status = 'partially_paid'
        AND o.starts_at <= now() + make_interval(days => $1) AND o.starts_at > now()
        AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.on_account)
        AND NOT EXISTS (SELECT 1 FROM payment_requests r WHERE r.order_id = o.id AND r.kind = 'balance' AND r.status IN ('open', 'paid'))`,
    [terms.balance_due_days_before],
  );
  for (const o of due) await createPaymentRequest(ctx, o.id, { kind: 'balance', due_at: new Date(o.starts_at).toISOString() });
  return due.length;
}


// ---------------------------------------------------------------------------
// Reconciliation (FR-PAY-7)
// ---------------------------------------------------------------------------

export function reconciliationIssueToApi(r: any) {
  return {
    id: r.id, object: 'payment_reconciliation_issue', payment_id: r.payment_id, order_id: r.order_id, provider: r.provider, provider_ref: r.provider_ref, kind: r.kind,
    details: r.details, detected_at: r.detected_at, resolved_at: r.resolved_at, resolved_by: r.resolved_by, resolution: r.resolution,
  };
}

/**
 * Nightly: compares recent online payments with what the provider says. Differences become open issues
 * (one per payment and kind) and staff are told; a provider that cannot be reached is skipped until next time.
 */
/** What a provider payment came to here: itself plus the parts an invoice payment was shared into. */
async function recordedAmount(ctx: Ctx, p: any) {
  return Number((await one<{ n: string }>(ctx, `SELECT coalesce(sum(amount), 0)::bigint AS n FROM payments WHERE provider = $1 AND (provider_ref = $2 OR provider_ref LIKE $2 || ':part%') AND kind = 'charge'`, [p.provider, p.provider_ref]))!.n);
}

export async function reconcilePayments(ctx: Ctx, opts: { days?: number; limit?: number } = {}) {
  const rows = await many<any>(
    ctx,
    `SELECT * FROM payments WHERE provider <> 'manual' AND provider_ref IS NOT NULL AND kind = 'charge' AND provider_ref NOT LIKE '%:capture' AND provider_ref NOT LIKE '%:part%'
        AND created_at > now() - make_interval(days => $1) ORDER BY created_at LIMIT $2`,
    [opts.days ?? 3, opts.limit ?? 200],
  );
  let found = 0;
  for (const p of rows) {
    const pc = await providerContext(ctx, p.provider).catch(() => null);
    if (!pc?.provider.retrievePayment) continue;
    let kind: 'status_mismatch' | 'amount_mismatch' | 'missing_at_provider' | null = null;
    let details: Record<string, unknown> = {};
    try {
      const ev = await pc.provider.retrievePayment(pc.pctx, p.provider_ref);
      const theirs = ev.type === 'payment.succeeded' ? 'succeeded' : ev.type === 'payment.failed' ? 'failed' : ev.type === 'payment.cancelled' ? 'cancelled' : null;
      if (theirs && theirs !== p.status) {
        kind = 'status_mismatch';
        details = { ours: p.status, theirs };
      } else if (ev.type === 'payment.succeeded' && ev.amount !== (await recordedAmount(ctx, p))) {
        kind = 'amount_mismatch';
        details = { ours: await recordedAmount(ctx, p), theirs: ev.amount };
      }
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status ?? err?.raw?.statusCode;
      if (status === 404 || err?.code === 'resource_missing') {
        kind = 'missing_at_provider';
        details = { error: String(err?.message ?? err) };
      } else {
        ctx.logger.warn({ err, payment: p.id }, 'reconciliation skipped: provider not reachable');
        continue;
      }
    }
    if (!kind) continue;
    const row = (
      await many(
        ctx,
        `INSERT INTO payment_reconciliation_issues (id, tenant_id, payment_id, order_id, provider, provider_ref, kind, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, provider, provider_ref, kind) WHERE resolved_at IS NULL DO NOTHING RETURNING *`,
        [newId('rci'), ctx.tenantId, p.id, p.order_id, p.provider, p.provider_ref, kind, json(details)],
      )
    )[0];
    if (!row) continue;
    found++;
    await emit(ctx, 'payment.reconciliation_issue', { type: 'payment', id: p.id }, reconciliationIssueToApi(row));
    if (p.order_id) await notifyStaff(ctx, p.order_id, 'staff_payment_failed', { error: msg(`payment.reconciliation.${kind}`, {}, await tenantLocale(ctx)) });
  }
  return { checked: rows.length, issues: found };
}

export async function listReconciliationIssues(ctx: Ctx, filter: { open?: boolean } = {}) {
  return (
    await many(ctx, `SELECT * FROM payment_reconciliation_issues WHERE ($1::boolean IS NULL OR (resolved_at IS NULL) = $1) ORDER BY detected_at DESC LIMIT 200`, [filter.open ?? null])
  ).map(reconciliationIssueToApi);
}

export async function resolveReconciliationIssue(ctx: Ctx, id: string, input: { resolution?: string }) {
  const row = (
    await many(ctx, `UPDATE payment_reconciliation_issues SET resolved_at = now(), resolved_by = $2, resolution = $3 WHERE id = $1 AND resolved_at IS NULL RETURNING *`, [
      id, ctx.actor.id, input.resolution?.trim().slice(0, 500) || null,
    ])
  )[0];
  if (!row) throw new AppError('not_open', 409, msg('payment.reconciliation.not_open'));
  await audit(ctx, { entity_type: 'payment_reconciliation_issue', entity_id: id, action: 'resolve', after: row });
  return reconciliationIssueToApi(row);
}

export * from './customer.ts';
