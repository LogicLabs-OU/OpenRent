import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreatePaymentIntentInput, ProviderContext } from '@openrent/plugin-sdk';
import { startMollieFake, type MollieFake } from '@openrent/payment-fakes';
import { createMollieProvider, mollieAmount } from '../src/index.ts';

const mollie = createMollieProvider();
const intent = (over: Partial<CreatePaymentIntentInput> = {}): CreatePaymentIntentInput => ({
  amount: 12050, currency: 'EUR', orderId: 'ord_1', orderNumber: 1042, purpose: 'rental', customer: { id: 'cus_1', name: 'Ada', email: 'ada@example.org', providerRef: null },
  savePaymentMethod: false, description: 'Booking #1042', metadata: { payment_request_id: 'prq_1' }, returnUrl: 'https://shop.example/order/tok', ...over,
});
const body = (id: string) => ({ rawBody: Buffer.from(`id=${id}`), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

describe('Mollie against the Mollie fake', () => {
  let fake: MollieFake;
  let ctx: ProviderContext;
  beforeAll(async () => {
    fake = await startMollieFake();
    ctx = { tenantId: 'ten_1', config: { api_key: fake.apiKey, api_base_url: fake.url }, logger: console as any, webhookUrl: 'https://api.example/webhooks/mollie/ten_1' };
  });
  afterAll(() => fake.close());

  it('writes amounts as Mollie wants them and checks the key format', () => {
    expect([mollieAmount(12050, 'EUR'), mollieAmount(1200, 'JPY')]).toEqual([{ currency: 'EUR', value: '120.50' }, { currency: 'JPY', value: '1200' }]);
    expect(mollie.isConfigured({ ...ctx, config: { api_key: 'sk_test_123' } })).toBe(false);
    expect(mollie.isConfigured(ctx)).toBe(true);
  });

  it('sends the customer to Mollie and learns the result from the webhook by fetching the payment', async () => {
    const r = await mollie.createPaymentIntent(ctx, intent());
    expect(r).toMatchObject({ clientSecret: null, status: 'requires_payment', redirectUrl: expect.stringContaining(`/checkout/${r.ref}`) });
    const p = fake.payments.find((x) => x.id === r.ref)!;
    expect([p.redirectUrl, p.webhookUrl, p.amount.value, p.sequenceType]).toEqual(['https://shop.example/order/tok', ctx.webhookUrl, '120.50', 'oneoff']);
    expect(await mollie.handleWebhook(ctx, body(r.ref))).toMatchObject({ type: 'ignored' });
    fake.checkout(r.ref);
    expect(await mollie.handleWebhook(ctx, body(r.ref))).toEqual({
      type: 'payment.succeeded', eventId: `${r.ref}:paid`, ref: r.ref, amount: 12050, currency: 'EUR', orderId: 'ord_1', purpose: 'rental', customerRef: null, paymentMethodRef: null, paymentRequestId: 'prq_1',
    });
    await expect(mollie.handleWebhook(ctx, { rawBody: Buffer.from('id=../../etc'), headers: {} })).rejects.toMatchObject({ status: 400 });
  });

  it('keeps a mandate from the first payment and holds, captures and releases deposits with it', async () => {
    const first = await mollie.createPaymentIntent(ctx, intent({ savePaymentMethod: true }));
    expect(first.customerRef).toMatch(/^cst_/);
    fake.checkout(first.ref);
    const paid = await mollie.retrievePayment!(ctx, first.ref);
    expect(paid).toMatchObject({ type: 'payment.succeeded', customerRef: first.customerRef, paymentMethodRef: expect.stringMatching(/^mdt_/) });
    const mandate = (paid as any).paymentMethodRef;
    const hold = await mollie.authorize(ctx, { amount: 20000, currency: 'EUR', orderId: 'ord_1', customerRef: first.customerRef!, paymentMethodRef: mandate });
    expect(hold.status).toBe('held');
    expect(await mollie.capture(ctx, hold.ref, 5000)).toEqual({ status: 'partially_captured', amountCaptured: 5000 });
    await expect(mollie.capture(ctx, hold.ref, 5000)).rejects.toThrow(/Only authorized payments/);
    const second = await mollie.authorize(ctx, { amount: 20000, currency: 'EUR', orderId: 'ord_1', customerRef: first.customerRef!, paymentMethodRef: mandate });
    await mollie.void(ctx, second.ref);
    expect(fake.payments.find((x) => x.id === second.ref)!.status).toBe('canceled');
    expect((await mollie.authorize(ctx, { amount: 100, currency: 'EUR', orderId: 'ord_1', customerRef: first.customerRef!, paymentMethodRef: 'mdt_none' })).status).toBe('failed');
  });

  it('refunds at most what was paid and reports the refund when Mollie completes it', async () => {
    const r = await mollie.createPaymentIntent(ctx, intent({ amount: 8000 }));
    fake.checkout(r.ref);
    await expect(mollie.refund(ctx, r.ref, 9000)).rejects.toThrow(/higher than the amount/);
    const refund = await mollie.refund(ctx, r.ref, 3000);
    expect(refund.status).toBe('pending');
    fake.completeRefund(refund.ref);
    expect(await mollie.handleWebhook(ctx, body(r.ref))).toEqual({ type: 'refund.succeeded', eventId: `${refund.ref}:refunded`, ref: refund.ref, paymentRef: r.ref, amount: 3000 });
  });
});
