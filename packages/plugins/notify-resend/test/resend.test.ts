import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resendChannel, verifySvix } from '../src/index.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const secret = `whsec_${Buffer.from('resend-secret-key').toString('base64')}`;
const ctx = { tenantId: 'ten_1', config: { api_key: 're_key', from: 'Shop <hi@shop.test>', webhook_secret: secret }, logger };

function signed(body: unknown, ts = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = createHmac('sha256', Buffer.from('resend-secret-key')).update(`msg_1.${ts}.${raw.toString()}`).digest('base64');
  return { rawBody: raw, headers: { 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` } };
}

describe('Resend channel', () => {
  it('sends with the API key and returns the email id', async () => {
    let seen: any;
    const ch = resendChannel((async (_u: any, init: any) => ((seen = init), new Response(JSON.stringify({ id: 're_1' }), { status: 200 }))) as any);
    expect((await ch.send(ctx, { to: 'a@x.test', subject: 'Hi', html: '<p>Hi</p>' })).ref).toBe('re_1');
    expect(seen.headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(seen.body)).toMatchObject({ to: ['a@x.test'], from: 'Shop <hi@shop.test>' });
  });
  it('treats a refused message as permanent', async () => {
    const ch = resendChannel((async () => new Response(JSON.stringify({ name: 'validation_error', message: 'Invalid to' }), { status: 422 })) as any);
    await expect(ch.send(ctx, { to: 'bad', subject: 's', html: 'h' })).rejects.toMatchObject({ code: 'recipient_rejected', permanent: true });
  });
  it('verifies Svix signatures and maps delivery events', async () => {
    const ch = resendChannel();
    expect(await ch.handleWebhook!(ctx, signed({ type: 'email.bounced', data: { email_id: 're_1', bounce: { message: 'No such user' } } }))).toEqual([{ ref: 're_1', status: 'bounced', error: 'No such user' }]);
    expect(await ch.handleWebhook!(ctx, signed({ type: 'email.delivered', data: { email_id: 're_2' } }))).toEqual([{ ref: 're_2', status: 'delivered' }]);
    const old = signed({ type: 'email.delivered', data: { email_id: 're_3' } }, Math.floor(Date.now() / 1000) - 3600);
    expect(verifySvix(secret, old)).toBe(false);
    const tampered = signed({ type: 'email.delivered', data: { email_id: 're_4' } });
    tampered.rawBody = Buffer.from('{"type":"email.delivered","data":{"email_id":"re_5"}}');
    await expect(ch.handleWebhook!(ctx, tampered)).rejects.toMatchObject({ status: 401 });
  });
});
