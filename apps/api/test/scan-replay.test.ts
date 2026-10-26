import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orders, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Offline scans sent later (FR-SCAN-5). */
suite('offline scan replay', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let orderId: string;
  let endsAt: Date;
  const HOUR = 3600_000;

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>, now = new Date()) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now, plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false }, logger: quietLogger }),
    );
  const replay = (items: unknown[]) => admin.post('/api/v1/scans/replay', { items });

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    const v = (await admin.post('/api/v1/products', { type: 'rental', name: 'Drone', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
    for (const b of ['DR-1', 'DR-2']) await admin.post('/api/v1/stock_items', { variant_id: v, location_id: locationId, barcode: b });
    const customer = (await admin.post('/api/v1/customers', { name: 'Pilot', email: 'pilot@test.dev' })).body.id;
    // A rental that started three days ago and ended two days ago, picked up on time.
    const start = new Date(Math.floor((Date.now() - 3 * 24 * HOUR) / HOUR) * HOUR);
    endsAt = new Date(start.getTime() + 24 * HOUR);
    const before = new Date(start.getTime() - HOUR);
    const o = await inTenant((ctx) => orders.createOrder(ctx, { customer_id: customer, starts_at: start.toISOString(), ends_at: endsAt.toISOString(), lines: [{ variant_id: v, quantity: 2 }] } as any), before);
    orderId = o.id;
    await inTenant((ctx) => orders.runAction(ctx, o.id, 'reserve', {}), before);
    await inTenant((ctx) => orders.assignUnits(ctx, o.id, { barcodes: ['DR-1', 'DR-2'] }), before);
    await inTenant((ctx) => orders.runAction(ctx, o.id, 'check_out', {}), start);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('returns a unit at the time it was scanned, so no late fee is charged for the offline time', async () => {
    const at = new Date(endsAt.getTime() + 30 * 60_000).toISOString();
    const r = await replay([{ client_id: 'phone-1-0001', mode: 'check_in', code: 'DR-1', occurred_at: at }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ applied: 1, conflicts: 0 });
    expect(r.body.results[0]).toMatchObject({ client_id: 'phone-1-0001', status: 'applied', occurred_at: at });
    const o = (await admin.get(`/api/v1/orders/${orderId}`)).body;
    const unit = o.lines[0].units.find((u: any) => u.barcode === 'DR-1');
    expect(new Date(unit.checked_in_at).toISOString()).toBe(at);
    expect(o.lines.filter((l: any) => l.type === 'fee')).toEqual([]);
  });

  it('applies each scan on its own and reports the ones that no longer fit', async () => {
    const at = new Date(Date.now() - HOUR).toISOString();
    const r = (await replay([
      { client_id: 'phone-1-0002', mode: 'check_in', code: 'DR-1', occurred_at: at }, // already back
      { client_id: 'phone-1-0003', mode: 'check_in', code: 'DR-2', occurred_at: at },
      { client_id: 'phone-1-0004', mode: 'lookup', code: 'DR-2', occurred_at: at },
      { client_id: 'phone-1-0005', mode: 'check_in', code: 'NOPE', occurred_at: at },
      { client_id: 'phone-1-0006', mode: 'check_in', code: 'DR-2', occurred_at: new Date(Date.now() + 3 * HOUR).toISOString() },
    ])).body;
    expect(r.results.map((x: any) => [x.client_id, x.status])).toEqual([
      ['phone-1-0002', 'conflict'], ['phone-1-0003', 'applied'], ['phone-1-0004', 'ignored'], ['phone-1-0005', 'conflict'], ['phone-1-0006', 'error'],
    ]);
    // DR-2 came back two days late: the late fee counts up to the scan, not to the replay.
    const o = (await admin.get(`/api/v1/orders/${orderId}`)).body;
    expect(o.status).toBe('returned');
    expect(o.lines.filter((l: any) => l.type === 'fee')).toHaveLength(1);
  });

  it('ignores a batch sent twice', async () => {
    const again = (await replay([{ client_id: 'phone-1-0003', mode: 'check_in', code: 'DR-2', occurred_at: new Date().toISOString() }])).body;
    expect(again.results[0]).toMatchObject({ client_id: 'phone-1-0003', status: 'applied', repeated: true });
    expect(again.applied).toBe(1);
    const tooMany = await replay(Array.from({ length: 101 }, (_, i) => ({ client_id: `bulk-${String(i).padStart(4, '0')}`, mode: 'lookup', code: 'X', occurred_at: new Date().toISOString() })));
    expect(tooMany.status).toBe(400);
  });
});
