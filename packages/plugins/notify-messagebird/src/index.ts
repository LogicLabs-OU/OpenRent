import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DeliveryError, definePlugin, type DeliveryReport, type NotificationChannel, type ProviderContext, type WebhookRequest } from '@openrent/plugin-sdk';

const API = 'https://rest.messagebird.com';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** A JWT may be this many seconds early or late (clock skew). */
const LEEWAY = 60;

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks a `MessageBird-Signature-JWT`: HS256 with the signing key, still valid, and made for this
 * very URL (and body). Returns the claims; throws a 401 otherwise.
 */
export function verifyJwt(token: string, signingKey: string, url: string, body: string, now = Date.now()) {
  const fail = () => Object.assign(new Error('Invalid MessageBird signature'), { status: 401, code: 'invalid_signature' });
  const [head, payload, sig] = token.split('.');
  if (!head || !payload || !sig) throw fail();
  const header = JSON.parse(Buffer.from(head, 'base64url').toString() || '{}');
  if (header.alg !== 'HS256') throw fail();
  if (!safeEqual(createHmac('sha256', signingKey).update(`${head}.${payload}`).digest('base64url'), sig)) throw fail();
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const t = Math.floor(now / 1000);
  if (claims.iss !== 'MessageBird' || (claims.nbf && claims.nbf > t + LEEWAY) || (claims.exp && claims.exp < t - LEEWAY)) throw fail();
  if (!safeEqual(String(claims.url_hash ?? ''), createHash('sha256').update(url).digest('hex'))) throw fail();
  if (body && !safeEqual(String(claims.payload_hash ?? ''), createHash('sha256').update(body).digest('hex'))) throw fail();
  return claims;
}

export function messageBirdChannel(): NotificationChannel {
  return {
    id: 'messagebird-sms',
    channel: 'sms',
    isConfigured: (ctx) => !!str(ctx.config.access_key) && !!str(ctx.config.originator),
    async send(ctx, msg) {
      const key = str(ctx.config.access_key);
      if (!key) throw new DeliveryError('not_configured', 'MessageBird is not configured');
      let res: Response;
      try {
        res = await fetch(`${str(ctx.config.api_base_url) ?? API}/messages`, {
          method: 'POST',
          headers: { authorization: `AccessKey ${key}`, 'content-type': 'application/json', accept: 'application/json' },
          // MessageBird wants the number without its plus.
          body: JSON.stringify({ recipients: [msg.to.replace(/^\+/, '')], originator: str(ctx.config.originator), body: msg.text ?? '', reportUrl: ctx.webhookUrl, reference: msg.template ?? undefined }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new DeliveryError((err as Error)?.name === 'TimeoutError' ? 'timeout' : 'connection_failed', String((err as Error)?.message ?? err), { cause: err });
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string; errors?: { code: number; description: string; parameter?: string }[] };
      const e = body.errors?.[0];
      if (res.status === 401) throw new DeliveryError('auth_failed', e?.description ?? 'MessageBird rejected the access key');
      if (!res.ok) {
        const permanent = e?.parameter === 'recipients' || e?.parameter === 'recipient' || e?.parameter === 'originator';
        throw new DeliveryError(permanent ? 'recipient_rejected' : 'rejected', `${e?.description ?? 'MessageBird error'} (${e?.code ?? res.status})`, { permanent });
      }
      return { ref: body.id ?? null };
    },
    /** Status reports (FR-NOT-5): GET requests to the report URL, signed with the signing key. */
    async handleWebhook(ctx: ProviderContext, req: WebhookRequest): Promise<DeliveryReport[]> {
      const signingKey = str(ctx.config.signing_key);
      const token = String(req.headers['messagebird-signature-jwt'] ?? '');
      const url = `${ctx.webhookUrl ?? ''}${req.query ? `?${req.query}` : ''}`;
      if (!signingKey || !token) throw Object.assign(new Error('Invalid MessageBird signature'), { status: 401, code: 'invalid_signature' });
      verifyJwt(token, signingKey, url, req.method === 'GET' ? '' : req.rawBody.toString('utf8'));
      const q = new URLSearchParams(req.query || req.rawBody.toString('utf8'));
      const ref = q.get('id');
      const status = q.get('status');
      if (!ref) return [];
      if (status === 'delivered') return [{ ref, status: 'delivered' }];
      if (status === 'delivery_failed' || status === 'expired') return [{ ref, status: 'failed', error: q.get('statusErrorCode') ? `MessageBird error ${q.get('statusErrorCode')}` : status }];
      return [];
    },
  };
}

/**
 * SMS through MessageBird (FR-NOT-4). Each message names /webhooks/notify/notify-messagebird/<tenant id>
 * as its report URL; reports are checked with the signing key from the MessageBird dashboard.
 */
export default definePlugin({
  id: 'notify-messagebird',
  name: 'MessageBird SMS',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.6.0',
  permissions: ['notifications:send', 'network'],
  settings: [
    { key: 'access_key', label: 'Access key', type: 'secret', required: true, help: 'A live or test key from Developers → API access' },
    { key: 'originator', label: 'Sender', type: 'text', required: true, help: 'A number, or up to 11 letters and digits where allowed' },
    { key: 'signing_key', label: 'Signing key', type: 'secret', help: 'From Developers → API access, to check delivery reports' },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ access_key: api.env('MESSAGEBIRD_ACCESS_KEY'), signing_key: api.env('MESSAGEBIRD_SIGNING_KEY') });
    api.registerNotificationChannel(messageBirdChannel());
  },
});
