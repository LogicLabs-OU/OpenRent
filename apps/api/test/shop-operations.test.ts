import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '@openrent/db';
import { postAccounting } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;
const KEY = 'operator-key-for-tests-0123456789';

/** Managed cloud (PRD §10.1): sign-up, limits per shop, suspending and erasing a shop. */
suite('shop operations', () => {
  let t: TestApp;
  let admin: Client;
  let b: Client;
  let shopB: { tenant_id: string; slug: string };
  const op = (method: string, url: string, body?: unknown, key = KEY) => new Client(t.app).req(method, `/api/v1/operator${url}`, body, key ? { 'x-operator-key': key } : {});
  const signup = (email: string, password: string, name = 'Bike Hire') =>
    new Client(t.app).post('/api/v1/signup', { owner: { email, password, name: 'Owner B' }, tenant: { name, currency: 'EUR', timezone: 'Europe/Tallinn' }, location: { name: 'Depot' } });

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!, {
      OPENRENT_MODE: 'multi_tenant',
      OPENRENT_SIGNUP: '1',
      OPENRENT_OPERATOR_KEY: KEY,
      OPENRENT_DEFAULT_LIMITS: JSON.stringify({ orders_per_month: 2, plugins: 1 }),
    }));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('opens shops by sign-up, never in someone else’s name', async () => {
    expect((await new Client(t.app).get('/api/v1/signup')).body).toEqual({ object: 'signup_status', enabled: true });
    // An email with an account signs in instead, whatever password is given.
    const taken = await signup('owner@test.dev', 'password123');
    expect([taken.status, taken.body.errors[0].field]).toEqual([422, 'owner.email']);

    b = new Client(t.app);
    const res = await b.post('/api/v1/signup', { owner: { email: 'b@test.dev', password: 'password-b-123', name: 'Owner B' }, tenant: { name: 'Bike Hire', currency: 'EUR', timezone: 'Europe/Tallinn' }, location: { name: 'Depot' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    shopB = res.body;
    expect(shopB.slug).toBe('bike-hire');
    expect((await b.get('/api/v1/auth/me')).body.tenant).toMatchObject({ slug: 'bike-hire', status: 'active' });
    expect((await signup('c@test.dev', 'password-c-123')).body.slug).toBe('bike-hire-2');
  });

  it('keeps a shop within its limits', async () => {
    const customer = (await b.post('/api/v1/customers', { name: 'Rider', email: 'rider@test.dev' })).body.id;
    const variant = (await b.post('/api/v1/products', { type: 'rental', name: 'Bike', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 1500 } })).body.variants[0].id;
    const order = () => b.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(5), ends_at: isoIn(6), lines: [{ variant_id: variant, quantity: 1 }] });
    expect((await order()).status).toBe(201);
    expect((await order()).status).toBe(201);
    const third = await order();
    expect([third.status, third.body.code]).toEqual([402, 'plan_limit']);
    expect((await b.get('/api/v1/tenant/usage')).body).toMatchObject({ limits: { orders_per_month: 2, plugins: 1 }, usage: { orders_this_month: 2, plugins_enabled: 0 } });
    expect((await b.patch('/api/v1/plugins/rates-ecb', { enabled: true })).status).toBe(200);
    expect((await b.patch('/api/v1/plugins/analytics', { enabled: true })).status).toBe(402);

    // The operator lifts the order limit; the first shop (made by setup) has none.
    expect((await op('GET', '/shops', undefined, 'wrong')).status).toBe(401);
    const shops = (await op('GET', '/shops')).body.data;
    expect(shops.map((s: any) => s.slug)).toEqual(['test-rentals', 'bike-hire', 'bike-hire-2']);
    expect(shops[0].limits).toEqual({});
    expect((await op('PATCH', `/shops/${shopB.tenant_id}`, { limits: { orders_per_month: null } })).body.limits).toEqual({ orders_per_month: null, plugins: 1 });
    expect((await order()).status).toBe(201);
  });

  it('suspends a shop: admin and storefront stop, other shops go on', async () => {
    const s = await op('POST', `/shops/${shopB.tenant_id}/actions/suspend`, { reason: 'Unpaid invoice' });
    expect(s.body).toMatchObject({ status: 'suspended', suspended_reason: 'Unpaid invoice' });
    const blocked = await b.get('/api/v1/products');
    expect([blocked.status, blocked.body.code]).toEqual([403, 'shop_suspended']);
    expect((await b.get('/api/v1/auth/me')).body.tenant).toMatchObject({ status: 'suspended', suspended_reason: 'Unpaid invoice' });
    expect((await new Client(t.app, { 'x-tenant-slug': 'bike-hire' }).get('/api/v1/storefront/settings')).status).toBe(403);
    expect((await admin.get('/api/v1/products')).status).toBe(200);
    await op('POST', `/shops/${shopB.tenant_id}/actions/resume`);
    expect((await b.get('/api/v1/products')).status).toBe(200);
  });

  it('erases a suspended shop with everything in it, append-only records too', async () => {
    // An issued invoice and its accounting entries, which can otherwise never be removed.
    const o = (await b.get('/api/v1/orders')).body.data[0];
    expect((await b.post(`/api/v1/orders/${o.id}/actions/reserve`, {})).status).toBe(200);
    expect((await b.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' })).status).toBe(201);
    await postAccounting(t.deps, quietLogger as any);
    const count = (table: string) => withSystem(t.deps.db, async (c) => Number((await c.query(`SELECT count(*) FROM ${table} WHERE tenant_id = $1`, [shopB.tenant_id])).rows[0].count));
    expect(await count('accounting_entries')).toBeGreaterThan(0);
    expect(await count('audit_log')).toBeGreaterThan(0);

    expect((await op('DELETE', `/shops/${shopB.tenant_id}?confirm=bike-hire`)).status).toBe(409);
    await op('POST', `/shops/${shopB.tenant_id}/actions/suspend`, {});
    expect((await op('DELETE', `/shops/${shopB.tenant_id}?confirm=nope`)).status).toBe(422);
    const erased = await op('DELETE', `/shops/${shopB.tenant_id}?confirm=bike-hire`);
    expect([erased.status, erased.body.object], JSON.stringify(erased.body)).toEqual([200, 'erased_shop']);

    const left = await withSystem(t.deps.db, async (c) => {
      const tables = (await c.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped WHERE n.nspname = 'public' AND c.relkind = 'r'`)).rows;
      const out: Record<string, number> = {};
      for (const { relname } of tables) {
        const n = Number((await c.query(`SELECT count(*) FROM "${relname}" WHERE tenant_id = $1`, [shopB.tenant_id])).rows[0].count);
        if (n) out[relname] = n;
      }
      return out;
    });
    expect(left).toEqual({});
    const rest = await withSystem(t.deps.db, async (c) => ({
      tenants: (await c.query(`SELECT slug FROM tenants ORDER BY created_at`)).rows.map((r) => r.slug),
      users: (await c.query(`SELECT email FROM users ORDER BY email`)).rows.map((r) => r.email),
    }));
    expect(rest).toEqual({ tenants: ['test-rentals', 'bike-hire-2'], users: ['c@test.dev', 'owner@test.dev'] });
    expect((await b.get('/api/v1/products')).status).toBe(401);
  });
});
