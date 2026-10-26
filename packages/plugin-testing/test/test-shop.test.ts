import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '@openrent/plugin-sdk';
import { startTestShop, type TestShop } from '../src/index.ts';

/** The kit plugin authors use: a plugin with a table, a hook and a schedule, tested end to end. */
const counter = definePlugin({
  id: 'order-counter',
  name: 'Order counter',
  version: '1.0.0',
  compat: '^1.1.0',
  migrations: [{ name: '0001_counts', sql: 'CREATE TABLE plg_order_counter_counts (tenant_id text NOT NULL PRIMARY KEY, orders int NOT NULL DEFAULT 0)' }],
  setup(api) {
    api.before('orders.create', async (_input, ctx) => {
      await ctx.scope!.db.query(`INSERT INTO plg_order_counter_counts (tenant_id, orders) VALUES ($1, 1) ON CONFLICT (tenant_id) DO UPDATE SET orders = plg_order_counter_counts.orders + 1`, [ctx.tenantId]);
    });
    api.schedule('reset', '0 0 1 * *', async (ctx) => {
      await ctx.scope!.db.query(`UPDATE plg_order_counter_counts SET orders = 0`);
    });
  },
});

describe('plugin test shop', () => {
  let shop: TestShop;
  beforeAll(async () => {
    shop = await startTestShop({ plugins: [counter] });
  }, 120_000);
  afterAll(async () => shop?.close());

  it('runs the plugin’s hooks and schedules against a real API', async () => {
    const c = await shop.post('/api/v1/customers', { name: 'Kit Tester', email: 'kit@test.dev' });
    expect(c.status).toBe(201);
    expect((await shop.post('/api/v1/orders', { customer_id: c.body.id, starts_at: new Date(Date.now() + 86400_000).toISOString(), ends_at: new Date(Date.now() + 2 * 86400_000).toISOString(), lines: [] })).status).toBe(201);
    const count = () => shop.inShop(async (ctx) => (await ctx.db.query(`SELECT orders FROM plg_order_counter_counts`)).rows[0]?.orders);
    expect(await count()).toBe(1);
    await shop.runSchedule('order-counter', 'reset');
    expect(await count()).toBe(0);
  });
});
