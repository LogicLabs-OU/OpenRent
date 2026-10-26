import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Choice bundles (FR-CAT-6): a slot of alternatives the booking picks one of. */
suite('choice bundles', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let bundle: any;
  const v = { body: '', wide: '', tele: '', battery: '' };
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const product = async (name: string, amount: number, qty: number) => {
    const p = await admin.post('/api/v1/products', { type: 'rental', name, tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount } });
    await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${locationId}`, { quantity: qty });
    return p.body.variants[0].id as string;
  };
  const childVariants = (o: any) => o.lines[0].components.map((c: any) => [c.variant_id, c.quantity]).sort();

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    v.body = await product('Camera body', 5000, 3);
    v.wide = await product('Wide lens', 2000, 0);
    v.tele = await product('Tele lens', 3000, 2);
    v.battery = await product('Battery', 500, 10);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('keeps bundles under /bundles with their slots', async () => {
    const r = await admin.post('/api/v1/bundles', {
      name: 'Camera kit', visibility: 'public',
      bundle: { pricing_mode: 'sum', components: [
        { variant_id: v.body, quantity: 1 }, { variant_id: v.wide, quantity: 1, slot_name: 'Lens' }, { variant_id: v.tele, quantity: 1, slot_name: 'Lens' }, { variant_id: v.battery, quantity: 2 },
      ] },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    bundle = r.body;
    expect(bundle.type).toBe('bundle');
    expect((await admin.get('/api/v1/bundles')).body.data.map((b: any) => b.id)).toEqual([bundle.id]);
    expect((await admin.get(`/api/v1/bundles/${bundle.id}`)).body.bundle.components.map((c: any) => c.slot_name)).toEqual([null, 'Lens', 'Lens', null]);
    expect((await admin.get(`/api/v1/bundles/${(await admin.get('/api/v1/products?q=Battery')).body.data[0].id}`)).status).toBe(404);
  });

  it('is available when one option of each slot is, and prices the pick', async () => {
    const a = await admin.get(`/api/v1/availability?variant_id=${bundle.variants[0].id}&location_id=${locationId}&from=${isoIn(5)}&to=${isoIn(6)}`);
    // The wide lens is out of stock, the tele lens has two: the kit can go twice.
    expect(a.body.available).toBe(2);
    const quote = (picks?: Record<string, string>) => admin.post('/api/v1/price_quote', { starts_at: isoIn(5), ends_at: isoIn(6), lines: [{ variant_id: bundle.variants[0].id, quantity: 1, picks }] });
    // One day: body 50.00 + lens + 2 × 5.00, before tax.
    expect((await quote({ Lens: v.wide })).body.lines[0].subtotal.amount).toBe(8000);
    expect((await quote({ Lens: v.tele })).body.lines[0].subtotal.amount).toBe(9000);
    expect((await quote()).body.lines[0].subtotal.amount).toBe(8000);
    const bad = await quote({ Lens: v.battery });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'lines[0].picks.Lens']);
  });

  it('books the picked option and can switch it while the order is a draft', async () => {
    const customer = (await admin.post('/api/v1/customers', { name: 'Kit Staff Booking' })).body.id;
    const o = await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(7), ends_at: isoIn(8), lines: [{ variant_id: bundle.variants[0].id, quantity: 1, picks: { Lens: v.tele } }] });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect(childVariants(o.body)).toEqual([[v.battery, 2], [v.body, 1], [v.tele, 1]].sort());
    expect(o.body.lines[0].price_snapshot.picks).toEqual({ Lens: v.tele });
    const changed = await admin.patch(`/api/v1/orders/${o.body.id}/lines/${o.body.lines[0].id}`, { picks: { Lens: v.wide } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(childVariants(changed.body)).toEqual([[v.battery, 2], [v.body, 1], [v.wide, 1]].sort());
    expect(changed.body.lines[0].subtotal.amount).toBe(8000);
    // Repricing keeps the pick.
    expect((await admin.patch(`/api/v1/orders/${o.body.id}`, { ends_at: isoIn(9) })).body.lines[0].price_snapshot.picks).toEqual({ Lens: v.wide });
    // The wide lens has no stock: reserving says so for that component.
    const short = await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    expect([short.status, short.body.code]).toEqual([409, 'exceeds_availability']);
    await admin.patch(`/api/v1/orders/${o.body.id}/lines/${o.body.lines[0].id}`, { picks: { Lens: v.tele } });
    const ok = await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('shows the slots in the storefront and books the pick online', async () => {
    const p = await shop().get(`/api/v1/storefront/catalog/products/${bundle.slug}?from=${isoIn(12)}&to=${isoIn(13)}`);
    expect(p.body.bundle).toEqual({
      components: [{ name: 'Camera body', quantity: 1 }, { name: 'Battery', quantity: 2 }],
      slots: [{ name: 'Lens', options: [{ variant_id: v.wide, name: 'Wide lens', quantity: 1, available: 0 }, { variant_id: v.tele, name: 'Tele lens', quantity: 1, available: 2 }] }],
    });
    const cs = await shop().post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(12), ends_at: isoIn(13), lines: [{ variant_id: bundle.variants[0].id, quantity: 1, picks: { Lens: v.tele } }] });
    expect(cs.body.lines[0].picks).toEqual({ Lens: v.tele });
    expect(cs.body.quote.lines[0].subtotal.amount).toBe(9000);
    const terms = (await shop().get('/api/v1/storefront/settings')).body.terms.hash;
    const done = await shop().post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Kit Renter', email: 'kit@test.dev' }, terms_accepted: true, terms_hash: terms });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const o = (await admin.get(`/api/v1/orders/${done.body.order.id}`)).body;
    expect(childVariants(o)).toEqual([[v.battery, 2], [v.body, 1], [v.tele, 1]].sort());
  });
});
