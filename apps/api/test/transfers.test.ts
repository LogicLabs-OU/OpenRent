import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Stock transfers between locations (FR-LOC-2, ADR 0007). */
suite('stock transfers', () => {
  let t: TestApp;
  let admin: Client;
  let main: string;
  let branch: string;
  let customer: string;
  let camera: string; // serialized: CAM-A, CAM-B at the main shop
  let kayak: string; // bulk: 5 at the main shop
  const units: Record<string, string> = {};

  const free = async (variant: string, location: string, from: string, to: string) =>
    (await admin.get(`/api/v1/availability?variant_id=${variant}&location_id=${location}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).body.available;
  const booking = async (location: string, from: string, to: string, lines: unknown[]) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, location_id: location, starts_at: from, ends_at: to, lines })).body;
    return { o, r: await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {}) };
  };
  const plan = (body: Record<string, unknown>) => admin.post('/api/v1/transfers', { from_location_id: main, to_location_id: branch, ...body });

  beforeAll(async () => {
    ({ t, admin, locationId: main } = await shopForTests(dbinfo!));
    branch = (await admin.post('/api/v1/locations', { name: 'Harbour', opening_hours: {} })).body.id;
    customer = (await admin.post('/api/v1/customers', { name: 'Move Customer', email: 'move@test.dev' })).body.id;
    camera = (await admin.post('/api/v1/products', { type: 'rental', name: 'Camera', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    kayak = (await admin.post('/api/v1/products', { type: 'rental', name: 'Kayak', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    for (const b of ['CAM-A', 'CAM-B']) units[b] = (await admin.post('/api/v1/stock_items', { variant_id: camera, location_id: main, barcode: b })).body.id;
    await admin.put(`/api/v1/stock_levels/${kayak}/${main}`, { quantity: 5 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('refuses incomplete transfers line by line', async () => {
    const same = await plan({ to_location_id: main, lines: [{ barcode: 'CAM-A' }] });
    expect(same.status).toBe(422);
    expect(same.body.errors.map((e: any) => e.field)).toEqual(['to_location_id']);
    expect((await plan({ lines: [] })).body.errors.map((e: any) => e.field)).toEqual(['lines']);
    expect((await plan({ ships_at: isoIn(3), eta: isoIn(2), lines: [{ barcode: 'CAM-A' }] })).body.errors.map((e: any) => e.field)).toEqual(['eta']);
    const lines = await plan({ lines: [{ barcode: 'CAM-A' }, { barcode: 'CAM-A' }, { variant_id: camera, quantity: 1 }, { barcode: 'NOPE' }, { variant_id: kayak, quantity: 0 }] });
    expect(lines.status).toBe(422);
    expect(lines.body.errors.map((e: any) => [e.field, e.code])).toEqual([
      ['lines[1]', 'duplicate'], ['lines[2]', 'units_required'], ['lines[3]', 'not_found'], ['lines[4].quantity', 'invalid'],
    ]);
    expect((await admin.get('/api/v1/transfers')).body.data).toEqual([]);
  });

  it('holds the stock at the source from the day it ships, and frees it when cancelled', async () => {
    const r = await plan({ ships_at: isoIn(5), lines: [{ barcode: 'CAM-A' }, { variant_id: kayak, quantity: 3 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ number: 1, status: 'planned', from_location_name: 'Main shop', to_location_name: 'Harbour' });
    expect(r.body.lines.map((l: any) => [l.barcode, l.quantity, l.outstanding])).toEqual([['CAM-A', 1, 1], [null, 3, 3]]);
    expect(await free(kayak, main, isoIn(1), isoIn(2))).toBe(5);
    expect(await free(kayak, main, isoIn(6), isoIn(7))).toBe(2);
    expect(await free(camera, main, isoIn(6), isoIn(7))).toBe(1);
    // A booking after the ship date cannot use what is leaving.
    expect((await booking(main, isoIn(8), isoIn(9), [{ variant_id: kayak, quantity: 3 }])).r.status).toBe(409);
    const later = await booking(main, isoIn(8), isoIn(9), [{ variant_id: camera, quantity: 1 }]);
    expect(later.r.status).toBe(200);
    expect((await admin.post(`/api/v1/orders/${later.o.id}/actions/assign_units`, { barcodes: ['CAM-A'] })).status).toBe(409);
    await admin.post(`/api/v1/orders/${later.o.id}/actions/cancel`, {});

    const cancelled = await admin.post(`/api/v1/transfers/${r.body.id}/actions/cancel`, {});
    expect(cancelled.body.status).toBe('cancelled');
    expect(await free(kayak, main, isoIn(6), isoIn(7))).toBe(5);
    expect((await admin.post(`/api/v1/transfers/${r.body.id}/actions/dispatch`, {})).body.code).toBe('invalid_transition');
  });

  it('refuses to plan stock that is already booked after the ship date', async () => {
    const { o } = await booking(main, isoIn(8), isoIn(9), [{ variant_id: kayak, quantity: 4 }]);
    const r = await plan({ ships_at: isoIn(5), lines: [{ variant_id: kayak, quantity: 3 }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('exceeds_availability');
    expect(r.body.errors[0].field).toBe('lines[0]');
    await admin.post(`/api/v1/orders/${o.id}/actions/cancel`, {});
  });

  it('checks the extra time when the transfer leaves earlier than planned', async () => {
    const { o } = await booking(main, isoIn(1), isoIn(2), [{ variant_id: kayak, quantity: 4 }]);
    const r = (await plan({ ships_at: isoIn(5), lines: [{ variant_id: kayak, quantity: 3 }] })).body;
    expect(r.status).toBe('planned');
    const early = await admin.post(`/api/v1/transfers/${r.id}/actions/dispatch`, {});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('exceeds_availability');
    expect((await admin.get(`/api/v1/transfers/${r.id}`)).body.status).toBe('planned');
    await admin.post(`/api/v1/transfers/${r.id}/actions/cancel`, {});
    await admin.post(`/api/v1/orders/${o.id}/actions/cancel`, {});
  });

  it('moves the stock on dispatch and keeps it held at the destination until the ETA', async () => {
    const eta = isoIn(2);
    const r = (await plan({ eta, notes: 'Van 2', lines: [{ barcode: 'CAM-A' }, { variant_id: kayak, quantity: 3 }] })).body;
    units.transfer = r.id;
    const sent = await admin.post(`/api/v1/transfers/${r.id}/actions/dispatch`, {});
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe('in_transit');
    const cam = (await admin.get(`/api/v1/stock_items/${units['CAM-A']}`)).body;
    expect([cam.location_id, cam.status]).toEqual([branch, 'in_transit']);
    const levels = (await admin.get(`/api/v1/stock_levels?variant_id=${kayak}`)).body.data;
    expect(Object.fromEntries(levels.map((l: any) => [l.location_id, l.quantity]))).toEqual({ [main]: 2, [branch]: 3 });
    // Nothing promised at the destination before it arrives; free after the ETA.
    expect(await free(kayak, branch, isoIn(1), isoIn(1, 12))).toBe(0);
    expect(await free(kayak, branch, isoIn(3), isoIn(4))).toBe(3);
    expect(await free(camera, branch, isoIn(3), isoIn(4))).toBe(1);
    expect(await free(camera, main, isoIn(3), isoIn(4))).toBe(1);

    // On the way, the unit cannot be handed out or set to another status.
    const { o } = await booking(branch, isoIn(3), isoIn(4), [{ variant_id: camera, quantity: 1 }]);
    const assign = await admin.post(`/api/v1/orders/${o.id}/actions/assign_units`, { barcodes: ['CAM-A'] });
    expect([assign.status, assign.body.code]).toEqual([409, 'unit_in_transit']);
    expect((await admin.post(`/api/v1/stock_items/${units['CAM-A']}/actions/set_status`, { status: 'available', reason: 'x' })).body.code).toBe('unit_in_transit');
    await admin.post(`/api/v1/orders/${o.id}/actions/cancel`, {});

    // A scan of the unit offers to receive it.
    const scan = (await admin.post('/api/v1/scans', { code: 'CAM-A', mode: 'receive' })).body;
    expect([scan.suggested_action, scan.entity.transfer_id]).toEqual(['receive', r.id]);
  });

  it('receives in parts and writes off what never arrives', async () => {
    const tr = (await admin.get(`/api/v1/transfers/${units.transfer}`)).body;
    const kayakLine = tr.lines.find((l: any) => !l.barcode).id;
    const tooMany = await admin.post(`/api/v1/transfers/${tr.id}/actions/receive`, { lines: [{ line_id: kayakLine, quantity: 4 }] });
    expect([tooMany.status, tooMany.body.errors[0].field]).toEqual([422, 'lines[0].quantity']);
    const wrong = await admin.post(`/api/v1/transfers/${tr.id}/actions/receive`, { barcodes: ['CAM-B'] });
    expect([wrong.status, wrong.body.errors[0].field]).toEqual([422, 'barcodes[0]']);

    const part = (await admin.post(`/api/v1/transfers/${tr.id}/actions/receive`, { lines: [{ line_id: kayakLine, quantity: 2 }], barcodes: ['CAM-A'] })).body;
    expect(part.status).toBe('in_transit');
    expect(part.lines.map((l: any) => l.outstanding)).toEqual([0, 1]);
    expect((await admin.get(`/api/v1/stock_items/${units['CAM-A']}`)).body.status).toBe('available');
    // What arrived is free now; the last kayak is still on the way.
    expect(await free(kayak, branch, isoIn(1), isoIn(1, 12))).toBe(2);
    expect(await free(camera, branch, isoIn(1), isoIn(1, 12))).toBe(1);

    const done = (await admin.post(`/api/v1/transfers/${tr.id}/actions/receive`, { complete: true })).body;
    expect(done.status).toBe('received');
    expect(done.lines.map((l: any) => [l.received_quantity, l.lost_quantity])).toEqual([[1, 0], [2, 1]]);
    const level = (await admin.get(`/api/v1/stock_levels?variant_id=${kayak}&location_id=${branch}`)).body.data[0];
    expect(level.quantity).toBe(2);
    expect(await free(kayak, branch, isoIn(1), isoIn(1, 12))).toBe(2);
  });

  it('sends a single unit, booked in at once when carried across', async () => {
    const r = await admin.post(`/api/v1/stock_items/${units['CAM-B']}/actions/transfer`, { to_location_id: branch, received: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('received');
    const cam = (await admin.get(`/api/v1/stock_items/${units['CAM-B']}`)).body;
    expect([cam.location_id, cam.status]).toEqual([branch, 'available']);
    expect(await free(camera, branch, isoIn(1), isoIn(2))).toBe(2);
    expect(await free(camera, main, isoIn(1), isoIn(2))).toBe(0);
  });

  it('lists availability at every location, the default first', async () => {
    const all = (await admin.get(`/api/v1/availability?variant_id=${kayak}&location_id=*&from=${encodeURIComponent(isoIn(1))}&to=${encodeURIComponent(isoIn(2))}`)).body;
    expect(all.object).toBe('list');
    expect(all.data.map((r: any) => [r.location_name, r.capacity, r.available])).toEqual([['Main shop', 2, 2], ['Harbour', 2, 2]]);
  });

  it('keeps a location with open transfers from being archived', async () => {
    const back = (await admin.post('/api/v1/transfers', { from_location_id: branch, to_location_id: main, ships_at: isoIn(3), lines: [{ barcode: 'CAM-B' }] })).body;
    const del = await admin.del(`/api/v1/locations/${branch}`);
    expect([del.status, del.body.code]).toEqual([409, 'location_has_transfers']);
    const list = (await admin.get(`/api/v1/transfers?status=planned,in_transit&location_id=${main}`)).body.data;
    expect(list.map((x: any) => x.id)).toEqual([back.id]);
    await admin.post(`/api/v1/transfers/${back.id}/actions/cancel`, {});
  });
});
