import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Stock rented in from a supplier (FR-CAT-9): more capacity for its dates only. */
suite('rented-in stock', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let variant: string;
  let customer: string;
  const avail = async (from: number, to: number) => (await admin.get(`/api/v1/availability?variant_id=${variant}&location_id=${locationId}&from=${isoIn(from)}&to=${isoIn(to)}`)).body.available;
  const book = async (from: number, to: number, body: Record<string, unknown> = {}) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(from), ends_at: isoIn(to), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    return { o, r: await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false, ...body }) };
  };
  const rentIn = (from: number, to: number, quantity = 2) =>
    admin.post('/api/v1/external_stock', { variant_id: variant, location_id: locationId, supplier: 'Party Hire Ltd', quantity, starts_at: isoIn(from), ends_at: isoIn(to), unit_cost: 2500, reference: 'PO-77' });

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Marquee', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 20000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 1 });
    customer = (await admin.post('/api/v1/customers', { name: 'Wedding Planner' })).body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('raises capacity for its dates only', async () => {
    expect((await book(5, 6)).r.status).toBe(200);
    expect((await book(5, 6)).r.status).toBe(409);
    const ext = await rentIn(4, 7);
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    expect(ext.body).toMatchObject({ supplier: 'Party Hire Ltd', quantity: 2, total_cost: { amount: 5000 }, status: 'booked', overbookings_resolved: 0 });
    expect(await avail(5, 6)).toBe(2);
    // Outside its dates only the shop's own stock.
    expect(await avail(10, 11)).toBe(1);
    expect((await book(5, 6)).r.status).toBe(200);
    // A booking that runs past its end needs the shop's own unit there: one fits, a second does not.
    expect((await book(6, 9)).r.status).toBe(200);
    expect((await book(6, 9)).r.status).toBe(409);
    // The planner shows it.
    const plan = (await admin.get(`/api/v1/planner?location_id=${locationId}&from=${encodeURIComponent(isoIn(3))}&days=7`)).body;
    expect(plan.external.map((x: any) => [x.supplier, x.quantity])).toEqual([['Party Hire Ltd', 2]]);
  });

  it('settles overbookings it covers', async () => {
    const { o } = await book(20, 21);
    const second = await book(20, 21, { overbook: { reason: 'Big client' } });
    expect(second.r.status, JSON.stringify(second.r.body)).toBe(200);
    expect((await admin.get(`/api/v1/orders/${second.o.id}`)).body.overbookings).toHaveLength(1);
    const ext = await rentIn(19, 22, 1);
    expect(ext.body.overbookings_resolved).toBe(1);
    expect((await admin.get(`/api/v1/orders/${second.o.id}`)).body.overbookings).toEqual([]);
    expect(o.id).toBeTruthy();
  });

  it('cannot be cancelled while bookings need it, unless forced', async () => {
    const list = (await admin.get(`/api/v1/external_stock?variant_id=${variant}&status=booked`)).body.data;
    const first = list.find((x: any) => new Date(x.starts_at).getTime() < Date.now() + 10 * 86_400_000);
    const refused = await admin.post(`/api/v1/external_stock/${first.id}/actions/cancel`, {});
    expect([refused.status, refused.body.code]).toEqual([409, 'external_stock_in_use']);
    const forced = await admin.post(`/api/v1/external_stock/${first.id}/actions/cancel`, { force: true });
    expect(forced.body.status).toBe('cancelled');
    expect(await avail(5, 6)).toBe(0);
  });

  it('checks what it is given', async () => {
    const bad = await admin.post('/api/v1/external_stock', { variant_id: variant, location_id: locationId, supplier: ' ', quantity: 0, starts_at: isoIn(5), ends_at: isoIn(4) });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field).sort()).toEqual(['ends_at', 'quantity', 'supplier']);
    const service = await admin.post('/api/v1/products', { type: 'service', name: 'Setup', price: { kind: 'fixed', period_unit: 'day', amount: 5000 } });
    const svc = await admin.post('/api/v1/external_stock', { variant_id: service.body.variants[0].id, location_id: locationId, supplier: 'X', quantity: 1, starts_at: isoIn(1), ends_at: isoIn(2) });
    expect([svc.status, svc.body.errors[0].field]).toEqual([422, 'variant_id']);
  });
});
