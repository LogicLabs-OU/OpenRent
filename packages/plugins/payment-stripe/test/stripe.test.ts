import { describe, expect, it, vi } from 'vitest';
import { createStripeProvider, mapEvent, mapIntentState, type StripeLike } from '../src/provider.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = { tenantId: 'ten_1', config: { secret_key: 'sk_test_x', publishable_key: 'pk_test_x', webhook_secret: 'whsec_x' }, logger, idempotencyKey: 'idem-1' };

function fake(): StripeLike & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    customers: { create: vi.fn(async (p) => (calls.push(['customer', p]), { id: 'cus_s1' })) },
    paymentIntents: {
      create: vi.fn(async (p) => (calls.push(['pi', p]), p.capture_method === 'manual' ? { id: 'pi_dep', status: 'requires_capture', amount: p.amount } : { id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method', amount: p.amount })),
      retrieve: vi.fn(async (id) => ({ id, status: 'succeeded', amount: 6000, amount_received: 6000, currency: 'eur', customer: 'cus_s1', payment_method: 'pm_1', metadata: { order_id: 'ord_1', purpose: 'rental' } })),
      capture: vi.fn(async (id, p) => ({ id, status: 'succeeded', amount: 5000, amount_received: p.amount_to_capture })),
      cancel: vi.fn(async (id) => ({ id, status: 'canceled' })),
    },
    refunds: { create: vi.fn(async () => ({ id: 're_1', status: 'succeeded' })) },
    checkout: { sessions: { create: vi.fn(async (p) => (calls.push(['checkout', p]), { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', expires_at: p.expires_at })) } },
    webhooks: {
      constructEvent: vi.fn((raw, sig) => {
        if (sig !== 'good') throw new Error('bad sig');
        return JSON.parse(String(raw));
      }),
    },
  };
}

describe('stripe provider', () => {
  it('creates a customer and a payment intent that saves the card for the deposit', async () => {
    const f = fake();
    const p = createStripeProvider(() => f);
    const r = await p.createPaymentIntent(ctx, { amount: 6000, currency: 'EUR', orderId: 'ord_1', orderNumber: 1001, purpose: 'rental', customer: { id: 'cus_1', name: 'Ann', email: 'a@x.ee' }, savePaymentMethod: true });
    expect(r).toMatchObject({ ref: 'pi_1', clientSecret: 'pi_1_secret', customerRef: 'cus_s1' });
    const pi = f.calls.find((c) => c[0] === 'pi')[1];
    expect(pi).toMatchObject({ amount: 6000, currency: 'eur', setup_future_usage: 'off_session', metadata: { order_id: 'ord_1', purpose: 'rental' } });
  });

  it('holds deposits with manual capture off-session and captures partially', async () => {
    const f = fake();
    const p = createStripeProvider(() => f);
    const a = await p.authorize(ctx, { amount: 5000, currency: 'EUR', orderId: 'ord_1', customerRef: 'cus_s1', paymentMethodRef: 'pm_1' });
    expect(a.status).toBe('held');
    expect(f.calls.at(-1)[1]).toMatchObject({ capture_method: 'manual', off_session: true, confirm: true });
    const c = await p.capture(ctx, 'pi_dep', 2000);
    expect(c).toEqual({ status: 'partially_captured', amountCaptured: 2000 });
  });

  it('verifies webhook signatures and maps events', async () => {
    const f = fake();
    const p = createStripeProvider(() => f);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 6000, amount_received: 6000, currency: 'eur', customer: 'cus_s1', payment_method: 'pm_1', metadata: { order_id: 'ord_1', purpose: 'rental' } } } }));
    await expect(p.handleWebhook(ctx, { rawBody: body, headers: { 'stripe-signature': 'bad' } })).rejects.toThrow(/Invalid Stripe signature/);
    const ev = await p.handleWebhook(ctx, { rawBody: body, headers: { 'stripe-signature': 'good' } });
    expect(ev).toMatchObject({ type: 'payment.succeeded', orderId: 'ord_1', amount: 6000, currency: 'EUR', paymentMethodRef: 'pm_1', customerRef: 'cus_s1' });
  });

  it('makes a hosted payment link whose payment settles the request', async () => {
    const f = fake();
    const p = createStripeProvider(() => f);
    const r = await p.createPaymentLink!(ctx, {
      amount: 4500, currency: 'EUR', orderId: 'ord_1', orderNumber: 1001, description: 'Order #1001', customer: { id: 'cus_1', name: 'Ann', email: 'a@x.ee' },
      successUrl: 'https://shop.test/order/tok?paid=1', cancelUrl: 'https://shop.test/order/tok', metadata: { payment_request_id: 'prq_1' },
    });
    expect(r).toMatchObject({ ref: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
    const s = f.calls.find((c) => c[0] === 'checkout')[1];
    expect(s).toMatchObject({ mode: 'payment', customer_email: 'a@x.ee', success_url: 'https://shop.test/order/tok?paid=1' });
    expect(s.line_items[0].price_data).toMatchObject({ currency: 'eur', unit_amount: 4500 });
    // The intent carries the request id, so the usual payment_intent.succeeded webhook settles it.
    expect(s.payment_intent_data.metadata).toMatchObject({ payment_request_id: 'prq_1', order_id: 'ord_1', purpose: 'rental' });
    // Never longer than Stripe allows (24 h).
    expect(s.expires_at * 1000 - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
  });

  it('ignores unrelated events', () => {
    expect(mapEvent({ id: 'evt_2', type: 'charge.updated', data: { object: {} } }).type).toBe('ignored');
  });

  it('reads a payment intent back as a stable event when the customer returns', async () => {
    const f = fake();
    const p = createStripeProvider(() => f);
    const ev = await p.retrievePayment!(ctx, 'pi_1');
    expect(ev).toMatchObject({ type: 'payment.succeeded', eventId: 'sync_pi_1_succeeded', ref: 'pi_1', amount: 6000, currency: 'EUR', orderId: 'ord_1', purpose: 'rental', paymentMethodRef: 'pm_1' });
    expect(mapIntentState({ id: 'pi_2', status: 'requires_payment_method', last_payment_error: { message: 'Card declined' }, metadata: {} })).toMatchObject({ type: 'payment.failed', error: 'Card declined' });
    expect(mapIntentState({ id: 'pi_3', status: 'processing', metadata: {} })).toMatchObject({ type: 'ignored' });
  });
});
