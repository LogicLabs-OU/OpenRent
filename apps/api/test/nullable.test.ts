import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/**
 * Request bodies keep null as null. Ajv coerces types, and an `anyOf` of a number and null used to turn
 * null into 0 (or "" for strings) before the null branch was tried.
 */
suite('null in request bodies', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('accepts null for a number that must be at least 1', async () => {
    const r = await admin.post('/api/v1/coupons', { code: 'NULLS', kind: 'percent', value: 1000, max_uses: null, max_uses_per_customer: null });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.body.max_uses, r.body.max_uses_per_customer]).toEqual([null, null]);
  });

  it('stores null, not 0, and keeps 0 as 0', async () => {
    const v = (await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 100 } })).body.variants[0].id;
    const none = await admin.post('/api/v1/stock_items', { variant_id: v, location_id: locationId, purchase_price: null });
    expect(none.body.purchase_price).toBeNull();
    const zero = await admin.post('/api/v1/stock_items', { variant_id: v, location_id: locationId, purchase_price: 0 });
    expect(zero.body.purchase_price).toBe(0);
    const tpl = await admin.post('/api/v1/inspection_templates', { name: 'Tent check', items: [{ label: { en: 'Poles' }, kind: 'number', min: 0, max: null }] });
    expect(tpl.body.items[0]).toMatchObject({ min: 0, max: null });
  });
});
