import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderContext } from '@openrent/plugin-sdk';
import { messageBirdJwt, startMessageBirdFake, type MessageBirdFake } from '@openrent/messaging-fakes';
import { messageBirdChannel, verifyJwt } from '../src/index.ts';

describe('MessageBird SMS', () => {
  let fake: MessageBirdFake;
  let hook: Server;
  let hookUrl = '';
  const received: { url: string; headers: Record<string, unknown> }[] = [];
  const ctx = (over: Record<string, unknown> = {}): ProviderContext => ({
    tenantId: 'ten_1', logger: console as any, webhookUrl: hookUrl,
    config: { access_key: fake.accessKey, originator: 'KayakHire', signing_key: fake.signingKey, api_base_url: fake.url, ...over },
  });
  const lastReport = () => {
    const r = received.at(-1)!;
    return { rawBody: Buffer.alloc(0), headers: r.headers as any, method: 'GET', query: r.url.split('?')[1] ?? '' };
  };

  beforeAll(async () => {
    fake = await startMessageBirdFake();
    hook = createServer((req, res) => {
      received.push({ url: req.url!, headers: req.headers });
      res.end('ok');
    });
    await new Promise<void>((ok) => hook.listen(0, '127.0.0.1', ok));
    hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/webhooks/notify/notify-messagebird/ten_1`;
  });
  afterAll(async () => {
    await fake.close();
    hook.close();
  });

  it('sends to the number without its plus, with a report URL', async () => {
    const r = await messageBirdChannel().send(ctx(), { to: '+3725551234', subject: '', html: '', text: 'Booking #7 is confirmed', template: 'order_confirmed' });
    expect(fake.messages.find((m) => m.id === r.ref)).toMatchObject({ recipients: ['3725551234'], originator: 'KayakHire', body: 'Booking #7 is confirmed', reportUrl: hookUrl, reference: 'order_confirmed' });
  });

  it('reads signed status reports and refuses forged ones', async () => {
    const r = await messageBirdChannel().send(ctx(), { to: '+3725551234', subject: '', html: '', text: 'Hi' });
    await fake.report(r.ref!, 'delivered');
    expect(await messageBirdChannel().handleWebhook!(ctx(), lastReport())).toEqual([{ ref: r.ref, status: 'delivered' }]);
    await fake.report(r.ref!, 'delivery_failed');
    expect(await messageBirdChannel().handleWebhook!(ctx(), lastReport())).toEqual([{ ref: r.ref, status: 'failed', error: 'delivery_failed' }]);
    // Signed with another key, or for another URL.
    await fake.report(r.ref!, 'delivered', { signingKey: 'not-the-key' });
    await expect(messageBirdChannel().handleWebhook!(ctx(), lastReport())).rejects.toMatchObject({ status: 401 });
    await fake.report(r.ref!, 'delivered');
    await expect(messageBirdChannel().handleWebhook!({ ...ctx(), webhookUrl: 'https://elsewhere.example/x' }, lastReport())).rejects.toMatchObject({ status: 401 });
  });

  it('checks the token lifetime', () => {
    const url = 'https://shop.example/webhooks/notify/notify-messagebird/ten_1?id=1';
    const jwt = messageBirdJwt('k', url);
    expect(verifyJwt(jwt, 'k', url, '').iss).toBe('MessageBird');
    expect(() => verifyJwt(jwt, 'k', url, '', Date.now() + 3600_000)).toThrow('Invalid MessageBird signature');
  });

  it('explains failures: the key, and a number it will never reach', async () => {
    await expect(messageBirdChannel().send(ctx({ access_key: 'wrong' }), { to: '+3725551234', subject: '', html: '', text: 'x' })).rejects.toMatchObject({ code: 'auth_failed' });
    await expect(messageBirdChannel().send(ctx(), { to: '+0', subject: '', html: '', text: 'x' })).rejects.toMatchObject({ code: 'recipient_rejected', permanent: true });
    await expect(messageBirdChannel().send(ctx({ originator: 'A sender far too long' }), { to: '+3725551234', subject: '', html: '', text: 'x' })).rejects.toMatchObject({ permanent: true });
  });
});
