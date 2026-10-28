import type { ProviderEvent } from '@openrent/plugin-sdk';
import { t as msg } from '../i18n/index.ts';
import { tenantLocale } from '../i18n/context.ts';
import type { Ctx } from '../context.ts';
import { money } from '../crud.ts';
import { AppError, invalid } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { addMinutes } from '../time.ts';
import { queue, storefrontBase } from '../notifications/index.ts';
import { activeProvider, paymentRequestToApi, paymentToApi } from './index.ts';

/**
 * Payments of customer invoices that belong to no booking, such as a membership fee (ADR 0014). They
 * carry the invoice (`document_id`) and the customer instead of an order; the accounting triggers book
 * them like any other payment. A monthly invoice of bookings is paid through its bookings instead.
 */

/** An invoice of the customer's own: issued to them, with no booking on it or pointing at it. */
async function customerInvoice(ctx: Ctx, documentId: string, lock = false) {
  const d = await must<any>(ctx, `SELECT * FROM documents WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [documentId], 'document', documentId);
  const ofBookings = d.order_id || (await one(ctx, `SELECT 1 FROM orders WHERE invoice_id = $1 LIMIT 1`, [d.id]));
  if (d.type !== 'invoice' || !d.customer_id || ofBookings) throw new AppError('not_customer_invoice', 409, msg('payments.not_customer_invoice'));
  return d;
}

/** What is still owed on a customer invoice: its total less what was paid and not refunded. */
export async function invoiceDue(ctx: Ctx, documentId: string) {
  const d = await customerInvoice(ctx, documentId);
  const r = await one<{ paid: string; refunded: string }>(
    ctx,
    `SELECT coalesce(sum(amount) FILTER (WHERE kind IN ('charge','manual') AND status = 'succeeded'), 0)::bigint AS paid,
            coalesce(sum(amount) FILTER (WHERE kind = 'refund' AND status IN ('succeeded','pending')), 0)::bigint AS refunded
       FROM payments WHERE document_id = $1`,
    [d.id],
  );
  const total = d.status === 'voided' ? 0 : Number(d.total ?? 0);
  const paid = Number(r?.paid ?? 0) - Number(r?.refunded ?? 0);
  const currency = String(d.currency).trim();
  return {
    id: d.id, object: 'invoice_balance', number: d.number, status: d.status, total: money(total, currency), paid: money(paid, currency), due: money(Math.max(0, total - paid), currency),
    einvoice_format: d.data?.einvoice?.format ?? null,
  };
}

/** A customer's own invoices with what is owed on each, newest first. */
export async function listCustomerInvoices(ctx: Ctx, customerId: string, opts: { open?: boolean } = {}) {
  const rows = await many<any>(
    ctx,
    `SELECT d.id FROM documents d WHERE d.type = 'invoice' AND d.customer_id = $1 AND d.order_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.invoice_id = d.id) ORDER BY d.issued_at DESC LIMIT 200`,
    [customerId],
  );
  const out = [];
  for (const r of rows) {
    const b = await invoiceDue(ctx, r.id);
    if (!opts.open || (b.due.amount > 0 && b.status !== 'voided')) out.push(b);
  }
  return out;
}

async function afterInvoicePayment(ctx: Ctx, d: any, row: any) {
  await emit(ctx, 'payment.succeeded', { type: 'payment', id: row.id }, paymentToApi(row));
  const b = await invoiceDue(ctx, d.id);
  if (b.due.amount === 0) {
    await exec(ctx, `UPDATE payment_requests SET status = 'cancelled' WHERE invoice_id = $1 AND status = 'open' AND order_id IS NULL`, [d.id]);
    await emit(ctx, 'document.paid', { type: 'document', id: d.id }, { id: d.id, object: 'document', type: 'invoice', number: d.number, customer_id: d.customer_id, source_key: d.data?.source_key ?? null, total: b.total });
  }
  return b;
}

/** Cash, bank transfer or a card terminal, recorded by staff against the invoice. */
export async function recordInvoicePayment(ctx: Ctx, documentId: string, input: { amount: number; method: string; note?: string }) {
  const d = await customerInvoice(ctx, documentId, true);
  if (d.status === 'voided') throw new AppError('invoice_voided', 409, msg('payments.invoice_voided'));
  const { due } = await invoiceDue(ctx, d.id);
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > due.amount)
    throw invalid(msg('payments.request_amount', { max: due.amount }), [{ field: 'amount', code: 'out_of_range', message: msg('payments.request_amount', { max: due.amount }) }]);
  const row = (
    await many(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, customer_id, document_id, provider, kind, purpose, method, amount, currency, status, note, idempotency_key, created_by)
       VALUES ($1,$2,NULL,$3,$4,'manual','manual','invoice',$5,$6,$7,'succeeded',$8,$9,$10) RETURNING *`,
      [newId('pay'), ctx.tenantId, d.customer_id, d.id, input.method, input.amount, d.currency, input.note ?? null, ctx.idempotencyKey ?? null, ctx.actor.id],
    )
  )[0];
  await audit(ctx, { entity_type: 'payment', entity_id: row.id, action: 'create', after: row });
  await afterInvoicePayment(ctx, d, row);
  return paymentToApi(row);
}

/**
 * Asks the customer to pay the invoice online: a provider-hosted page (a payment link, or the provider's
 * own page for providers that take every payment there). With `notify`, the customer gets the invoice by
 * email with the link. A new request replaces the open one.
 */
export async function requestInvoicePayment(ctx: Ctx, documentId: string, input: { notify?: boolean; returnUrl?: string } = {}) {
  const d = await customerInvoice(ctx, documentId, true);
  if (d.status === 'voided') throw new AppError('invoice_voided', 409, msg('payments.invoice_voided'));
  const { due } = await invoiceDue(ctx, d.id);
  if (due.amount <= 0) throw new AppError('nothing_to_pay', 409, msg('payments.not_payable'));
  const pc = await activeProvider(ctx);
  if (!pc) throw new AppError('online_payment_unavailable', 409, msg('portal.online_payment_unavailable'));
  const customer = await must<any>(ctx, `SELECT * FROM customers WHERE id = $1`, [d.customer_id], 'customer', d.customer_id);
  await exec(ctx, `UPDATE payment_requests SET status = 'cancelled' WHERE invoice_id = $1 AND order_id IS NULL AND status = 'open'`, [d.id]);
  const req = (
    await many(
      ctx,
      `INSERT INTO payment_requests (id, tenant_id, order_id, customer_id, invoice_id, amount, currency, kind, status, created_by) VALUES ($1,$2,NULL,$3,$4,$5,$6,'invoice','open',$7) RETURNING *`,
      [newId('prq'), ctx.tenantId, d.customer_id, d.id, due.amount, d.currency, ctx.actor.id],
    )
  )[0];
  const back = input.returnUrl ?? `${(await storefrontBase(ctx, customer.locale)).replace(/\/$/, '')}/account`;
  const description = msg('payment.description.invoice', { number: d.number }, customer.locale || (await tenantLocale(ctx)));
  const who = { id: customer.id, name: customer.name, email: customer.email, providerRef: customer.provider_refs?.[pc.provider.id] ?? null };
  const pctx = { ...pc.pctx, idempotencyKey: `prq:${req.id}` };
  let url: string | null;
  let ref: string | null;
  let expires: Date | null = null;
  if (pc.provider.createPaymentLink) {
    const r = await pc.provider.createPaymentLink(pctx, {
      amount: due.amount, currency: String(d.currency).trim(), orderId: null, orderNumber: null, reference: d.id, description, customer: who,
      successUrl: `${back}${back.includes('?') ? '&' : '?'}paid=1`, cancelUrl: back, expiresAt: null, metadata: { payment_request_id: req.id },
    });
    [url, ref, expires] = [r.url, r.ref, r.expiresAt];
  } else {
    // Providers that take every payment on their own page (Mollie, PayPal) send the customer there.
    const r = await pc.provider.createPaymentIntent(pctx, {
      amount: due.amount, currency: String(d.currency).trim(), orderId: null, orderNumber: null, reference: d.id, purpose: 'invoice', customer: who,
      savePaymentMethod: true, description, metadata: { payment_request_id: req.id, tenant_id: ctx.tenantId, purpose: 'invoice' }, returnUrl: back,
    });
    if (!r.redirectUrl) throw new AppError('online_payment_unavailable', 409, msg('portal.online_payment_unavailable'));
    if (r.customerRef && who.providerRef !== r.customerRef) await exec(ctx, `UPDATE customers SET provider_refs = provider_refs || $2 WHERE id = $1`, [customer.id, json({ [pc.provider.id]: r.customerRef })]);
    await exec(
      ctx,
      `INSERT INTO payment_intents (id, tenant_id, order_id, document_id, provider, purpose, amount, currency, status, provider_ref, expires_at) VALUES ($1,$2,NULL,$3,$4,'invoice',$5,$6,$7,$8,$9)
       ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING`,
      [newId('pin'), ctx.tenantId, d.id, pc.provider.id, due.amount, d.currency, r.status, r.ref, addMinutes(ctx.now, 60 * 24)],
    );
    [url, ref] = [r.redirectUrl, r.ref];
  }
  const row = (await many(ctx, `UPDATE payment_requests SET provider = $2, provider_ref = $3, url = $4, expires_at = $5 WHERE id = $1 RETURNING *`, [req.id, pc.provider.id, ref, url, expires]))[0];
  const api = paymentRequestToApi(row);
  await audit(ctx, { entity_type: 'document', entity_id: d.id, action: 'request_payment', extra: { request_id: req.id, amount: due.amount } });
  await emit(ctx, 'payment_request.created', { type: 'payment_request', id: row.id }, api);
  if (input.notify !== false && customer.email) {
    await queue(ctx, {
      template: 'invoice_payment', to: customer.email, audience: 'customer', data: { ...d.data, request: { amount: due.amount, url } }, attachments: d.data?.einvoice?.format ? [d.id, `einvoice:${d.id}`] : [d.id], dedupeKey: `invoice_payment:${req.id}`,
    });
  }
  return api;
}

/**
 * Charges the card the customer saved with an earlier online payment, without them being there (a
 * membership renewal). Null when there is no saved card; a refused charge comes back as `{ failed }`.
 */
export async function chargeInvoiceCard(ctx: Ctx, documentId: string, key: string): Promise<{ payment: ReturnType<typeof paymentToApi> } | { failed: string } | null> {
  const d = await customerInvoice(ctx, documentId, true);
  const { due } = await invoiceDue(ctx, d.id);
  if (d.status === 'voided' || due.amount <= 0) return null;
  const pc = await activeProvider(ctx);
  if (!pc) return null;
  const pm = (
    await one<any>(
      ctx,
      `SELECT p.metadata FROM payments p LEFT JOIN orders o ON o.id = p.order_id
        WHERE (p.customer_id = $1 OR o.customer_id = $1) AND p.provider = $2 AND p.status = 'succeeded' AND p.metadata ? 'payment_method' AND p.metadata ? 'customer'
        ORDER BY p.created_at DESC LIMIT 1`,
      [d.customer_id, pc.provider.id],
    )
  )?.metadata;
  if (!pm?.payment_method || !pm?.customer) return null;
  const pctx = { ...pc.pctx, idempotencyKey: key };
  const description = msg('payment.description.invoice', { number: d.number }, await tenantLocale(ctx));
  const r = await pc.provider.authorize(pctx, {
    amount: due.amount, currency: String(d.currency).trim(), orderId: null, reference: d.id, customerRef: pm.customer, paymentMethodRef: pm.payment_method, description,
    metadata: { tenant_id: ctx.tenantId, purpose: 'invoice', document_id: d.id },
  });
  if (r.status !== 'held') return { failed: r.error ?? r.status };
  const cap = await pc.provider.capture(pctx, r.ref, due.amount);
  if (cap.status === 'failed') {
    await pc.provider.void(pctx, r.ref).catch(() => undefined);
    return { failed: 'capture_failed' };
  }
  const row = (
    await many(
      ctx,
      `INSERT INTO payments (id, tenant_id, order_id, customer_id, document_id, provider, kind, purpose, method, amount, currency, status, provider_ref, metadata, created_by)
       VALUES ($1,$2,NULL,$3,$4,$5,'charge','invoice','card',$6,$7,'succeeded',$8,$9,$10) RETURNING *`,
      [newId('pay'), ctx.tenantId, d.customer_id, d.id, pc.provider.id, due.amount, d.currency, r.ref, json({ payment_method: pm.payment_method, customer: pm.customer }), ctx.actor.id],
    )
  )[0];
  await audit(ctx, { entity_type: 'payment', entity_id: row.id, action: 'create', after: row });
  await afterInvoicePayment(ctx, d, row);
  return { payment: paymentToApi(row) };
}

/** A provider reports a payment without a booking: it settles the customer invoice its request names. */
export async function invoicePaid(ctx: Ctx, provider: string, ev: Extract<ProviderEvent, { type: 'payment.succeeded' }>) {
  const existing = await one<any>(ctx, `SELECT * FROM payments WHERE provider = $1 AND provider_ref = $2 AND kind <> 'refund'`, [provider, ev.ref]);
  if (existing?.status === 'succeeded') return;
  const req = ev.paymentRequestId ? await one<any>(ctx, `SELECT * FROM payment_requests WHERE id = $1 AND order_id IS NULL AND invoice_id IS NOT NULL`, [ev.paymentRequestId]) : null;
  if (!req) return;
  const d = await must<any>(ctx, `SELECT * FROM documents WHERE id = $1 FOR UPDATE`, [req.invoice_id], 'document', req.invoice_id);
  const meta = { payment_method: ev.paymentMethodRef ?? null, customer: ev.customerRef ?? null };
  const row = existing
    ? (await many(ctx, `UPDATE payments SET status = 'succeeded', amount = $2, metadata = metadata || $3 WHERE id = $1 RETURNING *`, [existing.id, ev.amount, json(meta)]))[0]
    : (
        await many(
          ctx,
          `INSERT INTO payments (id, tenant_id, order_id, customer_id, document_id, provider, kind, purpose, method, amount, currency, status, provider_ref, metadata)
           VALUES ($1,$2,NULL,$3,$4,$5,'charge','invoice','card',$6,$7,'succeeded',$8,$9) RETURNING *`,
          [newId('pay'), ctx.tenantId, d.customer_id, d.id, provider, ev.amount, d.currency, ev.ref, json(meta)],
        )
      )[0];
  await exec(ctx, `UPDATE payment_intents SET status = 'succeeded' WHERE provider = $1 AND provider_ref = $2`, [provider, ev.ref]);
  if (ev.customerRef) await exec(ctx, `UPDATE customers SET provider_refs = provider_refs || $2 WHERE id = $1`, [d.customer_id, json({ [provider]: ev.customerRef })]);
  const paidReq = (await many(ctx, `UPDATE payment_requests SET status = 'paid', paid_at = now(), payment_id = $2 WHERE id = $1 AND status = 'open' RETURNING *`, [req.id, row.id]))[0];
  if (paidReq) await emit(ctx, 'payment_request.paid', { type: 'payment_request', id: paidReq.id }, paymentRequestToApi(paidReq));
  await afterInvoicePayment(ctx, d, row);
}
