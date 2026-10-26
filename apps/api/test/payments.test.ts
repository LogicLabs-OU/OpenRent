import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payments, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { definePlugin, type PaymentProvider, type ProviderEvent } from '@openrent/plugin-sdk';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** A payment provider that records every call; `state` drives what retrievePayment reports. */
function fakeProvider() {
  const calls: [string, ...unknown[]][] = [];
  const state = new Map<string, ProviderEvent>();
  let n = 0;
  const provider: PaymentProvider = {
    id: 'fakepay',
    displayName: 'Fake pay',
    authorizationWindowDays: 7,
    isConfigured: () => true,
    publicConfig: () => ({ publishable_key: 'pk_fake' }),
    async createPaymentIntent(_c, input) {
      calls.push(['intent', input.amount]);
      return { ref: `fpi_${++n}`, clientSecret: 'secret', status: 'requires_payment', customerRef: 'fcus_1' };
    },
    async createPaymentLink(c, input) {
      calls.push(['link', input.amount, input.metadata?.payment_request_id, c.idempotencyKey]);
      return { ref: `flink_${++n}`, url: `https://pay.fake/${n}`, expiresAt: null };
    },
    async authorize(c, input) {
      calls.push(['authorize', input.amount, c.idempotencyKey]);
      return { ref: `fauth_${++n}`, status: 'held', expiresAt: new Date(Date.now() + 7 * 86400_000) };
    },
    async capture(_c, ref, amount) {
      calls.push(['capture', ref, amount]);
      return { status: 'captured', amountCaptured: amount };
    },
    async void(_c, ref) {
      calls.push(['void', ref]);
    },
    async refund(_c, ref, amount) {
      calls.push(['refund', ref, amount]);
      return { ref: `fre_${++n}`, status: 'succeeded' };
    },
    async handleWebhook() {
      return { type: 'ignored', eventId: 'x', providerType: 'x' };
    },
    async retrievePayment(_c, ref) {
      const ev = state.get(ref);
      if (!ev) throw Object.assign(new Error('No such payment'), { statusCode: 404 });
      return ev;
    },
  };
  return { provider, calls, state };
}

suite('payment links, deposits, damage messages and reconciliation', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;
  const fake = fakeProvider();
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );

  /** A reserved order for a customer who paid online before (a saved card on file). */
  async function bookedOrder(deposit = 10000) {
    const c = await admin.post('/api/v1/customers', { name: 'Pay Person', email: `pay-${Date.now()}-${Math.random()}@test.dev` });
    const o = (await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(2), ends_at: isoIn(4), lines: [{ variant_id: variant, quantity: 1 }], deposit: { mode: 'fixed', amount: deposit } })).body;
    await withSystem(t.deps.db, (db) =>
      db.query(
        `INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, metadata) VALUES ($1,$2,$3,'fakepay','charge','rental','card',100,'EUR','succeeded',$4,$5)`,
        [`pay_seed${Date.now()}${Math.floor(Math.random() * 1e6)}`, tenantId, o.id, `fseed_${o.id}`, JSON.stringify({ payment_method: 'fpm_1', customer: 'fcus_1' })],
      ),
    );
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    const dep = (await admin.get(`/api/v1/orders/${o.id}?expand=deposits`)).body.deposits[0];
    return { order: o, deposit: dep };
  }
  const ledger = async (orderId: string) =>
    (await withSystem(t.deps.db, (db) => db.query(`SELECT provider, kind, purpose, method, amount::int AS amount, status FROM payments WHERE order_id = $1 AND provider_ref IS DISTINCT FROM $2 ORDER BY created_at, kind`, [orderId, `fseed_${orderId}`]))).rows;

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    await t.deps.plugins.register(definePlugin({ id: 'fakepay', name: 'Fake pay', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerPaymentProvider(fake.provider) }));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Raft', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${(await admin.get('/api/v1/locations')).body.data[0].id}`, { quantity: 20 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('sends a provider-hosted payment link and settles it from the payment', async () => {
    const { order } = await bookedOrder(0);
    const link = await admin.post(`/api/v1/orders/${order.id}/payment_links`, { amount: 2500, notify: false });
    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({ provider: 'fakepay', url: expect.stringMatching(/^https:\/\/pay\.fake\//) });
    expect(fake.calls.find((c) => c[0] === 'link')).toEqual(['link', 2500, link.body.id, `prq:${link.body.id}`]);
    await inTenant((ctx) =>
      payments.applyProviderEvent(ctx, 'fakepay', { type: 'payment.succeeded', eventId: 'evt_link_1', ref: 'fpi_link', amount: 2500, currency: 'EUR', orderId: order.id, purpose: 'rental', paymentRequestId: link.body.id }),
    );
    const req = (await admin.get(`/api/v1/orders/${order.id}/payment_requests`)).body.data[0];
    expect(req.status).toBe('paid');
    const events = await withSystem(t.deps.db, (db) => db.query(`SELECT event_type FROM outbox WHERE event_type = 'payment_link.paid' AND payload->'data'->'object'->>'id' = $1`, [link.body.id]));
    expect(events.rows).toHaveLength(1);
  });

  it('charges a deposit to the saved card and refunds what is not kept for damage', async () => {
    const { order, deposit } = await bookedOrder(10000);
    const charged = await admin.post(`/api/v1/deposits/${deposit.id}/actions/authorize`, { method: 'charge', via: 'provider' });
    expect(charged.status, JSON.stringify(charged.body)).toBe(200);
    expect(charged.body).toMatchObject({ status: 'held', method: 'charge' });
    const auth = fake.calls.filter((c) => c[0] === 'authorize').at(-1)!;
    expect(fake.calls.at(-1)).toEqual(['capture', expect.stringMatching(/^fauth_/), 10000]);
    // Keep 3000 for damage: 7000 goes back to the card; nothing is counted twice.
    expect((await admin.post(`/api/v1/deposits/${deposit.id}/actions/capture`, { amount: 3000 })).status).toBe(200);
    expect(fake.calls.at(-1)).toEqual(['refund', expect.stringMatching(/^fauth_/), 7000]);
    expect(await ledger(order.id)).toEqual([
      { provider: 'fakepay', kind: 'charge', purpose: 'deposit', method: 'card', amount: 10000, status: 'succeeded' },
      { provider: 'manual', kind: 'charge', purpose: 'damage', method: 'deposit', amount: 3000, status: 'succeeded' },
      { provider: 'manual', kind: 'refund', purpose: 'deposit', method: 'deposit', amount: 3000, status: 'succeeded' },
      { provider: 'fakepay', kind: 'refund', purpose: 'deposit', method: 'card', amount: 7000, status: 'succeeded' },
    ]);
    // Each attempt has its own idempotency key.
    expect(auth[2]).toMatch(/^dep:/);

    // Releasing a charged deposit refunds all of it.
    const other = await bookedOrder(5000);
    await admin.post(`/api/v1/deposits/${other.deposit.id}/actions/authorize`, { method: 'charge', via: 'provider' });
    expect((await admin.post(`/api/v1/deposits/${other.deposit.id}/actions/release`, {})).status).toBe(200);
    expect(fake.calls.at(-1)).toEqual(['refund', expect.stringMatching(/^fauth_/), 5000]);
  });

  it('renews or charges card holds before they expire, as the shop chooses', async () => {
    const hold = async () => {
      const b = await bookedOrder(4000);
      await admin.post(`/api/v1/deposits/${b.deposit.id}/actions/authorize`, { method: 'card_auth' });
      await withSystem(t.deps.db, (db) => db.query(`UPDATE deposits SET expires_at = now() + interval '2 hours' WHERE id = $1`, [b.deposit.id]));
      return b.deposit.id as string;
    };
    await admin.patch('/api/v1/tenant/settings', { deposit_expiry_policy: 'reauthorize' });
    const a = await hold();
    const before = fake.calls.length;
    await inTenant((ctx) => payments.depositMaintenance(ctx));
    expect(fake.calls.slice(before).map((c) => c[0])).toEqual(['void', 'authorize']);
    expect((await admin.get(`/api/v1/deposits/${a}`)).body).toMatchObject({ status: 'held', method: 'card_auth' });

    await admin.patch('/api/v1/tenant/settings', { deposit_expiry_policy: 'convert_to_charge' });
    const b = await hold();
    await inTenant((ctx) => payments.depositMaintenance(ctx));
    expect(fake.calls.at(-1)).toEqual(['capture', expect.stringMatching(/^fauth_/), 4000]);
    expect((await admin.get(`/api/v1/deposits/${b}`)).body).toMatchObject({ status: 'held', method: 'charge', expires_at: null });
    const bad = await admin.patch('/api/v1/tenant/settings', { deposit_expiry_policy: 'never' });
    expect(bad.status).toBe(422);
    await admin.patch('/api/v1/tenant/settings', { deposit_expiry_policy: 'notify' });
  });

  it('tells the customer about damage once per inspection, with photos on the order page', async () => {
    const { order } = await bookedOrder(0);
    expect((await admin.post(`/api/v1/orders/${order.id}/actions/check_out`, {})).status).toBeLessThan(300);
    expect((await admin.post(`/api/v1/orders/${order.id}/actions/check_in`, { all: true })).status).toBeLessThan(300);
    const done = await admin.post(`/api/v1/orders/${order.id}/actions/inspect`, { damage_charges: [{ description: 'Torn seat', amount: 2500 }, { description: 'Scratch (waived later)', amount: 0 }] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const sent = await withSystem(t.deps.db, (db) => db.query(`SELECT subject FROM notifications WHERE order_id = $1 AND template_key = 'damage_charge_created'`, [order.id]));
    expect(sent.rows).toHaveLength(1);
    expect(sent.rows[0].subject).toContain(String(order.number));
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const pub = await sf.get(`/api/v1/storefront/orders/${order.public_token}?token=${order.public_token}`);
    expect(pub.body.damage_charges).toEqual([expect.objectContaining({ description: 'Torn seat', photo_ids: [] })]);
  });

  it('finds payments the provider sees differently, once', async () => {
    const { order } = await bookedOrder(0);
    await withSystem(t.deps.db, (db) =>
      db.query(`INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref) VALUES ('pay_rec1',$1,$2,'fakepay','charge','rental','card',5000,'EUR','succeeded','fpi_rec1'), ('pay_rec2',$1,$2,'fakepay','charge','rental','card',5000,'EUR','succeeded','fpi_rec2')`, [tenantId, order.id]),
    );
    fake.state.set('fpi_rec1', { type: 'payment.failed', eventId: 'e1', ref: 'fpi_rec1', orderId: order.id, error: 'card_declined' });
    fake.state.set('fpi_rec2', { type: 'payment.succeeded', eventId: 'e2', ref: 'fpi_rec2', amount: 4000, currency: 'EUR', orderId: order.id, purpose: 'rental' });
    const first = await inTenant((ctx) => payments.reconcilePayments(ctx));
    expect(first.issues).toBeGreaterThanOrEqual(2);
    const again = await inTenant((ctx) => payments.reconcilePayments(ctx));
    expect(again.issues).toBe(0);
    const open = (await admin.get('/api/v1/payment_reconciliation_issues?open=true')).body.data;
    const kinds = Object.fromEntries(open.filter((i: any) => i.order_id === order.id).map((i: any) => [i.provider_ref, i.kind]));
    expect(kinds).toMatchObject({ fpi_rec1: 'status_mismatch', fpi_rec2: 'amount_mismatch' });
    const one = open.find((i: any) => i.provider_ref === 'fpi_rec1');
    expect((await admin.post(`/api/v1/payment_reconciliation_issues/${one.id}/actions/resolve`, { resolution: 'Refunded by hand' })).body.resolved_at).toBeTruthy();
    expect((await admin.post(`/api/v1/payment_reconciliation_issues/${one.id}/actions/resolve`, {})).status).toBe(409);
  });
});
