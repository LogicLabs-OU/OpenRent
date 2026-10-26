import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hookContext, refusePluginSql, type Ctx } from '@openrent/core';
import { migratePlugins, withSystem, withTenant } from '@openrent/db';
import { definePlugin, HookVeto, type PluginScope } from '@openrent/plugin-sdk';
import { runPluginSchedule } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('plugin platform: scope, migrations, hooks, providers and schedules', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let variant: string;
  const seen: Record<string, unknown[]> = {};
  let lastScope: PluginScope | undefined;
  const note = (k: string, v: unknown) => (seen[k] ??= []).push(v);
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    await t.deps.plugins.register(
      definePlugin({
        id: 'loyalty',
        name: 'Loyalty',
        version: '1.0.0',
        compat: '^1.1.0',
        migrations: [{ name: '0001_points', sql: 'CREATE TABLE plg_loyalty_points (id text PRIMARY KEY, tenant_id text NOT NULL, order_id text NOT NULL, points int NOT NULL)' }],
        setup(api) {
          api.after('payments.record', async (payment: any, ctx) => {
            lastScope = ctx.scope;
            await ctx.scope!.db.query(`INSERT INTO plg_loyalty_points (id, tenant_id, order_id, points) VALUES ($1, $2, $3, $4)`, [payment.id, ctx.tenantId, payment.order_id, Math.floor(payment.amount.amount / 100)]);
            await ctx.scope!.events.emit('plugin.loyalty.points_added', { order_id: payment.order_id });
          });
          api.before('payments.record', (p: any) => {
            if (p.amount > 1_000_000) throw new HookVeto('over_till_limit', 'Take payments over 10,000 by bank transfer');
          });
          api.before('documents.render', async (p: any, ctx) => {
            const r = await ctx.scope!.db.query<{ n: number }>(`SELECT coalesce(sum(points), 0)::int AS n FROM plg_loyalty_points WHERE order_id = $1`, [p.order_id]);
            p.data.loyalty_points = r.rows[0]!.n;
          });
          api.registerTaxProvider({ id: 'flat-tax', isConfigured: () => true, rates: async (_c, req) => { note('tax', req); return Object.fromEntries(req.lines.map((l) => [l.key, 500])); } });
          api.registerIdentityProvider({ id: 'id-check', isConfigured: () => true, check: async (_c, req) => (req.customer.email?.startsWith('ok') ? { status: 'verified', ref: 'idv_1' } : { status: 'pending', url: 'https://id.example/start' }) });
          api.registerSearchProvider({ id: 'smart-search', isConfigured: () => true, search: async (_c, req) => { note('search', req.q); return seen.ids?.at(-1) as string[] ?? []; } });
          api.schedule('nightly', '0 2 * * *', async (ctx) => {
            note('schedule', ctx.tenantId);
            await ctx.scope!.db.query(`DELETE FROM plg_loyalty_points WHERE points < 0`);
          });
        },
      }),
    );
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Surfboard', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 5 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('applies a plugin’s migration once and puts its table under row-level security', async () => {
    const first = await migratePlugins(dbinfo!.url, t.deps.plugins.migrations);
    expect(first).toEqual({ applied: ['loyalty/0001_points'], refused: [] });
    expect((await migratePlugins(dbinfo!.url, t.deps.plugins.migrations)).applied).toEqual([]);
    const rls = await withSystem(t.deps.db, (c) => c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'plg_loyalty_points'`));
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const bad = await migratePlugins(dbinfo!.url, [{ pluginId: 'loyalty', migrations: [{ name: '0002_bad', sql: 'ALTER TABLE orders ADD COLUMN points int' }] }]);
    expect(bad.refused[0]).toMatchObject({ name: '0002_bad' });
  });

  it('gives hooks a guarded database, events and the missing hooks', async () => {
    const c = await admin.post('/api/v1/customers', { name: 'Loyal One', email: 'loyal@test.dev', addresses: { billing: { city: 'Tartu', country: 'EE' }, shipping: { line1: '1 Dock St', city: 'Pärnu', country: 'EE' } } });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(2), ends_at: isoIn(3), lines: [{ variant_id: variant, quantity: 1 }] });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });

    // The tax plugin set 5 % on every line; the engine priced with it.
    expect(o.body.lines[0].tax.amount).toBe(200);
    expect((seen.tax![0] as any).lines[0]).toMatchObject({ productId: expect.any(String), defaultRateBp: 2000 });
    // The delivery address goes to the tax service, ahead of the billing one.
    expect((seen.tax![0] as any).customer).toMatchObject({ country: 'EE', address: { city: 'Pärnu' } });

    const veto = await admin.post(`/api/v1/orders/${o.body.id}/payments`, { amount: 2_000_000, method: 'cash' });
    expect(veto.status).toBe(422);
    expect(veto.body.code).toBe('over_till_limit');
    expect((await admin.post(`/api/v1/orders/${o.body.id}/payments`, { amount: 4200, method: 'cash' })).status).toBe(201);
    const points = await withSystem(t.deps.db, (db) => db.query(`SELECT points FROM plg_loyalty_points WHERE order_id = $1`, [o.body.id]));
    expect(points.rows).toEqual([{ points: 42 }]);
    const ev = await withSystem(t.deps.db, (db) => db.query(`SELECT 1 FROM outbox WHERE event_type = 'plugin.loyalty.points_added'`));
    expect(ev.rows).toHaveLength(1);

    const doc = await admin.post(`/api/v1/orders/${o.body.id}/documents`, { type: 'invoice' });
    const full = await admin.get(`/api/v1/documents/${doc.body.id}`);
    expect(full.body.data.loyalty_points).toBe(42);

    // Outside the plugin's own tables, writes and session changes are refused.
    await expect(inTenant(async (ctx) => hookContext(ctx).scopeFor!('loyalty').db.query(`UPDATE orders SET notes = '{}'`))).rejects.toThrow(/own plg_loyalty_ tables/);
    await expect(lastScope!.events.emit('order.updated', {})).rejects.toThrow(/plugin\.loyalty\./);
    expect(refusePluginSql('loyalty', "SELECT set_config('app.system', 'on', true)")).toMatch(/session/);
    expect(refusePluginSql('loyalty', 'SET ROLE postgres')).toMatch(/only SELECT/);
    expect(refusePluginSql('loyalty', 'SELECT 1; DROP TABLE orders')).toMatch(/one statement/);
    expect(refusePluginSql('loyalty', `INSERT INTO plg_loyalty_points VALUES ('a','b','c',1) ON CONFLICT (id) DO UPDATE SET points = 2`)).toBeNull();
    expect(refusePluginSql('loyalty', `SELECT * FROM orders WHERE notes::text = 'update customers set x = 1' FOR UPDATE`)).toBeNull();
  });

  it('checks ID before pickup through the identity plugin', async () => {
    const pending = await admin.post('/api/v1/customers', { name: 'New Face', email: 'new@test.dev', flags: { requires_id_check: true } });
    const o = await admin.post('/api/v1/orders', { customer_id: pending.body.id, starts_at: isoIn(0, 23), ends_at: isoIn(2), lines: [{ variant_id: variant, quantity: 1 }] });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    const refused = await admin.post(`/api/v1/orders/${o.body.id}/actions/check_out`, {});
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'id_check_required', url: 'https://id.example/start' });

    const known = await admin.post('/api/v1/customers', { name: 'Known Face', email: 'ok-known@test.dev', flags: { requires_id_check: true } });
    const o2 = await admin.post('/api/v1/orders', { customer_id: known.body.id, starts_at: isoIn(0, 23), ends_at: isoIn(2), lines: [{ variant_id: variant, quantity: 1 }] });
    await admin.post(`/api/v1/orders/${o2.body.id}/actions/reserve`, { notify: false });
    expect((await admin.post(`/api/v1/orders/${o2.body.id}/actions/check_out`, {})).status).toBe(200);
    expect((await admin.get(`/api/v1/customers/${known.body.id}`)).body.flags.id_verified).toBe(true);

    // Staff can tick "ID checked" themselves.
    await admin.patch(`/api/v1/customers/${pending.body.id}`, { flags: { requires_id_check: true, id_verified: true } });
    expect((await admin.post(`/api/v1/orders/${o.body.id}/actions/check_out`, {})).status).toBe(200);
  });

  it('searches the storefront through the search plugin, then runs schedules per shop', async () => {
    const products = (await admin.get('/api/v1/products')).body.data;
    note('ids', [products[0].id, 'prod_missing']);
    const r = await t.app.inject({ method: 'GET', url: '/api/v1/storefront/catalog/products?q=anything' });
    expect(r.json().data.map((p: any) => p.id)).toEqual([products[0].id]);
    expect(seen.search).toEqual(['anything']);

    await runPluginSchedule(t.deps, quietLogger, t.deps.plugins.schedules.find((s) => s.name === 'nightly')!);
    expect(seen.schedule).toEqual([tenantId]);
    // A shop that turned the plugin off is skipped, and so are its hooks.
    await admin.patch('/api/v1/plugins/loyalty', { enabled: false });
    await t.deps.plugins.refreshEnablement();
    await runPluginSchedule(t.deps, quietLogger, t.deps.plugins.schedules.find((s) => s.name === 'nightly')!);
    expect(seen.schedule).toHaveLength(1);
    const plain = await admin.post('/api/v1/price_quote', { starts_at: isoIn(4), ends_at: isoIn(5), lines: [{ variant_id: variant, quantity: 1 }] });
    expect(plain.body.lines[0].tax_rate_bp).toBe(2000);
  });
});
