import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError, availability, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Changing existing bookings (P2-00): resize, end, move a unit, and early pickup on top of them. */
suite('changing existing bookings', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let customer: string;
  let chairs: string; // bulk, 10 in stock
  let camera: string; // serialised, 2 units
  const units: { id: string; barcode: string }[] = [];

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false }, logger: quietLogger }),
    );
  const reserved = async (variant: string, from: string, to: string, quantity = 1) => {
    const o = await admin.post('/api/v1/orders', { customer_id: customer, starts_at: from, ends_at: to, lines: [{ variant_id: variant, quantity }] });
    const r = await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { id: string; lines: { id: string }[] };
  };
  const allocationsOf = (orderId: string) =>
    inTenant((ctx) =>
      ctx.db
        .query(`SELECT id, stock_item_id, quantity, lower(period) AS s, upper(period) AS e FROM allocations WHERE order_id = $1 ORDER BY lower(period), id`, [orderId])
        .then((r) => r.rows as { id: string; stock_item_id: string | null; quantity: number; s: Date; e: Date }[]),
    );
  const available = async (variant: string, from: string, to: string) =>
    (await admin.get(`/api/v1/availability?variant_id=${variant}&from=${from}&to=${to}`)).body.available as number;
  const rejection = (p: Promise<unknown>) => p.then(() => null, (e: AppError) => ({ code: e.code, status: e.status, message: e.message }));

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    customer = (await admin.post('/api/v1/customers', { name: 'Resize Customer', email: 'resize@test.dev' })).body.id;
    chairs = (await admin.post('/api/v1/products', { type: 'rental', name: 'Chair', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 100 } })).body.variants[0].id;
    expect((await admin.put(`/api/v1/stock_levels/${chairs}/${locationId}`, { quantity: 10 })).status).toBe(200);
    camera = (await admin.post('/api/v1/products', { type: 'rental', name: 'Camera', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
    for (let i = 0; i < 2; i++) units.push((await admin.post('/api/v1/stock_items', { variant_id: camera, location_id: locationId })).body);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('grows a quantity hold only while the pool has room, and shrinks it freely', async () => {
    const a = await reserved(chairs, isoIn(10), isoIn(11), 6);
    await reserved(chairs, isoIn(12), isoIn(13), 6);
    const [alloc] = await allocationsOf(a.id);
    // Into day 12 the pool would need 12 chairs: refused, and nothing changes.
    const refused = await rejection(inTenant((ctx) => availability.resizeAllocations(ctx, [{ allocationId: alloc!.id, to: new Date(isoIn(12, 12)) }])));
    expect(refused).toMatchObject({ code: 'exceeds_availability', status: 409 });
    expect((await allocationsOf(a.id))[0]!.e.toISOString()).toBe(isoIn(11));
    // Up to the other booking's start fits.
    await inTenant((ctx) => availability.resizeAllocations(ctx, [{ allocationId: alloc!.id, to: new Date(isoIn(12)) }]));
    expect(await available(chairs, isoIn(11, 12), isoIn(11, 13))).toBe(4);
    await inTenant((ctx) => availability.resizeAllocations(ctx, [{ allocationId: alloc!.id, from: new Date(isoIn(10, 12)), to: new Date(isoIn(10, 14)) }]));
    expect(await available(chairs, isoIn(11, 12), isoIn(11, 13))).toBe(10);
    expect((await rejection(inTenant((ctx) => availability.resizeAllocations(ctx, [{ allocationId: alloc!.id, to: new Date(isoIn(10, 11)) }]))))?.status).toBe(422);
  });

  it('refuses to stretch a unit booking over another booking of that unit', async () => {
    const a = await reserved(camera, isoIn(20), isoIn(21));
    await admin.post(`/api/v1/orders/${a.id}/actions/assign_units`, { stock_item_ids: [units[0]!.id] });
    const b = await reserved(camera, isoIn(22), isoIn(23));
    await admin.post(`/api/v1/orders/${b.id}/actions/assign_units`, { stock_item_ids: [units[0]!.id] });
    const [mine] = await allocationsOf(a.id);
    const refused = await rejection(inTenant((ctx) => availability.resizeAllocations(ctx, [{ allocationId: mine!.id, to: new Date(isoIn(22, 12)) }])));
    expect(refused).toMatchObject({ code: 'unit_unavailable', status: 409 });
    expect(refused!.message).toContain(units[0]!.barcode);
    expect((await allocationsOf(a.id))[0]!.e.toISOString()).toBe(isoIn(21));
  });

  it('hands a booked unit to another unit, splitting the booking at the moment of the move', async () => {
    const a = await reserved(camera, isoIn(30), isoIn(32));
    await admin.post(`/api/v1/orders/${a.id}/actions/assign_units`, { stock_item_ids: [units[0]!.id] });
    const [before] = await allocationsOf(a.id);
    const moved = await inTenant((ctx) => availability.moveUnitAllocation(ctx, before!.id, units[1]!.id, new Date(isoIn(31))));
    const after = await allocationsOf(a.id);
    expect(after.map((x) => [x.stock_item_id, x.s.toISOString(), x.e.toISOString()])).toEqual([
      [units[0]!.id, isoIn(30), isoIn(31)],
      [units[1]!.id, isoIn(31), isoIn(32)],
    ]);
    expect(moved).toBe(after[1]!.id);
    // The first unit is free again from the move on; the second is busy.
    const b = await reserved(camera, isoIn(31, 12), isoIn(31, 14));
    await admin.post(`/api/v1/orders/${b.id}/actions/assign_units`, { stock_item_ids: [units[0]!.id] });
    expect(await rejection(inTenant((ctx) => availability.moveUnitAllocation(ctx, after[1]!.id, units[0]!.id, new Date(isoIn(30)))))).toMatchObject({ code: 'unit_unavailable' });
    // Before the start the whole booking moves; a quantity hold or a time after the end is refused.
    const c = await reserved(camera, isoIn(40), isoIn(41));
    await admin.post(`/api/v1/orders/${c.id}/actions/assign_units`, { stock_item_ids: [units[0]!.id] });
    const [cAlloc] = await allocationsOf(c.id);
    expect(await inTenant((ctx) => availability.moveUnitAllocation(ctx, cAlloc!.id, units[1]!.id, new Date(isoIn(39))))).toBe(cAlloc!.id);
    expect((await allocationsOf(c.id))[0]!.stock_item_id).toBe(units[1]!.id);
    expect(await rejection(inTenant((ctx) => availability.moveUnitAllocation(ctx, cAlloc!.id, units[0]!.id, new Date(isoIn(42)))))).toMatchObject({ status: 422 });
    const d = await reserved(chairs, isoIn(40), isoIn(41), 1);
    const [hold] = await allocationsOf(d.id);
    expect(await rejection(inTenant((ctx) => availability.moveUnitAllocation(ctx, hold!.id, units[0]!.id, new Date(isoIn(40, 12)))))).toMatchObject({ code: 'not_a_unit_booking' });
  });

  it('ends bookings early without ever lengthening them', async () => {
    const a = await reserved(chairs, isoIn(50), isoIn(51), 2);
    const [x] = await allocationsOf(a.id);
    await inTenant((ctx) => availability.endAllocationsAt(ctx, { ids: [x!.id] }, new Date(isoIn(52))));
    expect((await allocationsOf(a.id))[0]!.e.toISOString()).toBe(isoIn(51));
    await inTenant((ctx) => availability.endAllocationsAt(ctx, { ids: [x!.id] }, new Date(isoIn(49))));
    const [y] = await allocationsOf(a.id);
    expect(y!.e.getTime() - y!.s.getTime()).toBe(1);
  });

  it('checks the pool when a bulk order is picked up early', async () => {
    // Picked up now, the 6 chairs booked from day 2 would overlap the 6 another customer holds today.
    const early = await reserved(chairs, isoIn(2), isoIn(3), 6);
    await reserved(chairs, new Date(Date.now() + 3600_000).toISOString(), isoIn(1, 23), 6);
    const r = await admin.post(`/api/v1/orders/${early.id}/actions/check_out`, {});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('exceeds_availability');
    expect((await admin.get(`/api/v1/orders/${early.id}`)).body.status).toBe('reserved');
  });

  it('lets exactly one of an early pickup and a new booking take the last chairs', async () => {
    const early = await reserved(chairs, isoIn(62), isoIn(63), 6);
    // Pretend "now" is day 60 for the pickup: the race is over days 60–62.
    const other = await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(60, 12), ends_at: isoIn(61), lines: [{ variant_id: chairs, quantity: 6 }] });
    const [hold] = await allocationsOf(early.id);
    const results = await Promise.all([
      rejection(inTenant((ctx) => availability.resizeAllocations(ctx, [{ allocationId: hold!.id, from: new Date(isoIn(60)) }]))),
      admin.post(`/api/v1/orders/${other.body.id}/actions/reserve`, {}).then((x) => (x.status === 200 ? null : { code: x.body.code })),
    ]);
    expect(results.filter((x) => x === null)).toHaveLength(1);
    expect(results.find((x) => x !== null)).toMatchObject({ code: 'exceeds_availability' });
    expect(await available(chairs, isoIn(60, 12), isoIn(61))).toBe(4);
  }, 60_000);

  it('never puts the pool over capacity, whatever resizes are tried', async () => {
    // Fresh chairs, so earlier tests' bookings do not interfere.
    const pool = (await admin.post('/api/v1/products', { type: 'rental', name: 'Stool', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 100 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${pool}/${locationId}`, { quantity: 5 });
    const holds: string[] = [];
    for (let i = 0; i < 4; i++) holds.push((await allocationsOf((await reserved(pool, isoIn(100 + i * 2), isoIn(101 + i * 2), 2)).id))[0]!.id);
    const hour = (h: number) => new Date(new Date(isoIn(100, 0)).getTime() + h * 3600_000);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 190 }), fc.integer({ min: 1, max: 60 }), async (which, start, len) => {
        await rejection(inTenant((ctx) => availability.resizeAllocations(ctx, [{ allocationId: holds[which]!, from: hour(start), to: hour(start + len) }])));
        const spans = await inTenant((ctx) => availability.loadSpans(ctx, pool, locationId, hour(-1), hour(260)));
        return availability.peakConcurrent(spans, hour(-1).getTime(), hour(260).getTime()) <= 5;
      }),
      { numRuns: dbinfo!.real ? 60 : 25 },
    );
  }, 120_000);
});
