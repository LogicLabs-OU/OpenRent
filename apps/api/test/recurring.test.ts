import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, type PaymentProvider } from '@openrent/plugin-sdk';
import { orders, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { postAccounting } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;
const DAY = 86_400_000;

/** Long rentals billed per period while out (FR-OR-11). */
suite('recurring billing', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;
  let customer: string;
  let card: 'ok' | 'refused' = 'ok';
  const charges: number[] = [];

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>, now = new Date()) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now, plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );
  const sql = (text: string, values: unknown[] = []) => withSystem(t.deps.db, async (c) => (await c.query(text, values)).rows);
  const docs = async (orderId: string) =>
    (await sql(`SELECT type, total, data FROM documents WHERE order_id = $1 AND type IN ('invoice', 'credit_note') ORDER BY created_at`, [orderId])).map((d) => ({ type: d.type, total: Number(d.total), period: d.data.billing_period, lines: d.data.lines }));
  const book = async (days: number, cycle: string, startOffset = -3600_000) => {
    const start = new Date(Date.now() + startOffset);
    const o = await admin.post('/api/v1/orders', { customer_id: customer, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + days * DAY).toISOString(), billing_cycle: cycle, lines: [{ variant_id: variant, quantity: 1 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect((await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false })).status).toBe(200);
    return o.body;
  };

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    const provider: PaymentProvider = {
      id: 'cardpay', displayName: 'Card pay', authorizationWindowDays: 7, isConfigured: () => true, publicConfig: () => ({}),
      createPaymentIntent: async () => ({ ref: 'pi', clientSecret: 'cs', status: 'requires_payment' }),
      authorize: async (_c, input) => (card === 'ok' ? (charges.push(input.amount), { ref: `auth_${charges.length}`, status: 'held', expiresAt: null }) : { ref: 'auth_x', status: 'failed', expiresAt: null, error: 'card_declined' }),
      capture: async (_c, _r, amount) => ({ status: 'captured', amountCaptured: amount }),
      void: async () => undefined, refund: async () => ({ ref: 'r', status: 'succeeded' }), handleWebhook: async () => ({ type: 'ignored', eventId: 'x', providerType: 'x' }),
    };
    await t.deps.plugins.register(definePlugin({ id: 'cardpay', name: 'Card pay', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerPaymentProvider(provider) }));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Container', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId!}`, { quantity: 10 });
    customer = (await admin.post('/api/v1/customers', { name: 'Long Term Ltd', email: 'long@test.dev' })).body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('starts periods on the same local day each month, across daylight saving', async () => {
    // Europe/Tallinn moves from +02 to +03 on 29 March 2026; the period keeps 10:00 local time.
    const from = new Date('2026-03-15T08:00:00.000Z');
    expect(orders.nextPeriodStart(from, 'monthly', 'Europe/Tallinn').toISOString()).toBe('2026-04-15T07:00:00.000Z');
    // 31 January → 28 February; weekly is seven days.
    expect(orders.nextPeriodStart(new Date('2026-01-31T09:00:00.000Z'), 'monthly', 'UTC').toISOString()).toBe('2026-02-28T09:00:00.000Z');
    expect(orders.nextPeriodStart(new Date('2026-10-20T09:00:00.000Z'), 'weekly', 'UTC').toISOString()).toBe('2026-10-27T09:00:00.000Z');
  });

  it('bills the first period at pickup, the next ones as they start, and the rest at return', async () => {
    const o = await book(70, 'monthly');
    expect((await admin.patch(`/api/v1/orders/${o.id}`, { billing_cycle: 'yearly' })).body.errors[0].field).toBe('billing_cycle');
    await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    expect((await admin.patch(`/api/v1/orders/${o.id}`, { billing_cycle: 'weekly' })).status).toBe(409);
    // 70 days at 10.00 + 20 % tax = 840.00 in all.
    const total = (await admin.get(`/api/v1/orders/${o.id}`)).body.totals.total.amount;
    expect(total).toBe(84000);
    let d = await docs(o.id);
    expect(d).toHaveLength(1);
    expect(d[0]!.type).toBe('invoice');
    expect(d[0]!.lines[0].name).toContain('Container ·');
    // About a month of 70 days.
    expect(d[0]!.total).toBeGreaterThan(84000 * 28 / 70 - 100);
    expect(d[0]!.total).toBeLessThan(84000 * 31 / 70 + 100);
    // No run in between: two periods are caught up at once 65 days later, the last one waits for the return.
    expect(await inTenant((ctx) => orders.billRecurring(ctx), new Date(Date.now() + 65 * DAY))).toBe(2);
    d = await docs(o.id);
    expect(d.map((x) => x.type)).toEqual(['invoice', 'invoice', 'invoice']);
    expect(d.reduce((s, x) => s + x.total, 0)).toBe(total);
    expect(d[2]!.period.final).toBe(true);
    // Nothing more, even when run again.
    expect(await inTenant((ctx) => orders.billRecurring(ctx), new Date(Date.now() + 66 * DAY))).toBe(0);
  });

  it('takes an extension into the next period and credits an early return', async () => {
    const o = await book(21, 'weekly');
    await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    const longer = new Date(new Date(o.ends_at).getTime() + 7 * DAY).toISOString();
    const ext = await admin.post(`/api/v1/orders/${o.id}/actions/extend`, { ends_at: longer, notify: false });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200);
    // The extension added no invoice of its own.
    expect((await docs(o.id)).length).toBe(1);
    expect(await inTenant((ctx) => orders.billRecurring(ctx), new Date(Date.now() + 7.5 * DAY))).toBe(1);
    const total = (await admin.get(`/api/v1/orders/${o.id}`)).body.totals.total.amount;
    expect(total).toBe(28 * 1200);
    // Back after ten days instead of four weeks: the return credits what was billed too much.
    const early = new Date(new Date(o.starts_at).getTime() + 10 * DAY).toISOString();
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/return_early`, { ends_at: early, notify: false })).status).toBe(200);
    await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true });
    const d = await docs(o.id);
    expect(d.map((x) => x.type)).toEqual(['invoice', 'invoice', 'credit_note']);
    const after = (await admin.get(`/api/v1/orders/${o.id}`)).body.totals.total.amount;
    expect(d[0]!.total + d[1]!.total - d[2]!.total).toBe(after);
    // The books agree: invoices less credit notes is what the booking cost.
    await postAccounting(t.deps, quietLogger);
    const entries = await sql(`SELECT kind, total FROM accounting_entries WHERE order_id = $1 AND kind IN ('invoice', 'credit_note')`, [o.id]);
    expect(entries.reduce((s, e) => s + (e.kind === 'invoice' ? 1 : -1) * Number(e.total), 0)).toBe(after);
  });

  it('charges the saved card, and asks for payment with a link when the card is refused', async () => {
    const o = await book(14, 'weekly');
    // As if the customer paid online once: the provider keeps their card.
    await sql(`INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status, provider_ref, metadata) VALUES ('pay_seed_rec', $1, $2, 'cardpay', 'charge', 'deposit', 'card', 100, 'EUR', 'succeeded', 'seed', '{"payment_method":"pm_1","customer":"cus_1"}')`, [tenantId, o.id]);
    await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    const first = (await docs(o.id))[0]!;
    expect(charges.at(-1)).toBe(first.total);
    const paid = (await admin.get(`/api/v1/orders/${o.id}?expand=payments`)).body.payments.filter((p: any) => p.purpose === 'rental');
    expect(paid.map((p: any) => [p.amount.amount, p.status])).toEqual([[first.total, 'succeeded']]);

    card = 'refused';
    expect(await inTenant((ctx) => orders.billRecurring(ctx), new Date(Date.now() + 7.5 * DAY))).toBe(1);
    const second = (await docs(o.id))[1]!;
    const requests = (await admin.get(`/api/v1/orders/${o.id}?expand=payment_requests`)).body.payment_requests;
    expect(requests.map((r: any) => [r.status, r.amount.amount])).toEqual([['open', second.total]]);
    const failed = await sql(`SELECT 1 FROM outbox WHERE event_type = 'payment.failed' AND aggregate_id = $1`, [o.id]);
    expect(failed).toHaveLength(1);
    const billed = await sql(`SELECT count(*)::int AS n FROM outbox WHERE event_type = 'order.billed' AND aggregate_id = $1`, [o.id]);
    expect(billed[0].n).toBe(2);
    card = 'ok';
  });
});
