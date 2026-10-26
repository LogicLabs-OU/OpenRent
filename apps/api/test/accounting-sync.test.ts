import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrations, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { startXeroFake, type XeroFake } from '@openrent/accounting-fakes';
import { postAccounting, publishOutbox, runIntegrationTasks } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/**
 * Accounting sync end to end (ADR 0009): the real Xero plugin against the Xero fake, through the API
 * and the worker jobs. Setup (app credentials, OAuth, organisation, mapping from Xero's own lists,
 * start), bookings that issue their invoice, payments, deposits, what came back from Xero, what changed
 * there, rate limits and a revoked sign-in.
 */
suite('accounting sync with Xero', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let fake: XeroFake;
  let variant: string;

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );
  /** What the worker does every minute: book, publish, send. */
  const work = async () => {
    await postAccounting(t.deps, quietLogger);
    await publishOutbox(t.deps, quietLogger);
    await runIntegrationTasks(t.deps, quietLogger);
    await withSystem(t.deps.db, (db) => db.query(`UPDATE integration_tasks SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending' AND message LIKE '%not in Xero yet%'`));
    await runIntegrationTasks(t.deps, quietLogger);
  };
  const org = () => fake.orgs[1]!;
  const order = async (deposit = 0) => {
    const c = await admin.post('/api/v1/customers', { name: `Ada ${Date.now()}`, email: `ada-${Date.now()}@test.dev` });
    const o = (await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(5), ends_at: isoIn(7), lines: [{ variant_id: variant, quantity: 1 }], deposit: { mode: 'fixed', amount: deposit } })).body;
    return o;
  };

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    fake = await startXeroFake();
    variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
  }, 120_000);

  afterAll(async () => {
    await fake?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('sets up: app credentials, sign-in, the second organisation, a mapping from Xero’s lists, start', async () => {
    const before = (await admin.get('/api/v1/accounting/systems')).body.data.find((s: any) => s.id === 'xero');
    expect(before).toMatchObject({ ready: false, has_lookups: true, maps_taxes: true });
    await admin.post('/api/v1/accounting/systems/xero/app', { config: { client_id: 'xero-client', client_secret: 'xero-secret', api_base_url: fake.url, auth_base_url: fake.url } });
    const start = await admin.post('/api/v1/accounting/systems/xero/connect', {});
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    // The fake signs the user in at once and sends the browser back with a code.
    const auth = await fetch(start.body.authorize_url, { redirect: 'manual' });
    const back = new URL(auth.headers.get('location')!);
    const done = await new Client(t.app).get(`${back.pathname}${back.search}`);
    expect(done.headers.location).toBe('http://localhost:7070/admin/accounting?connected=xero');

    let conn = (await admin.get('/api/v1/accounting/connection')).body;
    expect(conn.organisations.map((o: any) => o.name)).toEqual(['Kayak Hire Ltd', 'Kayak Hire Events Ltd']);
    conn = (await admin.post('/api/v1/accounting/connection/actions/choose_organisation', { organisation_id: org().tenantId })).body;
    expect(conn).toMatchObject({ account_name: 'Kayak Hire Events Ltd', organisation_id: org().tenantId, sync_enabled: false });

    const lookups = (await admin.get('/api/v1/accounting/connection/lookups')).body;
    const byCode = (code: string) => [...lookups.accounts, ...lookups.paymentAccounts].find((a: any) => a.code === code).id;
    // Starting before the mapping is complete says what is missing, next to each choice.
    const early = await admin.post('/api/v1/accounting/connection/actions/start_sync', { from: '2000-01-01' });
    expect(early.status).toBe(422);
    expect(early.body.errors.map((e: any) => e.field)).toEqual(expect.arrayContaining(['mapping.accounts.revenue_rental', 'mapping.payment_accounts.bank', 'mapping.taxes.2000', 'mapping.taxes.0']));
    // An account of the wrong type is refused.
    const wrong = await admin.put('/api/v1/accounting/connection/mapping', { mapping: { 'accounts.deposits': byCode('201') } });
    expect(wrong.status).toBe(422);
    expect(wrong.body.errors[0]).toMatchObject({ field: 'mapping.accounts.deposits', code: 'wrong_type' });
    const saved = await admin.put('/api/v1/accounting/connection/mapping', {
      mapping: {
        'accounts.revenue_rental': byCode('201'), 'accounts.revenue_other': byCode('260'), 'accounts.revenue_damage': byCode('205'), 'accounts.deposits': byCode('835'),
        'payment_accounts.bank': byCode('090'), 'payment_accounts.cash': byCode('091'), 'payment_accounts.card_clearing': byCode('092'), 'taxes.2000': 'OUTPUT2', 'taxes.0': 'NONE',
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await admin.get('/api/v1/accounting/connection/check')).body).toMatchObject({ ready: true, errors: [] });
    const started = await admin.post('/api/v1/accounting/connection/actions/start_sync', { from: new Date().toISOString().slice(0, 10) });
    expect(started.body).toMatchObject({ sync_enabled: true });
    await admin.patch('/api/v1/accounting/settings', { invoice_when: 'reserved' });
  });

  it('books a reservation: its invoice is issued and reaches Xero, then the card payment is applied', async () => {
    const o = await order();
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await admin.post(`/api/v1/orders/${o.id}/payments`, { amount: 12000, method: 'card' });
    await work();
    const inv = org().docs.find((d) => d.reference === `#${o.number}`)!;
    expect([inv.total, inv.due, inv.status]).toEqual([120, 0, 'PAID']);
    const records = (await admin.get('/api/v1/accounting/records')).body.data.filter((r: any) => r.order_id === o.id);
    expect(records.map((r: any) => [r.kind, r.status])).toEqual([['payment', 'sent'], ['invoice', 'sent']]);
    expect(records.find((r: any) => r.kind === 'invoice').remote).toMatchObject({ url: expect.stringContaining('go.xero.com'), total: 12000, mismatch: false });
  });

  it('attaches the issued invoice PDF when the shop turns it on', async () => {
    const settings = (await admin.get('/api/v1/accounting/connection')).body.settings;
    expect((await admin.patch('/api/v1/accounting/connection', { settings: { ...settings, attach_pdf: true } })).status).toBe(200);
    try {
      const o = await order();
      await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
      await work();
      const inv = org().docs.find((d) => d.reference === `#${o.number}`)!;
      expect(inv.attachments).toEqual([{ name: expect.stringMatching(/^invoice-.+\.pdf$/), type: 'application/pdf', size: expect.any(Number) }]);
      expect(inv.attachments[0]!.size).toBeGreaterThan(1000);
      const task = (await admin.get('/api/v1/accounting/connection/tasks')).body.data.find((x: any) => /with its PDF$/.test(x.message ?? ''));
      expect(task).toBeTruthy();
    } finally {
      await admin.patch('/api/v1/accounting/connection', { settings });
    }
  }, 60_000);

  it('sends the deposit cycle as bank transactions and a journal', async () => {
    const o = await order(10000);
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    const dep = (await admin.get(`/api/v1/orders/${o.id}?expand=deposits`)).body.deposits[0];
    await admin.post(`/api/v1/deposits/${dep.id}/actions/authorize`, { method: 'cash' });
    await admin.post(`/api/v1/deposits/${dep.id}/actions/capture`, { amount: 1500 });
    await work();
    const kinds = (await admin.get('/api/v1/accounting/records')).body.data.filter((r: any) => r.order_id === o.id).map((r: any) => [r.kind, r.status]);
    expect(kinds).toEqual(expect.arrayContaining([['deposit_received', 'sent'], ['deposit_applied', 'sent'], ['deposit_returned', 'sent']]));
    expect(org().bankTransactions.filter((b) => b.type !== 'RECEIVE-OVERPAYMENT').map((b) => [b.type, b.total])).toEqual(expect.arrayContaining([['RECEIVE', 100], ['SPEND', 85]]));
  });

  it('brings back a payment entered in Xero without sending it back', async () => {
    await admin.patch('/api/v1/accounting/connection', { settings: { import_payments: true } });
    const o = await order();
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await work();
    const inv = org().docs.find((d) => d.reference === `#${o.number}`)!;
    fake.payInXero(org().tenantId, inv.id, 40);
    const payments = org().payments.length;
    expect(await inTenant((ctx) => integrations.records.importRemotePayments(ctx))).toBe(1);
    await work();
    const pays = (await admin.get(`/api/v1/orders/${o.id}?expand=payments`)).body.payments;
    expect(pays.map((p: any) => [p.amount.amount, p.method])).toEqual([[4000, 'bank_transfer']]);
    expect(org().payments.length).toBe(payments);
    expect(await inTenant((ctx) => integrations.records.importRemotePayments(ctx))).toBe(0);
  });

  it('finds an invoice voided in Xero and tells staff', async () => {
    const o = await order();
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await work();
    const inv = org().docs.find((d) => d.reference === `#${o.number}`)!;
    fake.voidInXero(org().tenantId, inv.id);
    expect(await inTenant((ctx) => integrations.records.checkRemote(ctx))).toBeGreaterThanOrEqual(1);
    const mismatched = (await admin.get('/api/v1/accounting/records?status=mismatch')).body.data;
    expect(mismatched.find((r: any) => r.order_id === o.id)).toMatchObject({ kind: 'invoice', remote: { status: 'voided', mismatch: true } });
    const notices = (await admin.get('/api/v1/me/notifications')).body.data;
    expect(notices.find((n: any) => n.kind === 'staff_accounting_issue')).toBeTruthy();
    expect((await admin.get('/api/v1/accounting/overview')).body.counts.mismatches).toBeGreaterThanOrEqual(1);
  });

  it('waits when Xero says to slow down, and asks to reconnect when access is revoked', async () => {
    const o = await order();
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    fake.rateLimit(50, 30);
    await work();
    fake.rateLimit(0);
    let conn = (await admin.get('/api/v1/accounting/connection')).body;
    expect(conn.status).toBe('connected');
    const waiting = (await admin.get('/api/v1/accounting/connection/tasks?status=pending')).body.data;
    expect(waiting.some((t: any) => /slow down/.test(t.message))).toBe(true);

    fake.revoke();
    await withSystem(t.deps.db, (db) => db.query(`UPDATE integration_tasks SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`));
    await work();
    conn = (await admin.get('/api/v1/accounting/connection')).body;
    expect(conn).toMatchObject({ status: 'error', last_error: 'Xero needs to be connected again' });
    // Nothing failed: the work waits for the new sign-in.
    expect((await admin.get('/api/v1/accounting/connection/tasks?status=failed')).body.data).toEqual([]);
  });

  it('marks an entry as handled by hand, and refuses a second accounting system', async () => {
    const [rec] = (await admin.get('/api/v1/accounting/records?status=waiting')).body.data;
    expect((await admin.post(`/api/v1/accounting/records/${rec.entry_id}/actions/mark_handled`, { note: 'Booked by our accountant' })).status).toBe(200);
    const again = (await admin.get('/api/v1/accounting/records')).body.data.find((r: any) => r.entry_id === rec.entry_id);
    expect(again).toMatchObject({ status: 'manual', message: 'Booked by our accountant' });
    await admin.post('/api/v1/accounting/systems/quickbooks/app', { config: { client_id: 'q', client_secret: 'q' } });
    const second = await admin.post('/api/v1/accounting/systems/quickbooks/connect', {});
    expect([second.status, second.body.code]).toEqual([409, 'accounting_connected']);
  });
});
