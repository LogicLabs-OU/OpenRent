import { timingSafeEqual } from 'node:crypto';
import { DeliveryError, definePlugin, type DeliveryReport, type NotificationChannel, type ProviderContext, type WebhookRequest } from '@openrent/plugin-sdk';

const API = 'https://api.postmarkapp.com/email';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Postmark error codes that will never succeed for this message: bad address, inactive recipient. */
const PERMANENT = new Set([300, 406, 409, 410, 411, 412, 413]);

export function postmarkChannel(fetchImpl: typeof fetch = fetch): NotificationChannel {
  return {
    id: 'postmark',
    channel: 'email',
    isConfigured: (ctx) => !!str(ctx.config.server_token) && !!str(ctx.config.from),
    async send(ctx, msg) {
      const token = str(ctx.config.server_token);
      if (!token) throw new DeliveryError('not_configured', 'Postmark is not configured');
      let res: Response;
      try {
        res = await fetchImpl(API, {
          method: 'POST',
          headers: { 'X-Postmark-Server-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            From: msg.from ?? str(ctx.config.from),
            To: msg.to,
            ReplyTo: msg.replyTo ?? str(ctx.config.reply_to) ?? undefined,
            Subject: msg.subject,
            HtmlBody: msg.html,
            ...(msg.text ? { TextBody: msg.text } : {}),
            MessageStream: str(ctx.config.message_stream) ?? 'outbound',
            Headers: Object.entries(msg.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
            Attachments: msg.attachments?.map((a) => ({ Name: a.filename, ContentType: a.contentType, Content: a.content.toString('base64') })),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new DeliveryError((err as Error)?.name === 'TimeoutError' ? 'timeout' : 'connection_failed', String((err as Error)?.message ?? err), { cause: err });
      }
      const body = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
      if (res.status === 401) throw new DeliveryError('auth_failed', body.Message ?? 'Postmark rejected the server token');
      if (!res.ok || (body.ErrorCode ?? 0) !== 0) {
        const code = body.ErrorCode ?? res.status;
        throw new DeliveryError(PERMANENT.has(code) ? 'recipient_rejected' : 'rejected', body.Message ?? `Postmark error ${code}`, { permanent: PERMANENT.has(code) });
      }
      return { ref: body.MessageID ?? null };
    },
    async handleWebhook(ctx: ProviderContext, req: WebhookRequest): Promise<DeliveryReport[]> {
      // Postmark sends the credentials put in the webhook URL as Basic auth.
      const secret = str(ctx.config.webhook_secret);
      const header = String(req.headers.authorization ?? '');
      const expected = secret ? `Basic ${Buffer.from(`openrent:${secret}`).toString('base64')}` : null;
      if (!expected || header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected)))
        throw Object.assign(new Error('Invalid Postmark webhook credentials'), { status: 401, code: 'invalid_signature' });
      const e = JSON.parse(req.rawBody.toString('utf8')) as { RecordType?: string; MessageID?: string; Description?: string; Details?: string };
      if (!e.MessageID) return [];
      if (e.RecordType === 'Delivery') return [{ ref: e.MessageID, status: 'delivered' }];
      if (e.RecordType === 'Bounce') return [{ ref: e.MessageID, status: 'bounced', error: e.Description ?? e.Details ?? null }];
      if (e.RecordType === 'SpamComplaint') return [{ ref: e.MessageID, status: 'complained', error: 'spam complaint' }];
      return [];
    },
  };
}

/**
 * Email through Postmark (FR-NOT-1). Delivery reports: add a webhook in Postmark for Delivery, Bounce
 * and Spam complaint pointing at https://openrent:<webhook secret>@<api host>/webhooks/notify/notify-postmark/<tenant id>.
 */
export default definePlugin({
  id: 'notify-postmark',
  name: 'Postmark email',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.0.0',
  permissions: ['notifications:send'],
  settings: [
    { key: 'server_token', label: 'Server API token', type: 'secret', required: true },
    { key: 'from', label: 'From address', type: 'text', required: true, help: 'A sender signature verified in Postmark' },
    { key: 'reply_to', label: 'Reply-to address', type: 'text' },
    { key: 'message_stream', label: 'Message stream', type: 'text', help: 'outbound when unsure' },
    { key: 'webhook_secret', label: 'Webhook password', type: 'secret', help: 'Use it as the password in the webhook URL (user: openrent)' },
  ],
  setup(api) {
    api.setDefaultConfig({ server_token: api.env('POSTMARK_SERVER_TOKEN'), from: api.env('EMAIL_FROM') });
    api.registerNotificationChannel(postmarkChannel());
  },
});
