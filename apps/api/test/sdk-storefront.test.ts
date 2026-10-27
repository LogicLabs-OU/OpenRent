import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenRentError } from '@openrent/sdk';
import { createStorefront, type Storefront } from '@openrent/sdk/storefront';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** The SDK's storefront helpers for headless shops (FR-SF-7), against the real API. */
suite('storefront SDK', () => {
  let t: TestApp;
  let admin: Client;
  let sf: Storefront;
  let slug: string;
  let variant: string;
  const from = isoIn(30);
  const to = isoIn(32);

  // The SDK's requests go straight to the app, as fetch would send them.
  const viaApp: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
    const res = await t.app.inject({ method: req.method as 'GET', url: url.pathname + url.search, headers: Object.fromEntries(req.headers), payload: body });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    return new Response(res.statusCode === 204 ? null : new Uint8Array(res.rawPayload), { status: res.statusCode, headers });
  };

  beforeAll(async () => {
    let locationId: string;
    let publishableKey: string;
    ({ t, admin, locationId, publishableKey } = await shopForTests(dbinfo!));
    const p = (await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', visibility: 'public', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } })).body;
    slug = p.slug;
    variant = p.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 3 });
    sf = createStorefront({ baseUrl: 'http://api.test', publishableKey, fetch: viaApp, retries: 0 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('reads the shop, the catalogue and live availability', async () => {
    const s = await sf.settings();
    expect(s.tenant.currency).toBe('EUR');
    expect(s.terms.hash).toMatch(/^[0-9a-f]{64}$/);
    const list = await sf.products({ from, to, q: 'canoe' });
    expect(list.data.map((x) => [x.slug, x.variants[0]!.available])).toEqual([[slug, 3]]);
    const p = await sf.product(slug, { from, to });
    expect([p.name, p.variants[0]!.price?.amount]).toEqual(['Canoe', { amount: 3600, currency: 'EUR' }]);
    const days = await sf.calendar(variant, from.slice(0, 7));
    expect(days.length).toBeGreaterThanOrEqual(28);
  });

  it('prices, fills a cart and books it', async () => {
    const q = await sf.quote({ starts_at: from, ends_at: to, lines: [{ variant_id: variant, quantity: 2 }] });
    expect(q.total.amount).toBeGreaterThan(0);
    const created = await sf.cart.create({ starts_at: from, ends_at: to });
    expect(created.status).toBe('open');
    await sf.cart.add(created.id, variant, 2);
    const cart = await sf.cart.add(created.id, variant);
    expect(cart.lines.map((l) => [l.variant_id, l.quantity])).toEqual([[variant, 3]]);
    expect(cart.quote!.total.amount).toBe((q.total.amount / 2) * 3);

    const { terms } = await sf.settings();
    const refused = await sf.cart.complete(created.id, { customer: { name: 'Headless Renter', email: 'headless@test.dev' }, terms_accepted: false, terms_hash: terms.hash }).catch((e) => e);
    expect(refused).toBeInstanceOf(OpenRentError);
    expect([refused.status, refused.problem.errors[0].field]).toEqual([422, 'terms_accepted']);

    const done = await sf.cart.complete(created.id, { customer: { name: 'Headless Renter', email: 'headless@test.dev' }, terms_accepted: true, terms_hash: terms.hash });
    expect(done.order.number).toBeGreaterThan(0);
    const order = await sf.order(done.order.token, done.order.token);
    expect([order.number, order.lines.map((l) => l.quantity)]).toEqual([done.order.number, [3]]);
    expect((await sf.products({ from, to, q: 'canoe' })).data[0]!.variants[0]!.available).toBe(0);
  });

  it('removes a line with a quantity that takes it to zero', async () => {
    const c = await sf.cart.create({ starts_at: from, ends_at: to, lines: [{ variant_id: variant, quantity: 1 }] });
    expect((await sf.cart.add(c.id, variant, -1)).lines).toEqual([]);
  });
});
