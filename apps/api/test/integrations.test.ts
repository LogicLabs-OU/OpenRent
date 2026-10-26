import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { definePlugin } from '@openrent/plugin-sdk';
import { withTenant } from '@openrent/db';
import { publishOutbox, runIntegrationTasks } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/**
 * The integrations framework end to end, with a fixture accounting integration against a local mock
 * of an OAuth server and an accounting API: connect, events become tasks, retries, token refresh,
 * catch-up, disconnect; plus the journal export.
 */
suite('integrations framework', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let server: Server;
  let base = '';
  let connectionId: string;
  let orderId: string;
  const mock = {
    challenge: '', codes: new Set<string>(), refreshes: 0, ttl: 3600, failNext: 0,
    calls: [] as { path: string; body: any; auth: string }[], tokens: new Set<string>(),
    // A second provider in the CRM style: credentials in the token request body, its own token word.
    dealTokens: new Set<string>(), deals: [] as { body: any; auth: string }[],
  };

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      const url = new URL(req.url!, base);
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/token') {
        const p = new URLSearchParams(raw);
        const basic = Buffer.from(String(req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString();
        if (basic !== 'books-client:books-secret') return send(401, { error: 'invalid_client' });
        if (p.get('grant_type') === 'authorization_code') {
          if (!mock.codes.delete(p.get('code')!) || createHash('sha256').update(p.get('code_verifier')!).digest('base64url') !== mock.challenge) return send(400, { error: 'invalid_grant' });
        } else if (p.get('grant_type') === 'refresh_token') {
          mock.refreshes++;
          if (!p.get('refresh_token')?.startsWith('r-')) return send(400, { error: 'invalid_grant' });
        }
        const access = `a-${randomUUID()}`;
        mock.tokens.add(access);
        return send(200, { access_token: access, refresh_token: `r-${randomUUID()}`, token_type: 'Bearer', expires_in: mock.ttl });
      }
      if (url.pathname === '/eu/token') {
        const p = new URLSearchParams(raw);
        if (req.headers.authorization || p.get('client_id') !== 'deals-client' || p.get('client_secret') !== 'deals-secret' || !mock.codes.delete(p.get('code')!)) return send(401, { error: 'invalid_client' });
        const access = `d-${randomUUID()}`;
        mock.dealTokens.add(access);
        return send(200, { access_token: access, refresh_token: `r-${randomUUID()}`, expires_in: 3600 });
      }
      if (url.pathname === '/deals') {
        const auth = String(req.headers.authorization ?? '');
        if (!auth.startsWith('Deal-token ') || !mock.dealTokens.has(auth.slice(11))) return send(401, { error: 'unauthorized' });
        mock.deals.push({ body: JSON.parse(raw), auth });
        return send(200, { id: `deal-${mock.deals.length}` });
      }
      const auth = String(req.headers.authorization ?? '');
      if (!mock.tokens.has(auth.replace('Bearer ', ''))) return send(401, { error: 'unauthorized' });
      if (url.pathname === '/org') return send(200, { name: 'Ada Books Ltd', id: 'org-1' });
      mock.calls.push({ path: url.pathname, body: raw ? JSON.parse(raw) : null, auth });
      if (mock.failNext > 0) {
        mock.failNext--;
        return send(503, { error: 'busy' });
      }
      return send(200, { id: `remote-${mock.calls.length}` });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // A small accounting integration, like the Xero and QuickBooks plugins, against the mock.
    await t.deps.plugins.register(
      definePlugin({
        id: 'books', name: 'Books', version: '1.0.0', compat: '^1.2.0',
        settings: [{ key: 'client_id', label: 'Client ID', type: 'text' }, { key: 'client_secret', label: 'Client secret', type: 'secret' }],
        setup(api) {
          api.setDefaultConfig({ client_id: 'books-client', client_secret: 'books-secret' });
          api.registerIntegration({
            id: 'books', name: 'Books', category: 'other',
            auth: { type: 'oauth2', authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token`, scopes: ['books'], clientIdSetting: 'client_id', clientSecretSetting: 'client_secret' },
            events: ['document.issued', 'payment.succeeded'],
            settings: [{ key: 'sales_account', label: 'Sales account', type: 'text' }],
            async onConnected(ctx, params) {
              const org = await (await ctx.fetch(`${base}/org`)).json();
              return { accountName: org.name, account: { org: org.id, region: params.region ?? null } };
            },
            async handle(ctx, task) {
              if (task.object.type === 'document') {
                const inv = await ctx.data.accounting.invoice(task.object.id);
                if (!inv) return { status: 'skipped', message: 'not an invoice' };
                const res = await ctx.fetch(`${base}/invoices`, { method: 'POST', body: JSON.stringify({ ...inv, account: ctx.connection.settings.sales_account ?? null }) });
                if (!res.ok) throw new Error(`Books said ${res.status}`);
                await ctx.links.set('document', inv.id, (await res.json()).id);
                return { status: 'done', message: `Invoice ${inv.number} sent` };
              }
              const p = await ctx.data.accounting.payment(task.object.id);
              const inv = p?.invoice_id ? await ctx.links.get('document', p.invoice_id) : null;
              if (!inv) throw new Error('invoice not sent yet');
              const res = await ctx.fetch(`${base}/payments`, { method: 'POST', body: JSON.stringify({ invoice: inv.remoteId, amount: p!.amount }) });
              if (!res.ok) throw new Error(`Books said ${res.status}`);
              return { status: 'done', message: 'Payment sent' };
            },
          });
        },
      }),
    );
    const customer = (await admin.post('/api/v1/customers', { name: 'Ada Customer', email: 'ada@books.test', company_name: 'Ada Ltd' })).body.id;
    const v = (await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
    orderId = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(5), ends_at: isoIn(7), lines: [{ variant_id: v, quantity: 1 }] })).body.id;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  /** Moves events to tasks and runs what is due, like the worker does every minute. */
  const work = async () => {
    await publishOutbox(t.deps, quietLogger);
    return runIntegrationTasks(t.deps, quietLogger);
  };
  const log = async () => (await admin.get(`/api/v1/integration_connections/${connectionId}/tasks`)).body.data;
  const backdate = () => withTenant(t.deps.db, tenantId, (c) => c.query(`UPDATE integration_tasks SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`));

  it('lists the integration and connects with OAuth (PKCE), keeping what the provider sent back', async () => {
    const list = (await admin.get('/api/v1/integrations')).body;
    expect(list.data.find((i: any) => i.id === 'books')).toMatchObject({ category: 'other', auth: 'oauth2', ready: true, connection: null });
    expect(list.redirect_uri).toBe('http://localhost:7070/api/v1/integrations/oauth/callback');
    const start = await admin.post('/api/v1/integrations/books/connect', {});
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const auth = new URL(start.body.authorize_url);
    expect(auth.origin + auth.pathname).toBe(`${base}/authorize`);
    expect([auth.searchParams.get('client_id'), auth.searchParams.get('code_challenge_method'), auth.searchParams.get('scope')]).toEqual(['books-client', 'S256', 'books']);
    mock.challenge = auth.searchParams.get('code_challenge')!;
    // The provider sends the browser back with a code (and here an extra value).
    const code = randomUUID();
    mock.codes.add(code);
    const back = await new Client(t.app).get(`/api/v1/integrations/oauth/callback?code=${code}&state=${auth.searchParams.get('state')}&region=eu`);
    expect([back.status, back.headers.location]).toEqual([302, 'http://localhost:7070/admin/integrations?connected=books']);
    const conn = (await admin.get('/api/v1/integrations')).body.data.find((i: any) => i.id === 'books').connection;
    expect(conn).toMatchObject({ status: 'connected', account_name: 'Ada Books Ltd' });
    connectionId = conn.id;
    // The same link does not work twice.
    expect((await new Client(t.app).get(`/api/v1/integrations/oauth/callback?code=${code}&state=${auth.searchParams.get('state')}`)).headers.location).toContain('integration_error=');
    // Credentials never leave the server.
    expect(JSON.stringify((await admin.get(`/api/v1/integration_connections/${connectionId}`)).body)).not.toMatch(/a-[0-9a-f-]{36}|r-[0-9a-f-]{36}/);
  });

  it('turns events into tasks and brings an issued invoice across once, with settings', async () => {
    await admin.patch(`/api/v1/integration_connections/${connectionId}`, { settings: { sales_account: '4000', not_a_setting: 'x' } });
    expect((await admin.get(`/api/v1/integration_connections/${connectionId}`)).body.settings).toEqual({ sales_account: '4000' });
    // A quote is not an invoice: skipped.
    await admin.post(`/api/v1/orders/${orderId}/documents`, { type: 'quote' });
    await admin.post(`/api/v1/orders/${orderId}/documents`, { type: 'invoice' });
    expect(await work()).toBe(2);
    const entries = await log();
    expect(entries.map((e: any) => [e.event, e.status])).toEqual([['document.issued', 'done'], ['document.issued', 'skipped']]);
    const sent = mock.calls.find((c) => c.path === '/invoices')!.body;
    expect(sent).toMatchObject({ type: 'invoice', currency: 'EUR', contact: { name: 'Ada Customer', company_name: 'Ada Ltd', email: 'ada@books.test' }, account: '4000', net_total: 10000, tax_total: 2000, total: 12000 });
    expect(sent.lines[0]).toMatchObject({ kind: 'rental', quantity: 1, net_amount: 10000, tax_amount: 2000, tax_rate_bp: 2000 });
    // Publishing again queues nothing new.
    expect(await work()).toBe(0);
  });

  it('retries a failing task with growing waits, then succeeds; staff can retry by hand', async () => {
    mock.failNext = 1;
    await admin.post(`/api/v1/orders/${orderId}/payments`, { amount: 12000, method: 'cash' });
    await work();
    let pay = (await log()).find((e: any) => e.event === 'payment.succeeded');
    expect([pay.status, pay.attempts, pay.message]).toEqual(['pending', 1, 'Books said 503']);
    expect(new Date(pay.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect((await admin.get(`/api/v1/integration_connections/${connectionId}`)).body).toMatchObject({ status: 'error', last_error: 'Books said 503' });
    // Not yet due: nothing runs. Staff retry it now.
    expect(await runIntegrationTasks(t.deps, quietLogger)).toBe(0);
    expect((await admin.post(`/api/v1/integration_tasks/${pay.id}/actions/retry`, {})).body.status).toBe('pending');
    await work();
    pay = (await log()).find((e: any) => e.event === 'payment.succeeded');
    expect([pay.status, pay.message]).toEqual(['done', 'Payment sent']);
    expect(mock.calls.filter((c) => c.path === '/payments').at(-1)!.body).toEqual({ invoice: expect.stringMatching(/^remote-/), amount: 12000 });
    expect((await admin.get(`/api/v1/integration_connections/${connectionId}`)).body.status).toBe('connected');
  });

  it('refreshes an expired token before calling, and keeps the new one even when the call fails', async () => {
    await withTenant(t.deps.db, tenantId, async (c) => {
      const { rows } = await c.query(`SELECT credentials_encrypted FROM integration_connections WHERE id = $1`, [connectionId]);
      const creds = JSON.parse(t.deps.secrets.decrypt(rows[0].credentials_encrypted));
      await c.query(`UPDATE integration_connections SET credentials_encrypted = $2 WHERE id = $1`, [connectionId, t.deps.secrets.encrypt(JSON.stringify({ ...creds, expires_at: Date.now() - 1000 }))]);
    });
    const before = mock.refreshes;
    mock.failNext = 1;
    await admin.post(`/api/v1/orders/${orderId}/payments`, { amount: 100, method: 'cash' });
    await work();
    expect(mock.refreshes).toBe(before + 1);
    // The refreshed token was saved although the task failed: the next run does not refresh again.
    await backdate();
    await work();
    expect(mock.refreshes).toBe(before + 1);
    expect((await log()).filter((e: any) => e.status === 'done' && e.event === 'payment.succeeded')).toHaveLength(2);
  });

  it('catches up on what happened before connecting, skipping what was sent', async () => {
    const r = await admin.post(`/api/v1/integration_connections/${connectionId}/actions/catch_up`, { from: isoIn(-30) });
    expect(r.body.queued).toBe(3);
    await work();
    const caught = (await log()).filter((e: any) => e.status === 'done' || e.status === 'skipped');
    expect(caught.length).toBeGreaterThanOrEqual(6);
    expect((await admin.post(`/api/v1/integration_connections/${connectionId}/actions/catch_up`, { from: isoIn(-30) })).body.queued).toBe(0);
  });

  it('writes a balanced double-entry journal', async () => {
    const j = (await admin.get(`/api/v1/accounting/journal?from=${encodeURIComponent(isoIn(-1))}&to=${encodeURIComponent(isoIn(1))}`)).body.data;
    const debit = j.reduce((s: number, r: any) => s + r.debit, 0);
    const credit = j.reduce((s: number, r: any) => s + r.credit, 0);
    expect(debit).toBe(credit);
    expect(j.filter((r: any) => r.entry.startsWith('INV')).map((r: any) => [r.account, r.debit, r.credit])).toEqual([['1200', 12000, 0], ['4000', 0, 10000], ['2200', 0, 2000]]);
    const csv = await admin.get(`/api/v1/accounting/journal?from=${encodeURIComponent(isoIn(-1))}&to=${encodeURIComponent(isoIn(1))}&format=csv`);
    expect(String(csv.body)).toContain('1200');
    expect(String(csv.body)).toContain('120.00');
  });

  it('disconnects: credentials go, pending work stops, a new event queues nothing', async () => {
    expect((await admin.del(`/api/v1/integration_connections/${connectionId}`)).status).toBe(204);
    await admin.post(`/api/v1/orders/${orderId}/payments`, { amount: 50, method: 'cash' });
    const calls = mock.calls.length;
    await work();
    expect(mock.calls.length).toBe(calls);
    const row = await withTenant(t.deps.db, tenantId, async (c) => (await c.query(`SELECT status, credentials_encrypted FROM integration_connections WHERE id = $1`, [connectionId])).rows[0]);
    expect(row).toEqual({ status: 'disconnected', credentials_encrypted: null });
    expect((await admin.get('/api/v1/integrations')).body.data.find((i: any) => i.id === 'books').connection).toBeNull();
  });

  it('connects a CRM that wants its credentials in the body, its own token word and a region in the URLs, and reads bookings', async () => {
    await t.deps.plugins.register(
      definePlugin({
        id: 'deals', name: 'Deals', version: '1.0.0', compat: '^1.3.0',
        settings: [{ key: 'client_id', label: 'Client ID', type: 'text' }, { key: 'client_secret', label: 'Client secret', type: 'secret' }, { key: 'region', label: 'Region', type: 'text' }],
        setup(api) {
          api.setDefaultConfig({ client_id: 'deals-client', client_secret: 'deals-secret', region: 'eu' });
          api.registerIntegration({
            id: 'deals', name: 'Deals', category: 'crm',
            auth: {
              type: 'oauth2', authorizeUrl: `${base}/{region}/authorize`, tokenUrl: `${base}/{region}/token`, clientAuth: 'body', tokenPrefix: 'Deal-token',
              scopes: ['deals'], clientIdSetting: 'client_id', clientSecretSetting: 'client_secret',
            },
            events: ['order.created'],
            async handle(ctx, task) {
              const o = await ctx.data.order(task.object.id);
              if (!o) return { status: 'skipped', message: 'no order' };
              const res = await ctx.fetch(`${base}/deals`, { method: 'POST', body: JSON.stringify({ number: o.number, email: o.contact?.email, total: o.total, location: o.location.name, lines: o.lines }) });
              if (!res.ok) throw new Error(`Deals said ${res.status}`);
              return { status: 'done', message: `Deal #${o.number}` };
            },
          });
        },
      }),
    );
    const start = await admin.post('/api/v1/integrations/deals/connect', {});
    const auth = new URL(start.body.authorize_url);
    expect(auth.pathname).toBe('/eu/authorize');
    const code = randomUUID();
    mock.codes.add(code);
    const back = await new Client(t.app).get(`/api/v1/integrations/oauth/callback?code=${code}&state=${auth.searchParams.get('state')}`);
    expect(back.headers.location).toBe('http://localhost:7070/admin/integrations?connected=deals');

    const customer = (await admin.post('/api/v1/customers', { name: 'Grace Hopper', email: 'grace@deals.test' })).body.id;
    const v = (await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } })).body.variants[0].id;
    const order = (await admin.post('/api/v1/orders', { customer_id: customer, starts_at: isoIn(3), ends_at: isoIn(4), lines: [{ variant_id: v, quantity: 2 }] })).body;
    await work();
    const sent = mock.deals.find((d) => d.body.number === order.number)!;
    expect(sent.auth).toMatch(/^Deal-token d-/);
    expect(sent.body).toMatchObject({ email: 'grace@deals.test', total: order.totals.total.amount, lines: [{ description: 'Tent', quantity: 2, product_id: expect.any(String) }] });
    expect(sent.body.location).toBeTruthy();
  });
});
