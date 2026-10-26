import { describe, expect, it } from 'vitest';
import { postmarkChannel } from '../src/index.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = { tenantId: 'ten_1', config: { server_token: 'pm-token', from: 'Shop <hi@shop.test>', webhook_secret: 's3cret' }, logger };
const reply = (status: number, body: unknown) => async (_url: any, init: any) => {
  (reply as any).last = { url: _url, init };
  return new Response(JSON.stringify(body), { status });
};

describe('Postmark channel', () => {
  it('sends with the server token, headers and attachments', async () => {
    const ch = postmarkChannel(reply(200, { MessageID: 'pm-1', ErrorCode: 0 }) as any);
    const r = await ch.send(ctx, { to: 'a@x.test', subject: 'Hi', html: '<p>Hi</p>', headers: { 'X-OpenRent-Notification': 'ntf_1' }, attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') }] });
    expect(r.ref).toBe('pm-1');
    const sent = JSON.parse((reply as any).last.init.body);
    expect((reply as any).last.init.headers['X-Postmark-Server-Token']).toBe('pm-token');
    expect(sent).toMatchObject({ From: 'Shop <hi@shop.test>', To: 'a@x.test', Headers: [{ Name: 'X-OpenRent-Notification', Value: 'ntf_1' }], Attachments: [{ Name: 'a.pdf', Content: 'cGRm' }] });
  });
  it('treats inactive recipients as permanent and auth errors as such', async () => {
    await expect(postmarkChannel(reply(422, { ErrorCode: 406, Message: 'Inactive recipient' }) as any).send(ctx, { to: 'a@x.test', subject: 's', html: 'h' })).rejects.toMatchObject({ code: 'recipient_rejected', permanent: true });
    await expect(postmarkChannel(reply(401, { Message: 'Bad token' }) as any).send(ctx, { to: 'a@x.test', subject: 's', html: 'h' })).rejects.toMatchObject({ code: 'auth_failed', permanent: false });
  });
  it('reads delivery reports only with the right credentials', async () => {
    const ch = postmarkChannel();
    const auth = `Basic ${Buffer.from('openrent:s3cret').toString('base64')}`;
    const body = (b: unknown) => Buffer.from(JSON.stringify(b));
    expect(await ch.handleWebhook!(ctx, { rawBody: body({ RecordType: 'Bounce', MessageID: 'pm-1', Description: 'Mailbox full' }), headers: { authorization: auth } })).toEqual([{ ref: 'pm-1', status: 'bounced', error: 'Mailbox full' }]);
    expect(await ch.handleWebhook!(ctx, { rawBody: body({ RecordType: 'Delivery', MessageID: 'pm-2' }), headers: { authorization: auth } })).toEqual([{ ref: 'pm-2', status: 'delivered' }]);
    await expect(ch.handleWebhook!(ctx, { rawBody: body({}), headers: { authorization: 'Basic nope' } })).rejects.toMatchObject({ status: 401 });
  });
});
