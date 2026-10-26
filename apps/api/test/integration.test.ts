import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { tenancy, webhooks } from '@openrent/core';
import { withSystem } from '@openrent/db';
import { Client, databaseForTests, resetDatabase, startApp, type TestApp } from './harness.ts';
import { deliverWebhooks, publishOutbox, sendNotifications } from '../../worker/src/jobs.ts';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { SMTPServer } from 'smtp-server';
import { definePlugin, type CreatePaymentIntentInput, type PaymentProvider } from '@openrent/plugin-sdk';

const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** A local SMTP server that keeps every message it receives. */
async function smtpSink() {
  const mails: { to: string[]; raw: string }[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c: Buffer) => (raw += c.toString()));
      stream.on('end', () => {
        mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.server.address() as { port: number }).port;
  return { mails, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

const day = 86400_000;
const iso = (offsetDays: number, hour = 10) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

suite('OpenRent API against PostgreSQL', () => {
  let t: TestApp;
  let admin: Client;
  const ids: Record<string, any> = {};

  beforeAll(async () => {
    await resetDatabase(dbinfo!.url);
    t = await startApp(dbinfo!.url, dbinfo!.real ? 20 : 1);
    admin = new Client(t.app);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('runs first-time setup and signs the owner in', async () => {
    expect((await admin.get('/api/v1/setup')).body.required).toBe(true);
    const r = await admin.post('/api/v1/setup', {
      owner: { email: 'owner@test.dev', password: 'password123', name: 'Owner' },
      tenant: { name: 'Test Rentals', currency: 'EUR', timezone: 'Europe/Tallinn' },
      location: { name: 'Main shop' },
      tax: { name: 'VAT', rate_bp: 2000 },
    });
    expect(r.status).toBe(201);
    ids.tenant = r.body.tenant_id;
    ids.location = r.body.location_id;
    ids.pk = r.body.publishable_key;
    const me = await admin.get('/api/v1/auth/me');
    expect(me.body.role).toBe('owner');
    expect((await admin.post('/api/v1/setup', {})).status).toBeGreaterThanOrEqual(400);
    // Open all hours so tests are not sensitive to the clock.
    const loc = await admin.patch(`/api/v1/locations/${ids.location}`, { opening_hours: {} });
    expect(loc.status).toBe(200);
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const r = await admin.req('POST', '/api/v1/customers', { name: 'X' }, { 'x-csrf-token': 'wrong' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('csrf_failed');
  });

  it('creates serialised, bulk and bundle products with stock', async () => {
    const bike = await admin.post('/api/v1/products', { type: 'rental', name: 'Bike', tracking: 'serialized', deposit_amount: 5000, buffer_after_min: 60, price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
    expect(bike.status).toBe(201);
    ids.bike = bike.body.variants[0].id;
    const camera = await admin.post('/api/v1/products', { type: 'rental', name: 'Camera', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } });
    ids.camera = camera.body.variants[0].id;
    const chairs = await admin.post('/api/v1/products', { type: 'rental', name: 'Chair', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 100 } });
    ids.chair = chairs.body.variants[0].id;
    const kit = await admin.post('/api/v1/products', { type: 'bundle', name: 'Kit', bundle: { pricing_mode: 'sum', components: [{ variant_id: ids.bike, quantity: 1 }, { variant_id: ids.camera, quantity: 1 }] } });
    expect(kit.status).toBe(201);
    ids.kit = kit.body.variants[0].id;
    const units = await admin.post('/api/v1/stock_items/batch', { variant_id: ids.bike, count: 2 });
    expect(units.body.data.every((u: any) => u.ok)).toBe(true);
    ids.bikeUnits = units.body.data.map((u: any) => u.data);
    const cam = await admin.post('/api/v1/stock_items', { variant_id: ids.camera, barcode: 'CAM-1' });
    ids.camUnit = cam.body;
    expect((await admin.put(`/api/v1/stock_levels/${ids.chair}/${ids.location}`, { quantity: 10 })).status).toBe(200);
    const av = await admin.get(`/api/v1/availability?variant_id=${ids.kit}&from=${iso(1)}&to=${iso(2)}`);
    expect(av.body.available).toBe(1);
  });

  it('quotes prices deterministically', async () => {
    const q = await admin.post('/api/v1/price_quote', { starts_at: iso(1), ends_at: iso(3), lines: [{ variant_id: ids.bike, quantity: 2 }] });
    expect(q.status).toBe(200);
    expect(q.body.subtotal.amount).toBe(8000);
    expect(q.body.tax.amount).toBe(1600);
    expect(q.body.deposit.amount).toBe(10000);
  });

  it('runs an order through its whole lifecycle', async () => {
    const cus = await admin.post('/api/v1/customers', { name: 'Ann Renter', email: 'ann@test.dev' });
    ids.customer = cus.body.id;
    const o = await admin.post('/api/v1/orders', { customer_id: ids.customer, starts_at: iso(1), ends_at: iso(3), lines: [{ variant_id: ids.bike, quantity: 1 }, { variant_id: ids.chair, quantity: 4 }] });
    expect(o.status).toBe(201);
    expect(o.body.status).toBe('draft');
    expect(o.body.availability_check.every((a: any) => a.ok)).toBe(true);
    const id = o.body.id;
    ids.order = id;
    const bad = await admin.post(`/api/v1/orders/${id}/actions/check_out`, {});
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('invalid_transition');
    const res = await admin.post(`/api/v1/orders/${id}/actions/reserve`, {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('reserved');
    const prep = await admin.post(`/api/v1/orders/${id}/actions/prepare`, {});
    expect(prep.status).toBe(409);
    expect(prep.body.errors[0].code).toBe('units_unassigned');
    const wrong = await admin.post(`/api/v1/orders/${id}/actions/assign_units`, { barcodes: ['CAM-1'] });
    expect(wrong.body.code).toBe('wrong_item');
    const asg = await admin.post(`/api/v1/orders/${id}/actions/assign_units`, { barcodes: [ids.bikeUnits[0].barcode] });
    expect(asg.status).toBe(200);
    expect((await admin.post(`/api/v1/orders/${id}/actions/prepare`, {})).body.status).toBe('prepared');
    const outRes = await admin.post(`/api/v1/orders/${id}/actions/check_out`, { signature: { name: 'Ann Renter' } });
    expect(outRes.body.status).toBe('out');
    const unit = await admin.get(`/api/v1/stock_items/${ids.bikeUnits[0].id}`);
    expect(unit.body.status).toBe('out');
    const partial = await admin.post(`/api/v1/orders/${id}/actions/check_in`, { units: [{ barcode: ids.bikeUnits[0].barcode, outcome: 'needs_inspection' }] });
    if (partial.status !== 200) console.log('DEBUG', partial.body);
    expect(partial.body.status).toBe('returned_partial');
    const full = await admin.post(`/api/v1/orders/${id}/actions/check_in`, { lines: [{ line_id: partial.body.lines[1].id, returned: 4 }] });
    expect(full.body.status).toBe('returned');
    const closeEarly = await admin.post(`/api/v1/orders/${id}/actions/close`, {});
    expect(closeEarly.status).toBe(409);
    const insp = await admin.post(`/api/v1/orders/${id}/actions/inspect`, { units: [{ stock_item_id: ids.bikeUnits[0].id, status: 'available' }], damage_charges: [{ description: 'Scratched frame', amount: 1500 }] });
    expect(insp.body.status).toBe('inspected');
    const order = await admin.get(`/api/v1/orders/${id}?expand=deposits,damage_charges,documents`);
    expect(order.body.documents.map((d: any) => d.type).sort()).toEqual(['confirmation', 'contract']);
    const dep = order.body.deposits[0];
    expect(dep.status).toBe('pending');
    expect((await admin.post(`/api/v1/deposits/${dep.id}/actions/authorize`, { method: 'cash' })).body.status).toBe('held');
    const cap = await admin.post(`/api/v1/deposits/${dep.id}/actions/capture`, { amount: 1500, damage_charge_ids: [order.body.damage_charges[0].id] });
    expect(cap.body.status).toBe('partially_captured');
    const pay = await admin.post(`/api/v1/orders/${id}/payments`, { amount: order.body.totals.balance.amount, method: 'cash' });
    expect(pay.status).toBe(201);
    const closed = await admin.post(`/api/v1/orders/${id}/actions/close`, {});
    expect(closed.body.status).toBe('closed');
    expect(closed.body.payment_status).toBe('paid');
    const tl = await admin.get(`/api/v1/orders/${id}/timeline`);
    expect(tl.body.data.length).toBeGreaterThan(5);
  });

  it('never double-books a serialised unit (exclusion constraint)', async () => {
    const mk = () => admin.post('/api/v1/orders', { customer_id: ids.customer, starts_at: iso(10), ends_at: iso(12), lines: [{ variant_id: ids.camera, quantity: 1 }] });
    const a = await mk();
    const b = await mk();
    expect((await admin.post(`/api/v1/orders/${a.body.id}/actions/reserve`, {})).status).toBe(200);
    const second = await admin.post(`/api/v1/orders/${b.body.id}/actions/reserve`, {});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('exceeds_availability');
    // The database itself refuses overlapping unit allocations.
    await expect(
      withSystem(t.deps.db, (c) =>
        c.query(
          `INSERT INTO allocations (id, tenant_id, variant_id, location_id, stock_item_id, quantity, period, kind) VALUES ('alc_x1', $1, $2, $3, $4, 1, tstzrange($5, $6), 'reservation'),
                                                                                                                        ('alc_x2', $1, $2, $3, $4, 1, tstzrange($5, $6), 'reservation')`,
          [ids.tenant, ids.camera, ids.location, ids.camUnit.id, iso(20), iso(21)],
        ),
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('lets exactly one of many parallel checkouts win the last unit (FR-AV-10)', async () => {
    const n = dbinfo!.real ? 100 : 12;
    const drafts = [];
    for (let i = 0; i < n; i++) {
      drafts.push((await admin.post('/api/v1/orders', { customer_id: ids.customer, starts_at: iso(30), ends_at: iso(31), lines: [{ variant_id: ids.camera, quantity: 1 }] })).body.id);
    }
    const results = await Promise.all(drafts.map((id) => admin.post(`/api/v1/orders/${id}/actions/reserve`, {})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.code === 'exceeds_availability')).toHaveLength(n - 1);
  }, 120_000);

  it('never oversells a bulk pool under parallel load', async () => {
    const n = dbinfo!.real ? 40 : 8;
    const drafts = [];
    for (let i = 0; i < n; i++) drafts.push((await admin.post('/api/v1/orders', { customer_id: ids.customer, starts_at: iso(40), ends_at: iso(41), lines: [{ variant_id: ids.chair, quantity: 3 }] })).body.id);
    const results = await Promise.all(drafts.map((id) => admin.post(`/api/v1/orders/${id}/actions/reserve`, {})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    const av = await admin.get(`/api/v1/availability?variant_id=${ids.chair}&from=${iso(40)}&to=${iso(41)}`);
    expect(av.body.available).toBe(1);
  }, 120_000);

  it('replays idempotent POSTs and rejects key reuse with another body', async () => {
    const body = { name: 'Idem Customer', email: 'idem@test.dev' };
    const a = await admin.post('/api/v1/customers', body, { 'idempotency-key': 'key-1' });
    const b = await admin.post('/api/v1/customers', body, { 'idempotency-key': 'key-1' });
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    const c = await admin.post('/api/v1/customers', { ...body, name: 'Other' }, { 'idempotency-key': 'key-1' });
    expect(c.status).toBe(422);
    expect(c.body.code).toBe('idempotency_key_reused');
  });

  it('returns 412 when If-Match is stale', async () => {
    const o = await admin.post('/api/v1/orders', { customer_id: ids.customer, starts_at: iso(50), ends_at: iso(51), lines: [] });
    const r = await admin.patch(`/api/v1/orders/${o.body.id}`, { tags: ['x'] }, { 'if-match': `W/"${o.body.version + 5}"` });
    expect(r.status).toBe(412);
  });

  it('isolates tenants with row-level security', async () => {
    const other = await withSystem(t.deps.db, (c) =>
      tenancy.runSetup(c, { owner: { email: 'other@test.dev', password: 'password123', name: 'Other' }, tenant: { name: 'Other Shop', slug: 'other', currency: 'EUR', timezone: 'UTC' }, location: { name: 'X' } }, { livemode: false }),
    );
    const otherAdmin = new Client(t.app);
    expect((await otherAdmin.post('/api/v1/auth/login', { email: 'other@test.dev', password: 'password123' })).status).toBe(200);
    const list = await otherAdmin.get('/api/v1/orders');
    expect(list.body.data).toHaveLength(0);
    const peek = await otherAdmin.get(`/api/v1/orders/${ids.order}`);
    expect(peek.status).toBe(404);
    const spoof = await otherAdmin.get('/api/v1/orders', ) ;
    expect(spoof.status).toBe(200);
    const forbidden = await otherAdmin.req('GET', '/api/v1/orders', undefined, { 'x-tenant-id': ids.tenant });
    expect(forbidden.status).toBe(403);
    ids.otherTenant = other.tenantId;
  });

  it('authenticates secret keys with scopes and limits publishable keys to the storefront', async () => {
    const key = await admin.post('/api/v1/api_keys', { name: 'Read only', kind: 'secret', scopes: ['orders:read'] });
    const api = new Client(t.app, { authorization: `Bearer ${key.body.key}` });
    expect((await api.get('/api/v1/orders')).status).toBe(200);
    const denied = await api.post('/api/v1/customers', { name: 'Nope' });
    expect(denied.status).toBe(403);
    const pk = new Client(t.app, { authorization: `Bearer ${ids.pk}` });
    expect((await pk.get('/api/v1/orders')).status).toBe(403);
    expect((await pk.get('/api/v1/storefront/settings')).status).toBe(200);
  });

  it('books through the storefront checkout (pay at pickup)', async () => {
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const settings = await sf.get('/api/v1/storefront/settings');
    expect(settings.status).toBe(200);
    const catalog = await sf.get(`/api/v1/storefront/catalog/products?from=${iso(60)}&to=${iso(62)}`);
    expect(catalog.body.data.length).toBeGreaterThan(0);
    const bike = catalog.body.data.find((p: any) => p.name === 'Bike');
    expect(bike.variants[0].available).toBe(2);
    const cal = await sf.get(`/api/v1/storefront/availability?variant_id=${ids.bike}&month=${iso(60).slice(0, 7)}`);
    expect(cal.body.data.length).toBeGreaterThan(27);
    const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(60), ends_at: iso(62), lines: [{ variant_id: ids.bike, quantity: 1 }] });
    expect(cs.status).toBe(201);
    expect(cs.body.quote.total.amount).toBe(4800);
    const noTerms = await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Web Buyer', email: 'web@test.dev' }, terms_accepted: true, terms_hash: 'nope' });
    expect(noTerms.status).toBe(422);
    const done = await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Web Buyer', email: 'web@test.dev' }, terms_accepted: true, terms_hash: settings.body.terms.hash });
    expect(done.status).toBe(200);
    expect(done.body.order.status).toBe('reserved');
    expect(done.body.payment).toBeNull();
    const pub = await sf.get(`/api/v1/storefront/orders/${done.body.order.id}?token=${done.body.order.token}`);
    expect(pub.body.number).toBe(done.body.order.number);
    expect((await sf.get(`/api/v1/storefront/orders/${done.body.order.id}?token=${'x'.repeat(20)}`)).status).toBe(404);
  });

  it('publishes signed webhooks from the outbox', async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORK = 'true';
    const received: { headers: any; body: string }[] = [];
    const server = createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        received.push({ headers: req.headers, body: b });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    const ep = await admin.post('/api/v1/webhook_endpoints', { url: `http://127.0.0.1:${port}/hook`, events: ['customer.*'] });
    expect(ep.status).toBe(201);
    const secret = ep.body.secret;
    await admin.post('/api/v1/customers', { name: 'Hooked', email: 'hook@test.dev' });
    const logger = { info() {}, warn() {}, error: console.error, debug() {} };
    for (let i = 0; i < 3; i++) await publishOutbox(t.deps, logger);
    await deliverWebhooks(t.deps, logger);
    server.close();
    const created = received.find((r) => JSON.parse(r.body).type === 'customer.created');
    expect(created).toBeTruthy();
    expect(webhooks.verifySignature(created!.body, String(created!.headers['openrent-signature']), secret)).toBe(true);
    expect(webhooks.verifySignature(created!.body, String(created!.headers['openrent-signature']), 'whsec_wrong')).toBe(false);
    const deliveries = await admin.get(`/api/v1/webhook_endpoints/${ep.body.id}/deliveries`);
    expect(deliveries.body.data.some((d: any) => d.status === 'succeeded')).toBe(true);
  });

  it('serves the OpenAPI document and RFC 9457 errors', async () => {
    const spec = await admin.get('/api/v1/openapi.json');
    expect(spec.body.openapi).toBe('3.1.0');
    expect(Object.keys(spec.body.paths).length).toBeGreaterThan(80);
    const nf = await admin.get('/api/v1/orders/ord_missing');
    expect(nf.status).toBe(404);
    expect(nf.headers['content-type']).toContain('application/problem+json');
    expect(nf.body).toMatchObject({ code: 'not_found', status: 404 });
    expect(nf.body.request_id).toBeTruthy();
  });

  it('keeps issued documents immutable and invoice numbers gap-free', async () => {
    const inv1 = await admin.post(`/api/v1/orders/${ids.order}/documents`, { type: 'invoice' });
    const inv2 = await admin.post(`/api/v1/orders/${ids.order}/documents`, { type: 'invoice' });
    const n1 = Number(inv1.body.number.split('-').pop());
    const n2 = Number(inv2.body.number.split('-').pop());
    expect(n2).toBe(n1 + 1);
    await expect(withSystem(t.deps.db, (c) => c.query(`UPDATE documents SET html = 'tampered' WHERE id = $1`, [inv1.body.id]))).rejects.toMatchObject({ code: 'P0001' });
    const v = await admin.post(`/api/v1/documents/${inv1.body.id}/actions/void`, { reason: 'test' });
    expect(v.body.credit_note.type).toBe('credit_note');
  });

  it('writes an append-only audit log', async () => {
    const log = await admin.get(`/api/v1/audit_log?filter[entity_type]=order&limit=5`);
    expect(log.body.data.length).toBeGreaterThan(0);
    await expect(withSystem(t.deps.db, (c) => c.query(`DELETE FROM audit_log`))).rejects.toBeTruthy();
  });
  it('lists plugins and stores secret settings encrypted per tenant', async () => {
    const list = await admin.get('/api/v1/plugins');
    expect(list.status).toBe(200);
    const ids_ = list.body.data.map((p: any) => p.id);
    expect(ids_).toEqual(expect.arrayContaining(['payment-stripe', 'notify-smtp']));
    const bad = await admin.patch('/api/v1/plugins/notify-smtp', { config: { port: 'abc', nope: 'x' } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field).sort()).toEqual(['config.nope', 'config.port']);
    const ok = await admin.patch('/api/v1/plugins/notify-smtp', { config: { host: '127.0.0.1', port: 2525, security: 'none', password: 'top-secret', from: 'Shop <shop@test.dev>' } });
    expect(ok.status).toBe(200);
    expect(ok.body.values).toMatchObject({ host: '127.0.0.1', port: 2525, security: 'none' });
    expect(ok.body.secrets.password).toBe('tenant');
    expect(JSON.stringify(ok.body)).not.toContain('top-secret');
    const raw = await withSystem(t.deps.db, (c) => c.query(`SELECT config FROM plugins WHERE plugin_id = 'notify-smtp'`));
    expect(JSON.stringify(raw.rows[0].config)).not.toContain('top-secret');
    const off = await admin.patch('/api/v1/plugins/notify-smtp', { enabled: false });
    expect(off.body.enabled).toBe(false);
    expect((await admin.post('/api/v1/notifications/actions/test_email', { to: 'me@test.dev' })).body.code).toBe('email_not_configured');
    expect((await admin.patch('/api/v1/plugins/notify-smtp', { enabled: true })).body.enabled).toBe(true);
  });

  it('sends email through the tenant SMTP server with document PDFs attached', async () => {
    const sink = await smtpSink();
    try {
      await admin.patch('/api/v1/plugins/notify-smtp', { config: { port: sink.port } });
      const test = await admin.post('/api/v1/notifications/actions/test_email', { to: 'me@test.dev' });
      expect(test.status).toBe(200);
      expect(sink.mails.at(-1)!.raw).toContain('Subject: Test email from Test Rentals');
      const order = await admin.get(`/api/v1/orders/${ids.order}?expand=documents,customer`);
      const conf = order.body.documents.find((d: any) => d.type === 'confirmation');
      expect(conf).toBeTruthy();
      await admin.post(`/api/v1/documents/${conf.id}/actions/send`);
      const queued = await admin.get(`/api/v1/notifications?order_id=${ids.order}&status=queued`);
      expect(queued.body.data.some((n: any) => n.attachments.includes(conf.id))).toBe(true);
      const sent = await sendNotifications(t.deps, quiet);
      expect(sent).toBeGreaterThan(0);
      const mail = sink.mails.find((m) => m.to.includes(order.body.customer.email) && m.raw.includes('confirmation-'));
      if (hasChromium) expect(mail?.raw).toMatch(/filename="?confirmation-[^"\s]+\.pdf/);
      expect((await admin.get(`/api/v1/notifications?order_id=${ids.order}&status=queued`)).body.data.length).toBe(0);
    } finally {
      await sink.close();
    }
  }, 60_000);

  it('explains failed deliveries, backs off and recovers once settings are fixed', async () => {
    const sink = await smtpSink();
    try {
      // Implicit TLS against a plain SMTP port: the mistake that leaves messages waiting.
      await admin.patch('/api/v1/plugins/notify-smtp', { config: { host: '127.0.0.1', port: sink.port, security: 'tls' } });
      const test = await admin.post('/api/v1/notifications/actions/test_email', { to: 'me@test.dev' });
      expect(test.status).toBe(502);
      expect(test.body.detail).toMatch(/STARTTLS/);
      const order = await admin.get(`/api/v1/orders/${ids.order}?expand=documents`);
      const conf = order.body.documents.find((d: any) => d.type === 'confirmation');
      await admin.post(`/api/v1/documents/${conf.id}/actions/send`);
      await sendNotifications(t.deps, quiet);
      const waiting = (await admin.get('/api/v1/notifications?status=queued')).body.data[0];
      expect(waiting).toMatchObject({ attempts: 1, status: 'queued' });
      expect(waiting.error).toMatch(/does not use TLS on this port/);
      expect(new Date(waiting.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
      // Backoff: the next worker run leaves it alone.
      await sendNotifications(t.deps, quiet);
      expect((await admin.get(`/api/v1/notifications/${waiting.id}`)).body.attempts).toBe(1);
      const stats = await admin.get('/api/v1/notifications/stats');
      expect(stats.body.counts.queued).toBeGreaterThan(0);
      expect(stats.body.last_error.message).toMatch(/STARTTLS/);

      // Cancel one copy, resend it, then fix the settings: waiting mail goes out at once.
      const copy = await admin.post(`/api/v1/notifications/${waiting.id}/actions/resend`);
      expect(copy.status).toBe(201);
      expect((await admin.post(`/api/v1/notifications/${copy.body.id}/actions/cancel`)).body.status).toBe('cancelled');
      expect((await admin.post(`/api/v1/notifications/${copy.body.id}/actions/cancel`)).status).toBe(409);
      await admin.patch('/api/v1/plugins/notify-smtp', { config: { security: 'none' } });
      expect((await admin.get(`/api/v1/notifications/${waiting.id}`)).body.next_attempt_at).toBeNull();
      await sendNotifications(t.deps, quiet);
      expect((await admin.get(`/api/v1/notifications/${waiting.id}`)).body).toMatchObject({ status: 'sent', error: null, attempts: 2 });
      expect(sink.mails.some((m) => m.raw.includes(waiting.id))).toBe(true);
      expect((await admin.post(`/api/v1/notifications/${waiting.id}/actions/retry`)).status).toBe(409);
      expect((await admin.post('/api/v1/notifications/actions/retry_all', { status: 'failed' })).body.object).toBe('notification_retry');
    } finally {
      await sink.close();
    }
  }, 60_000);

  it.runIf(hasChromium)('renders document PDFs once and serves them from storage', async () => {
    const docs = await admin.get(`/api/v1/documents?order_id=${ids.order}`);
    const doc = docs.body.data[0];
    const first = await t.app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/pdf`, headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('application/pdf');
    expect(first.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const stored = await withSystem(t.deps.db, (c) => c.query(`SELECT size, sha256 FROM files WHERE owner_type = 'document' AND owner_id = $1 AND kind = 'pdf'`, [doc.id]));
    expect(stored.rows[0].size).toBe(first.rawPayload.length);
    const second = await t.app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/pdf?download=true`, headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(second.headers['content-disposition']).toMatch(/^attachment/);
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true);
  }, 60_000);

  it('customises, previews, publishes and exports themes', async () => {
    const list = await admin.get('/api/v1/themes');
    expect(list.body.data).toEqual([
      expect.objectContaining({ id: 'default', live: true, status: 'ok' }),
      expect.objectContaining({ id: 'retro', live: false, status: 'ok' }),
      expect.objectContaining({ id: 'concept', live: false, status: 'ok' }),
      expect.objectContaining({ id: 'ink-green', live: false, status: 'ok' }),
      expect.objectContaining({ id: 'marquee', live: false, status: 'ok' }),
      expect.objectContaining({ id: 'linen', live: false, status: 'ok' }),
      expect.objectContaining({ id: 'nightfall', live: false, status: 'ok' }),
    ]);
    const bad = await admin.patch('/api/v1/themes/default/settings', { settings: { accent: 'teal', radius: 99, nope: 1 } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field).sort()).toEqual(['settings.accent', 'settings.nope', 'settings.radius']);
    const ok = await admin.patch('/api/v1/themes/default/settings', { settings: { accent: '#E11D48' } });
    expect(ok.body.settings).toMatchObject({ accent: '#e11d48' });

    // Home page sections: problems come back by path; a valid layout reaches the storefront.
    const theme = await admin.get('/api/v1/themes/default');
    expect(theme.body.sections).toBeNull();
    expect(theme.body.section_schemas.map((x: any) => x.type)).toEqual(expect.arrayContaining(['hero', 'faq', 'product-grid']));
    const badLayout = await admin.put('/api/v1/themes/default/sections', { sections: [{ id: 'h', type: 'hero', settings: { heading: 5 } }, { id: 'x', type: 'carousel' }] });
    expect(badLayout.status).toBe(422);
    expect(badLayout.body.errors.map((e: any) => e.field)).toEqual(['sections.0.settings.heading', 'sections.1.type']);
    const layout = [
      { id: 'faq', type: 'faq', settings: { heading: 'Good to know' }, blocks: [{ id: 'q1', type: 'item', settings: { question: 'Helmets?', answer: 'Free with every bike.' } }] },
      { id: 'hero', type: 'hero', settings: { heading: 'Kayaks for everyone' }, blocks: [] },
    ];
    expect((await admin.put('/api/v1/themes/default/sections', { sections: layout })).body.sections.map((x: any) => x.id)).toEqual(['faq', 'hero']);
    const tr = await admin.patch('/api/v1/themes/default/translations/en', { strings: { 'product.add': 'Book it', 'nope.key': 'x' } });
    expect(tr.status).toBe(422);
    await admin.patch('/api/v1/themes/default/translations/en', { strings: { 'product.add': 'Book it' } });
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const s = await sf.get('/api/v1/storefront/settings');
    expect(s.body.theme).toMatchObject({ id: 'default', preview: false, settings: { accent: '#e11d48' }, translations: { en: { 'product.add': 'Book it' } }, sections: [{ id: 'faq' }, { id: 'hero' }] });
    const pv = await admin.post('/api/v1/themes/default/actions/preview');
    const token = new URL(pv.body.url).searchParams.get('preview_theme')!;
    const viaPreview = await sf.get('/api/v1/storefront/settings', { 'x-theme-preview': token });
    expect(viaPreview.body.theme.preview).toBe(true);
    expect(viaPreview.headers['cache-control']).toContain('no-store');
    expect((await sf.get('/api/v1/storefront/settings', { 'x-theme-preview': `${token}x` })).body.code).toBe('preview_invalid');
    const exp = await admin.get('/api/v1/themes/default/settings/export');
    expect(exp.body).toMatchObject({ theme: 'default', settings: { accent: '#e11d48' }, sections: [{ id: 'faq' }, { id: 'hero' }] });
    await admin.patch('/api/v1/themes/default/settings', { settings: { accent: null } });
    expect((await admin.put('/api/v1/themes/default/sections', { sections: null })).body.sections).toBeNull();
    const imp = await admin.post('/api/v1/themes/default/settings/import', exp.body);
    expect(imp.body.settings.accent).toBe('#e11d48');
    expect(imp.body.sections.map((x: any) => x.id)).toEqual(['faq', 'hero']);
    await admin.put('/api/v1/themes/default/sections', { sections: null });
    expect((await admin.post('/api/v1/themes/default/settings/import', { ...exp.body, theme: 'other' })).status).toBe(422);
    expect((await admin.post('/api/v1/themes/default/actions/publish')).body.live).toBe(true);
    expect((await admin.post('/api/v1/themes/missing/actions/publish')).status).toBe(404);
  });

  it('confirms an online storefront payment when the customer returns before the webhook', async () => {
    const intents = new Map<string, CreatePaymentIntentInput>();
    const fake: PaymentProvider = {
      id: 'fakepay',
      displayName: 'Fake pay',
      authorizationWindowDays: 7,
      isConfigured: () => true,
      publicConfig: () => ({ publishable_key: 'pk_fake' }),
      async createPaymentIntent(_c, input) {
        const ref = `fpi_${intents.size + 1}`;
        intents.set(ref, input);
        return { ref, clientSecret: `${ref}_secret`, status: 'requires_payment', customerRef: 'fcus_1' };
      },
      authorize: async () => ({ ref: 'fdep_1', status: 'held', expiresAt: null }),
      capture: async (_c, _r, amount) => ({ status: 'captured', amountCaptured: amount }),
      void: async () => undefined,
      refund: async () => ({ ref: 'fre_1', status: 'succeeded' }),
      handleWebhook: async () => ({ type: 'ignored', eventId: 'x', providerType: 'x' }),
      async retrievePayment(_c, ref) {
        const i = intents.get(ref)!;
        return { type: 'payment.succeeded', eventId: `sync_${ref}_succeeded`, ref, amount: i.amount, currency: i.currency, orderId: i.orderId, purpose: 'rental', customerRef: 'fcus_1', paymentMethodRef: 'fpm_1' };
      },
    };
    await t.deps.plugins.register(definePlugin({ id: 'fakepay', name: 'Fake pay', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerPaymentProvider(fake) }));
    await admin.patch('/api/v1/tenant/settings', { storefront: { payment: 'stripe' } });
    try {
      const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
      const settings = await sf.get('/api/v1/storefront/settings');
      expect(settings.body.payment).toMatchObject({ provider: 'fakepay', publishable_key: 'pk_fake' });
      const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(80), ends_at: iso(81), lines: [{ variant_id: ids.bike, quantity: 1 }] });
      const done = await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Card Payer', email: 'payer@test.dev' }, terms_accepted: true, terms_hash: settings.body.terms.hash });
      expect(done.body.order.status).toBe('quote');
      expect(done.body.payment.client_secret).toBe('fpi_1_secret');
      const token = done.body.order.token;
      const before = await sf.get(`/api/v1/storefront/orders/${token}?token=${token}`);
      expect(before.body).toMatchObject({ payment_pending: true, payable: true });
      const synced = await sf.post(`/api/v1/storefront/orders/${token}/payments/sync`, { token });
      expect(synced.body).toMatchObject({ status: 'reserved', payment_status: 'paid', payment_pending: false, payable: false });
      const again = await sf.post(`/api/v1/storefront/orders/${token}/payments/sync`, { token });
      expect(again.body.status).toBe('reserved');
      const pays = await admin.get(`/api/v1/orders/${done.body.order.id}?expand=payments`);
      expect(pays.body.payments.filter((p: any) => p.status === 'succeeded')).toHaveLength(1);
      expect((await sf.post(`/api/v1/storefront/orders/${token}/payment_intents`, { token })).status).toBe(409);
    } finally {
      await admin.patch('/api/v1/tenant/settings', { storefront: { payment: 'none' } });
    }
  });

  it('stores product photos with resized variants and serves them publicly', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#0e7490' } }).png().toBuffer();
    const up = await admin.upload('/api/v1/files?purpose=image', 'bike photo.png', 'image/png', png);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ kind: 'image', width: 2400, height: 1600 });
    const bad = await admin.upload('/api/v1/files?purpose=image', 'notes.txt', 'text/plain', Buffer.from('hello'));
    expect(bad.status).toBe(415);
    const product = await admin.get(`/api/v1/variants/${ids.bike}`);
    const pid = product.body.product_id;
    const img = await admin.post(`/api/v1/products/${pid}/images`, { file_id: up.body.id, alt: { en: 'Blue bike' } });
    expect(img.status).toBe(201);
    const up2 = await admin.upload('/api/v1/files?purpose=image', 'side.png', 'image/png', await sharp({ create: { width: 300, height: 200, channels: 3, background: '#000' } }).png().toBuffer());
    const img2 = await admin.post(`/api/v1/products/${pid}/images`, { file_id: up2.body.id });
    expect((await admin.put(`/api/v1/products/${pid}/images/order`, { ids: [img.body.id] })).status).toBe(422);
    const ordered = await admin.put(`/api/v1/products/${pid}/images/order`, { ids: [img2.body.id, img.body.id] });
    expect(ordered.body.data.map((i: any) => i.id)).toEqual([img2.body.id, img.body.id]);
    // Public, unauthenticated, cacheable variants.
    const sm = await t.app.inject({ method: 'GET', url: new URL(img.body.url_sm).pathname });
    expect(sm.statusCode).toBe(200);
    expect(sm.headers['content-type']).toBe('image/webp');
    expect(sm.headers['cache-control']).toContain('immutable');
    expect((await sharp(sm.rawPayload).metadata()).width).toBe(480);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/public/files/fil_01NOTAREALFILE000000000000/sm' })).statusCode).toBe(404);
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const pub = await sf.get(`/api/v1/storefront/catalog/products/${(await admin.get(`/api/v1/products/${pid}`)).body.slug}`);
    expect(pub.body.images[1]).toMatchObject({ alt: 'Blue bike' });
    expect(pub.body.images[0].url_sm).toContain('/public/files/');
    expect((await admin.del(`/api/v1/products/${pid}/images/${img2.body.id}`)).status).toBe(204);
    const left = await withSystem(t.deps.db, (c) => c.query(`SELECT count(*)::int AS n FROM files WHERE id = $1 OR owner_id = $1`, [up2.body.id]));
    expect(left.rows[0].n).toBe(0);
  }, 60_000);

  it('imports products, stock and prices from CSV with a dry run first', async () => {
    const csv = [
      'Product name;SKU;Type;Category;Price;Period;Tracking;Deposit',
      'Paddle board;SUP-1;rental;Water;25,00;day;serialized;100',
      'Paddle board;SUP-2;rental;Water;30,00;day;serialized;100',
      'Wetsuit;WS-1;rental;Water;abc;day;bulk;',
      ';X-1;rental;;5;day;bulk;',
    ].join('\n');
    const f = await admin.upload('/api/v1/files?purpose=import', 'products.csv', 'text/csv', Buffer.from(csv));
    const dry = await admin.post('/api/v1/imports', { entity: 'products', file_id: f.body.id });
    expect(dry.status).toBe(201);
    expect(dry.body.report.counts).toMatchObject({ create: 2, error: 2 });
    expect(dry.body.report.rows.find((r: any) => r.row === 4).errors[0]).toMatchObject({ field: 'price' });
    expect(dry.body.report.rows.find((r: any) => r.row === 5).errors[0]).toMatchObject({ field: 'name' });
    const refused = await admin.post(`/api/v1/imports/${dry.body.id}/actions/apply`);
    expect(refused.status).toBe(422);
    expect((await admin.get('/api/v1/products?q=Paddle')).body.data).toHaveLength(0);

    const fixed = csv.replace('abc', '12.50').replace(';X-1;rental;;5;day;bulk;', 'Life vest;LV-1;rental;Water;5;day;bulk;');
    const f2 = await admin.upload('/api/v1/files?purpose=import', 'products.csv', 'text/csv', Buffer.from(fixed));
    const ok = await admin.post('/api/v1/imports', { entity: 'products', file_id: f2.body.id });
    expect(ok.body.report.counts).toMatchObject({ create: 4, error: 0 });
    const applied = await admin.post(`/api/v1/imports/${ok.body.id}/actions/apply`);
    expect(applied.body.status).toBe('applied');
    const sup = (await admin.get('/api/v1/products?q=Paddle')).body.data[0];
    expect(sup.variants.map((v: any) => v.sku).sort()).toEqual(['SUP-1', 'SUP-2']);
    expect(sup.deposit_amount).toBe(10000);
    expect((await admin.post(`/api/v1/imports/${ok.body.id}/actions/apply`)).status).toBe(409);

    // The same file again changes nothing.
    const again = await admin.post('/api/v1/imports', { entity: 'products', file_id: f2.body.id });
    expect(again.body.report.counts).toMatchObject({ create: 0, update: 0, unchanged: 4 });

    const stock = await admin.upload('/api/v1/files?purpose=import', 'stock.csv', 'text/csv', Buffer.from('sku,barcode,quantity,condition,purchase_date\nSUP-1,SUP-A,,good,31.12.2025\nSUP-1,,2,,\nWS-1,,25,,\nNOPE,,1,,\n'));
    const sdry = await admin.post('/api/v1/imports', { entity: 'stock_items', file_id: stock.body.id });
    expect(sdry.body.report.counts).toMatchObject({ create: 3, error: 1 });
    const stock2 = await admin.upload('/api/v1/files?purpose=import', 'stock.csv', 'text/csv', Buffer.from('sku,barcode,quantity,condition,purchase_date\nSUP-1,SUP-A,,good,31.12.2025\nSUP-1,,2,,\nWS-1,,25,,\n'));
    const s2 = await admin.post('/api/v1/imports', { entity: 'stock_items', file_id: stock2.body.id });
    expect((await admin.post(`/api/v1/imports/${s2.body.id}/actions/apply`)).body.status).toBe('applied');
    const units = await admin.get(`/api/v1/stock_items?filter[variant_id]=${sup.variants.find((v: any) => v.sku === 'SUP-1').id}`);
    expect(units.body.data).toHaveLength(3);
    expect(units.body.data.find((u: any) => u.barcode === 'SUP-A').purchase_date).toContain('2025-12-31');

    const prices = await admin.upload('/api/v1/files?purpose=import', 'prices.csv', 'text/csv', Buffer.from('sku,price,price_period\nSUP-1,40,day\nSUP-2,30.00,day\n'));
    const pdry = await admin.post('/api/v1/imports', { entity: 'prices', file_id: prices.body.id });
    expect(pdry.body.report.counts).toMatchObject({ update: 1, unchanged: 1 });
    await admin.post(`/api/v1/imports/${pdry.body.id}/actions/apply`);
    const quote = await admin.post('/api/v1/price_quote', { starts_at: iso(30), ends_at: iso(31), lines: [{ variant_id: sup.variants.find((v: any) => v.sku === 'SUP-1').id, quantity: 1 }] });
    expect(quote.body.lines[0].unit_price.amount).toBe(4000);

    const exp = await t.app.inject({ method: 'GET', url: '/api/v1/exports/products?format=xlsx', headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(exp.statusCode).toBe(200);
    expect(exp.rawPayload.subarray(0, 2).toString()).toBe('PK');
    // An export imports back without changes.
    const back = await admin.upload('/api/v1/files?purpose=import', 'products.xlsx', 'application/octet-stream', exp.rawPayload);
    const backDry = await admin.post('/api/v1/imports', { entity: 'products', file_id: back.body.id });
    expect(backDry.body.report.counts.error).toBe(0);
    expect(backDry.body.report.counts.create).toBe(0);
  }, 60_000);

  it('keeps company contacts and billing addresses', async () => {
    const c = await admin.post('/api/v1/customers', { name: 'Acme Events', type: 'company', company_name: 'Acme Events OÜ', email: 'office@acme.test', addresses: { billing: { line1: 'Pikk 1', postal_code: '10123', city: 'Tallinn', country: 'EE' } }, locale: 'et', marketing_consent: true });
    expect(c.status).toBe(201);
    expect(c.body.addresses.billing.city).toBe('Tallinn');
    expect((await admin.patch(`/api/v1/customers/${c.body.id}`, { addresses: { billing: { nope: 1 } } })).status).toBe(400);
    const a = await admin.post(`/api/v1/customers/${c.body.id}/contacts`, { name: 'Mari', email: 'MARI@acme.test', is_primary: true });
    await admin.post(`/api/v1/customers/${c.body.id}/contacts`, { name: 'Jaan', role: 'Warehouse', is_primary: true });
    const list = await admin.get(`/api/v1/customers/${c.body.id}/contacts`);
    expect(list.body.data.map((x: any) => [x.name, x.is_primary])).toEqual([['Jaan', true], ['Mari', false]]);
    expect(list.body.data[1].email).toBe('mari@acme.test');
    expect((await admin.del(`/api/v1/customers/${c.body.id}/contacts/${a.body.id}`)).status).toBe(204);

    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const settings = await sf.get('/api/v1/storefront/settings');
    const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(90), ends_at: iso(91), lines: [{ variant_id: ids.bike, quantity: 1 }] });
    const done = await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, {
      customer: { name: 'Bob Builder', email: 'bob@builder.test', company_name: 'Builder Ltd', tax_id: 'EE123', billing_address: { line1: 'Road 2', postal_code: '11111', city: 'Tartu', country: 'EE' } },
      terms_accepted: true,
      terms_hash: settings.body.terms.hash,
    });
    expect(done.status).toBe(200);
    const o = await admin.get(`/api/v1/orders/${done.body.order.id}?expand=customer,documents`);
    expect(o.body.customer).toMatchObject({ type: 'company', company_name: 'Builder Ltd', tax_id: 'EE123', addresses: { billing: { city: 'Tartu' } } });
    const conf = o.body.documents.find((d: any) => d.type === 'confirmation');
    const html = await t.app.inject({ method: 'GET', url: `/api/v1/documents/${conf.id}/html`, headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(html.body).toContain('11111 Tartu');
  });

  it('takes a down payment at checkout and requests the balance with a payment link', async () => {
    await admin.patch('/api/v1/tenant/settings', { storefront: { payment: 'stripe' }, payment_terms: { upfront: 'percent', percent_bp: 3000 } });
    try {
      const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
      const settings = await sf.get('/api/v1/storefront/settings');
      const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(100), ends_at: iso(101), lines: [{ variant_id: ids.bike, quantity: 1 }] });
      const total = cs.body.quote.total.amount;
      const done = await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Dee Posit', email: 'dee@test.dev' }, terms_accepted: true, terms_hash: settings.body.terms.hash });
      expect(done.body.payment.amount.amount).toBe(Math.round(total * 0.3));
      const token = done.body.order.token;
      expect((await sf.get(`/api/v1/storefront/orders/${token}?token=${token}`)).body.amount_due.amount).toBe(Math.round(total * 0.3));
      const synced = await sf.post(`/api/v1/storefront/orders/${token}/payments/sync`, { token });
      expect(synced.body).toMatchObject({ status: 'reserved', payment_status: 'partially_paid', payable: false });
      const reqs = await admin.get(`/api/v1/orders/${done.body.order.id}/payment_requests`);
      expect(reqs.body.data[0]).toMatchObject({ kind: 'upfront', status: 'paid' });

      // Staff send a payment link for the balance; the customer pays it on the order page.
      expect((await admin.post(`/api/v1/orders/${done.body.order.id}/payment_requests`, { amount: total })).status).toBe(422);
      const link = await admin.post(`/api/v1/orders/${done.body.order.id}/payment_requests`, { message: 'Balance before pickup' });
      expect(link.body.amount.amount).toBe(total - Math.round(total * 0.3));
      const mail = (await admin.get(`/api/v1/notifications?order_id=${done.body.order.id}`)).body.data.find((n: any) => n.template === 'payment_request');
      expect(mail.subject).toContain('Payment of');
      const page = await sf.get(`/api/v1/storefront/orders/${token}?token=${token}`);
      expect(page.body).toMatchObject({ payable: true, payment_request_id: link.body.id, amount_due: { amount: link.body.amount.amount } });
      const intent = await sf.post(`/api/v1/storefront/orders/${token}/payment_intents`, { token });
      expect(intent.body.amount.amount).toBe(link.body.amount.amount);
      await sf.post(`/api/v1/storefront/orders/${token}/payments/sync`, { token });
      const after = await admin.get(`/api/v1/orders/${done.body.order.id}?expand=payment_requests`);
      expect(after.body.payment_status).toBe('paid');
      expect(after.body.payment_requests[0]).toMatchObject({ id: link.body.id, status: 'paid' });
      expect((await admin.post(`/api/v1/orders/${done.body.order.id}/payment_requests/${link.body.id}/actions/cancel`)).status).toBe(409);
    } finally {
      await admin.patch('/api/v1/tenant/settings', { storefront: { payment: 'none' }, payment_terms: { upfront: 'full' } });
    }
  });

  it('exports the audit log with actor names', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/audit_log/export?filter[entity_type]=customer', headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(res.statusCode).toBe(200);
    expect(res.body.split('\r\n')[0]).toContain('created_at,actor_type,actor,entity_type');
    expect(res.body).toContain('Owner');
    const list = await admin.get('/api/v1/audit_log?limit=5');
    expect(list.body.data[0]).toHaveProperty('actor_name');
  });

  it('runs a counter pickup with a drawn signature, bins on the pick list and a wrong-location check', async () => {
    const sharp = (await import('sharp')).default;
    const loc2 = await admin.post('/api/v1/locations', { name: 'Harbour shop', timezone: 'Europe/Tallinn', opening_hours: {} });
    const far = await admin.post('/api/v1/stock_items', { variant_id: ids.camera, location_id: loc2.body.id, barcode: 'CAM-FAR' });
    await admin.patch(`/api/v1/stock_items/${ids.camUnit.id}`, { bin: 'A-03' });
    const cust = await admin.post('/api/v1/customers', { name: 'Sig Ner', email: 'sig@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: cust.body.id, starts_at: iso(-0.01), ends_at: iso(1), lines: [{ variant_id: ids.camera, quantity: 1 }] });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    const pick = await admin.get(`/api/v1/orders/${o.body.id}/pick_list`);
    expect(pick.body.items[0]).toMatchObject({ missing: 1, bins: ['A-03'] });
    const wrong = await admin.post(`/api/v1/orders/${o.body.id}/actions/assign_units`, { barcodes: ['CAM-FAR'] });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('wrong_location');
    expect(far.status).toBe(201);
    await admin.post(`/api/v1/orders/${o.body.id}/actions/assign_units`, { barcodes: ['CAM-1'] });
    const sig = await admin.upload('/api/v1/files?purpose=photo', 'signature.png', 'image/png', await sharp({ create: { width: 300, height: 100, channels: 4, background: '#00000000' } }).png().toBuffer());
    const out = await admin.post(`/api/v1/orders/${o.body.id}/actions/check_out`, { signature: { name: 'Sig Ner', method: 'drawn', file_id: sig.body.id } });
    expect(out.body.status).toBe('out');
    const docs = await admin.get(`/api/v1/documents?order_id=${o.body.id}&type=contract`);
    const html = await t.app.inject({ method: 'GET', url: `/api/v1/documents/${docs.body.data[0].id}/html`, headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(html.body).toContain('Signed at pickup');
    expect(html.body).toMatch(/src="data:image\/png;base64,/);
    ids.sigOrder = o.body.id;
  });

  it('opens maintenance tickets for damaged returns and closes them back into service', async () => {
    const sharp = (await import('sharp')).default;
    await admin.post(`/api/v1/orders/${ids.sigOrder}/actions/check_in`, { units: [{ barcode: 'CAM-1', outcome: 'damaged' }] });
    const tickets = await admin.get('/api/v1/maintenance_tickets');
    const tk = tickets.body.data.find((x: any) => x.stock_item.barcode === 'CAM-1');
    expect(tk).toMatchObject({ status: 'open', severity: 'hard_down' });
    expect((await admin.get(`/api/v1/stock_items/${ids.camUnit.id}`)).body.status).toBe('hard_down');
    const photo = await admin.upload('/api/v1/files?purpose=photo', 'crack.png', 'image/png', await sharp({ create: { width: 640, height: 480, channels: 3, background: '#999' } }).png().toBuffer());
    expect((await admin.post(`/api/v1/maintenance_tickets/${tk.id}/photos`, { file_id: photo.body.id })).status).toBe(201);
    expect((await admin.post(`/api/v1/maintenance_tickets/${tk.id}/photos`, { file_id: (await admin.upload('/api/v1/files?purpose=image', 'x.png', 'image/png', await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer())).body.id })).status).toBe(422);
    await admin.patch(`/api/v1/maintenance_tickets/${tk.id}`, { status: 'in_progress', notes: 'Lens mount cracked' });
    const insp = await admin.post(`/api/v1/orders/${ids.sigOrder}/actions/inspect`, { damage_charges: [{ description: 'Cracked mount', amount: 9000 }] });
    expect(insp.status).toBe(200);
    const dmg = await admin.get(`/api/v1/orders/${ids.sigOrder}?expand=damage_charges`);
    const dmgPhoto = await admin.upload('/api/v1/files?purpose=photo', 'mount.png', 'image/png', await sharp({ create: { width: 64, height: 64, channels: 3, background: '#555' } }).png().toBuffer());
    await admin.post(`/api/v1/damage_charges/${dmg.body.damage_charges[0].id}/photos`, { file_id: dmgPhoto.body.id });
    const withPhotos = await admin.get(`/api/v1/orders/${ids.sigOrder}?expand=damage_charges`);
    expect(withPhotos.body.damage_charges[0].photos[0].url_sm).toContain(`/files/${dmgPhoto.body.id}/content`);
    const closed = await admin.post(`/api/v1/maintenance_tickets/${tk.id}/actions/close`, { outcome: 'available', notes: 'Replaced mount' });
    expect(closed.body).toMatchObject({ status: 'done', photos: [expect.objectContaining({ file_id: photo.body.id })] });
    expect((await admin.get(`/api/v1/stock_items/${ids.camUnit.id}`)).body.status).toBe('available');
    const open = await admin.get(`/api/v1/downtimes?stock_item_id=${ids.camUnit.id}&active=true`);
    expect(open.body.data ?? []).toHaveLength(0);
    expect((await admin.post(`/api/v1/maintenance_tickets/${tk.id}/actions/close`, { outcome: 'available' })).status).toBe(409);
  });

  it('counts a location and marks missing units lost', async () => {
    const st = await admin.post('/api/v1/stock_takes', { location_id: ids.location });
    expect(st.status).toBe(201);
    expect((await admin.post('/api/v1/stock_takes', { location_id: ids.location })).body.id).toBe(st.body.id);
    const expected = st.body.missing.map((u: any) => u.barcode);
    expect(expected).toContain('CAM-1');
    const seen = expected.filter((b: string) => b !== 'CAM-1');
    for (const code of seen) expect((await admin.post(`/api/v1/stock_takes/${st.body.id}/scans`, { code })).body.result).toBe('found');
    expect((await admin.post(`/api/v1/stock_takes/${st.body.id}/scans`, { code: seen[0] })).body.repeated).toBe(true);
    expect((await admin.post(`/api/v1/stock_takes/${st.body.id}/scans`, { code: 'CAM-FAR' })).body.result).toBe('elsewhere');
    expect((await admin.post(`/api/v1/stock_takes/${st.body.id}/scans`, { code: 'NOPE-123' })).body.result).toBe('unknown');
    const view = await admin.get(`/api/v1/stock_takes/${st.body.id}`);
    expect(view.body.missing.map((u: any) => u.barcode)).toEqual(['CAM-1']);
    expect(view.body.unknown).toEqual(['NOPE-123']);
    const applied = await admin.post(`/api/v1/stock_takes/${st.body.id}/actions/apply`, { mark_missing_lost: true, move_found: true });
    expect(applied.body.result).toMatchObject({ lost: ['CAM-1'], moved: ['CAM-FAR'] });
    expect((await admin.get(`/api/v1/stock_items/${ids.camUnit.id}`)).body.status).toBe('lost');
    expect((await admin.post(`/api/v1/stock_takes/${st.body.id}/scans`, { code: 'X' })).status).toBe(409);
  });

  it('signs customers in by email link and lets them request cancellations that staff decide', async () => {
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const settings = await sf.get('/api/v1/storefront/settings');
    const book = async (email: string, name: string, offset: number) => {
      const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(offset), ends_at: iso(offset + 1), lines: [{ variant_id: ids.bike, quantity: 1 }] });
      return (await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name, email }, terms_accepted: true, terms_hash: settings.body.terms.hash })).body.order;
    };
    const order = await book('Acc.Holder@test.dev', 'Ann Holder', 120);
    const other = await book('someone@test.dev', 'Some One', 122);
    const linkFor = async (email: string) => {
      const r = await withSystem(t.deps.db, (c) => c.query(`SELECT body_html FROM notifications WHERE template_key = 'customer_login' AND recipient = $1 ORDER BY created_at DESC LIMIT 1`, [email]));
      // Handlebars escapes '=' in the link; mail clients decode it.
      return /token(?:=|&#x3D;)([\w-]+)/.exec(r.rows[0]?.body_html ?? '')?.[1];
    };

    // The answer never tells whether the email has bookings.
    const unknown = await sf.post('/api/v1/storefront/account/login', { email: 'nobody@test.dev' });
    const known = await sf.post('/api/v1/storefront/account/login', { email: ' ACC.holder@test.dev ' });
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect((await sf.post('/api/v1/storefront/account/login', { email: 'not-an-email' })).body.errors[0].field).toBe('email');
    expect(await linkFor('nobody@test.dev')).toBeUndefined();
    const token = (await linkFor('acc.holder@test.dev'))!;
    const session = await sf.post('/api/v1/storefront/account/verify', { token });
    expect(session.status).toBe(200);
    expect((await sf.post('/api/v1/storefront/account/verify', { token })).status).toBe(401);
    const as = { 'x-customer-session': session.body.token };

    const me = await sf.get('/api/v1/storefront/account', as);
    expect(me.body).toMatchObject({ email: 'acc.holder@test.dev', name: 'Ann Holder' });
    expect(me.body.orders.map((o: any) => o.id)).toEqual([order.id]);
    expect(me.body.orders[0]).toMatchObject({ upcoming: true, can_request_cancellation: true, cancellation_request: null });
    expect(me.body.orders[0].documents.length).toBeGreaterThan(0);
    expect((await sf.get('/api/v1/storefront/account')).status).toBe(401);
    expect((await sf.patch('/api/v1/storefront/account', { name: '  ' }, as)).body.errors[0].field).toBe('name');
    expect((await sf.patch('/api/v1/storefront/account', { name: 'Ann H. Holder', marketing_consent: true }, as)).body).toMatchObject({ name: 'Ann H. Holder', marketing_consent: true });

    // Another customer's booking and documents stay out of reach.
    expect((await sf.post(`/api/v1/storefront/account/orders/${other.id}/cancellation_request`, { reason: 'x' }, as)).status).toBe(404);
    const otherDoc = (await admin.get(`/api/v1/documents?order_id=${other.id}`)).body.data[0];
    expect((await sf.get(`/api/v1/storefront/account/documents/${otherDoc.id}/pdf`, as)).status).toBe(404);

    // Request, refuse a duplicate, withdraw, ask again; staff decline.
    const url = `/api/v1/storefront/account/orders/${order.id}/cancellation_request`;
    expect((await sf.post(url, { reason: 'Plans changed' }, as)).body.status).toBe('pending');
    expect((await sf.post(url, { reason: 'Again' }, as)).status).toBe(409);
    expect((await sf.req('DELETE', url, undefined, as)).body.status).toBe('withdrawn');
    const second = await sf.post(url, { reason: 'Plans changed for real' }, as);
    expect(second.status).toBe(201);
    expect((await admin.get('/api/v1/cancellation_requests?status=pending')).body.data.map((r: any) => r.id)).toContain(second.body.id);
    expect((await admin.get(`/api/v1/orders/${order.id}/cancellation_request`)).body.request).toMatchObject({ id: second.body.id, status: 'pending' });
    expect((await admin.post(`/api/v1/cancellation_requests/${second.body.id}/actions/decline`, { note: 'These dates cannot be cancelled' })).body.status).toBe('declined');
    expect((await admin.get(`/api/v1/orders/${order.id}`)).body.status).toBe('reserved');

    // The order link alone may ask too; staff approve and the order is cancelled.
    const third = await sf.post(`/api/v1/storefront/orders/${order.id}/cancellation_request`, { token: order.token, reason: 'Sick' });
    expect(third.body.status).toBe('pending');
    expect((await admin.post(`/api/v1/cancellation_requests/${third.body.id}/actions/approve`, {})).body.status).toBe('approved');
    expect((await admin.post(`/api/v1/cancellation_requests/${third.body.id}/actions/approve`, {})).status).toBe(409);
    expect((await admin.get(`/api/v1/orders/${order.id}`)).body.status).toBe('cancelled');
    const pub = await sf.get(`/api/v1/storefront/orders/${order.id}?token=${order.token}`);
    expect(pub.body).toMatchObject({ status: 'cancelled', can_request_cancellation: false, cancellation_request: { status: 'approved' } });
    const mails = (await admin.get(`/api/v1/notifications?order_id=${order.id}`)).body.data.map((n: any) => n.template);
    expect(mails).toEqual(expect.arrayContaining(['cancellation_request_received', 'staff_cancellation_requested', 'cancellation_declined', 'order_cancelled']));

    // Staff see the session and can end it.
    const customer = (await admin.get(`/api/v1/orders/${order.id}`)).body.customer_id;
    expect((await admin.get(`/api/v1/customers/${customer}/sessions`)).body.data.length).toBe(1);
    expect((await admin.del(`/api/v1/customers/${customer}/sessions`)).body.revoked).toBe(1);
    expect((await sf.get('/api/v1/storefront/account', as)).status).toBe(401);
  });

  it('searches the storefront catalogue with sorting and a free-on-my-dates filter', async () => {
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const names = (await sf.get('/api/v1/storefront/catalog/products?sort=name&limit=100')).body.data.map((p: any) => p.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    expect((await sf.get('/api/v1/storefront/catalog/products?q=bik')).body.data.map((p: any) => p.name)).toContain('Bike');
    expect((await sf.get('/api/v1/storefront/catalog/products?sort=cheapest')).status).toBe(400);

    // Book every bike for one day; the filter then leaves bikes out while the plain list keeps them.
    const settings = await sf.get('/api/v1/storefront/settings');
    const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(200), ends_at: iso(201), lines: [{ variant_id: ids.bike, quantity: 2 }] });
    await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Bike Fan', email: 'bikes@test.dev' }, terms_accepted: true, terms_hash: settings.body.terms.hash });
    const range = `from=${iso(200)}&to=${iso(201)}`;
    expect((await sf.get(`/api/v1/storefront/catalog/products?${range}&limit=100`)).body.data.map((p: any) => p.name)).toContain('Bike');
    const free = (await sf.get(`/api/v1/storefront/catalog/products?${range}&available=true&limit=100`)).body.data.map((p: any) => p.name);
    expect(free).not.toContain('Bike');
    expect(free.length).toBeGreaterThan(0);
  });

  it('cleans custom storefront CSS and HTML before the storefront renders them', async () => {
    const saved = await admin.put('/api/v1/storefront_code', {
      css: '@import url(https://evil.test/x.css); .hero{color:red}</style><script>alert(1)</script> .x{background:url(javascript:alert(1))}',
      header_html: '<p class="note" onclick="steal()">Free delivery <a href="javascript:alert(1)">now</a> <a href="https://shop.test" target="_blank">more</a></p><script>alert(1)</script><img src="http://x.test/a.png" onerror="x()">',
      footer_html: '<p>Open daily</p>',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.css).not.toMatch(/@import|<\/style|javascript:/i);
    expect(saved.body.css).toContain('.hero{color:red}');
    expect(saved.body.header_html).not.toMatch(/onclick|<script|javascript:|onerror|http:\/\//);
    expect(saved.body.header_html).toContain('rel="noopener noreferrer"');
    expect(saved.body.footer_html).toBe('<p>Open daily</p>');
    expect(saved.body.warnings.map((w: any) => w.field).sort()).toEqual(['css', 'header_html']);
    expect((await admin.put('/api/v1/storefront_code', { css: 'a'.repeat(50_001) })).body.errors[0].field).toBe('css');
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    expect((await sf.get('/api/v1/storefront/settings')).body.code).toMatchObject({ footer_html: '<p>Open daily</p>' });
    await admin.put('/api/v1/storefront_code', { css: '', header_html: '', footer_html: '' });
  });

  it('serves pickups and returns as an iCal feed until the feed is revoked', async () => {
    expect((await admin.post('/api/v1/calendar_feeds', { name: ' ' })).body.errors[0].field).toBe('name');
    const feed = await admin.post('/api/v1/calendar_feeds', { name: 'Counter; Tallinn, desk' });
    expect(feed.status).toBe(201);
    expect((await admin.get('/api/v1/calendar_feeds')).body.data[0]).not.toHaveProperty('url');
    const path = new URL(feed.body.url).pathname;
    const res = await t.app.inject({ method: 'GET', url: path });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    const ics = res.body;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:Counter\\; Tallinn\\, desk');
    // A booking 122 days ahead is in; the one 200 days ahead is past the 180-day window.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toMatch(/SUMMARY:#\d+ Pickup · Some One · 1× Bike/);
    expect(unfolded).toMatch(/SUMMARY:#\d+ Return · Some One/);
    expect(unfolded).not.toContain('Bike Fan');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    expect((await admin.del(`/api/v1/calendar_feeds/${feed.body.id}`)).status).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/calendar/abcdefghijklmnopqrstuvwxyz.ics' })).statusCode).toBe(404);
  });

  it('runs the admin, the storefront, emails and documents in several languages', async () => {
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const bikeProduct = (await admin.get(`/api/v1/variants/${ids.bike}`)).body.product_id;
    const english = (await admin.get('/api/v1/orders/%23999999')).body.detail;

    // Staff choose their own language; server messages follow it.
    expect((await admin.patch('/api/v1/auth/me', { locale: 'xx' })).status).toBe(400);
    expect((await admin.patch('/api/v1/auth/me', { locale: 'de' })).body.locale).toBe('de');
    const german = (await admin.get('/api/v1/orders/%23999999')).body.detail;
    expect(german).toContain('999999');
    expect(german).not.toBe(english);
    await admin.patch('/api/v1/auth/me', { locale: 'en' });

    // Shop languages: the default must be one of the enabled ones.
    const bad = await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en', 'de'], default_locale: 'fr' } });
    expect(bad.body.errors.map((e: any) => e.field)).toEqual(['storefront.default_locale']);
    await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en', 'de', 'ja'], default_locale: 'en' }, terms: { translations: { de: 'Deutsche Mietbedingungen' } } });
    try {
      const cat = await admin.post('/api/v1/categories', { name: 'Bicycles', slug: 'bicycles', translations: { de: { name: 'Fahrräder' } } });
      expect(cat.status).toBe(201);
      await admin.patch(`/api/v1/products/${bikeProduct}`, { translations: { de: { name: 'Fahrrad', description: 'Ein Rad' } } });
      await admin.patch(`/api/v1/variants/${ids.bike}`, { translations: { de: { name: 'Fahrrad' } } });

      const de = await sf.get('/api/v1/storefront/settings?locale=de');
      expect(de.body.categories.map((c: any) => c.name)).toContain('Fahrräder');
      expect(de.body.terms.text).toBe('Deutsche Mietbedingungen');
      expect((await sf.get('/api/v1/storefront/settings?locale=ja')).body.terms.text).not.toBe('Deutsche Mietbedingungen');
      const deBike = (await sf.get('/api/v1/storefront/catalog/products?locale=de&limit=100')).body.data.find((p: any) => p.id === bikeProduct);
      expect(deBike).toMatchObject({ name: 'Fahrrad', description: 'Ein Rad' });
      const enBike = (await sf.get('/api/v1/storefront/catalog/products?limit=100')).body.data.find((p: any) => p.id === bikeProduct);
      expect(enBike.name).toBe('Bike');
      // Estonian has no translation: the base text shows; the price line is still in Estonian.
      const etBike = (await sf.get('/api/v1/storefront/catalog/products?locale=et&limit=100')).body.data.find((p: any) => p.id === bikeProduct);
      expect(etBike.name).toBe('Bike');
      expect(etBike.variants[0].price.description).not.toBe(enBike.variants[0].price.description);

      // A booking in Japanese: the email and documents follow the customer's language.
      const ja = await sf.get('/api/v1/storefront/settings?locale=ja');
      const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(150), ends_at: iso(151), lines: [{ variant_id: ids.bike, quantity: 1 }] });
      const done = await sf.post(`/api/v1/storefront/checkout_sessions/${cs.body.id}/actions/complete`, { customer: { name: 'Yuki', email: 'yuki@test.dev', locale: 'ja' }, terms_accepted: true, terms_hash: ja.body.terms.hash });
      expect(done.status).toBe(200);
      const mail = (await admin.get(`/api/v1/notifications?order_id=${done.body.order.id}`)).body.data.find((n: any) => n.template === 'order_confirmed');
      expect(mail.subject).toContain(String(done.body.order.number));
      expect(mail.subject).not.toMatch(/Your booking/);
      const doc = (await admin.get(`/api/v1/documents?order_id=${done.body.order.id}`)).body.data[0];
      const html = await admin.get(`/api/v1/documents/${doc.id}/html`);
      expect(html.body).toContain('<html lang="ja">');
      // German terms text has its own hash, accepted too.
      const cs2 = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: iso(152), ends_at: iso(153), lines: [{ variant_id: ids.bike, quantity: 1 }] });
      expect((await sf.post(`/api/v1/storefront/checkout_sessions/${cs2.body.id}/actions/complete`, { customer: { name: 'Jonas', email: 'jonas@test.dev', locale: 'de' }, terms_accepted: true, terms_hash: de.body.terms.hash })).status).toBe(200);

      // Shop texts of a theme per language: only fields that exist and are translatable.
      expect((await admin.put('/api/v1/themes/default/content/de', { values: { 'sections.nope.heading': 'x' } })).status).toBe(422);
      const content = await admin.put('/api/v1/themes/default/content/de', { values: { 'sections.hero.heading': 'Ausrüstung mieten' } });
      expect(content.body.content_translations.de).toEqual({ 'sections.hero.heading': 'Ausrüstung mieten' });
      expect((await sf.get('/api/v1/storefront/settings?locale=de')).body.theme.content).toEqual({ 'sections.hero.heading': 'Ausrüstung mieten' });
      expect((await sf.get('/api/v1/storefront/settings')).body.theme.content).toEqual({});

      // Email templates list per language as plain, editable text.
      const tpl = (await admin.get('/api/v1/notification_templates?locale=de')).body.data.find((x: any) => x.event === 'order_confirmed');
      expect(tpl.body).not.toContain('{{t ');
      expect(tpl.subject).toContain('{{order.number}}');
    } finally {
      await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en'], default_locale: 'en' } });
      await admin.put('/api/v1/themes/default/content/de', { values: { 'sections.hero.heading': null } });
    }
  });
});
