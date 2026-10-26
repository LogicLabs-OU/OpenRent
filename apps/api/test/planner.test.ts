import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** The unit planner and moving bookings between units (FR-AV-9). */
suite('unit planner', () => {
  let t: TestApp;
  let admin: Client;
  let camera: string;
  let customer: string;
  const units: Record<string, string> = {};
  const orders: Record<string, any> = {};

  const book = async (key: string, from: number, to: number, barcode?: string) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(from), ends_at: isoIn(to), lines: [{ variant_id: camera, quantity: 1 }] })).body;
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {})).status).toBe(200);
    if (barcode) expect((await admin.post(`/api/v1/orders/${o.id}/actions/assign_units`, { barcodes: [barcode] })).status).toBe(200);
    orders[key] = o;
  };
  const view = async (days = 10) => (await admin.get(`/api/v1/planner?from=${encodeURIComponent(isoIn(0, 0))}&days=${days}`)).body;
  const barsOf = (p: any, code: string) => p.units.find((u: any) => u.barcode === code).bars.map((b: any) => b.order?.number);

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    camera = (await admin.post('/api/v1/products', { type: 'rental', name: 'Camera', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } })).body.variants[0].id;
    for (const b of ['CAM-1', 'CAM-2', 'CAM-3']) units[b] = (await admin.post('/api/v1/stock_items', { variant_id: camera, location_id: locationId, barcode: b })).body.id;
    customer = (await admin.post('/api/v1/customers', { name: 'Planner Customer', email: 'planner@test.dev' })).body.id;
    await book('a', 2, 3, 'CAM-1');
    await book('b', 2, 3);
    await book('c', 5, 6, 'CAM-2');
    await book('d', 2, 3, 'CAM-3');
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('shows each unit with its bookings and the bookings still waiting for a unit', async () => {
    const p = await view();
    expect(p).toMatchObject({ object: 'planner', days: 10, truncated: false });
    expect(p.units.map((u: any) => u.barcode)).toEqual(['CAM-1', 'CAM-2', 'CAM-3']);
    expect(barsOf(p, 'CAM-1')).toEqual([orders.a.number]);
    expect(barsOf(p, 'CAM-2')).toEqual([orders.c.number]);
    expect(p.units[0].bars[0]).toMatchObject({ kind: 'reservation', movable: true, picked_up: false });
    expect(p.unassigned.map((x: any) => [x.order.number, x.quantity])).toEqual([[orders.b.number, 1]]);
    const tooLong = await admin.get(`/api/v1/planner?from=${encodeURIComponent(isoIn(0))}&days=40`);
    expect(tooLong.status).toBe(400);
  });

  it('moves a booking to a free unit, and refuses one that is taken', async () => {
    const moved = await admin.post(`/api/v1/orders/${orders.a.id}/actions/reassign_unit`, { from_stock_item_id: units['CAM-1'], to_stock_item_id: units['CAM-2'] });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    let p = await view();
    expect(barsOf(p, 'CAM-1')).toEqual([]);
    expect(barsOf(p, 'CAM-2')).toEqual([orders.a.number, orders.c.number]);
    const taken = await admin.post(`/api/v1/orders/${orders.a.id}/actions/reassign_unit`, { from_stock_item_id: units['CAM-2'], to_stock_item_id: units['CAM-3'] });
    expect([taken.status, taken.body.code]).toEqual([409, 'unit_unavailable']);
    p = await view();
    expect(barsOf(p, 'CAM-2')).toEqual([orders.a.number, orders.c.number]);
    expect(barsOf(p, 'CAM-3')).toEqual([orders.d.number]);
    const units_ = (await admin.get(`/api/v1/orders/${orders.a.id}`)).body.lines[0].units.map((u: any) => u.barcode);
    expect(units_).toEqual(['CAM-2']);
  });

  it('lists an overbooked line once, with all its quantity', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(12), ends_at: isoIn(13), lines: [{ variant_id: camera, quantity: 4 }] })).body;
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { overbook: { reason: 'Partner lends one' } })).status).toBe(200);
    const p = (await admin.get(`/api/v1/planner?from=${encodeURIComponent(isoIn(10, 0))}&days=7`)).body;
    expect(p.unassigned.filter((x: any) => x.order.id === o.id).map((x: any) => x.quantity)).toEqual([4]);
    await admin.post(`/api/v1/orders/${o.id}/actions/cancel`, {});
  });

  it('only moves bookings that are not picked up yet', async () => {
    const wrong = await admin.post(`/api/v1/orders/${orders.c.id}/actions/reassign_unit`, { from_stock_item_id: units['CAM-3'], to_stock_item_id: units['CAM-1'] });
    expect([wrong.status, wrong.body.code]).toEqual([409, 'unit_not_assigned']);
    const draft = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(8), ends_at: isoIn(9), lines: [{ variant_id: camera, quantity: 1 }] })).body;
    const d = await admin.post(`/api/v1/orders/${draft.id}/actions/reassign_unit`, { from_stock_item_id: units['CAM-1'], to_stock_item_id: units['CAM-2'] });
    expect([d.status, d.body.code]).toEqual([409, 'invalid_transition']);
  });
});
