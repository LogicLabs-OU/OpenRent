import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounting, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Customers cancel and move bookings themselves when the shop allows it; the money follows (ADR 0012). */
suite('self-service cancellation and date changes', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let locationId: string;
  let variant: string;
  let customer: any;
  let session = '';
  const as = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals', 'x-customer-session': session });
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }));
  const booked = async (orderId: string) => {
    await inTenant((ctx) => accounting.postPending(ctx));
    return (await withTenant(t.deps.db, tenantId, (c) => c.query(`SELECT e.kind, json_agg(json_build_array(l.account_key, l.debit::int, l.credit::int) ORDER BY l.position) AS lines FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id WHERE e.order_id = $1 GROUP BY e.id ORDER BY e.number`, [orderId]))).rows;
  };
  /** A reserved booking of the customer, paid in full, `days` days ahead for one day. */
  const paidBooking = async (days: number, quantity = 1) => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(days), ends_at: isoIn(days + 1), lines: [{ variant_id: variant, quantity }], deposit: { mode: 'none' } })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await admin.post(`/api/v1/orders/${o.id}/payments`, { amount: o.totals.total.amount, method: 'cash' });
    return (await admin.get(`/api/v1/orders/${o.id}`)).body;
  };

  beforeAll(async () => {
    ({ t, admin, tenantId, locationId } = await shopForTests(dbinfo!));
    variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Van', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 10000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 2 });
    customer = (await admin.post('/api/v1/customers', { name: 'Self Server', email: 'self@test.dev' })).body;
    await admin.post(`/api/v1/customers/${customer.id}/actions/send_portal_link`);
    const r = await withSystem(t.deps.db, (c) => c.query(`SELECT body_html FROM notifications WHERE template_key = 'portal_invitation' AND recipient = 'self@test.dev' ORDER BY created_at DESC LIMIT 1`));
    session = (await new Client(t.app, { 'x-tenant-slug': 'test-rentals' }).post('/api/v1/portal/auth/verify', { token: /token(?:=|&#x3D;)([\w-]+)/.exec(r.rows[0].body_html)![1]! })).body.token;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('checks the self-service settings and the refund steps field by field', async () => {
    const bad = await admin.patch('/api/v1/tenant/settings', { self_service: { cancel: 'always', cancel_until_hours: -1 } });
    expect([bad.status, bad.body.errors.map((e: any) => e.field).sort()]).toEqual([422, ['self_service.cancel', 'self_service.cancel_until_hours']]);
    const tiers = await admin.patch('/api/v1/tenant/settings', { cancellation_policy: [{ hours_before: 24, refund_pct: 120 }] });
    expect([tiers.status, tiers.body.errors[0].field]).toEqual([422, 'cancellation_policy.0.refund_pct']);
  });

  it('keeps "ask to cancel" unless the shop lets customers cancel themselves', async () => {
    const o = await paidBooking(10);
    const acct = (await as().get('/api/v1/storefront/account')).body.orders.find((x: any) => x.id === o.id);
    expect(acct.self_service).toMatchObject({ cancel: null, change_dates: null });
    expect(acct.can_request_cancellation).toBe(true);
    expect((await as().post(`/api/v1/storefront/account/orders/${o.id}/actions/cancel`, {})).status).toBe(409);
  });

  it('lets a customer cancel with the refund of the shop’s tiers, and books the refund', async () => {
    await admin.patch('/api/v1/tenant/settings', { self_service: { cancel: 'self', cancel_until_hours: 24 }, cancellation_policy: [{ hours_before: 168, refund_pct: 100 }, { hours_before: 48, refund_pct: 50 }, { hours_before: 0, refund_pct: 0 }] });
    const o = await paidBooking(5);
    const acct = (await as().get('/api/v1/storefront/account')).body.orders.find((x: any) => x.id === o.id);
    expect(acct.self_service.cancel).toEqual({ refund_pct: 50 });
    expect(acct.can_request_cancellation).toBe(false);
    const r = await as().post(`/api/v1/storefront/account/orders/${o.id}/actions/cancel`, { reason: 'Plans changed' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await admin.get(`/api/v1/orders/${o.id}`)).body;
    expect(after.status).toBe('cancelled');
    expect(after.totals.refunded.amount).toBe(Math.round(o.totals.total.amount / 2));
    const audit = (await admin.get(`/api/v1/audit_log?filter[entity_id]=${o.id}`)).body.data.find((a: any) => a.action === 'cancel' || a.action === 'cancelled');
    expect(audit?.actor_type ?? 'customer').toBe('customer');
    expect((await admin.get('/api/v1/me/notifications')).body.data.map((n: any) => n.kind)).toContain('staff_customer_cancelled');
    expect((await booked(o.id)).some((e: any) => e.kind === 'refund' || e.lines.some((l: any) => l[0] === 'cash' && l[2] > 0))).toBe(true);
    // Too close to pickup: only asking is left.
    const soon = await paidBooking(0.5);
    expect((await as().post(`/api/v1/storefront/account/orders/${soon.id}/actions/cancel`, {})).status).toBe(409);
  });

  it('moves a booking to dearer dates: a fee line, owed online', async () => {
    await admin.patch('/api/v1/tenant/settings', { self_service: { change_dates: 'self', change_until_hours: 24 } });
    const o = await paidBooking(12);
    const preview = await as().post(`/api/v1/storefront/account/orders/${o.id}/actions/change_dates`, { starts_at: isoIn(14), ends_at: isoIn(16), dry_run: true });
    expect(preview.body).toMatchObject({ object: 'reschedule', available: true, mode: 'self', net: { amount: 10000 } });
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.starts_at).toBe(o.starts_at);
    const r = await as().post(`/api/v1/storefront/account/orders/${o.id}/actions/change_dates`, { starts_at: isoIn(14), ends_at: isoIn(16) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await admin.get(`/api/v1/orders/${o.id}`)).body;
    expect([new Date(after.starts_at).toISOString(), new Date(after.ends_at).toISOString()]).toEqual([isoIn(14), isoIn(16)]);
    expect(after.totals.balance.amount).toBe(12000);
    expect(after.lines.map((l: any) => l.type)).toContain('fee');
    const owing = (await as().get('/api/v1/portal/me')).body.owing.find((x: any) => x.id === o.id);
    expect(owing.balance.amount).toBe(12000);
  });

  it('moves a booking to cheaper dates: a credit, a credit note when invoiced, and the overpaid part refunded', async () => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(20), ends_at: isoIn(22), lines: [{ variant_id: variant, quantity: 1 }], deposit: { mode: 'none' } })).body;
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await admin.post(`/api/v1/orders/${o.id}/payments`, { amount: o.totals.total.amount, method: 'cash' });
    await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' });
    const r = await as().post(`/api/v1/storefront/account/orders/${o.id}/actions/change_dates`, { starts_at: isoIn(25), ends_at: isoIn(26) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await admin.get(`/api/v1/orders/${o.id}?expand=documents`)).body;
    expect(after.totals.balance.amount).toBe(0);
    expect(after.totals.refunded.amount).toBe(12000);
    expect(after.documents.map((d: any) => d.type)).toContain('credit_note');
    const entries = await booked(o.id);
    expect(entries.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['invoice', 'credit_note']));
  });

  it('refuses dates that are taken or outside the shop’s rules, and leaves the booking as it was', async () => {
    const mine = await paidBooking(30, 1);
    const other = (await admin.post('/api/v1/orders', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(40), ends_at: isoIn(41), lines: [{ variant_id: variant, quantity: 2 }], deposit: { mode: 'none' } })).body;
    expect((await admin.post(`/api/v1/orders/${other.id}/actions/reserve`, { notify: false })).status).toBe(200);
    const taken = await as().post(`/api/v1/storefront/account/orders/${mine.id}/actions/change_dates`, { starts_at: isoIn(40), ends_at: isoIn(41) });
    expect(taken.status).toBe(409);
    const dry = await as().post(`/api/v1/storefront/account/orders/${mine.id}/actions/change_dates`, { starts_at: isoIn(40), ends_at: isoIn(41), dry_run: true });
    expect(dry.body).toMatchObject({ available: false });
    expect((await as().post(`/api/v1/storefront/account/orders/${mine.id}/actions/change_dates`, { starts_at: isoIn(-1), ends_at: isoIn(1) })).status).toBe(422);
    const still = (await admin.get(`/api/v1/orders/${mine.id}`)).body;
    expect(still.starts_at).toBe(mine.starts_at);
    // The stock it held is still held: a third booking of 2 at its dates does not fit.
    const third = (await admin.post('/api/v1/orders', { customer_id: customer.id, location_id: locationId, starts_at: isoIn(30), ends_at: isoIn(31), lines: [{ variant_id: variant, quantity: 2 }], deposit: { mode: 'none' } })).body;
    expect((await admin.post(`/api/v1/orders/${third.id}/actions/reserve`, { notify: false })).status).toBe(409);
  });

  it('turns a date change into a request staff approve, when the shop wants to decide', async () => {
    await admin.patch('/api/v1/tenant/settings', { self_service: { change_dates: 'request' } });
    const o = await paidBooking(50);
    const r = await as().post(`/api/v1/storefront/account/orders/${o.id}/actions/change_dates`, { starts_at: isoIn(52), ends_at: isoIn(53), reason: 'Flight moved' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ object: 'extension_request', status: 'pending', mode: 'request' });
    expect(new Date(r.body.requested_starts_at).toISOString()).toBe(isoIn(52));
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.starts_at).toBe(o.starts_at);
    const approved = await admin.post(`/api/v1/extension_requests/${r.body.id}/actions/approve`, {});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(new Date((await admin.get(`/api/v1/orders/${o.id}`)).body.starts_at).toISOString()).toBe(isoIn(52));
  });
});
