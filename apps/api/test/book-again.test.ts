import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Booking again from the account, and a booking's pickup and return as a calendar file. */
suite('book again and calendar files', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let session = '';
  let order: any;
  let tent: any;
  let stove: any;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const as = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals', 'x-customer-session': session });

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    await admin.patch(`/api/v1/locations/${locationId}`, { address: { line1: 'Kai 1, Hall B; Gate 2', city: 'Tallinn' } });
    tent = (await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } })).body;
    stove = (await admin.post('/api/v1/products', { type: 'rental', name: 'Stove', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 500 } })).body;
    for (const p of [tent, stove]) await admin.put(`/api/v1/stock_levels/${p.variants[0].id}/${locationId}`, { quantity: 5 });
    const hash = (await shop().get('/api/v1/storefront/settings')).body.terms.hash;
    const cs = await shop().post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(3), ends_at: isoIn(4), lines: [{ variant_id: tent.variants[0].id, quantity: 2 }, { variant_id: stove.variants[0].id, quantity: 1 }] });
    order = (await shop().post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Camper', email: 'camper@test.dev' }, terms_accepted: true, terms_hash: hash })).body.order;
    const c = (await admin.get('/api/v1/customers?q=camper')).body.data[0];
    await admin.post(`/api/v1/customers/${c.id}/actions/send_portal_link`);
    const r = await withSystem(t.deps.db, (db) => db.query(`SELECT body_html FROM notifications WHERE template_key = 'portal_invitation' AND recipient = 'camper@test.dev' ORDER BY created_at DESC LIMIT 1`));
    const token = /token(?:=|&#x3D;)([\w-]+)/.exec(r.rows[0].body_html)![1]!;
    session = (await shop().post('/api/v1/portal/auth/verify', { token })).body.token;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('gives the pickup and return as calendar events, at the location', async () => {
    expect((await shop().get(`/api/v1/storefront/orders/${order.id}/calendar?token=wrong-token-123456`)).status).toBe(404);
    const r = await shop().get(`/api/v1/storefront/orders/${order.token}/calendar?token=${order.token}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/calendar');
    const ics = r.body as string;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain(`SUMMARY:Pickup #${order.number} · Test Rentals`);
    // Commas in text are escaped.
    expect(ics).toContain('LOCATION:Main shop\\, Kai 1\\, Hall B\\; Gate 2\\, Tallinn');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    // The confirmation email carries it.
    const mail = (await admin.get(`/api/v1/notifications?order_id=${order.id}`)).body.data.find((n: any) => n.template === 'order_confirmed');
    expect(mail.attachments).toContain(`ics:${order.id}`);
  });

  it('puts the items of a past booking in a new cart, leaving out what is no longer offered', async () => {
    expect((await shop().post(`/api/v1/storefront/account/orders/${order.id}/actions/book_again`, {})).status).toBe(401);
    await admin.patch(`/api/v1/products/${stove.id}`, { visibility: 'hidden' });
    const r = await as().post(`/api/v1/storefront/account/orders/${order.id}/actions/book_again`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.skipped).toEqual(['Stove']);
    const cart = (await shop().get(`/api/v1/storefront/checkout_sessions/${r.body.cart_id}`)).body;
    expect(cart).toMatchObject({ status: 'open', starts_at: null, location_id: locationId });
    expect(cart.lines.map((l: any) => [l.variant_id, l.quantity])).toEqual([[tent.variants[0].id, 2]]);
    // Someone else's booking stays theirs.
    const other = (await admin.post('/api/v1/orders', { location_id: locationId, starts_at: isoIn(10), ends_at: isoIn(11), lines: [{ variant_id: tent.variants[0].id, quantity: 1 }] })).body;
    expect((await as().post(`/api/v1/storefront/account/orders/${other.id}/actions/book_again`, {})).status).toBe(404);
  });
});
