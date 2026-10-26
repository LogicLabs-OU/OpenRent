import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreatePaymentIntentInput, ProviderContext } from '@openrent/plugin-sdk';
import { startPayPalFake, type PayPalFake } from '@openrent/payment-fakes';
import { createPayPalProvider, packRefs, unpackRefs } from '../src/index.ts';

const paypal = createPayPalProvider();
const intent = (over: Partial<CreatePaymentIntentInput> = {}): CreatePaymentIntentInput => ({
  amount: 12050, currency: 'EUR', orderId: 'ord_1', orderNumber: 1042, purpose: 'rental', customer: { id: 'cus_1', name: 'Ada', email: 'ada@example.org', providerRef: null },
  savePaymentMethod: false, description: 'Booking #1042', metadata: { payment_request_id: 'prq_1' }, returnUrl: 'https://shop.example/order/tok', ...over,
});

describe('PayPal against the PayPal fake', () => {
  let fake: PayPalFake;
  let ctx: ProviderContext;
  beforeAll(async () => {
    fake = await startPayPalFake();
    ctx = { tenantId: 'ten_1', config: { client_id: fake.clientId, client_secret: fake.clientSecret, webhook_id: fake.webhookId, api_base_url: fake.url }, logger: console as any };
  });
  afterAll(() => fake.close());
  const hook = (event: unknown, headers = fake.webhookHeaders()) => paypal.handleWebhook(ctx, { rawBody: Buffer.from(JSON.stringify(event)), headers });

  it('packs OpenRent’s references into custom_id', () => {
    const packed = packRefs({ tenant: 'ten_1', order: 'ord_1', purpose: 'rental', request: 'prq_1' });
    expect(packed.length).toBeLessThanOrEqual(127);
    expect(unpackRefs(packed)).toEqual({ tenant: 'ten_1', order: 'ord_1', purpose: 'rental', request: 'prq_1' });
  });

  it('sends the customer to PayPal, captures once on their return, and refunds the capture', async () => {
    const r = await paypal.createPaymentIntent(ctx, intent());
    expect(r).toMatchObject({ clientSecret: null, redirectUrl: expect.stringContaining(`checkoutnow?token=${r.ref}`) });
    expect((await paypal.retrievePayment!(ctx, r.ref)).type).toBe('ignored');
    fake.approve(r.ref);
    const paid = await paypal.retrievePayment!(ctx, r.ref);
    expect(paid).toMatchObject({ type: 'payment.succeeded', ref: r.ref, amount: 12050, currency: 'EUR', orderId: 'ord_1', paymentRequestId: 'prq_1' });
    // Coming back twice captures nothing more.
    expect(await paypal.retrievePayment!(ctx, r.ref)).toEqual(paid);
    expect(fake.orders.find((o) => o.id === r.ref)!.captures).toHaveLength(1);
    expect(await paypal.refund(ctx, r.ref, 2050)).toMatchObject({ status: 'succeeded' });
    await expect(paypal.refund(ctx, r.ref, 20000)).rejects.toThrow(/REFUND_AMOUNT_EXCEEDED/);
  });

  it('keeps the PayPal account for deposits: holds, captures and voids with it', async () => {
    const r = await paypal.createPaymentIntent(ctx, intent({ savePaymentMethod: true }));
    fake.approve(r.ref);
    const paid = (await paypal.retrievePayment!(ctx, r.ref)) as any;
    expect(paid.paymentMethodRef).toMatch(/^VLT/);
    const hold = await paypal.authorize(ctx, { amount: 20000, currency: 'EUR', orderId: 'ord_1', customerRef: paid.customerRef, paymentMethodRef: paid.paymentMethodRef });
    expect(hold.status).toBe('held');
    expect(await paypal.capture(ctx, hold.ref, 5000)).toEqual({ status: 'partially_captured', amountCaptured: 5000 });
    const second = await paypal.authorize(ctx, { amount: 20000, currency: 'EUR', orderId: 'ord_1', customerRef: paid.customerRef, paymentMethodRef: paid.paymentMethodRef });
    await paypal.void(ctx, second.ref);
    expect(fake.orders.find((o) => o.id === second.ref)!.authorizations[0]!.status).toBe('VOIDED');
    expect((await paypal.authorize(ctx, { amount: 100, currency: 'EUR', orderId: 'ord_1', customerRef: 'x', paymentMethodRef: 'VLT-none' })).status).toBe('failed');
  });

  it('accepts only webhooks PayPal signed, and captures an approved order from one', async () => {
    const r = await paypal.createPaymentIntent(ctx, intent());
    fake.approve(r.ref);
    const event = { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: r.ref } };
    await expect(hook(event, { ...fake.webhookHeaders(), 'paypal-transmission-sig': 'forged' })).rejects.toMatchObject({ status: 400 });
    expect(await hook(event)).toMatchObject({ type: 'payment.succeeded', ref: r.ref });
    const cap = fake.orders.find((o) => o.id === r.ref)!.captures[0]!;
    expect(await hook({ id: 'WH-2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: cap.id, supplementary_data: { related_ids: { order_id: r.ref } } } })).toMatchObject({ type: 'payment.succeeded', eventId: `${r.ref}:captured` });
    const refund = await paypal.refund(ctx, r.ref, 1000);
    expect(await hook({ id: 'WH-3', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: refund.ref, amount: { currency_code: 'EUR', value: '10.00' }, links: [{ rel: 'up', href: `${fake.url}/v2/payments/captures/${cap.id}` }] } })).toEqual({
      type: 'refund.succeeded', eventId: 'WH-3', ref: refund.ref, paymentRef: r.ref, amount: 1000,
    });
  });

  it('reports a declined capture', async () => {
    const r = await paypal.createPaymentIntent(ctx, intent());
    fake.approve(r.ref);
    fake.declineNext();
    expect(await paypal.retrievePayment!(ctx, r.ref)).toMatchObject({ type: 'payment.failed' });
  });
});
