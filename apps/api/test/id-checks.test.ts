import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customers, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { startVeriffFake, type VeriffFake } from '@openrent/identity-fakes';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** ID checks with an outside service (FR-PAY-9): pickup waits until the customer is verified. */
suite('ID checks', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let fake: VeriffFake;
  let customer: any;
  let order: any;
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: t.deps.config as any, logger: quietLogger }));
  const webhook = (body: string, signature: string) => t.app.inject({ method: 'POST', url: `/webhooks/identity/identity-veriff/${tenantId}`, headers: { 'content-type': 'application/json', 'x-hmac-signature': signature }, payload: body });

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    fake = await startVeriffFake({ apiKey: 'vk-1', secret: 'vs-1' });
    const variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'E-bike', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 3 });
    await admin.patch('/api/v1/plugins/identity-veriff', { config: { api_key: 'vk-1', shared_secret: 'vs-1', api_url: fake.url } });
    customer = (await admin.post('/api/v1/customers', { name: 'Ida Check', email: 'ida@test.dev', flags: { requires_id_check: true } })).body;
    order = (await admin.post('/api/v1/orders', { customer_id: customer.id, starts_at: isoIn(1), ends_at: isoIn(2), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${order.id}/actions/reserve`, { notify: false });
  }, 120_000);

  afterAll(async () => {
    await fake?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('emails the link when the booking is reserved, and holds the pickup until then', async () => {
    const r = await admin.post(`/api/v1/orders/${order.id}/actions/check_out`, {});
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'id_check_required', url: expect.stringContaining('veriff.com/v/') });
    const c = (await admin.get(`/api/v1/customers/${customer.id}`)).body;
    expect(c.id_check).toMatchObject({ required: true, verified: false, status: 'pending', url: r.body.url });
    const mail = (await withSystem(t.deps.db, (db) => db.query(`SELECT subject, body_html FROM notifications WHERE template_key = 'id_check'`))).rows;
    expect(mail).toHaveLength(1);
    expect(mail[0].body_html).toContain(r.body.url);
    // Trying again shows the same link and sends nothing more.
    expect((await admin.post(`/api/v1/orders/${order.id}/actions/check_out`, {})).body.url).toBe(r.body.url);
    expect((await withSystem(t.deps.db, (db) => db.query(`SELECT 1 FROM notifications WHERE template_key = 'id_check'`))).rows).toHaveLength(1);
    expect(fake.sessions.size).toBe(1);
  });

  it('lets pickup through once the service approves, by signed webhook', async () => {
    const ref = (await withSystem(t.deps.db, (db) => db.query(`SELECT flags->'id_check'->>'ref' AS ref FROM customers WHERE id = $1`, [customer.id]))).rows[0].ref;
    fake.approve(ref);
    const { body, signature } = fake.webhook(ref);
    expect((await webhook(body, 'f'.repeat(64))).statusCode).toBe(401);
    const ok = await webhook(body, signature);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'verified' });
    expect((await admin.get(`/api/v1/customers/${customer.id}`)).body).toMatchObject({ flags: { id_verified: true }, id_check: { verified: true, status: 'verified', url: null } });
    expect((await admin.post(`/api/v1/orders/${order.id}/actions/check_out`, {})).body.status).toBe('out');
  });

  it('records a declined check found by asking, and staff can send a new link', async () => {
    const other = (await admin.post('/api/v1/customers', { name: 'Olle Other', email: 'olle@test.dev', flags: { requires_id_check: true } })).body;
    const started = await admin.post(`/api/v1/customers/${other.id}/actions/start_id_check`, {});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body).toMatchObject({ object: 'id_check', status: 'pending', url: expect.any(String) });
    const ref = (await withSystem(t.deps.db, (db) => db.query(`SELECT flags->'id_check'->>'ref' AS ref FROM customers WHERE id = $1`, [other.id]))).rows[0].ref;
    fake.decline(ref, 'Document expired');
    expect(await inTenant((ctx) => customers.syncIdentityChecks(ctx))).toBe(1);
    expect((await admin.get(`/api/v1/customers/${other.id}`)).body.id_check).toMatchObject({ status: 'failed', reason: 'Document expired', url: null });
  });
});
