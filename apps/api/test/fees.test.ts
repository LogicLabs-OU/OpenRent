import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orders, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Fee rules and the damage waiver (FR-PR-8, FR-PAY-8): quotes, orders, checkout, damage and pickup. */
suite('fees and damage waiver', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let customer: string;
  let kayak: string; // bulk, 10 in stock, 2000 per day
  const fees: Record<string, string> = {};

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>, now = new Date()) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now, plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false }, logger: quietLogger }),
    );
  const feeLines = (o: any) => o.lines.filter((l: any) => l.type === 'fee').map((l: any) => [l.description, l.subtotal.amount]);
  const order = async (extra: Record<string, unknown> = {}, quantity = 2) =>
    (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(20), ends_at: isoIn(23), lines: [{ variant_id: kayak, quantity }], ...extra })).body;

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    customer = (await admin.post('/api/v1/customers', { name: 'Fee Customer', email: 'fees@test.dev' })).body.id;
    kayak = (await admin.post('/api/v1/products', { type: 'rental', name: 'Kayak', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${kayak}/${locationId}`, { quantity: 10 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('refuses incomplete fee rules field by field', async () => {
    const r = await admin.post('/api/v1/fee_rules', { name: 'Waiver', kind: 'damage_waiver', calculation: 'percent', amount: 20000 });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => e.field)).toEqual(['amount']);
    expect((await admin.post('/api/v1/fee_rules', { name: 'Per day', kind: 'cleaning', calculation: 'per_period', amount: 100 })).body.errors[0].field).toBe('period_unit');
    expect((await admin.post('/api/v1/fee_rules', { name: 'Zones', kind: 'cleaning', calculation: 'zone', zones: [{ postcodes: ['1'], amount: 1 }] })).body.errors[0].field).toBe('calculation');
    expect((await admin.post('/api/v1/fee_rules', { name: 'Late', kind: 'late', calculation: 'flat', amount: 100, mode: 'optional' })).body.errors[0].field).toBe('mode');
  });

  it('adds auto fees to orders and keeps one line per rule as the order changes', async () => {
    fees.cleaning = (await admin.post('/api/v1/fee_rules', { name: 'Cleaning', kind: 'cleaning', calculation: 'per_unit', amount: 500 })).body.id;
    const o = await order();
    expect(feeLines(o)).toEqual([['Cleaning', 1000]]);
    expect(o.totals.fees.amount).toBe(1000);
    const lineId = o.lines.find((l: any) => l.type === 'fee').id;
    // More kayaks: the same fee line, repriced.
    const more = await admin.patch(`/api/v1/orders/${o.id}/lines/${o.lines[0].id}`, { quantity: 3 });
    expect(more.status, JSON.stringify(more.body)).toBe(200);
    const after = (await admin.get(`/api/v1/orders/${o.id}`)).body;
    expect(after.lines.filter((l: any) => l.type === 'fee').map((l: any) => [l.id, l.subtotal.amount])).toEqual([[lineId, 1500]]);
    // A rule switched off disappears at the next reprice.
    await admin.patch(`/api/v1/fee_rules/${fees.cleaning}`, { active: false });
    const repriced = (await admin.patch(`/api/v1/orders/${o.id}`, { tags: [] , starts_at: isoIn(20, 11) })).body;
    expect(feeLines(repriced)).toEqual([]);
  });

  it('offers optional fees and adds the chosen ones', async () => {
    fees.waiver = (await admin.post('/api/v1/fee_rules', { name: 'Damage waiver', kind: 'damage_waiver', calculation: 'percent', amount: 1000, mode: 'optional' })).body.id;
    fees.delivery = (await admin.post('/api/v1/fee_rules', { name: 'Delivery', kind: 'delivery', calculation: 'zone', mode: 'optional', zones: [{ postcodes: ['101'], amount: 1500 }] })).body.id;
    const q = await admin.post('/api/v1/price_quote', { starts_at: isoIn(20), ends_at: isoIn(23), lines: [{ variant_id: kayak, quantity: 2 }] });
    expect(q.body.optional_fees.map((f: any) => [f.name, f.amount.amount, f.selected])).toEqual([['Damage waiver', 1200, false], ['Delivery', 0, false]]);
    const notServed = await admin.post('/api/v1/price_quote', { starts_at: isoIn(20), ends_at: isoIn(23), lines: [{ variant_id: kayak, quantity: 2 }], options: { fees: [fees.delivery], postcode: '99999' } });
    expect(notServed.body.fee_errors).toEqual([{ fee_id: fees.delivery, reason: 'postcode_not_served' }]);

    const o = await order({ options: { fees: [fees.waiver, fees.delivery], postcode: '10115' } });
    expect(o.options).toEqual({ fees: [fees.waiver, fees.delivery], postcode: '10115', address: null });
    expect(feeLines(o)).toEqual([['Damage waiver', 1200], ['Delivery', 1500]]);
    const dropped = (await admin.patch(`/api/v1/orders/${o.id}`, { options: { fees: [fees.waiver] } })).body;
    expect(feeLines(dropped)).toEqual([['Damage waiver', 1200]]);
  });

  it('lets the damage waiver pay damage above the excess', async () => {
    await admin.patch('/api/v1/tenant/settings', { damage_waiver_excess: 5000 });
    const o = await order({ options: { fees: [fees.waiver] } }, 1);
    for (const a of ['reserve', 'check_out']) expect((await admin.post(`/api/v1/orders/${o.id}/actions/${a}`, {})).status).toBe(200);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true })).status).toBe(200);
    const inspected = await admin.post(`/api/v1/orders/${o.id}/actions/inspect`, { damage_charges: [{ description: 'Cracked hull', amount: 8000 }, { description: 'Lost paddle', amount: 2000 }] });
    expect(inspected.status).toBe(200);
    const charges = (await admin.get(`/api/v1/orders/${o.id}/damage_charges`)).body.data;
    expect(charges.map((c: any) => [c.amount.amount, c.covered_amount.amount, c.customer_amount.amount])).toEqual([[8000, 3000, 5000], [2000, 2000, 0]]);
    // Without a waiver the customer owes all of it.
    const plain = await order({}, 1);
    for (const a of ['reserve', 'check_out']) await admin.post(`/api/v1/orders/${plain.id}/actions/${a}`, {});
    await admin.post(`/api/v1/orders/${plain.id}/actions/check_in`, { all: true });
    await admin.post(`/api/v1/orders/${plain.id}/actions/inspect`, { damage_charges: [{ description: 'Scratch', amount: 8000 }] });
    expect((await admin.get(`/api/v1/orders/${plain.id}/damage_charges`)).body.data[0].covered_amount.amount).toBe(0);
  });

  it('can require a waiver or insurance before pickup', async () => {
    await admin.patch('/api/v1/tenant/settings', { requires_waiver_or_insurance: true });
    const o = await order({}, 1);
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    const refused = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('waiver_or_insurance_required');
    const up = await admin.upload('/api/v1/files?purpose=attachment', 'insurance.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n%%EOF\n'));
    expect((await admin.post(`/api/v1/customers/${customer}/attachments`, { file_id: up.body.id, kind: 'insurance' })).status).toBe(201);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {})).status).toBe(200);
    await admin.patch('/api/v1/tenant/settings', { requires_waiver_or_insurance: false });
  });

  it('prices a late return with a late fee rule', async () => {
    await admin.post('/api/v1/fee_rules', { name: 'Late return', kind: 'late', calculation: 'per_period', period_unit: 'hour', amount: 400 });
    const o = await order({}, 1);
    for (const a of ['reserve', 'check_out']) await admin.post(`/api/v1/orders/${o.id}/actions/${a}`, {});
    // Back 3 hours and 20 minutes after the booked end: 4 started hours, past the 60-minute grace.
    const back = new Date(new Date(isoIn(23)).getTime() + 200 * 60_000);
    const done = await inTenant((ctx) => orders.runAction(ctx, o.id, 'check_in', { all: true }), back);
    expect(done.lines.find((l: any) => l.type === 'fee')).toMatchObject({ subtotal: { amount: 1600 } });
  });

  it('carries fees chosen at checkout into the order, ignoring fees the shop does not offer', async () => {
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const s = (await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(30), ends_at: isoIn(31), lines: [{ variant_id: kayak, quantity: 1 }] })).body;
    const patched = (await sf.patch(`/api/v1/storefront/checkout_sessions/${s.id}`, { options: { fees: [fees.waiver, 'fee_unknown'], postcode: ' 10115 ' } })).body;
    expect(patched.options).toEqual({ fees: [fees.waiver], postcode: '10115', address: null });
    expect(patched.quote.lines.map((l: any) => l.type)).toEqual(['rental', 'fee']);
    const settings = (await sf.get('/api/v1/storefront/settings')).body;
    const done = await sf.post(`/api/v1/storefront/checkout_sessions/${s.id}/actions/complete`, { customer: { name: 'Shopper', email: 'shopper-fees@test.dev' }, terms_accepted: true, terms_hash: settings.terms.hash });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const o = (await admin.get(`/api/v1/orders/${done.body.order.id}`)).body;
    expect(feeLines(o)).toEqual([['Damage waiver', 200]]);
  });
});
