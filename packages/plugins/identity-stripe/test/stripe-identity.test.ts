import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStripeIdentityFake, type StripeIdentityFake } from '@openrent/identity-fakes';
import { createStripeIdentityProvider, verifySignature } from '../src/index.ts';

describe('Stripe Identity against the fake', () => {
  let fake: StripeIdentityFake;
  const p = createStripeIdentityProvider();
  const ctx = () => ({ tenantId: 't1', logger: console as any, config: { secret_key: 'sk_test_abcdefghijkl', webhook_secret: 'whsec_1', api_url: fake.url, require_selfie: true } });
  beforeAll(async () => {
    fake = await startStripeIdentityFake({ secretKey: 'sk_test_abcdefghijkl' });
  });
  afterAll(() => fake?.close());

  it('starts a document check that comes back to the shop', async () => {
    const s = await p.start!(ctx(), { customer: { id: 'cus_1', name: 'Ann Lee', email: 'ann@x.ee' }, orderId: 'ord_1', returnUrl: 'https://shop.test/account' });
    expect(s.url).toContain('verify.stripe.com');
    expect(fake.sessions.get(s.ref)).toMatchObject({ type: 'document', return_url: 'https://shop.test/account', metadata: { customer_id: 'cus_1', order_id: 'ord_1' } });
    expect(await p.status!(ctx(), s.ref)).toMatchObject({ status: 'pending' });
    fake.verify(s.ref);
    expect(await p.status!(ctx(), s.ref)).toMatchObject({ status: 'verified' });
  });

  it('reads a failed attempt, and trusts only signed webhooks', async () => {
    const s = await p.start!(ctx(), { customer: { id: 'cus_2', name: 'Bo', email: null }, orderId: null, returnUrl: 'https://shop.test/account' });
    fake.fail(s.ref);
    const { body, signature } = fake.webhook(s.ref, 'whsec_1');
    expect(await p.handleWebhook!(ctx(), { rawBody: Buffer.from(body), headers: { 'stripe-signature': signature } })).toEqual({ ref: s.ref, status: 'failed', reason: 'The document is expired.' });
    const forged = fake.webhook(s.ref, 'whsec_other');
    await expect(p.handleWebhook!(ctx(), { rawBody: Buffer.from(forged.body), headers: { 'stripe-signature': forged.signature } })).rejects.toMatchObject({ status: 401 });
    expect(verifySignature(signature, Buffer.from(body), 'whsec_1', Date.now() + 10 * 60_000)).toBe(false);
  });
});
