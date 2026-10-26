import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Accessories, related products and "often rented with" (FR-CAT-7). */
suite('product relations', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  const p: Record<'kayak' | 'paddle' | 'helmet' | 'map' | 'secret', any> = {} as any;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    const make = async (name: string, type: string, visibility = 'public') => {
      const r = await admin.post('/api/v1/products', { type, name, tracking: 'bulk', visibility, price: { kind: type === 'rental' ? 'per_period' : 'fixed', period_unit: 'day', amount: 1000 } });
      await admin.put(`/api/v1/stock_levels/${r.body.variants[0].id}/${locationId}`, { quantity: 20 });
      return r.body;
    };
    p.kayak = await make('Kayak', 'rental');
    p.paddle = await make('Paddle', 'rental');
    p.helmet = await make('Helmet', 'rental');
    p.map = await make('River map', 'sale');
    p.secret = await make('Staff-only spare', 'rental', 'hidden');
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('keeps the accessories and related products staff choose', async () => {
    const r = await admin.put(`/api/v1/products/${p.kayak.id}/relations`, { accessory: [p.paddle.id, p.helmet.id, p.secret.id, p.kayak.id], related: [p.map.id] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // The product itself is left out.
    expect(r.body.accessory.map((x: any) => x.name)).toEqual(['Paddle', 'Helmet', 'Staff-only spare']);
    expect(r.body.related.map((x: any) => x.name)).toEqual(['River map']);
    const bad = await admin.put(`/api/v1/products/${p.kayak.id}/relations`, { related: ['prd_missing'] });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'related']);
  });

  it('works out what is often rented together from bookings', async () => {
    const customer = (await admin.post('/api/v1/customers', { name: 'Paddler' })).body.id;
    for (const day of [3, 6]) {
      const o = await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(day), ends_at: isoIn(day + 1), lines: [{ variant_id: p.kayak.variants[0].id }, { variant_id: p.map.variants[0].id }] });
      await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    }
    // One booking is not enough.
    const once = await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(9), ends_at: isoIn(10), lines: [{ variant_id: p.kayak.variants[0].id }, { variant_id: p.helmet.variants[0].id }] });
    await admin.post(`/api/v1/orders/${once.body.id}/actions/reserve`, { notify: false });
    expect(await inTenant((ctx) => catalog.computeOftenRentedWith(ctx))).toBe(2);
    const r = (await admin.get(`/api/v1/products/${p.map.id}/relations`)).body;
    expect(r.often_rented_with.map((x: any) => [x.name, x.score])).toEqual([['Kayak', 2]]);
  });

  it('offers public accessories and related products in the storefront', async () => {
    const r = (await shop().get(`/api/v1/storefront/catalog/products/${p.kayak.slug}`)).body;
    expect(r.accessories.map((x: any) => [x.name, x.variant_id])).toEqual([['Paddle', p.paddle.variants[0].id], ['Helmet', p.helmet.variants[0].id]]);
    expect(r.accessories[0].price.description).toContain('10');
    // The map is related by staff and often rented with the kayak: shown once.
    expect(r.related.map((x: any) => x.name)).toEqual(['River map']);
    // Deleting a product takes its relations with it.
    expect((await admin.del(`/api/v1/products/${p.secret.id}`)).status).toBe(204);
    expect((await admin.get(`/api/v1/products/${p.kayak.id}/relations`)).body.accessory.map((x: any) => x.name)).toEqual(['Paddle', 'Helmet']);
  });
});
