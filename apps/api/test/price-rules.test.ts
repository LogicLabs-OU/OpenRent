import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenancy } from '@openrent/core';
import { withSystem } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Price rules (FR-PR-7): CRUD, validation, quotes and orders, permissions and tenant isolation. */
suite('price rules', () => {
  let t: TestApp;
  let admin: Client;
  let bike: string;
  let bikeProduct: string;

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Bike', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
    bike = p.body.variants[0].id;
    bikeProduct = p.body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  const quote = (extra: Record<string, unknown> = {}) =>
    admin.post('/api/v1/price_quote', { starts_at: isoIn(40), ends_at: isoIn(41), lines: [{ variant_id: bike, quantity: 1 }], ...extra });

  it('refuses incomplete rules field by field', async () => {
    const r = await admin.post('/api/v1/price_rules', { name: 'Summer', kind: 'season', adjustment_bp: 0 });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => e.field).sort()).toEqual(['adjustment_bp', 'ends_on', 'starts_on']);
    const back = await admin.post('/api/v1/price_rules', { name: 'Back', kind: 'season', adjustment_bp: 1000, starts_on: '2027-08-01', ends_on: '2027-07-01' });
    expect(back.body.errors.map((e: any) => e.field)).toEqual(['ends_on']);
    expect((await admin.post('/api/v1/price_rules', { name: 'Vol', kind: 'volume', adjustment_bp: -500 })).body.errors[0].field).toBe('min_quantity');
    expect((await admin.post('/api/v1/price_rules', { name: 'Odd', kind: 'weekday', adjustment_bp: 500, weekdays: [7] })).status).toBe(400);
  });

  it('applies to quotes and orders, with the rule named on the line', async () => {
    const day = isoIn(40).slice(0, 10);
    const rule = await admin.post('/api/v1/price_rules', { name: 'Peak week', kind: 'season', adjustment_bp: 5000, starts_on: day, ends_on: day, priority: 10 });
    expect(rule.status).toBe(201);
    expect(rule.body).toMatchObject({ object: 'price_rule', kind: 'season', starts_on: day, product_ids: [] });
    // The rental runs 10:00 day 40 → 10:00 day 41; the rule covers day 40 only, so part of it.
    const q = await quote();
    const line = q.body.lines[0];
    expect(line.rule_ids).toContain(rule.body.id);
    expect(line.unit_price.amount).toBeGreaterThan(2000);
    expect(line.unit_price.amount).toBeLessThan(3000);
    expect(line.explanation.at(-1)).toContain('Peak week');

    const c = await admin.post('/api/v1/customers', { name: 'Club member', email: 'club@test.dev', tags: ['club'] });
    const member = await admin.post('/api/v1/price_rules', { name: 'Club', kind: 'customer_group', adjustment_bp: -2500, customer_tags: ['club'], priority: 1 });
    const forMember = await quote({ customer_id: c.body.id });
    // The club rule runs first and is not stackable, so the peak surcharge does not apply on top.
    expect(forMember.body.lines[0].unit_price.amount).toBe(1500);
    expect(forMember.body.lines[0].rule_ids).toEqual(expect.arrayContaining([member.body.id]));
    expect(forMember.body.lines[0].rule_ids).not.toContain(rule.body.id);

    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(40), ends_at: isoIn(41), lines: [{ variant_id: bike, quantity: 1 }] });
    expect(o.body.lines[0].unit_price.amount).toBe(1500);
  });

  it('only counts active rules for the chosen products, and soft-deletes', async () => {
    const other = await admin.post('/api/v1/price_rules', { name: 'Kayaks only', kind: 'volume', adjustment_bp: -5000, min_quantity: 1, product_ids: ['prod_x'], priority: 5 });
    const before = (await quote()).body.lines[0].unit_price.amount;
    expect(before).toBeGreaterThan(0);
    const mine = await admin.patch(`/api/v1/price_rules/${other.body.id}`, { product_ids: [bikeProduct] });
    expect(mine.body.product_ids).toEqual([bikeProduct]);
    expect((await quote()).body.lines[0].rule_ids).toContain(other.body.id);
    await admin.patch(`/api/v1/price_rules/${other.body.id}`, { active: false });
    expect((await quote()).body.lines[0].rule_ids).not.toContain(other.body.id);
    expect((await admin.del(`/api/v1/price_rules/${other.body.id}`)).status).toBe(204);
    expect((await admin.get(`/api/v1/price_rules/${other.body.id}`)).status).toBe(404);
    const list = await admin.get('/api/v1/price_rules?sort=priority');
    expect(list.body.data.map((r: any) => r.name)).toEqual(['Club', 'Peak week']);
  });

  it('needs pricing:write and keeps rules to their shop', async () => {
    const key = await admin.post('/api/v1/api_keys', { name: 'Read prices', kind: 'secret', scopes: ['pricing:read'] });
    const reader = new Client(t.app, { authorization: `Bearer ${key.body.key}` });
    expect((await reader.get('/api/v1/price_rules')).status).toBe(200);
    expect((await reader.post('/api/v1/price_rules', { name: 'X', kind: 'volume', adjustment_bp: -100, min_quantity: 1 })).status).toBe(403);

    await withSystem(t.deps.db, (c) =>
      tenancy.runSetup(c, { owner: { email: 'rules-other@test.dev', password: 'password123', name: 'Other' }, tenant: { name: 'Other Rules', slug: 'other-rules', currency: 'EUR', timezone: 'UTC' }, location: { name: 'X' } }, { livemode: false }),
    );
    const otherAdmin = new Client(t.app);
    expect((await otherAdmin.post('/api/v1/auth/login', { email: 'rules-other@test.dev', password: 'password123' })).status).toBe(200);
    expect((await otherAdmin.get('/api/v1/price_rules')).body.data).toEqual([]);
  });
});
