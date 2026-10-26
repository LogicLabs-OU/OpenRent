import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { domains, notifications, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('custom storefront domains', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  const dns = { txt: new Map<string, string[]>(), cname: new Map<string, string[]>() };
  const resolver: domains.Resolver = { txt: async (n) => dns.txt.get(n) ?? [], cname: async (n) => dns.cname.get(n) ?? [] };
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>, now = new Date()) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now, plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://localhost:7072', livemode: false }, logger: quietLogger }),
    );

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('adds a domain and checks it against DNS', async () => {
    expect((await admin.post('/api/v1/storefront_domains', { hostname: 'not a domain' })).body.errors[0]).toMatchObject({ field: 'hostname', code: 'invalid' });
    expect((await admin.post('/api/v1/storefront_domains', { hostname: 'localhost' })).status).toBe(422);
    const d = await admin.post('/api/v1/storefront_domains', { hostname: 'https://Rent.Example.com/' });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ hostname: 'rent.example.com', status: 'pending', is_primary: true, dns: { txt: { name: '_openrent.rent.example.com', value: expect.stringMatching(/^openrent-verify=/) }, cname: { name: 'rent.example.com', target: 'localhost' } } });
    expect((await admin.post('/api/v1/storefront_domains', { hostname: 'rent.example.com' })).body.errors[0]).toMatchObject({ field: 'hostname', code: 'taken' });

    // Nothing in DNS yet: it keeps waiting and says what is missing.
    const miss = await inTenant((ctx) => domains.verifyDomain(ctx, d.body.id, resolver));
    expect(miss).toMatchObject({ status: 'pending', last_error: expect.stringContaining('_openrent.rent.example.com') });
    expect(await withSystem(t.deps.db, (c) => domains.tenantByHost(c, 'rent.example.com'))).toBeNull();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/system/domain_check?domain=rent.example.com' })).statusCode).toBe(404);

    dns.txt.set('_openrent.rent.example.com', [d.body.dns.txt.value]);
    expect((await inTenant((ctx) => domains.verifyDomain(ctx, d.body.id, resolver))).status).toBe('verified');
    expect(await withSystem(t.deps.db, (c) => domains.tenantByHost(c, 'RENT.example.com'))).toBe(tenantId);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/system/domain_check?domain=rent.example.com' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/system/domain_check?domain=localhost' })).statusCode).toBe(200);
    const events = await withSystem(t.deps.db, (c) => c.query(`SELECT 1 FROM outbox WHERE event_type = 'storefront_domain.verified'`));
    expect(events.rows).toHaveLength(1);

    // A CNAME to the installation also proves it.
    const other = await admin.post('/api/v1/storefront_domains', { hostname: 'www.rent.example.com' });
    expect(other.body.is_primary).toBe(false);
    dns.cname.set('www.rent.example.com', ['localhost.']);
    expect((await inTenant((ctx) => domains.verifyDomain(ctx, other.body.id, resolver))).status).toBe('verified');
    expect((await admin.post(`/api/v1/storefront_domains/${other.body.id}/actions/make_primary`)).body.is_primary).toBe(true);
    expect((await admin.get('/api/v1/storefront_domains')).body.data.filter((x: any) => x.is_primary).map((x: any) => x.id)).toEqual([other.body.id]);
  });

  it('serves the shop on its domain and links to it', async () => {
    const shop = await t.app.inject({ method: 'GET', url: '/api/v1/storefront/settings', headers: { 'x-storefront-host': 'www.rent.example.com' } });
    expect(shop.statusCode).toBe(200);
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Paddle', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 500 } });
    await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${locationId}`, { quantity: 4 });
    const c = await admin.post('/api/v1/customers', { name: 'Domain Fan', email: 'domain@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(2), ends_at: isoIn(3), lines: [{ variant_id: p.body.variants[0].id, quantity: 1 }] });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    const data = await inTenant((ctx) => notifications.orderMessageData(ctx, o.body.id));
    expect(data.order_url).toMatch(/^https:\/\/www\.rent\.example\.com\/order\//);
  });

  it('gives up on a domain that never shows up in DNS, and removes domains', async () => {
    const d = await admin.post('/api/v1/storefront_domains', { hostname: 'never.example.org' });
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(await inTenant((ctx) => domains.verifyPending(ctx, resolver), later)).toBe(1);
    expect((await admin.get('/api/v1/storefront_domains')).body.data.find((x: any) => x.id === d.body.id).status).toBe('failed');

    const list = (await admin.get('/api/v1/storefront_domains')).body.data;
    const primary = list.find((x: any) => x.is_primary);
    expect((await admin.del(`/api/v1/storefront_domains/${primary.id}`)).status).toBe(204);
    // The other verified domain takes over in emails.
    expect((await admin.get('/api/v1/storefront_domains')).body.data.find((x: any) => x.is_primary).hostname).toBe('rent.example.com');
    expect(await withSystem(t.deps.db, (c) => domains.tenantByHost(c, 'www.rent.example.com'))).toBeNull();
  });
});
