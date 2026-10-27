import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth } from '@openrent/core';
import { MIGRATIONS_DIR, migrate } from '@openrent/db';
import { Client, databaseForTests, isoIn, startApp, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;
const releases = JSON.parse(await readFile(fileURLToPath(new URL('../../../packages/db/releases.json', import.meta.url)), 'utf8'));
const lastOfPrevious: string = releases.releases[releases.previous];

/**
 * Definition of done (PRD §11.2): a database from the previous release, with data in it, upgrades to
 * this release's schema, and this release's code works with that data. New columns must have defaults
 * or allow null, and new rules must accept old rows.
 */
suite(`upgrade from ${releases.previous}`, () => {
  let t: TestApp;
  let dir: string;
  const ids = { tenant: 'ten_old', user: 'usr_old', location: 'loc_old', product: 'prd_old', variant: 'var_old', customer: 'cus_old', order: 'ord_old' };

  beforeAll(async () => {
    const c = new pg.Client({ connectionString: dbinfo!.url });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    // The previous release's migrations only.
    dir = await mkdtemp(path.join(tmpdir(), 'openrent-n1-'));
    for (const f of await readdir(MIGRATIONS_DIR)) if (f.endsWith('.sql') && f <= lastOfPrevious) await cp(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    await migrate(dbinfo!.url, { dir, log: () => undefined });

    // Data as the previous release wrote it: a shop, its owner, a product with stock, a customer, an order.
    await c.query(`SELECT set_config('app.system', 'on', false), set_config('app.tenant_id', $1, false)`, [ids.tenant]);
    await c.query(`INSERT INTO tenants (id, slug, name, currency, timezone) VALUES ($1, 'old-shop', 'Old Shop', 'EUR', 'Europe/Tallinn')`, [ids.tenant]);
    await c.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1, 'old@test.dev', 'Old Owner', $2)`, [ids.user, await auth.hashPassword('old-password-1')]);
    await c.query(`INSERT INTO memberships (id, tenant_id, user_id, role) VALUES ('mem_old', $1, $2, 'owner')`, [ids.tenant, ids.user]);
    await c.query(`INSERT INTO locations (id, tenant_id, name, timezone, is_default) VALUES ($1, $2, 'Old depot', 'Europe/Tallinn', true)`, [ids.location, ids.tenant]);
    await c.query(`INSERT INTO tax_profiles (id, tenant_id, name, rates, is_default) VALUES ('tax_old', $1, 'VAT 20%', '[{"name":"VAT","rate_bp":2000}]', true)`, [ids.tenant]);
    await c.query(`INSERT INTO products (id, tenant_id, type, name, slug, visibility) VALUES ($1, $2, 'rental', 'Canoe', 'canoe', 'public')`, [ids.product, ids.tenant]);
    await c.query(`INSERT INTO variants (id, tenant_id, product_id, name, tracking) VALUES ($1, $2, $3, 'Default', 'bulk')`, [ids.variant, ids.tenant, ids.product]);
    await c.query(`INSERT INTO stock_levels (tenant_id, variant_id, location_id, quantity) VALUES ($1, $2, $3, 4)`, [ids.tenant, ids.variant, ids.location]);
    await c.query(`INSERT INTO customers (id, tenant_id, name, email, tax_id) VALUES ($1, $2, 'Old Customer', 'customer@old.test', 'EE100000001')`, [ids.customer, ids.tenant]);
    await c.query(
      `INSERT INTO orders (id, tenant_id, number, location_id, customer_id, starts_at, ends_at, timezone, currency, public_token, status)
       VALUES ($1, $2, 1001, $3, $4, $5, $6, 'Europe/Tallinn', 'EUR', 'oldtoken0123456789abcdef', 'draft')`,
      [ids.order, ids.tenant, ids.location, ids.customer, isoIn(10), isoIn(12)],
    );
    // The previous release numbered orders from its sequence, as this one does.
    await c.query(`INSERT INTO order_sequences (tenant_id, next_value) VALUES ($1, 1002)`, [ids.tenant]);
    await c.query(`INSERT INTO order_lines (id, tenant_id, order_id, type, variant_id, product_id, description, quantity) VALUES ('oln_old', $1, $2, 'rental', $3, $4, 'Canoe', 1)`, [ids.tenant, ids.order, ids.variant, ids.product]);
    await c.end();

    // This release's migrations on top, then this release's code.
    const r = await migrate(dbinfo!.url, { log: () => undefined });
    expect(r.applied.length).toBeGreaterThan(0);
    t = await startApp(dbinfo!.url, dbinfo!.real ? 5 : 1);
  }, 180_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('signs in and reads what the previous release stored', async () => {
    const owner = new Client(t.app);
    expect((await owner.post('/api/v1/auth/login', { email: 'old@test.dev', password: 'old-password-1' })).status).toBe(200);
    const me = (await owner.get('/api/v1/auth/me')).body;
    expect(me.tenant).toMatchObject({ slug: 'old-shop', status: 'active' });
    const order = (await owner.get(`/api/v1/orders/${ids.order}`)).body;
    expect([order.number, order.status, order.lines.length]).toEqual([1001, 'draft', 1]);
    const customer = (await owner.get(`/api/v1/customers/${ids.customer}`)).body;
    expect(customer).toMatchObject({ tax_id: 'EE100000001', tax_id_check: null });
    expect((await owner.get('/api/v1/tenant/usage')).body.limits).toEqual({});
    expect((await owner.get('/api/v1/tenant/settings')).status).toBe(200);
  });

  it('keeps working with that data: new orders, the storefront and the books', async () => {
    const owner = new Client(t.app);
    await owner.post('/api/v1/auth/login', { email: 'old@test.dev', password: 'old-password-1' });
    const o = await owner.post('/api/v1/orders', { customer_id: ids.customer, starts_at: isoIn(20), ends_at: isoIn(21), lines: [{ variant_id: ids.variant, quantity: 2, amount: 2500 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect((await owner.post(`/api/v1/orders/${o.body.id}/actions/reserve`, {})).status).toBe(200);
    const sf = new Client(t.app, { 'x-tenant-slug': 'old-shop' });
    expect((await sf.get('/api/v1/storefront/settings')).status).toBe(200);
    expect((await sf.get('/api/v1/storefront/catalog/products')).body.data.map((p: any) => p.slug)).toEqual(['canoe']);
  });
});
