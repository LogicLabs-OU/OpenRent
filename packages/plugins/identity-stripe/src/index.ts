import { createHmac, timingSafeEqual } from 'node:crypto';
import { definePlugin, type IdentityCheckResult, type IdentityProvider, type ProviderContext } from '@openrent/plugin-sdk';

/**
 * Stripe Identity ID checks (FR-PAY-9): a verification session in which the customer photographs an ID
 * document (and, if the shop asks, a selfie) on Stripe's page. Stripe's webhook, or OpenRent asking,
 * brings the result.
 */
const base = (ctx: ProviderContext) => String(ctx.config.api_url || 'https://api.stripe.com').replace(/\/$/, '');

async function call(ctx: ProviderContext, path: string, form?: Record<string, string>) {
  const res = await fetch(`${base(ctx)}${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${ctx.config.secret_key}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(form && ctx.idempotencyKey ? { 'idempotency-key': ctx.idempotencyKey } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const b: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe Identity ${res.status}: ${b.error?.message ?? res.statusText}`);
  return b;
}

/** A session in OpenRent's terms: verified, still open, or failed with Stripe's reason. */
export function result(s: any): IdentityCheckResult {
  if (s.status === 'verified') return { status: 'verified', ref: s.id };
  if (s.status === 'canceled' || (s.status === 'requires_input' && s.last_error)) return { status: 'failed', ref: s.id, url: s.url ?? null, reason: s.last_error?.reason ?? s.status };
  return { status: 'pending', ref: s.id, url: s.url ?? null };
}

/** Checks a Stripe-Signature header (`t=…,v1=…`) over `t.body`, within five minutes. */
export function verifySignature(header: string, body: Buffer, secret: string, now = Date.now()) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!secret || !t || !parts.v1 || Math.abs(now / 1000 - t) > 300) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(`${t}.${body.toString('utf8')}`).digest('hex'));
  const got = Buffer.from(parts.v1);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function createStripeIdentityProvider(): IdentityProvider {
  return {
    id: 'stripe-identity',
    isConfigured: (ctx) => /^(sk|rk)_(test|live)_\w{10,}$/.test(String(ctx.config.secret_key ?? '')),
    async check(ctx, req) {
      const s = await this.start!(ctx, { ...req, returnUrl: String(ctx.config.return_url || 'https://stripe.com') });
      return { status: 'pending', ref: s.ref, url: s.url };
    },
    async start(ctx, req) {
      const form: Record<string, string> = { type: 'document', return_url: req.returnUrl, 'metadata[customer_id]': req.customer.id, ...(req.orderId ? { 'metadata[order_id]': req.orderId } : {}) };
      if (req.customer.email) form['provided_details[email]'] = req.customer.email;
      if (ctx.config.require_selfie === true) form['options[document][require_matching_selfie]'] = 'true';
      const s = await call(ctx, '/v1/identity/verification_sessions', form);
      return { ref: s.id, url: s.url };
    },
    async status(ctx, ref) {
      return result(await call(ctx, `/v1/identity/verification_sessions/${encodeURIComponent(ref)}`));
    },
    async handleWebhook(ctx, req) {
      if (!verifySignature(String(req.headers['stripe-signature'] ?? ''), req.rawBody, String(ctx.config.webhook_secret ?? ''))) throw Object.assign(new Error('Invalid Stripe signature'), { status: 401, code: 'invalid_signature' });
      const ev = JSON.parse(req.rawBody.toString('utf8'));
      if (!String(ev.type ?? '').startsWith('identity.verification_session.')) return null;
      const r = result(ev.data?.object ?? {});
      return r.ref ? { ref: r.ref, status: r.status, reason: r.reason ?? null } : null;
    },
  };
}

export default definePlugin({
  id: 'identity-stripe',
  name: 'Stripe Identity ID checks',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['customers:read', 'network'],
  settings: [
    { key: 'secret_key', label: 'Secret key', type: 'secret', required: true, help: 'A restricted key with Identity write access is enough' },
    { key: 'webhook_secret', label: 'Webhook signing secret', type: 'secret', help: 'For a webhook endpoint with the identity.verification_session events' },
    { key: 'require_selfie', label: 'Ask for a selfie that matches the document', type: 'boolean', default: false },
  ],
  setup(api) {
    api.registerIdentityProvider(createStripeIdentityProvider());
  },
});
