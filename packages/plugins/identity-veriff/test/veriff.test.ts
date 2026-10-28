import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startVeriffFake, type VeriffFake } from '@openrent/identity-fakes';
import { createVeriffProvider } from '../src/index.ts';

describe('Veriff against the fake', () => {
  let fake: VeriffFake;
  const p = createVeriffProvider();
  const ctx = (over: Record<string, unknown> = {}) => ({ tenantId: 't1', logger: console as any, config: { api_key: 'vk-1', shared_secret: 'vs-1', api_url: fake.url, ...over } });
  beforeAll(async () => {
    fake = await startVeriffFake({ apiKey: 'vk-1', secret: 'vs-1' });
  });
  afterAll(() => fake?.close());

  it('starts a signed session and reads the decision with a signed request', async () => {
    const s = await p.start!(ctx(), { customer: { id: 'cus_1', name: 'Ann Maria Lee', email: 'ann@x.ee' }, orderId: null, returnUrl: 'https://shop.test/account' });
    expect(s.url).toContain('veriff.com/v/');
    expect(fake.sessions.get(s.ref)).toMatchObject({ vendorData: 'cus_1', callback: 'https://shop.test/account' });
    expect(await p.status!(ctx(), s.ref)).toMatchObject({ status: 'pending' });
    fake.approve(s.ref);
    expect(await p.status!(ctx(), s.ref)).toMatchObject({ status: 'verified' });
    await expect(p.start!(ctx({ shared_secret: 'wrong' }), { customer: { id: 'c', name: 'X', email: null }, orderId: null, returnUrl: '' })).rejects.toThrow(/Veriff 401/);
  });

  it('trusts only decision webhooks signed with the shared secret', async () => {
    const s = await p.start!(ctx(), { customer: { id: 'cus_2', name: 'Bo', email: null }, orderId: null, returnUrl: '' });
    fake.decline(s.ref);
    const { body, signature } = fake.webhook(s.ref);
    expect(await p.handleWebhook!(ctx(), { rawBody: Buffer.from(body), headers: { 'x-hmac-signature': signature } })).toEqual({ ref: s.ref, status: 'failed', reason: 'Document is not valid' });
    await expect(p.handleWebhook!(ctx(), { rawBody: Buffer.from(body), headers: { 'x-hmac-signature': 'f'.repeat(64) } })).rejects.toMatchObject({ status: 401 });
  });
});
