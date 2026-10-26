import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, type PaymentProvider } from '@openrent/plugin-sdk';
import { withSystem } from '@openrent/db';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** The customer portal (FR-CUS-6, PRD §5.4 /portal): sign-in, bookings, balances, extensions and insurance uploads. */
suite('customer portal', () => {
  let t: TestApp;
  let admin: Client;
  let variant: string;
  let customer: any;
  let order: any;
  let session: string;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const as = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals', 'x-customer-session': session });
  const linkTo = async (email: string, template: string) => {
    const r = await withSystem(t.deps.db, (c) => c.query(`SELECT body_html FROM notifications WHERE template_key = $2 AND recipient = $1 ORDER BY created_at DESC LIMIT 1`, [email, template]));
    return /token(?:=|&#x3D;)([\w-]+)/.exec(r.rows[0]?.body_html ?? '')?.[1];
  };

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Trailer', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId!}`, { quantity: 5 });
    customer = (await admin.post('/api/v1/customers', { name: 'Pia Portal', email: 'pia@test.dev' })).body;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('lets staff send an account link before the first booking; it opens a session once', async () => {
    const none = (await admin.post('/api/v1/customers', { name: 'No Mail' })).body;
    expect((await admin.post(`/api/v1/customers/${none.id}/actions/send_portal_link`)).body.errors[0].field).toBe('email');
    const sent = await admin.post(`/api/v1/customers/${customer.id}/actions/send_portal_link`);
    expect([sent.status, sent.body]).toEqual([202, { object: 'portal_link', sent: true, email: 'pia@test.dev' }]);
    const token = (await linkTo('pia@test.dev', 'portal_invitation'))!;
    const verified = await shop().post('/api/v1/portal/auth/verify', { token });
    expect(verified.status).toBe(200);
    session = verified.body.token;
    expect((await shop().post('/api/v1/portal/auth/verify', { token })).status).toBe(401);
    expect((await shop().get('/api/v1/portal/me')).status).toBe(401);
    const me = await as().get('/api/v1/portal/me');
    expect(me.body).toMatchObject({ object: 'account', email: 'pia@test.dev', name: 'Pia Portal', b2b: null, open_balance: { amount: 0 }, insurance: [], signature_requests: [] });
    // The same as the storefront login for customers with bookings.
    expect((await shop().post('/api/v1/portal/auth/request_link', { email: 'nobody@test.dev' })).status).toBe(202);
  });

  it('shows bookings with what is left to pay, and only the customer’s own', async () => {
    order = (await admin.post('/api/v1/orders', { customer_id: customer.id, starts_at: isoIn(10), ends_at: isoIn(12), lines: [{ variant_id: variant, quantity: 1 }], po_number: 'P-1' })).body;
    await admin.post(`/api/v1/orders/${order.id}/actions/reserve`, { notify: false });
    const other = (await admin.post('/api/v1/customers', { name: 'Other', email: 'other@test.dev' })).body;
    const theirs = (await admin.post('/api/v1/orders', { customer_id: other.id, starts_at: isoIn(10), ends_at: isoIn(11), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    await admin.post(`/api/v1/orders/${theirs.id}/actions/reserve`, { notify: false });

    const list = (await as().get('/api/v1/portal/orders')).body.data;
    expect(list.map((o: any) => o.id)).toEqual([order.id]);
    // 2 days at 50.00 + 20 % tax.
    expect(list[0]).toMatchObject({ balance: { amount: 12000 }, order_url: expect.stringContaining(`/order/${order.public_token}`) });
    const one = await as().get(`/api/v1/portal/orders/${order.id}`);
    expect(one.body).toMatchObject({ number: order.number, po_number: 'P-1', totals: { total: { amount: 12000 }, paid: { amount: 0 }, balance: { amount: 12000 } }, lines: [{ description: 'Trailer', quantity: 1 }] });
    expect((await as().get(`/api/v1/portal/orders/${theirs.id}`)).status).toBe(404);
    expect((await as().get('/api/v1/portal/me')).body.open_balance.amount).toBe(12000);
  });

  it('asks the shop for more time and changes the profile', async () => {
    const r = await as().post(`/api/v1/portal/orders/${order.id}/actions/request_extension`, { ends_at: isoIn(14), reason: 'Moving takes longer' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await as().patch('/api/v1/portal/me', { phone: '+372 555 0101' })).body.phone).toBe('+372 555 0101');
  });

  it('pays what is left online once the shop takes payments', async () => {
    const refused = await as().post(`/api/v1/portal/orders/${order.id}/payment_intents`);
    expect([refused.status, refused.body.code]).toEqual([409, 'online_payment_unavailable']);
    const provider: PaymentProvider = {
      id: 'testpay', displayName: 'Test pay', authorizationWindowDays: 7, isConfigured: () => true, publicConfig: () => ({ publishable_key: 'pk_test' }),
      createPaymentIntent: async () => ({ ref: 'tpi_1', clientSecret: 'cs_secret', status: 'requires_payment' }),
      createPaymentLink: async () => ({ ref: 'lnk', url: 'https://pay.example/x', expiresAt: null }),
      authorize: async () => ({ ref: 'x', status: 'held', expiresAt: null }), capture: async (_c, _r, amount) => ({ status: 'captured', amountCaptured: amount }),
      void: async () => undefined, refund: async () => ({ ref: 'r', status: 'succeeded' }), handleWebhook: async () => ({ type: 'ignored', eventId: 'x', providerType: 'x' }),
    };
    await t.deps.plugins.register(definePlugin({ id: 'testpay', name: 'Test pay', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerPaymentProvider(provider) }));
    const intent = await as().post(`/api/v1/portal/orders/${order.id}/payment_intents`);
    expect(intent.status, JSON.stringify(intent.body)).toBe(200);
    expect(intent.body).toMatchObject({ client_secret: 'cs_secret', amount: { amount: 12000 } });
    const requests = (await admin.get(`/api/v1/orders/${order.id}?expand=payment_requests`)).body.payment_requests;
    expect(requests.map((x: any) => [x.kind, x.status, x.amount.amount])).toEqual([['balance', 'open', 12000]]);
    // A second try reuses the open request.
    await as().post(`/api/v1/portal/orders/${order.id}/payment_intents`);
    expect((await admin.get(`/api/v1/orders/${order.id}?expand=payment_requests`)).body.payment_requests).toHaveLength(1);
  });

  it('takes an insurance certificate that then counts at pickup', async () => {
    await admin.patch('/api/v1/tenant/settings', { requires_waiver_or_insurance: true });
    const blocked = await admin.post(`/api/v1/orders/${order.id}/actions/check_out`, {});
    expect([blocked.status, blocked.body.code]).toEqual([409, 'waiver_or_insurance_required']);
    const bad = await as().upload('/api/v1/portal/insurance', 'tool.exe', 'application/x-msdownload', Buffer.from('MZ'));
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'file']);
    const ok = await as().upload('/api/v1/portal/insurance', 'policy.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF'));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await as().get('/api/v1/portal/me')).body.insurance).toEqual([expect.objectContaining({ label: 'policy.pdf', filename: 'policy.pdf' })]);
    const staffSide = (await admin.get(`/api/v1/customers/${customer.id}/attachments`)).body.data;
    expect(staffSide.map((a: any) => [a.kind, a.visibility])).toEqual([['insurance', 'customer']]);
    expect((await admin.post(`/api/v1/orders/${order.id}/actions/check_out`, {})).status).toBe(200);
    await admin.patch('/api/v1/tenant/settings', { requires_waiver_or_insurance: false });
  });
});
