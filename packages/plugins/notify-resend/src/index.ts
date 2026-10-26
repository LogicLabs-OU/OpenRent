import { createHmac, timingSafeEqual } from 'node:crypto';
import { DeliveryError, definePlugin, type DeliveryReport, type NotificationChannel, type ProviderContext, type WebhookRequest } from '@openrent/plugin-sdk';

const API = 'https://api.resend.com/emails';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const header = (req: WebhookRequest, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Resend signs webhooks the Svix way: base64 HMAC-SHA256 of `id.timestamp.body` with the `whsec_` secret. */
export function verifySvix(secret: string, req: WebhookRequest, now = Date.now()) {
  const id = header(req, 'svix-id');
  const ts = header(req, 'svix-timestamp');
  const sigs = header(req, 'svix-signature');
  if (!id || !ts || !sigs) return false;
  // Older than five minutes counts as a replay.
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${req.rawBody.toString('utf8')}`).digest();
  return sigs.split(' ').some((s) => {
    const [v, sig] = s.split(',');
    if (v !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export function resendChannel(fetchImpl: typeof fetch = fetch): NotificationChannel {
  return {
    id: 'resend',
    channel: 'email',
    isConfigured: (ctx) => !!str(ctx.config.api_key) && !!str(ctx.config.from),
    async send(ctx, msg) {
      const key = str(ctx.config.api_key);
      if (!key) throw new DeliveryError('not_configured', 'Resend is not configured');
      let res: Response;
      try {
        res = await fetchImpl(API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: msg.from ?? str(ctx.config.from),
            to: [msg.to],
            reply_to: msg.replyTo ?? str(ctx.config.reply_to) ?? undefined,
            subject: msg.subject,
            html: msg.html,
            ...(msg.text ? { text: msg.text } : {}),
            headers: msg.headers,
            attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new DeliveryError((err as Error)?.name === 'TimeoutError' ? 'timeout' : 'connection_failed', String((err as Error)?.message ?? err), { cause: err });
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (res.status === 401 || res.status === 403) throw new DeliveryError('auth_failed', body.message ?? 'Resend rejected the API key');
      // 422: the message itself is invalid (bad address, unverified sender); retrying will not help.
      if (res.status === 422) throw new DeliveryError(body.name === 'validation_error' ? 'recipient_rejected' : 'rejected', body.message ?? 'Resend refused the message', { permanent: true });
      if (!res.ok) throw new DeliveryError('rejected', body.message ?? `Resend error ${res.status}`);
      return { ref: body.id ?? null };
    },
    async handleWebhook(ctx: ProviderContext, req: WebhookRequest): Promise<DeliveryReport[]> {
      const secret = str(ctx.config.webhook_secret);
      if (!secret || !verifySvix(secret, req)) throw Object.assign(new Error('Invalid Resend webhook signature'), { status: 401, code: 'invalid_signature' });
      const e = JSON.parse(req.rawBody.toString('utf8')) as { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
      const ref = e.data?.email_id;
      if (!ref) return [];
      if (e.type === 'email.delivered') return [{ ref, status: 'delivered' }];
      if (e.type === 'email.bounced') return [{ ref, status: 'bounced', error: e.data?.bounce?.message ?? null }];
      if (e.type === 'email.complained') return [{ ref, status: 'complained', error: 'spam complaint' }];
      return [];
    },
  };
}

/**
 * Email through Resend (FR-NOT-1). Delivery reports: add a webhook in Resend for email.delivered,
 * email.bounced and email.complained pointing at <api host>/webhooks/notify/notify-resend/<tenant id>
 * and paste its signing secret here.
 */
export default definePlugin({
  id: 'notify-resend',
  name: 'Resend email',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.0.0',
  permissions: ['notifications:send'],
  settings: [
    { key: 'api_key', label: 'API key', type: 'secret', required: true },
    { key: 'from', label: 'From address', type: 'text', required: true, help: 'An address on a domain verified in Resend' },
    { key: 'reply_to', label: 'Reply-to address', type: 'text' },
    { key: 'webhook_secret', label: 'Webhook signing secret', type: 'secret', help: 'whsec_… from the Resend webhook' },
  ],
  setup(api) {
    api.setDefaultConfig({ api_key: api.env('RESEND_API_KEY'), from: api.env('EMAIL_FROM') });
    api.registerNotificationChannel(resendChannel());
  },
});
