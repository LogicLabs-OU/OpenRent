import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { tenancy } from '@openrent/core';
import { scramVerifier, withSystem } from '@openrent/db';
import { Client, databaseForTests, shopForTests, startApp, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Reads the database as a BI login would (SET ROLE stands in for signing in as it). */
async function asLogin<T>(url: string, role: string, fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`GRANT "${role}" TO current_user`).catch(() => undefined);
    await c.query(`SET ROLE "${role}"`);
    return await fn(c);
  } finally {
    await c.query('RESET ROLE').catch(() => undefined);
    await c.end();
  }
}

/** FR-REP-5: reporting views for BI tools, each login reading its own shop only. */
suite('data access for BI tools', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;
  const roles: string[] = [];

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!, { OPENRENT_BI_HOST: 'db.example.test', OPENRENT_BI_PORT: '6543' }));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Drill', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } });
    variant = p.body.variants[0].id;
    const loc = (await admin.get('/api/v1/locations')).body.data[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${loc}`, { quantity: 4 });
    const start = new Date(Date.now() + 2 * 86400_000);
    start.setUTCHours(9, 0, 0, 0);
    const customer = await admin.post('/api/v1/customers', { name: 'Report Reader', email: 'reader@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: customer.body.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: variant, quantity: 2 }], deposit: { mode: 'none' } });
    const reserved = await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);
  }, 120_000);
  afterAll(async () => {
    for (const r of roles) await withSystem(t.deps.db, (c) => c.query(`DROP ROLE IF EXISTS "${r}"`)).catch(() => undefined);
    await t?.close();
    await dbinfo?.stop();
  });

  it('makes a login that reads this shop’s views and nothing else', async () => {
    const before = await admin.get('/api/v1/bi_access');
    expect(before.body).toMatchObject({ available: true, problem: null, connection: { host: 'db.example.test', port: 6543 }, data: [] });
    expect(before.body.views).toContain('bi.utilisation_daily');

    expect((await admin.post('/api/v1/bi_access', { name: ' ' })).body.errors[0].field).toBe('name');
    const made = await admin.post('/api/v1/bi_access', { name: 'Metabase' });
    expect(made.status).toBe(201);
    expect(made.body.username).toMatch(/^openrent_bi_[0-9a-f]{12}$/);
    expect(made.body.password.length).toBeGreaterThanOrEqual(30);
    roles.push(made.body.username);
    // The password is shown once.
    const listed = (await admin.get('/api/v1/bi_access')).body.data;
    expect(listed).toEqual([expect.objectContaining({ name: 'Metabase', username: made.body.username })]);
    expect(JSON.stringify(listed)).not.toContain(made.body.password);

    // A second shop with its own order.
    const other = await withSystem(t.deps.db, (c) => tenancy.runSetup(c, { owner: { email: 'bi-other@test.dev', password: 'other-pass-123', name: 'Other' }, tenant: { name: 'Other Rentals', currency: 'EUR', timezone: 'UTC' }, location: { name: 'Elsewhere' } } as any, { livemode: false }));
    await withSystem(t.deps.db, (c) => c.query(`INSERT INTO customers (id, tenant_id, name) VALUES ('cus_bi_other', $1, 'Someone else')`, [other.tenantId]));

    // On PostgreSQL itself (not PGlite), the login signs in with its password.
    if (dbinfo!.real) {
      const u = new URL(dbinfo!.url);
      u.username = made.body.username;
      u.password = made.body.password;
      const direct = new pg.Client({ connectionString: u.toString() });
      await direct.connect();
      expect((await direct.query(`SELECT id FROM shop`)).rows).toEqual([{ id: tenantId }]);
      await direct.end();
    }

    await asLogin(dbinfo!.url, made.body.username, async (c) => {
      expect((await c.query(`SELECT id FROM bi.shop`)).rows).toEqual([{ id: tenantId }]);
      const orders = (await c.query(`SELECT number, status, total, currency FROM bi.orders`)).rows;
      expect(orders).toEqual([expect.objectContaining({ status: 'reserved', currency: 'EUR' })]);
      expect(Number(orders[0].total)).toBeGreaterThan(0);
      expect((await c.query(`SELECT quantity FROM bi.order_lines WHERE type = 'rental'`)).rows).toEqual([{ quantity: 2 }]);
      const used = (await c.query(`SELECT capacity, booked_unit_hours, utilisation FROM bi.utilisation_daily WHERE variant_id = $1 AND booked_unit_hours > 0 ORDER BY day`, [variant])).rows;
      expect(used.length).toBeGreaterThanOrEqual(1);
      expect(used.reduce((s, r) => s + Number(r.booked_unit_hours), 0)).toBeCloseTo(48, 1);
      expect(used[0].capacity).toBe(4);
      // The other shop's customer is not there, whatever the session says.
      await c.query(`SELECT set_config('app.tenant_id', $1, false), set_config('app.system', 'on', false)`, [other.tenantId]);
      expect((await c.query(`SELECT id FROM bi.customers WHERE id = 'cus_bi_other'`)).rows).toEqual([]);
      expect((await c.query(`SELECT count(*)::int AS n FROM bi.shop`)).rows[0].n).toBe(1);
      // No tables, and no writing.
      await expect(c.query(`SELECT * FROM public.orders`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`SELECT * FROM public.users`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`UPDATE bi.orders SET status = 'cancelled'`)).rejects.toThrow(/permission denied|cannot|read-only/);
      await expect(c.query(`SELECT openrent_user_in_other_shops('x'::text, 'y'::text)`)).rejects.toThrow(/permission denied|does not exist/);
    });
  });

  it('rotates the password, stops a revoked login and keeps to five', async () => {
    const [login] = (await admin.get('/api/v1/bi_access')).body.data;
    const verifier = async () => (await withSystem(t.deps.db, (c) => c.query(`SELECT rolpassword FROM pg_authid WHERE rolname = $1`, [login.username]).catch(() => ({ rows: [] })))).rows[0]?.rolpassword;
    const old = await verifier();
    const rotated = await admin.post(`/api/v1/bi_access/${login.id}/actions/rotate`, {});
    expect(rotated.status).toBe(200);
    expect(rotated.body.password).toBeTruthy();
    if (old) {
      expect(old).toMatch(/^SCRAM-SHA-256\$4096:/);
      expect(await verifier()).not.toBe(old);
    }
    expect(rotated.body.rotated_at).toBeTruthy();

    const revoked = await admin.del(`/api/v1/bi_access/${login.id}`);
    expect(revoked.status).toBe(200);
    expect((await withSystem(t.deps.db, (c) => c.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [login.username]))).rows).toEqual([]);
    const audit = (await admin.get('/api/v1/audit_log?filter[entity_type]=bi_login')).body.data.map((a: any) => a.action);
    expect(audit.sort()).toEqual(['create', 'revoke', 'rotate']);

    for (let i = 0; i < 5; i++) roles.push((await admin.post('/api/v1/bi_access', { name: `Tool ${i}` })).body.username);
    const sixth = await admin.post('/api/v1/bi_access', { name: 'One too many' });
    expect([sixth.status, sixth.body.code]).toEqual([409, 'bi_login_limit']);
    // Staff do not see logins that read everything.
    await admin.post('/api/v1/users', { email: 'bi-staff@test.dev', name: 'Staff', role: 'staff', password: 'staff-pass-123' });
    const staff = new Client(t.app);
    await staff.post('/api/v1/auth/login', { email: 'bi-staff@test.dev', password: 'staff-pass-123' });
    expect((await staff.get('/api/v1/bi_access')).status).toBe(403);
  });

  it('makes no logins when the operator turned data access off, and still revokes', async () => {
    const off = await startApp(dbinfo!.url, 1, { OPENRENT_BI_ACCESS: 'off' });
    try {
      const c = new Client(off.app);
      await c.post('/api/v1/auth/login', { email: 'owner@test.dev', password: 'password123' });
      const state = (await c.get('/api/v1/bi_access')).body;
      expect(state).toMatchObject({ available: false, problem: { code: 'bi_off' }, connection: null });
      expect((await c.post('/api/v1/bi_access', { name: 'Power BI' })).body.code).toBe('bi_off');
      const r = await c.del(`/api/v1/bi_access/${state.data[0].id}`);
      expect(r.status).toBe(200);
    } finally {
      await off.close();
    }
  });

  it('writes verifiers PostgreSQL accepts', () => {
    // RFC 7677's password and salt; the expected value was worked out with Python's hashlib and hmac.
    expect(scramVerifier('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'))).toBe(
      'SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=',
    );
  });
});
