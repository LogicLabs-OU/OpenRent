import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, type PaymentProvider } from '@openrent/plugin-sdk';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('widget checkout', () => {
  let t: TestApp;
  let admin: Client;
  let variant: string;
  let terms: string;
  const links: { successUrl: string; cancelUrl: string; amount: number }[] = [];
  const shop = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url: `/api/v1/storefront${url}`, payload: payload as any }).then((r) => ({ status: r.statusCode, body: r.json() }));

  beforeAll(async () => {
    let locationId: string;
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    const provider: PaymentProvider = {
      id: 'linkpay',
      displayName: 'Link pay',
      authorizationWindowDays: 7,
      isConfigured: () => true,
      publicConfig: () => ({}),
      createPaymentIntent: async () => ({ ref: 'lpi_1', clientSecret: 'secret', status: 'requires_payment' }),
      async createPaymentLink(_c, input) {
        links.push({ successUrl: input.successUrl, cancelUrl: input.cancelUrl, amount: input.amount });
        return { ref: `lnk_${links.length}`, url: `https://pay.example/${links.length}`, expiresAt: null };
      },
      authorize: async () => ({ ref: 'x', status: 'held', expiresAt: null }),
      capture: async (_c, _r, amount) => ({ status: 'captured', amountCaptured: amount }),
      void: async () => undefined,
      refund: async () => ({ ref: 'r', status: 'succeeded' }),
      handleWebhook: async () => ({ type: 'ignored', eventId: 'x', providerType: 'x' }),
    };
    await t.deps.plugins.register(definePlugin({ id: 'linkpay', name: 'Link pay', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerPaymentProvider(provider) }));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId!}`, { quantity: 10 });
    terms = (await shop('GET', '/settings')).body.terms.hash;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  const book = async (returnUrl?: string) => {
    const s = await shop('POST', '/checkout_sessions', { starts_at: isoIn(5), ends_at: isoIn(6), lines: [{ variant_id: variant, quantity: 1 }] });
    // Lines carry their names, however many products the shop has.
    expect(s.body.lines[0]).toMatchObject({ variant_id: variant, quantity: 1, product_name: 'Canoe', variant_name: 'Canoe', product_slug: expect.any(String) });
    return shop('POST', `/checkout_sessions/${s.body.id}/actions/complete`, { customer: { name: 'Widget Buyer', email: `w-${Math.random()}@test.dev` }, terms_accepted: true, terms_hash: terms, ...(returnUrl ? { return_url: returnUrl } : {}) });
  };

  it('keeps the shop’s list of widget sites valid', async () => {
    const bad = await admin.patch('/api/v1/tenant/settings', { widget_origins: ['https://ok.example', 'https://bad.example/path'] });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].field).toBe('widget_origins.1');
    expect((await admin.patch('/api/v1/tenant/settings', { widget_origins: ['https://www.merchant.example'] })).body.widget_origins).toEqual(['https://www.merchant.example']);
  });

  it('books without online payment from any site', async () => {
    const r = await book('https://anywhere.example/page');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ order: { status: 'reserved' }, payment: null });
  });

  it('sends the customer to the provider and back to the embedding page', async () => {
    await admin.patch('/api/v1/tenant/settings', { storefront: { payment: 'stripe' } });
    const refused = await book('https://evil.example/steal');
    expect(refused.status).toBe(422);
    expect(refused.body.errors[0].field).toBe('return_url');

    const r = await book('https://www.merchant.example/rent?openrent_order=old&x=1');
    expect(r.status).toBe(200);
    expect(r.body.payment).toMatchObject({ object: 'payment_redirect', url: expect.stringMatching(/^https:\/\/pay\.example\//) });
    const link = links.at(-1)!;
    const success = new URL(link.successUrl);
    expect(success.origin + success.pathname).toBe('https://www.merchant.example/rent');
    expect(Object.fromEntries(success.searchParams)).toEqual({ x: '1', openrent_order: r.body.order.id, openrent_token: r.body.order.token, openrent_paid: '1' });
    expect(new URL(link.cancelUrl).searchParams.get('openrent_paid')).toBeNull();
    expect(link.amount).toBe(r.body.order.totals.total.amount);

    // The widget shows the booking from the order id and token in the URL.
    const order = await shop('GET', `/orders/${r.body.order.id}?token=${r.body.order.token}`);
    expect(order.body.number).toBe(r.body.order.number);
    // The storefront itself is always allowed.
    expect((await book('http://localhost:7072/cart')).status).toBe(200);
  });
});
