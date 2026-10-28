import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, type PaymentProvider } from '@openrent/plugin-sdk';
import { hookContext, payments, plugins, type Ctx } from '@openrent/core';
import { migratePlugins, withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** The memberships plugin (ADR 0014): plans, fees as customer invoices, member prices and a borrowing limit. */
suite('memberships plugin', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let customer: any;
  let variant: string;
  let plan: any;
  let member: any;
  const calls: unknown[][] = [];
  const provider: PaymentProvider = {
    id: 'mempay', displayName: 'Member pay', authorizationWindowDays: 7, isConfigured: () => true, publicConfig: () => ({}),
    createPaymentIntent: async () => ({ ref: 'unused', clientSecret: null, status: 'requires_payment' }),
    createPaymentLink: async (_c, input) => (calls.push(['link', input.reference, input.amount]), { ref: `cs_${calls.length}`, url: `https://pay.example/${calls.length}`, expiresAt: null }),
    authorize: async (_c, input) => (calls.push(['card', input.reference, input.amount]), { ref: `pi_card_${calls.length}`, status: 'held', expiresAt: null }),
    capture: async (_c, _r, amount) => ({ status: 'captured', amountCaptured: amount }),
    void: async () => undefined,
    refund: async () => ({ ref: 're', status: 'succeeded' }),
    handleWebhook: async () => ({ type: 'ignored', eventId: 'x', providerType: 'x' }),
  };
  const ctxOf = (c: any): Ctx => ({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger });
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) => withTenant(t.deps.db, tenantId, (c) => fn(ctxOf(c)));
  const api = (path: string) => `/api/v1/plugins/memberships${path}`;
  /** Hands the outbox's `document.paid` events to the plugins, as the worker does. */
  async function dispatchPaid() {
    const rows = (await withSystem(t.deps.db, (c) => c.query(`SELECT id, payload FROM outbox WHERE event_type = 'document.paid' AND NOT (payload ? 'handled_in_test') ORDER BY created_at`))).rows;
    for (const r of rows) {
      await inTenant((ctx) => t.deps.plugins.dispatch(r.payload, hookContext(ctx)));
      await withSystem(t.deps.db, (c) => c.query(`UPDATE outbox SET payload = payload || '{"handled_in_test": true}' WHERE id = $1`, [r.id]));
    }
  }
  const memberRow = async () => (await admin.get(api(`/members?customer_id=${customer.id}`))).body.data[0];
  const quote = async (quantity = 1) => (await admin.post('/api/v1/price_quote', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(20), ends_at: isoIn(21), lines: [{ variant_id: variant, quantity }] })).body;

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    await t.deps.plugins.register(definePlugin({ id: 'mempay', name: 'Member pay', version: '1.0.0', compat: '^1.0.0', setup: (a) => a.registerPaymentProvider(provider) }));
    await migratePlugins(dbinfo!.url, t.deps.plugins.migrations);
    variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Drill', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 10 });
    customer = (await admin.post('/api/v1/customers', { name: 'Mia Member', email: 'mia@test.dev' })).body;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('is off until the shop turns it on', async () => {
    expect((await admin.get('/api/v1/plugin_pages')).body.data).toEqual([]);
    expect((await admin.get(api('/plans'))).status).toBe(404);
    expect((await admin.patch('/api/v1/plugins/memberships', { enabled: true })).status).toBe(200);
    await t.deps.plugins.refreshEnablement();
    expect((await admin.get('/api/v1/plugin_pages?locale=de')).body.data.map((p: any) => [p.key, p.placement, p.title])).toEqual([['plans', 'settings', 'Mitgliedschaften'], ['members', 'customer', 'Mitgliedschaft']]);
  });

  it('keeps plans, refusing a bad one next to its fields', async () => {
    const bad = await admin.post(api('/plans'), { name: '', fee: -1, interval: 'month' });
    expect(bad.status, JSON.stringify(bad.body)).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field)).toEqual(['name', 'fee']);
    const r = await admin.post(api('/plans'), { name: 'Gold', fee: 1000, interval: 'month', discount_pct: 50, max_items: 2, public: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    plan = r.body;
    expect(plan).toMatchObject({ name: 'Gold', fee: { amount: 1000, currency: 'EUR' }, interval_label: 'Month', discount_label: '50 %', max_items: 2 });
    expect((await admin.get(api('/plan_options'))).body.data).toEqual([{ value: plan.id, label: 'Gold: €10.00 a month' }]);
  });

  it('adds a member with a first invoice and a payment link; paying it starts the membership', async () => {
    const r = await admin.post(api('/members'), { customer_id: customer.id, plan_id: plan.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    member = r.body;
    expect(member).toMatchObject({ status: 'pending', status_label: 'Waiting for payment', plan_name: 'Gold' });
    expect((await admin.post(api('/members'), { customer_id: customer.id, plan_id: plan.id })).status).toBe(409);
    const invoices = (await admin.get(`/api/v1/customers/${customer.id}/invoices`)).body.data;
    expect(invoices).toEqual([expect.objectContaining({ total: { amount: 1200, currency: 'EUR' }, due: { amount: 1200, currency: 'EUR' } })]);
    expect(calls).toEqual([['link', invoices[0].id, 1200]]);
    // No member price before the fee is paid.
    expect((await quote()).total.amount).toBe(1200);

    const req = (await withSystem(t.deps.db, (c) => c.query(`SELECT id FROM payment_requests WHERE invoice_id = $1 AND status = 'open'`, [invoices[0].id]))).rows[0];
    await inTenant((ctx) => payments.applyProviderEvent(ctx, 'mempay', { type: 'payment.succeeded', eventId: 'm1', ref: 'pi_link_1', amount: 1200, currency: 'EUR', orderId: null, purpose: 'invoice', paymentRequestId: req.id, customerRef: 'cus_m', paymentMethodRef: 'pm_m' }));
    await dispatchPaid();
    const now = await memberRow();
    expect(now).toMatchObject({ status: 'active', period: 1 });
    expect(new Date(now.period_end).getTime() - Date.now()).toBeGreaterThan(27 * 86400_000);
  });

  it('gives members their price, explained', async () => {
    const q = await quote();
    expect(q.total.amount).toBe(600);
    expect(JSON.stringify(q.lines[0].explanation_items ?? q.explanation)).toContain('Member price (Gold)');
  });

  it('lets a member borrow up to the plan’s items at a time', async () => {
    const make = async (quantity: number, from: number) => (await admin.post('/api/v1/orders', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(from), ends_at: isoIn(from + 2), lines: [{ variant_id: variant, quantity }] })).body;
    const tooMany = await make(3, 5);
    const refused = await admin.post(`/api/v1/orders/${tooMany.id}/actions/reserve`, {});
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'membership_limit', detail: 'Gold members can have 2 items at a time; this booking would make 3.' });
    const two = await make(2, 5);
    expect((await admin.post(`/api/v1/orders/${two.id}/actions/reserve`, {})).status).toBe(200);
    const overlap = await make(1, 6);
    expect((await admin.post(`/api/v1/orders/${overlap.id}/actions/reserve`, {})).body.code).toBe('membership_limit');
    // Later, when the first booking is over, there is room again.
    const later = await make(1, 12);
    expect((await admin.post(`/api/v1/orders/${later.id}/actions/reserve`, {})).status).toBe(200);
  });

  it('shows the member card in the customer’s account', async () => {
    const panels = await inTenant((ctx) => plugins.renderAccountPanels(ctx, { id: customer.id, email: customer.email }, 'en'));
    expect(panels).toEqual([{ plugin: 'memberships', key: 'card', title: 'Membership', html: expect.stringContaining('Gold: active until') }]);
    expect(panels[0]!.html).toContain('50 % off every rental.');
  });

  it('renews ahead of time with the saved card, and the paid time continues', async () => {
    const end = new Date(Date.now() + 86400_000);
    await withSystem(t.deps.db, (c) => c.query(`UPDATE plg_memberships_members SET period_end = $2 WHERE id = $1`, [member.id, end.toISOString()]));
    const job = t.deps.plugins.schedules.find((s) => s.pluginId === 'memberships' && s.name === 'renew')!;
    await inTenant((ctx) => t.deps.plugins.runSchedule(job, hookContext(ctx)));
    expect(calls.at(-1)).toEqual(['card', expect.stringMatching(/^doc_/), 1200]);
    await dispatchPaid();
    const now = await memberRow();
    expect(now).toMatchObject({ status: 'active', period: 2 });
    expect(new Date(now.period_end).getTime()).toBe(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), end.getUTCHours(), end.getUTCMinutes(), end.getUTCSeconds(), end.getUTCMilliseconds()));
    // Running again bills nothing twice.
    await inTenant((ctx) => t.deps.plugins.runSchedule(job, hookContext(ctx)));
    expect((await admin.get(`/api/v1/customers/${customer.id}/invoices`)).body.data).toHaveLength(2);
  });

  it('pauses member prices when a fee stays unpaid, and cancelling ends an unpaid membership at once', async () => {
    await withSystem(t.deps.db, (c) => c.query(`UPDATE plg_memberships_members SET period_end = now() - interval '10 days', invoice_id = 'doc_open' WHERE id = $1`, [member.id]));
    const job = t.deps.plugins.schedules.find((s) => s.pluginId === 'memberships' && s.name === 'renew')!;
    await inTenant((ctx) => t.deps.plugins.runSchedule(job, hookContext(ctx)));
    expect((await memberRow()).status).toBe('lapsed');
    expect((await quote()).total.amount).toBe(1200);
    await withSystem(t.deps.db, (c) => c.query(`UPDATE plg_memberships_members SET invoice_id = NULL WHERE id = $1`, [member.id]));
    const r = await admin.post(api(`/members/${member.id}/actions/cancel`), {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('cancelled');
    expect(await inTenant((ctx) => plugins.renderAccountPanels(ctx, { id: customer.id, email: customer.email }, 'en'))).toEqual([]);
  });
});
