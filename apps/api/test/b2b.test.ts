import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customers, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { postAccounting } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** B2B accounts (FR-CUS-7): on account, PO numbers, credit limits, payment terms and monthly invoices. */
suite('B2B accounts', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>, now = new Date()) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now, plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );
  const order = (customerId: string, days: number, body: Record<string, unknown> = {}) =>
    admin.post('/api/v1/orders', { customer_id: customerId, starts_at: isoIn(days), ends_at: isoIn(days + 2), lines: [{ variant_id: variant, quantity: 1 }], ...body });
  const company = (name: string, b2b: Record<string, unknown>) => admin.post('/api/v1/customers', { type: 'company', name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@test.dev`, b2b });

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Scaffold tower', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 10000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId!}`, { quantity: 50 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('keeps account terms on the customer and checks them', async () => {
    const c = await company('Build Co', { on_account: true, payment_terms_days: 30, credit_limit: 100000, po_required: true });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.b2b).toEqual({ on_account: true, payment_terms_days: 30, credit_limit: 100000, po_required: true, invoice_schedule: 'per_order' });
    const plain = await admin.post('/api/v1/customers', { name: 'Walk In' });
    expect(plain.body.b2b).toMatchObject({ on_account: false, invoice_schedule: 'per_order' });
    const bad = await admin.patch(`/api/v1/customers/${plain.body.id}`, { b2b: { invoice_schedule: 'monthly' } });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'b2b.invoice_schedule']);
    expect((await admin.patch(`/api/v1/customers/${c.body.id}`, { b2b: { payment_terms_days: 400 } })).status).toBe(422);
    expect((await admin.patch(`/api/v1/customers/${c.body.id}`, { b2b: { credit_limit: null } })).body.b2b.credit_limit).toBeNull();
    await admin.patch(`/api/v1/customers/${c.body.id}`, { b2b: { credit_limit: 100000 } });
  });

  it('needs the PO number and keeps on-account bookings within the credit limit, unless staff override it', async () => {
    const c = (await company('Limit Ltd', { on_account: true, payment_terms_days: 14, credit_limit: 50000, po_required: true })).body;
    // 2 days at 100.00 + 20 % tax = 240.00 each.
    const first = (await order(c.id, 10)).body;
    const noPo = await admin.post(`/api/v1/orders/${first.id}/actions/reserve`, { notify: false });
    expect([noPo.status, noPo.body.errors.map((e: any) => e.field)]).toEqual([422, ['po_number']]);
    await admin.patch(`/api/v1/orders/${first.id}`, { po_number: '  PO-7781 ' });
    const reserved = await admin.post(`/api/v1/orders/${first.id}/actions/reserve`, { notify: false });
    expect([reserved.status, reserved.body.po_number]).toEqual([200, 'PO-7781']);
    expect((await admin.get(`/api/v1/customers/${c.id}`)).body.open_balance).toBe(24000);

    const second = (await order(c.id, 14, { po_number: 'PO-7782' })).body;
    const third = (await order(c.id, 18, { po_number: 'PO-7783' })).body;
    expect((await admin.post(`/api/v1/orders/${second.id}/actions/reserve`, { notify: false })).status).toBe(200);
    // 480.00 owed, 240.00 more would pass 500.00.
    const over = await admin.post(`/api/v1/orders/${third.id}/actions/reserve`, { notify: false });
    expect([over.status, over.body.errors[0].field, over.body.errors[0].code]).toEqual([422, 'customer_id', 'credit_limit_exceeded']);
    expect(over.body.errors[0].message).toContain('20.00');
    const forced = await admin.post(`/api/v1/orders/${third.id}/actions/reserve`, { notify: false, override_credit_limit: true });
    expect(forced.status).toBe(200);
    const log = await withSystem(t.deps.db, (db) => db.query(`SELECT action FROM audit_log WHERE entity_id = $1`, [third.id]));
    expect(log.rows.map((r) => r.action)).toContain('credit_limit_override');
    // The list shows what each customer owes.
    const list = (await admin.get('/api/v1/customers?q=Limit')).body.data;
    expect(list.find((x: any) => x.id === c.id).open_balance).toBe(72000);
  });

  it('dates invoices by the terms and closes on-account bookings that are not paid yet', async () => {
    const c = (await company('Terms GmbH', { on_account: true, payment_terms_days: 30 })).body;
    const o = (await order(c.id, 1, { po_number: 'PO-1' })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    const inv = await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const days = (new Date(inv.body.due_at).getTime() - new Date(inv.body.issued_at).getTime()) / 86_400_000;
    expect(days).toBe(30);
    const html = (await withSystem(t.deps.db, (db) => db.query(`SELECT html FROM documents WHERE id = $1`, [inv.body.id]))).rows[0].html;
    expect(html).toContain('Payment due by');
    expect(html).toContain('PO PO-1');
    // Walk the booking through; it closes with the balance owed on the invoice.
    await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true });
    const closed = await admin.post(`/api/v1/orders/${o.id}/actions/close`, {});
    expect([closed.status, closed.body.status]).toEqual([200, 'closed']);
    expect(closed.body.totals.balance.amount).toBeGreaterThan(0);
  });

  it('puts the finished bookings of a monthly customer on one invoice, booked like any invoice', async () => {
    await admin.patch('/api/v1/accounting/settings', { invoice_when: 'checked_out' });
    const c = (await company('Monthly AS', { on_account: true, payment_terms_days: 14, invoice_schedule: 'monthly' })).body;
    const done: any[] = [];
    for (const [days, po] of [[2, 'PO-A'], [4, 'PO-B']] as const) {
      const o = (await order(c.id, days, { po_number: po })).body;
      await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
      await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
      await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true });
      done.push(o);
    }
    // Not invoiced one by one, although the shop invoices at pickup.
    const docs = await admin.get(`/api/v1/documents?type=invoice`);
    expect(docs.body.data.filter((d: any) => done.some((o) => o.id === d.order_id))).toEqual([]);
    // Bookings that have not ended stay off the invoice until next month (job) or "invoice now".
    const nextMonth = new Date(Date.now() + 40 * 86_400_000);
    expect(await inTenant((ctx) => customers.consolidateMonthly(ctx))).toBe(0);
    expect(await inTenant((ctx) => customers.consolidateMonthly(ctx), nextMonth)).toBe(1);
    const inv = (await admin.get(`/api/v1/documents?type=invoice`)).body.data.find((d: any) => d.customer_id === c.id);
    expect(inv).toMatchObject({ order_id: null, orders: done.map((o) => ({ id: o.id, number: o.number })), total: { amount: 48000 } });
    for (const o of done) expect((await admin.get(`/api/v1/orders/${o.id}`)).body.invoice_id).toBe(inv.id);
    const html = (await withSystem(t.deps.db, (db) => db.query(`SELECT html FROM documents WHERE id = $1`, [inv.id]))).rows[0].html;
    expect(html).toContain(`#${done[0].number} · Scaffold tower`);
    expect(html).toContain('PO PO-B');
    // Booked once, as an invoice of the whole amount.
    await postAccounting(t.deps, quietLogger);
    const entry = (await admin.get('/api/v1/accounting/records')).body.data.find((r: any) => r.reference === inv.number);
    expect(entry).toMatchObject({ kind: 'invoice', total: 48000 });
    // Nothing is invoiced twice.
    expect(await inTenant((ctx) => customers.consolidateMonthly(ctx), nextMonth)).toBe(0);
    const again = await admin.post(`/api/v1/customers/${c.id}/actions/invoice_now`);
    expect([again.status, again.body.code]).toEqual([409, 'nothing_to_invoice']);
    expect((await admin.post(`/api/v1/customers/${(await company('Per Order', { on_account: true })).body.id}/actions/invoice_now`)).body.code).toBe('not_invoiced_monthly');
    await admin.patch('/api/v1/accounting/settings', { invoice_when: 'manual' });
  });

  it('invoices a monthly customer at once on request', async () => {
    const c = (await company('Rush Oy', { on_account: true, invoice_schedule: 'monthly' })).body;
    const o = (await order(c.id, 1)).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await admin.post(`/api/v1/orders/${o.id}/actions/check_out`, {});
    expect((await admin.post(`/api/v1/customers/${c.id}/actions/invoice_now`)).body.code).toBe('nothing_to_invoice');
    await admin.post(`/api/v1/orders/${o.id}/actions/check_in`, { all: true });
    const r = await admin.post(`/api/v1/customers/${c.id}/actions/invoice_now`);
    expect([r.status, r.body.orders]).toEqual([201, [{ id: o.id, number: o.number }]]);
    expect(r.body.due_at).toBeTruthy();
  });

  it('lets a signed-in customer on account book on account at checkout, with their PO number', async () => {
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const c = (await company('Shop Online', { on_account: true, payment_terms_days: 21, credit_limit: 30000, po_required: true })).body;
    // A first booking by staff, so the customer can sign in.
    const first = (await order(c.id, 30, { po_number: 'PO-0' })).body;
    await admin.post(`/api/v1/orders/${first.id}/actions/reserve`, { notify: false });
    await sf.post('/api/v1/storefront/account/login', { email: c.email });
    const mail = await withSystem(t.deps.db, (db) => db.query(`SELECT body_html FROM notifications WHERE template_key = 'customer_login' AND recipient = $1 ORDER BY created_at DESC LIMIT 1`, [c.email]));
    const token = /token(?:=|&#x3D;)([\w-]+)/.exec(mail.rows[0].body_html)![1]!;
    const session = (await sf.post('/api/v1/storefront/account/verify', { token })).body.token;
    const as = { 'x-customer-session': session };
    expect((await sf.get('/api/v1/storefront/account/b2b', as)).body).toEqual({ object: 'b2b', on_account: true, po_required: true, payment_terms_days: 21, available_credit: { amount: 6000, currency: 'EUR' } });
    expect((await sf.get('/api/v1/storefront/account/b2b')).body).toEqual({ object: 'b2b', on_account: false });

    const terms = (await sf.get('/api/v1/storefront/settings')).body.terms.hash;
    const cart = async (days: number) => (await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(days), ends_at: isoIn(days + 1), lines: [{ variant_id: variant, quantity: 1 }] })).body.id;
    const complete = (id: string, extra: Record<string, unknown>, headers: Record<string, string> = as) =>
      sf.post(`/api/v1/storefront/checkout_sessions/${id}/actions/complete`, { customer: { name: c.name, email: c.email }, terms_accepted: true, terms_hash: terms, extra }, headers);
    // Not signed in: no booking on account.
    const anon = await complete(await cart(40), { 'b2b.pay_on_account': true }, {});
    expect([anon.status, anon.body.errors[0].field]).toEqual([422, 'extra.b2b.pay_on_account']);
    // Signed in, but the PO number is missing.
    const noPo = await complete(await cart(40), { 'b2b.pay_on_account': true });
    expect([noPo.status, noPo.body.errors[0].field]).toEqual([422, 'extra.b2b.po_number']);
    // One day at 100.00 + tax = 120.00; 60.00 credit left.
    const over = await complete(await cart(40), { 'b2b.pay_on_account': true, 'b2b.po_number': 'PO-9' });
    expect([over.status, over.body.errors[0].field]).toEqual([422, 'extra.b2b.pay_on_account']);
    await admin.patch(`/api/v1/customers/${c.id}`, { b2b: { credit_limit: 100000 } });
    const ok = await complete(await cart(40), { 'b2b.pay_on_account': true, 'b2b.po_number': 'PO-9' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ order: { status: 'reserved' }, payment: null });
    const booked = (await admin.get(`/api/v1/orders/${ok.body.order.id}`)).body;
    expect([booked.customer_id, booked.po_number, booked.source]).toEqual([c.id, 'PO-9', 'storefront']);
  });
});
