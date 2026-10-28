import { createHmac, timingSafeEqual } from 'node:crypto';
import { definePlugin, type IdentityCheckResult, type IdentityProvider, type ProviderContext } from '@openrent/plugin-sdk';

/**
 * Veriff ID checks (FR-PAY-9): a session in which the customer shows an ID document on Veriff's page.
 * Requests are signed with the shared secret (HMAC-SHA256, hex); the decision webhook is too.
 */
const base = (ctx: ProviderContext) => String(ctx.config.api_url || 'https://stationapi.veriff.com').replace(/\/$/, '');
const sign = (ctx: ProviderContext, data: string | Buffer) => createHmac('sha256', String(ctx.config.shared_secret ?? '')).update(data).digest('hex');

/** Veriff's decision in OpenRent's terms; resubmission and review are still open. */
export function decision(v: any, ref: string): IdentityCheckResult {
  if (!v) return { status: 'pending', ref };
  if (v.status === 'approved') return { status: 'verified', ref };
  if (['declined', 'expired', 'abandoned'].includes(v.status)) return { status: 'failed', ref, reason: v.reason ?? v.status };
  return { status: 'pending', ref };
}

export function createVeriffProvider(): IdentityProvider {
  return {
    id: 'veriff',
    isConfigured: (ctx) => !!ctx.config.api_key && !!ctx.config.shared_secret,
    async check(ctx, req) {
      const s = await this.start!(ctx, { ...req, returnUrl: '' });
      return { status: 'pending', ref: s.ref, url: s.url };
    },
    async start(ctx, req) {
      const [firstName, ...rest] = req.customer.name.trim().split(/\s+/);
      const body = JSON.stringify({ verification: { ...(req.returnUrl ? { callback: req.returnUrl } : {}), person: { firstName: firstName ?? '', lastName: rest.join(' ') }, vendorData: req.customer.id } });
      const res = await fetch(`${base(ctx)}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-client': String(ctx.config.api_key), 'x-hmac-signature': sign(ctx, body) }, body, signal: AbortSignal.timeout(20_000) });
      const b: any = await res.json().catch(() => ({}));
      if (!res.ok || b.status !== 'success') throw new Error(`Veriff ${res.status}: ${b.message ?? res.statusText}`);
      return { ref: b.verification.id, url: b.verification.url };
    },
    async status(ctx, ref) {
      const res = await fetch(`${base(ctx)}/v1/sessions/${encodeURIComponent(ref)}/decision`, { headers: { 'x-auth-client': String(ctx.config.api_key), 'x-hmac-signature': sign(ctx, ref) }, signal: AbortSignal.timeout(20_000) });
      const b: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Veriff ${res.status}: ${b.message ?? res.statusText}`);
      return decision(b.verification, ref);
    },
    async handleWebhook(ctx, req) {
      const got = Buffer.from(String(req.headers['x-hmac-signature'] ?? '').toLowerCase());
      const want = Buffer.from(sign(ctx, req.rawBody));
      if (!ctx.config.shared_secret || got.length !== want.length || !timingSafeEqual(got, want)) throw Object.assign(new Error('Invalid Veriff signature'), { status: 401, code: 'invalid_signature' });
      const v = JSON.parse(req.rawBody.toString('utf8'))?.verification;
      if (!v?.id) return null;
      const r = decision(v, v.id);
      return { ref: v.id, status: r.status, reason: r.reason ?? null };
    },
  };
}

export default definePlugin({
  id: 'identity-veriff',
  name: 'Veriff ID checks',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['customers:read', 'network'],
  settings: [
    { key: 'api_key', label: 'API key', type: 'secret', required: true },
    { key: 'shared_secret', label: 'Shared secret key', type: 'secret', required: true },
    { key: 'api_url', label: 'API address', type: 'text', default: 'https://stationapi.veriff.com' },
  ],
  setup(api) {
    api.registerIdentityProvider(createVeriffProvider());
  },
});
