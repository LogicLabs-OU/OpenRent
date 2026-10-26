import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Deliveries and collections (FR-OR-12). */
suite('deliveries', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let customer: string;
  let kayaks: string; // bulk, 4 in stock

  const reserved = async (from: string, to: string, quantity = 4) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: from, ends_at: to, lines: [{ variant_id: kayaks, quantity }] })).body;
    const r = await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const available = async (from: string, to: string) => (await admin.get(`/api/v1/availability?variant_id=${kayaks}&from=${from}&to=${to}`)).body.available;
  const hours = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3600_000).toISOString();

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    customer = (await admin.post('/api/v1/customers', { name: 'Delivery Customer', email: 'dlv@test.dev', phone: '+372 555 0000', addresses: { shipping: { line1: 'Pikk 1', postal_code: '10123', city: 'Tallinn' } } })).body.id;
    kayaks = (await admin.post('/api/v1/products', { type: 'rental', name: 'Kayak', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${kayaks}/${locationId}`, { quantity: 4 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('stretches the bookings to cover delivery and collection windows, and shrinks them back', async () => {
    const o = await reserved(isoIn(10), isoIn(11));
    const d = await admin.post(`/api/v1/orders/${o.id}/deliveries`, { kind: 'delivery', window_start: hours(isoIn(10), -3), window_end: hours(isoIn(10), -1) });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body).toMatchObject({ object: 'delivery', kind: 'delivery', status: 'scheduled', address: { line1: 'Pikk 1' }, contact: { name: 'Delivery Customer', phone: '+372 555 0000' } });
    expect(await available(hours(isoIn(10), -2), hours(isoIn(10), -1))).toBe(0);
    const c = await admin.post(`/api/v1/orders/${o.id}/deliveries`, { kind: 'collection', window_start: isoIn(11), window_end: hours(isoIn(11), 4) });
    expect(await available(hours(isoIn(11), 2), hours(isoIn(11), 3))).toBe(0);
    // Only one active of each kind.
    expect((await admin.post(`/api/v1/orders/${o.id}/deliveries`, { kind: 'collection', window_start: isoIn(11), window_end: hours(isoIn(11), 1) })).body.code).toBe('delivery_exists');
    // Stock taken right after the rental blocks moving the collection later.
    await reserved(hours(isoIn(11), 6), isoIn(12));
    const late = await admin.patch(`/api/v1/deliveries/${c.body.id}`, { window_end: hours(isoIn(11), 8) });
    expect(late.status).toBe(409);
    await admin.post(`/api/v1/deliveries/${d.body.id}/actions/cancel`, {});
    await admin.post(`/api/v1/deliveries/${c.body.id}/actions/cancel`, {});
    expect(await available(hours(isoIn(10), -2), hours(isoIn(10), -1))).toBe(4);
    expect(await available(hours(isoIn(11), 2), hours(isoIn(11), 3))).toBe(4);
    const bad = await admin.post(`/api/v1/orders/${o.id}/deliveries`, { kind: 'delivery', window_start: isoIn(10), window_end: hours(isoIn(10), -1) });
    expect(bad.body.errors[0].field).toBe('window_end');
  });

  it('dispatches with a delivery note, and completing records pickup and return on the order', async () => {
    // Delivered today: the pickup is recorded at the door, so the rental starts soon.
    const now = new Date().toISOString();
    const o = await reserved(hours(now, 3), hours(now, 27), 1);
    const d = (await admin.post(`/api/v1/orders/${o.id}/deliveries`, { kind: 'delivery', window_start: hours(now, 1), window_end: hours(now, 3) })).body;
    const sent = await admin.post(`/api/v1/deliveries/${d.id}/actions/dispatch`, {});
    expect(sent.body.status).toBe('dispatched');
    const docs = (await admin.get(`/api/v1/documents?order_id=${o.id}`)).body.data.map((x: any) => x.type);
    expect(docs).toContain('delivery_note');
    const done = await admin.post(`/api/v1/deliveries/${d.id}/actions/complete`, { signed_name: 'Delivery Customer' });
    expect(done.body.status, JSON.stringify(done.body)).toBe('completed');
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.status).toBe('out');
    const c = (await admin.post(`/api/v1/orders/${o.id}/deliveries`, { kind: 'collection', window_start: hours(now, 27), window_end: hours(now, 29) })).body;
    await admin.post(`/api/v1/deliveries/${c.id}/actions/complete`, {});
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.status).toBe('returned');
    const mails = (await admin.get(`/api/v1/notifications?order_id=${o.id}`)).body.data.map((n: any) => n.template);
    expect(mails).toContain('delivery_dispatched');
  });

  it('records failures with a reason and plans the day\'s run', async () => {
    const day = isoIn(30).slice(0, 10);
    const a = await reserved(isoIn(30, 12), isoIn(31), 1);
    const b = await reserved(isoIn(30, 14), isoIn(31), 1);
    const da = (await admin.post(`/api/v1/orders/${a.id}/deliveries`, { kind: 'delivery', window_start: isoIn(30, 9), window_end: isoIn(30, 11), address: { line1: 'A street 1', lat: 59.43, lng: 24.75 } })).body;
    const db = (await admin.post(`/api/v1/orders/${b.id}/deliveries`, { kind: 'delivery', window_start: isoIn(30, 10), window_end: isoIn(30, 12), address: { line1: 'B street 2' } })).body;
    expect((await admin.get(`/api/v1/deliveries?date=${day}`)).body.data.map((x: any) => x.id)).toEqual([da.id, db.id]);
    await admin.post('/api/v1/deliveries/actions/reorder', { date: day, ids: [db.id, da.id] });
    expect((await admin.get(`/api/v1/deliveries?date=${day}`)).body.data.map((x: any) => x.id)).toEqual([db.id, da.id]);
    const csv = await admin.get(`/api/v1/deliveries/route?date=${day}`);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = String(csv.body).trim().split('\r\n');
    expect(lines[1]).toContain('B street 2');
    const gpx = await admin.get(`/api/v1/deliveries/route?date=${day}&format=gpx`);
    expect(String(gpx.body)).toContain('lat="59.43" lon="24.75"');
    expect((await admin.post(`/api/v1/deliveries/${db.id}/actions/fail`, { reason: '' })).body.errors[0].field).toBe('reason');
    const failed = await admin.post(`/api/v1/deliveries/${db.id}/actions/fail`, { reason: 'Nobody home' });
    expect(failed.body).toMatchObject({ status: 'failed', failure_reason: 'Nobody home' });
    const notices = (await admin.get('/api/v1/me/notifications')).body.data.map((n: any) => n.kind);
    expect(notices).toContain('staff_delivery_failed');
  });

  it('books a delivery and collection when a delivery fee is chosen at checkout', async () => {
    const fee = (await admin.post('/api/v1/fee_rules', { name: 'Delivery', kind: 'delivery', calculation: 'flat', amount: 1500, mode: 'optional' })).body;
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const s = (await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(40), ends_at: isoIn(41), lines: [{ variant_id: kayaks, quantity: 1 }] })).body;
    await sf.patch(`/api/v1/storefront/checkout_sessions/${s.id}`, { options: { fees: [fee.id], postcode: '10123', address: 'Lai 5, Tallinn' } });
    const settings = (await sf.get('/api/v1/storefront/settings')).body;
    const done = await sf.post(`/api/v1/storefront/checkout_sessions/${s.id}/actions/complete`, { customer: { name: 'Web Shopper', email: 'web-dlv@test.dev' }, terms_accepted: true, terms_hash: settings.terms.hash });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const list = (await admin.get(`/api/v1/deliveries?order_id=${done.body.order.id}`)).body.data;
    expect(list.map((d: any) => [d.kind, d.address.line1, d.address.postal_code])).toEqual([
      ['delivery', 'Lai 5, Tallinn', '10123'],
      ['collection', 'Lai 5, Tallinn', '10123'],
    ]);
  });

  it('needs deliveries:write to change them', async () => {
    const key = await admin.post('/api/v1/api_keys', { name: 'Driver app', kind: 'secret', scopes: ['deliveries:read'] });
    const reader = new Client(t.app, { authorization: `Bearer ${key.body.key}` });
    const list = await reader.get('/api/v1/deliveries');
    expect(list.status).toBe(200);
    expect((await reader.post(`/api/v1/deliveries/${list.body.data[0].id}/actions/cancel`, {})).status).toBe(403);
  });
});
