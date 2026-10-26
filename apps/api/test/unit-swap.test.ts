import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Swapping a unit mid-rental (FR-OR-10). */
suite('unit swap', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let bike: string;
  let customer: string;
  const units: { id: string; barcode: string }[] = [];

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    customer = (await admin.post('/api/v1/customers', { name: 'Swap Customer', email: 'swap@test.dev' })).body.id;
    bike = (await admin.post('/api/v1/products', { type: 'rental', name: 'Bike', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } })).body.variants[0].id;
    for (let i = 0; i < 3; i++) units.push((await admin.post('/api/v1/stock_items', { variant_id: bike, location_id: locationId })).body);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  const outOrder = async (unit: string, from = 0, to = 3) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(from, 0), ends_at: isoIn(to), lines: [{ variant_id: bike, quantity: 1, stock_item_ids: [unit] }] })).body;
    const res = await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body;
  };

  it('hands a broken unit back and gives out another one', async () => {
    const o = await outOrder(units[0]!.id);
    // A later booking of the replacement unit after this rental stays possible.
    const later = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(5), ends_at: isoIn(6), lines: [{ variant_id: bike, quantity: 1, stock_item_ids: [units[1]!.id] }] })).body;
    expect((await admin.post(`/api/v1/orders/${later.id}/actions/reserve`, {})).status).toBe(200);

    const r = await admin.post(`/api/v1/orders/${o.id}/actions/swap_unit`, { from_barcode: units[0]!.barcode, to_barcode: units[1]!.barcode, old_status: 'hard_down', reason: 'Flat tyre' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('out');
    const line = r.body.lines[0];
    expect(line.units.map((u: any) => [u.barcode, u.replaced, u.check_in_outcome])).toEqual([
      [units[1]!.barcode, false, null],
      [units[0]!.barcode, true, 'swapped'],
    ]);
    expect((await admin.get(`/api/v1/stock_items/${units[0]!.id}`)).body.status).toBe('hard_down');
    expect((await admin.get(`/api/v1/stock_items/${units[1]!.id}`)).body.status).toBe('out');
    const tickets = (await admin.get('/api/v1/maintenance_tickets?status=active')).body.data;
    expect(tickets.find((x: any) => x.stock_item.id === units[0]!.id)?.order).toMatchObject({ id: o.id });
    const events = (await admin.get(`/api/v1/orders/${o.id}/timeline`)).body.data.map((e: any) => e.type);
    expect(events).toContain('unit_swapped');

    // Checking in returns only the replacement; the order is then fully back.
    const back = await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true });
    expect(back.body.status).toBe('returned');
    expect((await admin.get(`/api/v1/stock_items/${units[1]!.id}`)).body.status).toBe('available');
  });

  it('refuses a replacement that is booked, wrong, or orders that are not out', async () => {
    const o = await outOrder(units[2]!.id, 10, 12);
    // units[1] is booked on days 5-6 only, so it is free now; units[0] is out of service but still the same item.
    const busy = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(0, 0), ends_at: isoIn(20), lines: [{ variant_id: bike, quantity: 1 }] })).body;
    expect(busy.id).toBeTruthy();
    const notOut = await admin.post(`/api/v1/orders/${busy.id}/actions/swap_unit`, { from_stock_item_id: units[2]!.id, to_stock_item_id: units[1]!.id });
    expect(notOut.body.code).toBe('order_not_out');
    const wrongUnit = await admin.post(`/api/v1/orders/${o.id}/actions/swap_unit`, { from_stock_item_id: units[1]!.id, to_stock_item_id: units[0]!.id });
    expect(wrongUnit.body.code).toBe('unit_not_out');
    const missing = await admin.post(`/api/v1/orders/${o.id}/actions/swap_unit`, { from_stock_item_id: units[2]!.id });
    expect(missing.body.errors[0].field).toBe('to_stock_item_id');
    // units[1] has the day 5-6 booking, which overlaps this rental (now until day 12).
    const taken = await admin.post(`/api/v1/orders/${o.id}/actions/swap_unit`, { from_stock_item_id: units[2]!.id, to_stock_item_id: units[1]!.id });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('unit_unavailable');
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.lines[0].units).toHaveLength(1);
  });
});
