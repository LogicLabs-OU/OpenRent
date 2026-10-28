import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, type PaymentProvider } from '@openrent/plugin-sdk';
import { accounting, payments, portal, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Invoices to a customer that belong to no booking, and their payments (ADR 0014). */
suite('customer payments', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let customer: any;
  let invoice: any;
  const calls: unknown[][] = [];
  const provider: PaymentProvider = {
    id: 'cuspay', displayName: 'Customer pay', authorizationWindowDays: 7, isConfigured: () => true, publicConfig: () => ({}),
    createPaymentIntent: async () => ({ ref: 'unused', clientSecret: null, status: 'requires_payment' }),
    createPaymentLink: async (_c, input) => (calls.push(['link', input.orderId, input.reference, input.amount, input.metadata?.payment_request_id]), { ref: 'cs_1', url: 'https://pay.example/cs_1', expiresAt: null }),
    authorize: async (_c, input) => (calls.push(['authorize', input.orderId, input.reference, input.amount, input.paymentMethodRef]), { ref: 'pi_saved', status: 'held', expiresAt: null }),
    capture: async (_c, _r, amount) => ({ status: 'captured', amountCaptured: amount }),
    void: async () => undefined,
    refund: async (_c, ref, amount) => (calls.push(['refund', ref, amount]), { ref: `re_${calls.length}`, status: 'succeeded' }),
    handleWebhook: async () => ({ type: 'ignored', eventId: 'x', providerType: 'x' }),
  };
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }));
  const balance = async (id: string) => (await admin.get(`/api/v1/documents/${id}/balance`)).body;

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    await t.deps.plugins.register(definePlugin({ id: 'cuspay', name: 'Customer pay', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerPaymentProvider(provider) }));
    customer = (await admin.post('/api/v1/customers', { name: 'Lena Lender', email: 'lena@test.dev' })).body;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('issues an invoice of its own, once per key, at the shop’s tax rate', async () => {
    const body = { lines: [{ description: 'Membership, November', amount: 2500 }], key: 'membership:nov', period: { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' } };
    const r = await admin.post(`/api/v1/customers/${customer.id}/invoices`, body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    invoice = r.body;
    expect(invoice).toMatchObject({ type: 'invoice', order_id: null, customer_id: customer.id, total: { amount: 3000, currency: 'EUR' } });
    expect((await admin.post(`/api/v1/customers/${customer.id}/invoices`, body)).body.id).toBe(invoice.id);
    expect(await balance(invoice.id)).toMatchObject({ total: { amount: 3000 }, paid: { amount: 0 }, due: { amount: 3000 } });
    expect((await admin.get(`/api/v1/customers/${customer.id}/invoices?open=true`)).body.data.map((i: any) => i.id)).toEqual([invoice.id]);
  });

  it('takes a payment at the counter, never more than is owed', async () => {
    const over = await admin.post(`/api/v1/documents/${invoice.id}/payments`, { amount: 5000, method: 'cash' });
    expect(over.status).toBe(422);
    expect(over.body.errors[0].field).toBe('amount');
    const p = await admin.post(`/api/v1/documents/${invoice.id}/payments`, { amount: 1000, method: 'cash' });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ order_id: null, customer_id: customer.id, document_id: invoice.id, purpose: 'invoice' });
    expect((await balance(invoice.id)).due.amount).toBe(2000);
  });

  it('emails a payment link; the provider’s payment settles the rest and the customer no longer owes it', async () => {
    const r = await admin.post(`/api/v1/documents/${invoice.id}/actions/request_payment`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ order_id: null, invoice_id: invoice.id, url: 'https://pay.example/cs_1', amount: { amount: 2000 } });
    expect(calls[0]).toEqual(['link', null, invoice.id, 2000, r.body.id]);
    const mail = (await withSystem(t.deps.db, (db) => db.query(`SELECT subject, body_html, attachments FROM notifications WHERE template_key = 'invoice_payment'`))).rows[0];
    expect(mail.subject).toBe(`Invoice ${invoice.number} from Test Rentals`);
    expect(mail.body_html).toContain('https://pay.example/cs_1');
    expect(mail.attachments).toEqual([invoice.id]);
    expect((await inTenant((ctx) => portal.me(ctx, 'lena@test.dev'))).invoices).toEqual([expect.objectContaining({ id: invoice.id, due: { amount: 2000, currency: 'EUR' } })]);

    await inTenant((ctx) => payments.applyProviderEvent(ctx, 'cuspay', { type: 'payment.succeeded', eventId: 'ev_1', ref: 'pi_link', amount: 2000, currency: 'EUR', orderId: null, purpose: 'invoice', paymentRequestId: r.body.id, customerRef: 'cus_x', paymentMethodRef: 'pm_x' }));
    expect((await balance(invoice.id)).due.amount).toBe(0);
    expect((await inTenant((ctx) => portal.me(ctx, 'lena@test.dev'))).invoices).toEqual([]);
    const paid = (await withSystem(t.deps.db, (db) => db.query(`SELECT event_type, payload FROM outbox WHERE event_type = 'document.paid'`))).rows;
    expect(paid.map((e) => e.payload.data.object)).toEqual([expect.objectContaining({ id: invoice.id, source_key: 'membership:nov' })]);
    // The same event again changes nothing.
    await inTenant((ctx) => payments.applyProviderEvent(ctx, 'cuspay', { type: 'payment.succeeded', eventId: 'ev_1b', ref: 'pi_link', amount: 2000, currency: 'EUR', orderId: null, purpose: 'invoice', paymentRequestId: r.body.id }));
    expect((await balance(invoice.id)).paid.amount).toBe(3000);
  });

  it('books the invoice and both payments against the customer', async () => {
    await inTenant((ctx) => accounting.postPending(ctx));
    const rows = (
      await withTenant(t.deps.db, tenantId, (c) =>
        c.query(`SELECT e.kind, e.customer_id, e.total::int AS total FROM accounting_entries e WHERE e.customer_id = $1 ORDER BY e.number`, [customer.id]),
      )
    ).rows;
    expect(rows.map((e) => [e.kind, e.total])).toEqual([['invoice', 3000], ['payment', 1000], ['payment', 2000]]);
  });

  it('refunds an online payment and the invoice is owed again', async () => {
    const online = (await withSystem(t.deps.db, (db) => db.query(`SELECT id FROM payments WHERE provider_ref = 'pi_link'`))).rows[0];
    const r = await admin.post(`/api/v1/payments/${online.id}/actions/refund`, { amount: 500 });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(r.body).toMatchObject({ kind: 'refund', document_id: invoice.id, order_id: null });
    expect(calls.at(-1)).toEqual(['refund', 'pi_link', 500]);
    expect((await balance(invoice.id)).due.amount).toBe(500);
  });

  it('charges the saved card for the next invoice', async () => {
    const next = (await admin.post(`/api/v1/customers/${customer.id}/invoices`, { lines: [{ description: 'Membership, December', amount: 2500 }], key: 'membership:dec' })).body;
    const r = await admin.post(`/api/v1/documents/${next.id}/actions/charge_card`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(calls.at(-1)).toEqual(['authorize', null, next.id, 3000, 'pm_x']);
    expect((await balance(next.id)).due.amount).toBe(0);
  });

  it('voids an invoice of no booking with a credit note of its own', async () => {
    const third = (await admin.post(`/api/v1/customers/${customer.id}/invoices`, { lines: [{ description: 'Late fee for a book', amount: 400, tax_rate_bp: 0 }] })).body;
    const r = await admin.post(`/api/v1/documents/${third.id}/actions/void`, { reason: 'waived' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.credit_note).toMatchObject({ type: 'credit_note', order_id: null, customer_id: customer.id, total: { amount: 400 } });
    expect((await balance(third.id)).due.amount).toBe(0);
    const pay = await admin.post(`/api/v1/documents/${third.id}/payments`, { amount: 100, method: 'cash' });
    expect(pay.status).toBe(409);
  });
});
