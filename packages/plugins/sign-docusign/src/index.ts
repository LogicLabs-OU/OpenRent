import { createHmac, createSign, timingSafeEqual } from 'node:crypto';
import { definePlugin, type ProviderContext, type SignatureProvider } from '@openrent/plugin-sdk';
import { PDFDocument } from 'pdf-lib';

/**
 * DocuSign e-signatures (FR-DOC-6), through the JWT grant: the shop's integration key and an RSA key
 * act for one DocuSign user, so no one has to sign in. A document goes out as an envelope with one signer
 * and a Sign Here tab on the last page; Connect webhooks (or OpenRent asking) bring the result.
 */
const AUTH = { demo: 'account-d.docusign.com', production: 'account.docusign.com' } as const;

/** The auth server: the shop's own setting, else DocuSign's for the environment. */
function authBase(ctx: ProviderContext) {
  if (typeof ctx.config.auth_url === 'string' && ctx.config.auth_url) return ctx.config.auth_url.replace(/\/$/, '');
  return `https://${AUTH[ctx.config.environment === 'production' ? 'production' : 'demo']}`;
}

const tokens = new Map<string, { token: string; until: number; baseUri: string; accountId: string }>();

/** An RS256 JWT assertion for the JWT grant. */
export function assertion(o: { integrationKey: string; userId: string; audience: string; privateKey: string; now?: number }) {
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: o.integrationKey, sub: o.userId, aud: o.audience, iat: now, exp: now + 3600, scope: 'signature impersonation' })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(o.privateKey).toString('base64url')}`;
}

async function session(ctx: ProviderContext) {
  const key = `${ctx.tenantId}:${ctx.config.integration_key}:${ctx.config.user_id}`;
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now() + 60_000) return hit;
  const auth = authBase(ctx);
  const res = await fetch(`${auth}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion({ integrationKey: String(ctx.config.integration_key), userId: String(ctx.config.user_id), audience: new URL(auth).host, privateKey: String(ctx.config.private_key) }),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const t: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DocuSign sign-in: ${t.error ?? res.status}${t.error === 'consent_required' ? ' (grant consent for the integration key once)' : ''}`);
  const info: any = await (await fetch(`${auth}/oauth/userinfo`, { headers: { authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(20_000) })).json();
  const account = (info.accounts ?? []).find((a: any) => (ctx.config.account_id ? a.account_id === ctx.config.account_id : a.is_default)) ?? info.accounts?.[0];
  if (!account) throw new Error('DocuSign: the user has no account');
  const s = { token: t.access_token, until: Date.now() + Number(t.expires_in ?? 3600) * 1000, baseUri: String(account.base_uri).replace(/\/$/, ''), accountId: account.account_id };
  tokens.set(key, s);
  return s;
}

async function call(ctx: ProviderContext, path: string, init: { method?: string; json?: unknown } = {}) {
  const s = await session(ctx);
  const res = await fetch(`${s.baseUri}/restapi/v2.1/accounts/${s.accountId}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${s.token}`, ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const b: any = await res.json().catch(() => ({}));
    throw new Error(`DocuSign ${res.status}: ${b.errorCode ?? ''} ${b.message ?? res.statusText}`.trim());
  }
  return res;
}

export function createDocuSignProvider(): SignatureProvider {
  return {
    id: 'docusign',
    isConfigured: (ctx) => !!ctx.config.integration_key && !!ctx.config.user_id && String(ctx.config.private_key ?? '').includes('PRIVATE KEY'),
    async requestSignature(ctx, req) {
      const pdf = await req.pdf?.();
      if (!pdf) throw new Error('DocuSign needs the document as a PDF; this installation makes no PDFs');
      const pages = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
      const e: any = await (
        await call(ctx, '/envelopes', {
          method: 'POST',
          json: {
            emailSubject: (req.title ?? 'Please sign').slice(0, 100),
            documents: [{ documentBase64: Buffer.from(pdf).toString('base64'), name: `${req.title ?? req.documentId}.pdf`, fileExtension: 'pdf', documentId: '1' }],
            recipients: { signers: [{ email: req.signer.email, name: req.signer.name, recipientId: '1', routingOrder: '1', tabs: { signHereTabs: [{ documentId: '1', pageNumber: String(pages), xPosition: '60', yPosition: '680' }] } }] },
            status: 'sent',
          },
        })
      ).json();
      return { ref: e.envelopeId, url: null };
    },
    async status(ctx, ref) {
      const e: any = await (await call(ctx, `/envelopes/${encodeURIComponent(ref)}`)).json();
      return e.status === 'completed' ? 'signed' : e.status === 'declined' || e.status === 'voided' ? 'declined' : 'pending';
    },
    async handleWebhook(ctx, req) {
      const key = String(ctx.config.hmac_key ?? '');
      const sent = Buffer.from(String(req.headers['x-docusign-signature-1'] ?? ''));
      const want = Buffer.from(createHmac('sha256', key).update(req.rawBody).digest('base64'));
      if (!key || sent.length !== want.length || !timingSafeEqual(sent, want)) throw Object.assign(new Error('Invalid DocuSign signature'), { status: 401, code: 'invalid_signature' });
      const body = JSON.parse(req.rawBody.toString('utf8'));
      const ref = body?.data?.envelopeId;
      if (!ref) return null;
      if (body.event === 'envelope-completed') return { ref, status: 'signed' };
      if (body.event === 'envelope-declined' || body.event === 'envelope-voided') return { ref, status: 'declined' };
      return null;
    },
    async signedPdf(ctx, ref) {
      return new Uint8Array(await (await call(ctx, `/envelopes/${encodeURIComponent(ref)}/documents/combined`)).arrayBuffer());
    },
  };
}

export default definePlugin({
  id: 'sign-docusign',
  name: 'DocuSign e-signatures',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['documents:read', 'network'],
  settings: [
    { key: 'environment', label: 'Environment', type: 'select', options: ['demo', 'production'], default: 'demo' },
    { key: 'integration_key', label: 'Integration key', type: 'text', required: true },
    { key: 'user_id', label: 'User ID (the DocuSign user the documents are sent as)', type: 'text', required: true },
    { key: 'private_key', label: 'RSA private key', type: 'secret', required: true, help: 'The key pair’s private key, PEM, from the integration key’s settings' },
    { key: 'account_id', label: 'Account ID', type: 'text', help: 'Empty for the user’s default account' },
    { key: 'hmac_key', label: 'Connect HMAC key', type: 'secret', help: 'For webhooks: Settings → Connect → HMAC; send “Envelope completed” and “Envelope declined” to the address OpenRent shows' },
  ],
  setup(api) {
    api.registerSignatureProvider(createDocuSignProvider());
  },
});
