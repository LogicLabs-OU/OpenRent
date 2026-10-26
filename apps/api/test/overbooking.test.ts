import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Controlled overbooking (FR-AV-8). */
suite('overbooking', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let customer: string;
  let tents: string; // bulk, 2 in stock
  let bikes: string; // serialised, 1 unit
  let bikeUnit: string;

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    customer = (await admin.post('/api/v1/customers', { name: 'Ovb Customer', email: 'ovb@test.dev' })).body.id;
    tents = (await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${tents}/${locationId}`, { quantity: 2 });
    bikes = (await admin.post('/api/v1/products', { type: 'rental', name: 'Bike', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    bikeUnit = (await admin.post('/api/v1/stock_items', { variant_id: bikes, location_id: locationId })).body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  const draft = async (lines: unknown[]) => (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(10), ends_at: isoIn(11), lines })).body;

  it('books past stock with a reason, only for staff allowed to', async () => {
    await admin.post(`/api/v1/orders/${(await draft([{ variant_id: tents, quantity: 2 }])).id}/actions/reserve`, {});
    const o = await draft([{ variant_id: tents, quantity: 3 }]);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {})).body.code).toBe('exceeds_availability');
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { overbook: { reason: ' ' } })).body.errors[0].field).toBe('overbook.reason');
    const key = await admin.post('/api/v1/api_keys', { name: 'Writer', kind: 'secret', scopes: ['orders:write', 'orders:read'] });
    const writer = new Client(t.app, { authorization: `Bearer ${key.body.key}` });
    expect((await writer.post(`/api/v1/orders/${o.id}/actions/reserve`, { overbook: { reason: 'Partner lends us tents' } })).status).toBe(403);

    const ok = await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { overbook: { reason: 'Partner lends us tents' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('reserved');
    expect(ok.body.overbookings).toEqual([expect.objectContaining({ variant_id: tents, quantity: 3, reason: 'Partner lends us tents' })]);
    const av = await admin.get(`/api/v1/availability?variant_id=${tents}&from=${isoIn(10)}&to=${isoIn(11)}`);
    expect(av.body).toMatchObject({ available: 0, shortage: true });

    // Cancelling releases the stock and closes the overbooking.
    const cancelled = await admin.post(`/api/v1/orders/${o.id}/actions/cancel`, {});
    expect(cancelled.body.overbookings).toEqual([]);
  });

  it('never overbooks a specific unit', async () => {
    await admin.post(`/api/v1/orders/${(await draft([{ variant_id: bikes, quantity: 1, stock_item_ids: [bikeUnit] }])).id}/actions/reserve`, {});
    const o = await draft([{ variant_id: bikes, quantity: 1, stock_item_ids: [bikeUnit] }]);
    const r = await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { overbook: { reason: 'Try' } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('exceeds_availability');
  });
});
