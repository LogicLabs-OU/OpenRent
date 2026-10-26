import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '@openrent/db';
import { startMollieFake, startPayPalFake, type MollieFake, type PayPalFake } from '@openrent/payment-fakes';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Mollie and PayPal (PRD M2): checkout on the provider's page, webhooks, the return, and voiding. */
suite('Mollie and PayPal payments', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;
  let mollie: MollieFake;
  let paypal: PayPalFake;
  let terms: string;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const sql = (text: string, values: unknown[] = []) => withSystem(t.deps.db, async (c) => (await c.query(text, values)).rows);
  const book = async (offset: number) => {
    const s = await shop().post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(offset), ends_at: isoIn(offset + 1), lines: [{ variant_id: variant, quantity: 1 }] });
    return shop().post(`/api/v1/storefront/checkout_sessions/${s.body.id}/actions/complete`, { customer: { name: 'Online Buyer', email: `buyer-${offset}@test.dev` }, terms_accepted: true, terms_hash: terms });
  };
  const only = async (id: 'mollie' | 'paypal') => {
    await admin.patch('/api/v1/payment_providers/mollie', { enabled: id === 'mollie' });
    await admin.patch('/api/v1/payment_providers/paypal', { enabled: id === 'paypal' });
  };

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    mollie = await startMollieFake();
    paypal = await startPayPalFake();
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'E-bike', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId!}`, { quantity: 10 });
    await admin.patch('/api/v1/tenant/settings', { storefront: { payment: 'stripe' } });
    terms = (await shop().get('/api/v1/storefront/settings')).body.terms.hash;
  }, 120_000);

  afterAll(async () => {
    await mollie?.close();
    await paypal?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('lists each provider with its settings fields, and keeps secrets to itself', async () => {
    expect((await admin.patch('/api/v1/payment_providers/mollie', { config: { api_key: mollie.apiKey, api_base_url: mollie.url } })).status).toBe(200);
    await admin.patch('/api/v1/payment_providers/paypal', { config: { client_id: paypal.clientId, client_secret: paypal.clientSecret, webhook_id: paypal.webhookId, api_base_url: paypal.url } });
    const list = (await admin.get('/api/v1/payment_providers')).body.data;
    const m = list.find((x: any) => x.id === 'mollie');
    expect(m).toMatchObject({ plugin_id: 'payment-mollie', configured: true, secrets: { api_key: true }, webhook_url: expect.stringContaining(`/webhooks/mollie/${tenantId}`) });
    expect(m.settings.map((f: any) => f.key)).toEqual(['api_key']);
    expect(JSON.stringify(list)).not.toContain(mollie.apiKey);
    expect(list.find((x: any) => x.id === 'paypal')).toMatchObject({ configured: true, values: { client_id: paypal.clientId, webhook_id: paypal.webhookId }, secrets: { client_secret: true } });
  });

  it('pays on Mollie’s page; the webhook confirms the booking', async () => {
    await only('mollie');
    const r = await book(10);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.status).toBe('quote');
    expect(r.body.payment).toMatchObject({ provider: 'mollie', client_secret: null, redirect_url: expect.stringContaining(`${mollie.url}/checkout/tr_`) });
    const paymentId = r.body.payment.redirect_url.split('/').pop();
    const p = mollie.payments.find((x) => x.id === paymentId)!;
    expect(p.redirectUrl).toContain(`/order/${r.body.order.token}`);
    expect(p.webhookUrl).toContain(`/webhooks/mollie/${tenantId}`);
    mollie.checkout(paymentId);
    const hook = () => t.app.inject({ method: 'POST', url: `/webhooks/mollie/${tenantId}`, payload: `id=${paymentId}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect((await hook()).json()).toEqual({ received: true, duplicate: false });
    expect((await hook()).json()).toEqual({ received: true, duplicate: true });
    const order = (await admin.get(`/api/v1/orders/${r.body.order.id}?expand=payments`)).body;
    expect([order.status, order.payment_status]).toEqual(['reserved', 'paid']);
    expect(order.payments.map((x: any) => [x.provider, x.status, x.amount.amount])).toEqual([['mollie', 'succeeded', 4800]]);
    // A forged webhook names no real payment: refused.
    expect((await t.app.inject({ method: 'POST', url: `/webhooks/mollie/${tenantId}`, payload: 'id=evil', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(400);
  });

  it('approves in PayPal and captures when the customer comes back to the booking', async () => {
    await only('paypal');
    const r = await book(14);
    expect(r.body.payment.redirect_url).toContain('checkoutnow?token=');
    const ref = new URL(r.body.payment.redirect_url).searchParams.get('token')!;
    paypal.approve(ref);
    const back = await shop().post(`/api/v1/storefront/orders/${r.body.order.id}/payments/sync`, { token: r.body.order.token });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.status).toBe('reserved');
    expect(paypal.orders.find((o) => o.id === ref)!.captures).toHaveLength(1);
    // Refunded from the admin through PayPal.
    const pay = (await admin.get(`/api/v1/orders/${r.body.order.id}?expand=payments`)).body.payments[0];
    const refund = await admin.post(`/api/v1/payments/${pay.id}/actions/refund`, { amount: 800 });
    expect(refund.status, JSON.stringify(refund.body)).toBe(200);
    expect(paypal.orders.find((o) => o.id === ref)!.captures[0]!.refunds.map((x) => x.minor)).toEqual([800]);
  });

  it('voids a payment that has not settled, at the provider too, and refuses one that has', async () => {
    await only('mollie');
    const r = await book(18);
    const ref = r.body.payment.redirect_url.split('/').pop();
    await sql(`INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref) VALUES ('pay_pending_1', $1, $2, 'mollie', 'charge', 'rental', 'card', 4800, 'EUR', 'pending', $3)`, [tenantId, r.body.order.id, ref]);
    const voided = await admin.post('/api/v1/payments/pay_pending_1/actions/void', { reason: 'Customer changed their mind' });
    expect([voided.status, voided.body.status]).toEqual([200, 'cancelled']);
    expect(mollie.payments.find((x) => x.id === ref)!.status).toBe('canceled');
    const again = await admin.post('/api/v1/payments/pay_pending_1/actions/void', {});
    expect([again.status, again.body.code]).toEqual([409, 'not_voidable']);
    const settled = (await sql(`SELECT id FROM payments WHERE status = 'succeeded' LIMIT 1`))[0].id;
    expect((await admin.post(`/api/v1/payments/${settled}/actions/void`, {})).body.code).toBe('not_voidable');
    expect((await sql(`SELECT 1 FROM outbox WHERE event_type = 'payment.voided'`)).length).toBe(1);
  });
});
