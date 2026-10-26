import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Extensions and early returns (FR-OR-9) and customers' extension requests (FR-CUS-6). */
suite('extensions and early returns', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let customer: { id: string };
  let boards: string; // bulk, 10 in stock, 1000 per day

  const order = async (from: number, to: number, quantity = 6, status: 'reserve' | null = 'reserve') => {
    const o = (await admin.post('/api/v1/orders', { customer_id: customer.id, starts_at: isoIn(from), ends_at: isoIn(to), lines: [{ variant_id: boards, quantity }] })).body;
    if (!status) return o;
    const r = await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const available = async (from: string, to: string) => (await admin.get(`/api/v1/availability?variant_id=${boards}&from=${from}&to=${to}`)).body.available;

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    customer = (await admin.post('/api/v1/customers', { name: 'Ext Customer', email: 'ext@test.dev' })).body;
    boards = (await admin.post('/api/v1/products', { type: 'rental', name: 'Paddle board', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } })).body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${boards}/${locationId}`, { quantity: 10 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('previews an extension, then extends with the price difference as its own line', async () => {
    const o = await order(10, 11);
    await order(12, 13);
    // Into day 12 the boards are taken: the preview says so and nothing changes.
    const blocked = await admin.post(`/api/v1/orders/${o.id}/actions/extend`, { ends_at: isoIn(12, 12), dry_run: true });
    expect(blocked.body).toMatchObject({ object: 'end_change', available: false, problem: { code: 'exceeds_availability' } });
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/extend`, { ends_at: isoIn(12, 12) })).status).toBe(409);

    const preview = await admin.post(`/api/v1/orders/${o.id}/actions/extend`, { ends_at: isoIn(12), dry_run: true });
    expect(preview.body).toMatchObject({ available: true, net: { amount: 6000 }, amount: { amount: 7200 } });
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.ends_at).toBe(isoIn(11));

    const done = await admin.post(`/api/v1/orders/${o.id}/actions/extend`, { ends_at: isoIn(12) });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.order.ends_at).toBe(isoIn(12));
    expect(done.body.order.status).toBe('reserved');
    const fee = done.body.order.lines.find((l: any) => l.type === 'fee');
    expect(fee).toMatchObject({ subtotal: { amount: 6000 }, tax: { amount: 1200 } });
    expect(fee.description).toContain('Extension until');
    expect(done.body.order.totals.total.amount).toBe(7200 * 2);
    expect(await available(isoIn(11, 12), isoIn(11, 13))).toBe(4);
    const mails = (await admin.get(`/api/v1/notifications?order_id=${o.id}`)).body.data.map((n: any) => n.template);
    expect(mails).toContain('order_extended');
    const tl = (await admin.get(`/api/v1/orders/${o.id}/timeline`)).body.data.map((e: any) => e.type);
    expect(tl).toContain('extended');
  });

  it('brings a return forward and credits the unused time', async () => {
    const o = await order(20, 23, 2);
    const done = await admin.post(`/api/v1/orders/${o.id}/actions/return_early`, { ends_at: isoIn(21) });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const credit = done.body.order.lines.find((l: any) => l.type === 'discount');
    expect(credit).toMatchObject({ discount: { amount: 4000 }, tax: { amount: -800 }, total: { amount: -4800 } });
    expect(done.body.order.totals.total.amount).toBe(7200 - 4800);
    expect(await available(isoIn(22), isoIn(23))).toBe(10);
    // Without credit only the dates move.
    const plain = await order(30, 33, 1);
    const kept = await admin.post(`/api/v1/orders/${plain.id}/actions/return_early`, { ends_at: isoIn(31), credit: false });
    expect(kept.body.order.lines.filter((l: any) => l.type !== 'rental')).toEqual([]);
    expect((await admin.post(`/api/v1/orders/${plain.id}/actions/return_early`, { ends_at: isoIn(29) })).body.errors[0].field).toBe('ends_at');
  });

  it('uses an extension fee rule and invoices the difference when the order was invoiced', async () => {
    await admin.post('/api/v1/fee_rules', { name: 'Extension fee', kind: 'extension', calculation: 'flat', amount: 1500 });
    const o = await order(40, 41, 1);
    expect((await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' })).status).toBe(201);
    const done = await admin.post(`/api/v1/orders/${o.id}/actions/extend`, { ends_at: isoIn(43) });
    expect(done.body).toMatchObject({ net: { amount: 1500 }, amount: { amount: 1800 } });
    const invoices = (await admin.get(`/api/v1/documents?order_id=${o.id}&type=invoice`)).body.data;
    expect(invoices).toHaveLength(2);
    expect(invoices.map((d: any) => d.total.amount ?? d.total).sort()).toEqual(expect.arrayContaining([1800]));
  });

  it('refuses drafts and returns before the current end', async () => {
    const draft = await order(50, 51, 1, null);
    expect((await admin.post(`/api/v1/orders/${draft.id}/actions/extend`, { ends_at: isoIn(52) })).body.code).toBe('order_locked');
    const o = await order(50, 51, 1);
    expect((await admin.post(`/api/v1/orders/${o.id}/actions/extend`, { ends_at: isoIn(50, 12) })).body.errors[0].field).toBe('ends_at');
  });

  it('lets a customer ask for more time, and staff approve or decline', async () => {
    const o = await order(60, 61, 1);
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const pub = (await sf.get(`/api/v1/storefront/orders/${o.public_token}?token=${o.public_token}`)).body;
    expect(pub.can_request_extension).toBe(true);
    const tooEarly = await sf.post(`/api/v1/storefront/orders/${o.id}/extension_request`, { token: o.public_token, ends_at: isoIn(60, 12) });
    expect(tooEarly.body.errors[0].field).toBe('ends_at');
    const asked = await sf.post(`/api/v1/storefront/orders/${o.id}/extension_request`, { token: o.public_token, ends_at: isoIn(62), reason: 'Lovely weather' });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect(asked.body).toMatchObject({ object: 'extension_request', status: 'pending', reason: 'Lovely weather' });
    expect((await sf.post(`/api/v1/storefront/orders/${o.id}/extension_request`, { token: o.public_token, ends_at: isoIn(63) })).status).toBe(409);
    const pending = (await admin.get('/api/v1/extension_requests?status=pending')).body.data;
    expect(pending.map((r: any) => r.order_number)).toContain(o.number);
    const approved = await admin.post(`/api/v1/extension_requests/${asked.body.id}/actions/approve`, {});
    expect(approved.body.status).toBe('approved');
    expect((await admin.get(`/api/v1/orders/${o.id}`)).body.ends_at).toBe(isoIn(62));

    const again = await sf.post(`/api/v1/storefront/orders/${o.id}/extension_request`, { token: o.public_token, ends_at: isoIn(64) });
    const declined = await admin.post(`/api/v1/extension_requests/${again.body.id}/actions/decline`, { note: 'Booked by someone else' });
    expect(declined.body).toMatchObject({ status: 'declined', decision_note: 'Booked by someone else' });
    const mails = (await admin.get(`/api/v1/notifications?order_id=${o.id}`)).body.data.map((n: any) => n.template);
    expect(mails).toEqual(expect.arrayContaining(['extension_request_received', 'extension_declined', 'order_extended']));
  });
});
