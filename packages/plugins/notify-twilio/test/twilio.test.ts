import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderContext } from '@openrent/plugin-sdk';
import { startTwilioFake, twilioSignature, type TwilioFake } from '@openrent/messaging-fakes';
import { contentSidFor, twilioSmsChannel, twilioWhatsAppChannel } from '../src/index.ts';

describe('Twilio SMS and WhatsApp', () => {
  let fake: TwilioFake;
  let hook: Server;
  let hookUrl = '';
  const received: { body: string; headers: Record<string, unknown> }[] = [];
  const ctx = (over: Record<string, unknown> = {}): ProviderContext => ({
    tenantId: 'ten_1', logger: console as any, webhookUrl: hookUrl,
    config: { account_sid: fake.accountSid, auth_token: fake.authToken, from: '+15005550006', whatsapp_from: '+14155238886', api_base_url: fake.url, ...over },
  });

  beforeAll(async () => {
    fake = await startTwilioFake();
    hook = createServer(async (req, res) => {
      let body = '';
      for await (const c of req) body += c;
      received.push({ body, headers: req.headers });
      res.end('ok');
    });
    await new Promise<void>((ok) => hook.listen(0, '127.0.0.1', ok));
    hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/webhooks/notify/notify-twilio/ten_1`;
  });
  afterAll(async () => {
    await fake.close();
    hook.close();
  });

  it('is set up with a sender, or a messaging service', () => {
    expect(twilioSmsChannel().isConfigured(ctx())).toBe(true);
    expect(twilioSmsChannel().isConfigured(ctx({ from: '' }))).toBe(false);
    expect(twilioSmsChannel().isConfigured(ctx({ from: '', messaging_service_sid: 'MG123' }))).toBe(true);
    expect(twilioWhatsAppChannel().isConfigured(ctx({ whatsapp_from: '' }))).toBe(false);
  });

  it('sends an SMS with a status callback, and reads the signed delivery report', async () => {
    const r = await twilioSmsChannel().send(ctx(), { to: '+3725551234', subject: '', html: '', text: 'Kayak Hire: booking #1042 is confirmed.' });
    const m = fake.messages.find((x) => x.sid === r.ref)!;
    expect(m).toMatchObject({ to: '+3725551234', from: '+15005550006', body: 'Kayak Hire: booking #1042 is confirmed.', statusCallback: hookUrl });
    await fake.report(m.sid, 'delivered');
    const req = { rawBody: Buffer.from(received.at(-1)!.body), headers: received.at(-1)!.headers as any };
    expect(await twilioSmsChannel().handleWebhook!(ctx(), req)).toEqual([{ ref: m.sid, status: 'delivered' }]);
    // A forged or replayed-elsewhere report is refused.
    await expect(twilioSmsChannel().handleWebhook!({ ...ctx(), webhookUrl: 'https://other.example/hook' }, req)).rejects.toMatchObject({ status: 401 });
    await expect(twilioSmsChannel().handleWebhook!(ctx(), { ...req, headers: { 'x-twilio-signature': 'nope' } })).rejects.toMatchObject({ status: 401 });
  });

  it('reports an undeliverable message as failed', async () => {
    const r = await twilioSmsChannel().send(ctx(), { to: '+3725550000', subject: '', html: '', text: 'Hello' });
    await fake.report(r.ref!, 'undelivered', 30003);
    const last = received.at(-1)!;
    expect(await twilioSmsChannel().handleWebhook!(ctx(), { rawBody: Buffer.from(last.body), headers: last.headers as any })).toEqual([{ ref: r.ref, status: 'failed', error: 'Twilio error 30003' }]);
  });

  it('uses the messaging service instead of a sender when set', async () => {
    const r = await twilioSmsChannel().send(ctx({ messaging_service_sid: 'MG42' }), { to: '+3725551234', subject: '', html: '', text: 'Hi' });
    expect(fake.messages.find((x) => x.sid === r.ref)).toMatchObject({ from: null, messagingServiceSid: 'MG42' });
  });

  it('sends WhatsApp free text, or the approved template for the event', async () => {
    const wa = twilioWhatsAppChannel();
    const free = await wa.send(ctx(), { to: '+3725551234', subject: '', html: '', text: 'Pickup tomorrow', template: 'order_confirmed' });
    expect(fake.messages.find((x) => x.sid === free.ref)).toMatchObject({ to: 'whatsapp:+3725551234', from: 'whatsapp:+14155238886', body: 'Pickup tomorrow', contentSid: null });
    const settings = { whatsapp_templates: 'pickup_reminder = HXabc; * = HXany' };
    expect([contentSidFor('pickup_reminder', settings), contentSidFor('order_overdue', settings), contentSidFor('x', {})]).toEqual(['HXabc', 'HXany', null]);
    const tpl = await wa.send(ctx(settings), { to: '+3725551234', subject: '', html: '', text: 'Pickup at 10:00', template: 'pickup_reminder' });
    expect(fake.messages.find((x) => x.sid === tpl.ref)).toMatchObject({ body: null, contentSid: 'HXabc', contentVariables: { 1: 'Pickup at 10:00' } });
  });

  it('explains failures: bad credentials, opted-out numbers for good, rate limits for later', async () => {
    await expect(twilioSmsChannel().send(ctx({ auth_token: 'wrong' }), { to: '+3725551234', subject: '', html: '', text: 'x' })).rejects.toMatchObject({ code: 'auth_failed' });
    fake.stopped.add('+3725559999');
    await expect(twilioSmsChannel().send(ctx(), { to: '+3725559999', subject: '', html: '', text: 'x' })).rejects.toMatchObject({ code: 'recipient_rejected', permanent: true });
    fake.rateLimit(1);
    await expect(twilioSmsChannel().send(ctx(), { to: '+3725551234', subject: '', html: '', text: 'x' })).rejects.toMatchObject({ code: 'rejected', permanent: false });
    expect(twilioSignature('t', 'https://a/b', { B: '2', A: '1' })).toBe(twilioSignature('t', 'https://a/b', { A: '1', B: '2' }));
  });
});
