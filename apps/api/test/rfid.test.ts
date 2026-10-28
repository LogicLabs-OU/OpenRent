import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { epc, message } from '@openrent/rfid-fakes';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** FR-SCAN-7: RFID tags on units, readers posting reads in their own formats, and units taken in bulk. */
suite('RFID', () => {
  let t: TestApp;
  let admin: Client;
  let variant: string;
  const units: { id: string; barcode: string; epc: string }[] = [];

  const post = (readerId: string, token: string, format: 'openrent' | 'zebra-iot' | 'impinj-connect', epcs: string[], repeats = 1) => {
    const m = message(format, epcs, { repeats });
    return t.app.inject({ method: 'POST', url: `/webhooks/rfid/${readerId}`, headers: { authorization: `Bearer ${token}`, 'content-type': m.contentType }, payload: m.body });
  };

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    await admin.patch('/api/v1/plugins/rfid-bridge', { enabled: true });
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Folding chair', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 300 } });
    variant = p.body.variants[0].id;
    const loc = (await admin.get('/api/v1/locations')).body.data[0].id;
    for (let i = 0; i < 52; i++) {
      const s = await admin.post('/api/v1/stock_items', { variant_id: variant, location_id: loc, barcode: `CHAIR-${String(i).padStart(3, '0')}` });
      const e = epc();
      units.push({ id: s.body.id, barcode: s.body.barcode, epc: e });
      expect((await admin.put(`/api/v1/stock_items/${s.body.id}/rfid_tags`, { epcs: [e] })).status).toBe(200);
    }
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('keeps each tag on one unit and says which line is wrong', async () => {
    const [a, b] = units;
    expect((await admin.get(`/api/v1/stock_items/${a!.id}/rfid_tags`)).body.epcs).toEqual([a!.epc]);
    const r = await admin.put(`/api/v1/stock_items/${a!.id}/rfid_tags`, { epcs: [a!.epc, 'not-hex', b!.epc.toLowerCase().replace(/(..)/g, '$1:').slice(0, -1)] });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => [e.field, e.code])).toEqual([['epcs.1', 'invalid'], ['epcs.2', 'taken']]);
    expect(r.body.errors[1].message).toContain(b!.barcode);
  });

  it('takes 50 chairs onto an order from one read, once each, and lists tags it does not know', async () => {
    const reader = await admin.post('/api/v1/rfid/readers', { name: 'Dock door', format: 'zebra-iot' });
    expect(reader.status).toBe(201);
    expect(reader.body.url).toMatch(/\/webhooks\/rfid\/rfr_/);
    expect((await admin.get('/api/v1/rfid/readers')).body.data[0]).not.toHaveProperty('token');

    expect((await post(reader.body.id, 'wrong', 'zebra-iot', [units[0]!.epc])).statusCode).toBe(401);
    const { since } = (await admin.get(`/api/v1/rfid/readers/${reader.body.id}/reads`)).body;
    const stranger = epc();
    // Each tag read three times, from several antennas, plus one tag on nothing of ours.
    const sent = await post(reader.body.id, reader.body.token, 'zebra-iot', [...units.slice(0, 50).map((u) => u.epc), stranger], 3);
    expect(sent.statusCode).toBe(200);
    const seen = (await admin.get(`/api/v1/rfid/readers/${reader.body.id}/reads?since=${encodeURIComponent(since)}`)).body;
    expect(seen.units).toHaveLength(50);
    expect(seen.unknown).toEqual([stranger]);

    const c = await admin.post('/api/v1/customers', { name: 'Wedding Party', email: 'wedding@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(0, 23), ends_at: isoIn(2), lines: [{ variant_id: variant, quantity: 50 }], deposit: { mode: 'none' } });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    const took = await admin.post('/api/v1/scans/tags', { mode: 'check_out', order_id: o.body.id, epcs: [...seen.units.flatMap((u: any) => u.epcs), stranger] });
    expect(took.status).toBe(200);
    expect([took.body.applied, took.body.skipped, took.body.unknown]).toEqual([50, 0, [stranger]]);
    // The same read again changes nothing: they are on the order already.
    const again = await admin.post('/api/v1/scans/tags', { mode: 'check_out', order_id: o.body.id, epcs: units.slice(0, 50).map((u) => u.epc) });
    expect(again.body.applied).toBe(0);
    expect((await admin.post(`/api/v1/orders/${o.body.id}/actions/check_out`, {})).status).toBe(200);

    // An Impinj reader at the counter brings 49 back; the one not read stays out.
    const counter = await admin.post('/api/v1/rfid/readers', { name: 'Counter', format: 'impinj-connect' });
    const from = (await admin.get(`/api/v1/rfid/readers/${counter.body.id}/reads`)).body.since;
    const back = units.slice(0, 49);
    expect((await post(counter.body.id, counter.body.token, 'impinj-connect', back.map((u) => u.epc), 2)).statusCode).toBe(200);
    const read = (await admin.get(`/api/v1/rfid/readers/${counter.body.id}/reads?since=${encodeURIComponent(from)}`)).body;
    expect(read.units).toHaveLength(49);
    const returned = await admin.post('/api/v1/scans/tags', { mode: 'check_in', epcs: read.units.flatMap((u: any) => u.epcs) });
    expect([returned.body.applied, returned.body.skipped]).toEqual([49, 0]);
    const order = (await admin.get(`/api/v1/orders/${o.body.id}`)).body;
    expect(order.status).toBe('returned_partial');
  }, 60_000);

  it('takes OpenRent’s own format and refuses formats the shop has not turned on', async () => {
    const own = await admin.post('/api/v1/rfid/readers', { name: 'Handheld', format: 'openrent' });
    expect((await post(own.body.id, own.body.token, 'openrent', [units[50]!.epc])).statusCode).toBe(200);
    expect((await admin.post('/api/v1/rfid/readers', { name: 'Odd', format: 'acme' })).body.errors[0].field).toBe('format');
    expect((await admin.del(`/api/v1/rfid/readers/${own.body.id}`)).status).toBe(200);
    expect((await post(own.body.id, own.body.token, 'openrent', [units[50]!.epc])).statusCode).toBe(401);
  });

  it('replays a read made offline as one batch', async () => {
    const r = await admin.post('/api/v1/scans/replay', { items: [{ client_id: 'rfid-batch-0001', mode: 'check_in', code: 'rfid', epcs: [units[49]!.epc], occurred_at: new Date().toISOString() }] });
    expect(r.status).toBe(200);
    expect(r.body.results[0]).toMatchObject({ status: 'applied' });
  });
});
