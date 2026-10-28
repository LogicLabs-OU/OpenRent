import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Cases that hold other units (FR-CAT-11): scanning the case scans what is packed in it. */
suite('cases', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let customer: string;
  let mic: string;
  const unit: Record<string, string> = {};

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    mic = (await admin.post('/api/v1/products', { type: 'rental', name: 'Wireless mic', tracking: 'serialized', buffer_after_min: 0, price: { kind: 'per_period', period_unit: 'day', amount: 1500 } })).body.variants[0].id;
    const box = (await admin.post('/api/v1/products', { type: 'rental', name: 'Flight case', tracking: 'serialized', buffer_after_min: 0, price: { kind: 'per_period', period_unit: 'day', amount: 500 } })).body.variants[0].id;
    for (const b of ['MIC-1', 'MIC-2', 'MIC-3']) unit[b] = (await admin.post('/api/v1/stock_items', { variant_id: mic, location_id: locationId, barcode: b })).body.id;
    for (const b of ['CASE-A', 'CASE-B']) unit[b] = (await admin.post('/api/v1/stock_items', { variant_id: box, location_id: locationId, barcode: b })).body.id;
    customer = (await admin.post('/api/v1/customers', { name: 'Stage Crew', email: 'crew@test.dev' })).body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('packs units in a case, and refuses a loop or another location', async () => {
    const r = await admin.post(`/api/v1/stock_items/${unit['CASE-A']}/actions/pack`, { barcodes: ['MIC-1', 'MIC-2', 'MIC-3'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.contents.map((c: any) => c.barcode)).toEqual(['MIC-1', 'MIC-2', 'MIC-3']);
    expect(r.body.contents_count).toBe(3);
    expect((await admin.get(`/api/v1/stock_items/${unit['MIC-1']}`)).body).toMatchObject({ container_id: unit['CASE-A'], container_barcode: 'CASE-A' });
    // A case in a case is fine; the outer one cannot then go inside the inner one.
    expect((await admin.post(`/api/v1/stock_items/${unit['CASE-B']}/actions/pack`, { barcodes: ['CASE-A'] })).status).toBe(200);
    const loop = await admin.post(`/api/v1/stock_items/${unit['CASE-A']}/actions/pack`, { barcodes: ['CASE-B'] });
    expect(loop.status).toBe(409);
    expect(loop.body.code).toBe('container_cycle');
    const self = await admin.post(`/api/v1/stock_items/${unit['CASE-A']}/actions/pack`, { barcodes: ['CASE-A'] });
    expect(self.body.code).toBe('container_cycle');
    expect((await admin.post(`/api/v1/stock_items/${unit['CASE-B']}/actions/unpack`, { all: true })).body.contents).toEqual([]);

    const harbour = (await admin.post('/api/v1/locations', { name: 'Harbour', opening_hours: {} })).body.id;
    const far = (await admin.post('/api/v1/stock_items', { variant_id: mic, location_id: harbour, barcode: 'MIC-FAR' })).body.id;
    const wrong = await admin.post(`/api/v1/stock_items/${unit['CASE-B']}/actions/pack`, { stock_item_ids: [far] });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('wrong_location');
  });

  it('a unit that moves to another location leaves its case', async () => {
    const extra = (await admin.post('/api/v1/stock_items', { variant_id: mic, location_id: locationId, barcode: 'MIC-4' })).body.id;
    await admin.post(`/api/v1/stock_items/${unit['CASE-B']}/actions/pack`, { stock_item_ids: [extra] });
    const harbour = (await admin.get('/api/v1/locations')).body.data.find((l: any) => l.name === 'Harbour').id;
    expect((await admin.patch(`/api/v1/stock_items/${extra}`, { location_id: harbour })).status).toBe(200);
    expect((await admin.get(`/api/v1/stock_items/${extra}`)).body.container_id).toBeNull();
    expect((await admin.get(`/api/v1/stock_items/${unit['CASE-B']}/contents`)).body.data).toEqual([]);
  });

  it('scanning the case assigns what it holds, checks it out and brings it back', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(1), ends_at: isoIn(3), lines: [{ variant_id: mic, quantity: 2 }] })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    const scan = (await admin.post('/api/v1/scans', { code: 'CASE-A', mode: 'check_out', order_id: o.id })).body;
    expect(scan.entity.contents.map((c: any) => c.barcode)).toEqual(['MIC-1', 'MIC-2', 'MIC-3']);
    // Two mics fit the order; the third is listed, and the case itself is not rented, so it is left out.
    const asg = await admin.post(`/api/v1/orders/${o.id}/actions/assign_units`, { barcodes: ['CASE-A'] });
    expect(asg.status, JSON.stringify(asg.body)).toBe(200);
    expect(asg.body.lines[0].units.map((u: any) => u.barcode).sort()).toEqual(['MIC-1', 'MIC-2']);
    expect(asg.body.skipped).toEqual([{ barcode: 'MIC-3', reason: expect.any(String) }]);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {})).body.status).toBe('out');

    const back = (await admin.post('/api/v1/scans', { code: 'CASE-A', mode: 'check_in' })).body;
    expect(back.entity.current_order_id).toBe(o.id);
    expect(back.suggested_action).toBe('check_in');
    const ret = await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { units: [{ barcode: 'CASE-A', outcome: 'ok' }] });
    expect(ret.status, JSON.stringify(ret.body)).toBe(200);
    expect(ret.body.status).toBe('returned');
    expect((await admin.get(`/api/v1/stock_items/${unit['MIC-3']}`)).body.status).toBe('available');
  });

  it('a case on the order goes out with its contents, and a missing unit can be marked on its own', async () => {
    const box = (await admin.get(`/api/v1/stock_items/${unit['CASE-A']}`)).body.variant_id;
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(5), ends_at: isoIn(6), lines: [{ variant_id: box, quantity: 1 }, { variant_id: mic, quantity: 3 }] })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    const out = await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, { barcodes: ['CASE-A'] });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.lines.flatMap((l: any) => l.units.map((u: any) => u.barcode)).sort()).toEqual(['CASE-A', 'MIC-1', 'MIC-2', 'MIC-3']);
    // The case comes back without one mic: the mic is marked lost, the rest come in with the case.
    const ret = await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { units: [{ barcode: 'CASE-A', outcome: 'ok' }, { barcode: 'MIC-3', outcome: 'lost' }] });
    expect(ret.status, JSON.stringify(ret.body)).toBe(200);
    expect(ret.body.status).toBe('returned');
    expect((await admin.get(`/api/v1/stock_items/${unit['MIC-3']}`)).body.status).toBe('lost');
    expect((await admin.get(`/api/v1/stock_items/${unit['MIC-1']}`)).body.status).toBe('available');
  });

  it('an offline return of the case brings its contents back', async () => {
    await admin.post(`/api/v1/stock_items/${unit['CASE-B']}/actions/pack`, { barcodes: ['MIC-1'] });
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(8), ends_at: isoIn(9), lines: [{ variant_id: mic, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, { barcodes: ['CASE-B'] })).body.status).toBe('out');
    const r = (await admin.post('/api/v1/scans/replay', { items: [{ client_id: 'case-0001', mode: 'check_in', code: 'CASE-B', occurred_at: new Date().toISOString() }] })).body;
    expect(r.results[0].status, JSON.stringify(r)).toBe('applied');
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.status).toBe('returned');
  });
});
