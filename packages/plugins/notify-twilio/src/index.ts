import { createHmac, timingSafeEqual } from 'node:crypto';
import { DeliveryError, definePlugin, type DeliveryReport, type NotificationChannel, type OutgoingMessage, type ProviderContext, type WebhookRequest } from '@openrent/plugin-sdk';

const API = 'https://api.twilio.com';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Twilio error codes that will not succeed on a retry: bad or unreachable number, opted out, sender not allowed. */
const PERMANENT = new Set([21211, 21212, 21408, 21606, 21610, 21612, 21614, 21617, 63007, 63016]);

/**
 * WhatsApp templates for messages sent outside a conversation (`whatsapp_templates`, "pickup_reminder = HX…;
 * order_confirmed = HX…"): an approved Content template whose `{{1}}` takes the message text.
 */
export function contentSidFor(template: string | undefined, settings: Record<string, unknown>) {
  for (const pair of String(settings.whatsapp_templates ?? '').split(/[\n;,]+/)) {
    const [k, v] = pair.split('=').map((x) => x.trim());
    if (k && v && (k === template || k === '*')) return v;
  }
  return null;
}

/** Twilio's request signature: HMAC-SHA1 over the URL and the sorted form parameters, base64. */
export function signature(authToken: string, url: string, params: URLSearchParams) {
  const keys = [...new Set([...params.keys()])].sort();
  return createHmac('sha1', authToken).update(url + keys.map((k) => k + params.get(k)).join(''), 'utf8').digest('base64');
}

async function sendVia(ctx: ProviderContext, msg: OutgoingMessage, kind: 'sms' | 'whatsapp') {
  const sid = str(ctx.config.account_sid);
  const token = str(ctx.config.auth_token);
  if (!sid || !token) throw new DeliveryError('not_configured', 'Twilio is not configured');
  const form = new URLSearchParams();
  if (kind === 'whatsapp') {
    form.set('To', `whatsapp:${msg.to}`);
    form.set('From', `whatsapp:${str(ctx.config.whatsapp_from)!.replace(/^whatsapp:/, '')}`);
    const content = contentSidFor(msg.template, ctx.config);
    if (content) {
      form.set('ContentSid', content);
      form.set('ContentVariables', JSON.stringify({ 1: msg.text ?? '' }));
    } else form.set('Body', msg.text ?? '');
  } else {
    form.set('To', msg.to);
    const service = str(ctx.config.messaging_service_sid);
    if (service) form.set('MessagingServiceSid', service);
    else form.set('From', str(ctx.config.from)!);
    form.set('Body', msg.text ?? '');
  }
  if (ctx.webhookUrl) form.set('StatusCallback', ctx.webhookUrl);
  let res: Response;
  try {
    res = await fetch(`${str(ctx.config.api_base_url) ?? API}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new DeliveryError((err as Error)?.name === 'TimeoutError' ? 'timeout' : 'connection_failed', String((err as Error)?.message ?? err), { cause: err });
  }
  const body = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
  if (res.status === 401) throw new DeliveryError('auth_failed', body.message ?? 'Twilio rejected the account SID or auth token');
  if (!res.ok) {
    const code = Number(body.code ?? res.status);
    throw new DeliveryError(PERMANENT.has(code) ? 'recipient_rejected' : 'rejected', `${body.message ?? 'Twilio error'} (${code})`, { permanent: PERMANENT.has(code) });
  }
  return { ref: body.sid ?? null };
}

/** Status callbacks (FR-NOT-5), checked against `X-Twilio-Signature` with the auth token. */
async function reports(ctx: ProviderContext, req: WebhookRequest): Promise<DeliveryReport[]> {
  const token = str(ctx.config.auth_token);
  const params = new URLSearchParams(req.rawBody.toString('utf8'));
  const given = String(req.headers['x-twilio-signature'] ?? '');
  const expected = token && ctx.webhookUrl ? signature(token, ctx.webhookUrl, params) : '';
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected)))
    throw Object.assign(new Error('Invalid Twilio signature'), { status: 401, code: 'invalid_signature' });
  const ref = params.get('MessageSid');
  const status = params.get('MessageStatus');
  if (!ref) return [];
  if (status === 'delivered' || status === 'read') return [{ ref, status: 'delivered' }];
  if (status === 'undelivered' || status === 'failed') return [{ ref, status: 'failed', error: params.get('ErrorCode') ? `Twilio error ${params.get('ErrorCode')}` : status }];
  return [];
}

export function twilioSmsChannel(): NotificationChannel {
  return {
    id: 'twilio-sms',
    channel: 'sms',
    isConfigured: (ctx) => !!str(ctx.config.account_sid) && !!str(ctx.config.auth_token) && !!(str(ctx.config.from) || str(ctx.config.messaging_service_sid)),
    send: (ctx, msg) => sendVia(ctx, msg, 'sms'),
    handleWebhook: reports,
  };
}

export function twilioWhatsAppChannel(): NotificationChannel {
  return {
    id: 'twilio-whatsapp',
    channel: 'whatsapp',
    isConfigured: (ctx) => !!str(ctx.config.account_sid) && !!str(ctx.config.auth_token) && !!str(ctx.config.whatsapp_from),
    send: (ctx, msg) => sendVia(ctx, msg, 'whatsapp'),
    handleWebhook: reports,
  };
}

/**
 * SMS and WhatsApp through Twilio (FR-NOT-4). Delivery reports come back by themselves: each message
 * names /webhooks/notify/notify-twilio/<tenant id> as its status callback, signed with the auth token.
 */
export default definePlugin({
  id: 'notify-twilio',
  name: 'Twilio SMS and WhatsApp',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.6.0',
  permissions: ['notifications:send', 'network'],
  settings: [
    { key: 'account_sid', label: 'Account SID', type: 'text', required: true },
    { key: 'auth_token', label: 'Auth token', type: 'secret', required: true },
    { key: 'from', label: 'SMS sender', type: 'text', help: 'A Twilio number (+14155550100) or an alphanumeric sender ID where allowed' },
    { key: 'messaging_service_sid', label: 'Messaging service SID', type: 'text', help: 'Instead of a sender: MG…' },
    { key: 'whatsapp_from', label: 'WhatsApp sender', type: 'text', help: 'Your WhatsApp-enabled number, e.g. +14155238886' },
    { key: 'whatsapp_templates', label: 'WhatsApp templates', type: 'text', help: 'For messages outside a chat: "pickup_reminder = HX…; * = HX…", each an approved template whose {{1}} holds the text' },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ account_sid: api.env('TWILIO_ACCOUNT_SID'), auth_token: api.env('TWILIO_AUTH_TOKEN') });
    api.registerNotificationChannel(twilioSmsChannel());
    api.registerNotificationChannel(twilioWhatsAppChannel());
  },
});
