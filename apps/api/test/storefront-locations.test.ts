import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** The location a shopper picks (X-Storefront-Location): stock, the cart and other locations that have an item free. */
suite('storefront location choice', () => {
  let t: TestApp;
  let admin: Client;
  let main: string;
  let harbour: string;
  let product: any;
  const shop = (location?: string) => new Client(t.app, { 'x-tenant-slug': 'test-rentals', ...(location ? { 'x-storefront-location': location } : {}) });
  const from = isoIn(5);
  const to = isoIn(6);

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    main = locationId;
    const created = (await admin.post('/api/v1/locations', { name: 'Harbour', timezone: 'Europe/Tallinn', delivery_windows: { sat: [['10:00', '12:00']] } })).body;
    expect(created.delivery_windows).toEqual({ sat: [['10:00', '12:00']] });
    harbour = created.id;
    product = (await admin.post('/api/v1/products', { type: 'rental', name: 'Kayak', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } })).body;
    // Only the harbour has kayaks.
    await admin.put(`/api/v1/stock_levels/${product.variants[0].id}/${harbour}`, { quantity: 3 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('shows stock at the chosen location, else the default', async () => {
    const at = async (loc?: string) => (await shop(loc).get(`/api/v1/storefront/catalog/products/${product.slug}?from=${from}&to=${to}`)).body.variants[0];
    expect((await at()).available).toBe(0);
    expect((await at(harbour)).available).toBe(3);
    // A location of no shop (or another shop) counts as none.
    expect((await at('loc_nope')).available).toBe(0);
    const list = await shop(harbour).get(`/api/v1/storefront/catalog/products?from=${from}&to=${to}&available=true`);
    expect(list.body.data.map((p: any) => p.id)).toContain(product.id);
    expect(list.headers.vary).toContain('X-Storefront-Location');
  });

  it('names the locations that have it free when the chosen one has none', async () => {
    const p = (await shop(main).get(`/api/v1/storefront/catalog/products/${product.slug}?from=${from}&to=${to}`)).body;
    expect(p.variants[0].elsewhere).toEqual([{ location_id: harbour, name: 'Harbour', available: 3 }]);
    const there = (await shop(harbour).get(`/api/v1/storefront/catalog/products/${product.slug}?from=${from}&to=${to}`)).body;
    expect(there.variants[0].elsewhere).toBeUndefined();
  });

  it('starts the cart at the chosen location, and moves it with the shopper', async () => {
    const cs = await shop(harbour).post('/api/v1/storefront/checkout_sessions', { starts_at: from, ends_at: to, lines: [{ variant_id: product.variants[0].id, quantity: 2 }] });
    expect(cs.body.location_id).toBe(harbour);
    expect(cs.body.availability[0]).toMatchObject({ available: 3 });
    const moved = await shop(main).patch(`/api/v1/storefront/checkout_sessions/${cs.body.id}`, { location_id: main });
    expect(moved.body.location_id).toBe(main);
    expect(moved.body.availability[0].available).toBe(0);
    const quote = await shop(harbour).post('/api/v1/storefront/price_quote', { starts_at: from, ends_at: to, lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
    expect(quote.status).toBe(200);
  });
  it('books delivery and collection in the times the customer chose, which the location offers', async () => {
    const bad = await admin.patch(`/api/v1/locations/${main}`, { delivery_windows: { mon: [['12:00', '08:00']] } });
    expect([bad.status, bad.body.errors?.[0]?.field]).toEqual([422, 'delivery_windows.mon']);
    const every = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['08:00', '12:00'], ['13:00', '17:00']]]));
    expect((await admin.patch(`/api/v1/locations/${main}`, { delivery_windows: every, timezone: 'Europe/Tallinn' })).status).toBe(200);
    expect((await shop().get('/api/v1/storefront/settings')).body.locations.find((l: any) => l.id === main).delivery_windows.mon).toEqual([['08:00', '12:00'], ['13:00', '17:00']]);
    await admin.put(`/api/v1/stock_levels/${product.variants[0].id}/${main}`, { quantity: 2 });
    const fee = (await admin.post('/api/v1/fee_rules', { name: 'Delivery', kind: 'delivery', calculation: 'flat', amount: 1500, mode: 'optional' })).body;
    const sf = shop(main);
    const s = (await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(20), ends_at: isoIn(22), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] })).body;
    await sf.patch(`/api/v1/storefront/checkout_sessions/${s.id}`, { options: { fees: [fee.id], address: 'Lai 5, Tallinn' } });
    const hash = (await sf.get('/api/v1/storefront/settings')).body.terms.hash;
    const complete = (extra: Record<string, unknown>) => sf.post(`/api/v1/storefront/checkout_sessions/${s.id}/actions/complete`, { customer: { name: 'Window Shopper', email: 'win@test.dev' }, terms_accepted: true, terms_hash: hash, extra });
    const missing = await complete({ 'delivery.window': '13:00-17:00', 'collection.window': '06:00-07:00' });
    expect([missing.status, missing.body.errors.map((e: any) => e.field)]).toEqual([422, ['extra.collection.window']]);
    const done = await complete({ 'delivery.window': '13:00-17:00', 'collection.window': '08:00-12:00' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const list = (await admin.get(`/api/v1/deliveries?order_id=${done.body.order.id}`)).body.data;
    const local = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn' }).format(new Date(iso));
    const d = list.find((x: any) => x.kind === 'delivery');
    const c = list.find((x: any) => x.kind === 'collection');
    expect([local(d.window_start), local(d.window_end), day(d.window_start)]).toEqual(['13:00', '17:00', day(isoIn(20))]);
    expect([local(c.window_start), local(c.window_end), day(c.window_start)]).toEqual(['08:00', '12:00', day(isoIn(22))]);
  });
});
