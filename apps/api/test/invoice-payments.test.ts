import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, type PaymentProvider, type ProviderEvent } from '@openrent/plugin-sdk';
import { accounting, payments, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** A monthly invoice paid online as a whole, shared out over its bookings (ADR 0012). */
suite('paying a monthly invoice online', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let session = '';
  let invoice: any;
  let orders: any[] = [];
  const calls: unknown[][] = [];
  const state = new Map<string, ProviderEvent>();
  const provider: PaymentProvider = {
    id: 'invpay', displayName: 'Invoice pay', authorizationWindowDays: 7, isConfigured: () => true, publicConfig: () => ({ publishable_key: 'pk_inv' }),
    createPaymentIntent: async (_c, input) => (calls.push(['intent', input.amount, input.metadata?.payment_request_id]), { ref: 'ipi_1', clientSecret: 'cs_inv', status: 'requires_payment' }),
    createPaymentLink: async () => ({ ref: 'lnk', url: 'https://pay.example/x', expiresAt: null }),
    authorize: async () => ({ ref: 'x', status: 'held', expiresAt: null }), capture: async (_c, _r, amount) => ({ status: 'captured', amountCaptured: amount }),
    void: async () => undefined,
    refund: async (_c, ref, amount) => (calls.push(['refund', ref, amount]), { ref: `ire_${calls.length}`, status: 'succeeded' }),
    handleWebhook: async () => ({ type: 'ignored', eventId: 'x', providerType: 'x' }),
    retrievePayment: async (_c, ref) => {
      const ev = state.get(ref);
      if (!ev) throw Object.assign(new Error('No such payment'), { statusCode: 404 });
      return ev;
    },
  };
  const as = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals', 'x-customer-session': session });
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }));

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    await t.deps.plugins.register(definePlugin({ id: 'invpay', name: 'Invoice pay', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerPaymentProvider(provider) }));
    const variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Truss', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 10000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 10 });
    const c = (await admin.post('/api/v1/customers', { type: 'company', name: 'Stage Co', company_name: 'Stage Co', email: 'stage@test.dev', b2b: { on_account: true, invoice_schedule: 'monthly' } })).body;
    for (const [from, to] of [[-10, -9], [-6, -4]] as const) {
      const o = (await admin.post('/api/v1/orders', { customer_id: c.id, location_id: locationId, starts_at: isoIn(from), ends_at: isoIn(to), lines: [{ variant_id: variant, quantity: 1 }], deposit: { mode: 'none' } })).body;
      await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
      await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
      await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true });
      orders.push(o);
    }
    invoice = (await admin.post(`/api/v1/customers/${c.id}/actions/invoice_now`, {})).body;
    await admin.post(`/api/v1/customers/${c.id}/actions/send_portal_link`);
    const r = await withSystem(t.deps.db, (db) => db.query(`SELECT body_html FROM notifications WHERE template_key = 'portal_invitation' AND recipient = 'stage@test.dev' ORDER BY created_at DESC LIMIT 1`));
    session = (await new Client(t.app, { 'x-tenant-slug': 'test-rentals' }).post('/api/v1/portal/auth/verify', { token: /token(?:=|&#x3D;)([\w-]+)/.exec(r.rows[0].body_html)![1]! })).body.token;
    orders = await Promise.all(orders.map(async (o) => (await admin.get(`/api/v1/orders/${o.id}`)).body));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  const due = () => orders.reduce((s, o) => s + o.totals.balance.amount, 0);

  it('lists the invoice with what its bookings owe, and starts one payment for all of it', async () => {
    const me = (await as().get('/api/v1/portal/me')).body;
    expect(me.invoices).toEqual([expect.objectContaining({ id: invoice.id, due: { amount: due(), currency: 'EUR' } })]);
    const r = await as().post(`/api/v1/portal/invoices/${invoice.id}/payment_intents`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ client_secret: 'cs_inv', invoice_id: invoice.id, amount: { amount: due() } });
    expect(r.body.order_url).toContain(`/order/${orders[0].public_token}`);
    expect(calls[0]).toEqual(['intent', due(), expect.stringMatching(/^prq_/)]);
    expect((await as().post(`/api/v1/portal/invoices/inv_nope/payment_intents`)).status).toBe(409);
  });

  it('shares the payment out over the bookings when it succeeds, books it, and reconciles it as one', async () => {
    const total = due();
    const requestId = calls[0]![2] as string;
    await inTenant((ctx) => payments.applyProviderEvent(ctx, 'invpay', { type: 'payment.succeeded', eventId: 'iev_1', ref: 'ipi_1', amount: total, currency: 'EUR', orderId: orders[0].id, purpose: 'rental', paymentRequestId: requestId }));
    for (const o of orders) expect((await admin.get(`/api/v1/orders/${o.id}`)).body.totals.balance.amount).toBe(0);
    const rows = (await withSystem(t.deps.db, (db) => db.query(`SELECT order_id, amount::int AS amount, provider_ref FROM payments WHERE provider = 'invpay' ORDER BY provider_ref`))).rows;
    expect(rows).toEqual([
      { order_id: orders[0].id, amount: orders[0].totals.balance.amount, provider_ref: 'ipi_1' },
      { order_id: orders[1].id, amount: orders[1].totals.balance.amount, provider_ref: 'ipi_1:part1' },
    ]);
    expect((await as().get('/api/v1/portal/me')).body.invoices).toEqual([]);
    await inTenant((ctx) => accounting.postPending(ctx));
    const booked = (await withTenant(t.deps.db, tenantId, (c) => c.query(`SELECT sum(l.debit)::int AS d FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id WHERE e.kind = 'payment' AND e.order_id = ANY($1)`, [orders.map((o) => o.id)]))).rows[0].d;
    expect(booked).toBe(total);
    state.set('ipi_1', { type: 'payment.succeeded', eventId: 'iev_1', ref: 'ipi_1', amount: total, currency: 'EUR', orderId: orders[0].id, purpose: 'rental' });
    const rec = await inTenant((ctx) => payments.reconcilePayments(ctx));
    expect(rec.issues).toBe(0);
  });

  it('refunds a share on the provider’s payment it came from', async () => {
    const part = (await withSystem(t.deps.db, (db) => db.query(`SELECT id FROM payments WHERE provider_ref = 'ipi_1:part1'`))).rows[0];
    const r = await admin.post(`/api/v1/payments/${part.id}/actions/refund`, { amount: 1000 });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(calls.at(-1)).toEqual(['refund', 'ipi_1', 1000]);
  });
});
