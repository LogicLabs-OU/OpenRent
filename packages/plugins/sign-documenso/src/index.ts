import { timingSafeEqual } from 'node:crypto';
import { definePlugin, type ProviderContext, type SignatureProvider } from '@openrent/plugin-sdk';
import { PDFDocument } from 'pdf-lib';

/**
 * Documenso e-signatures (FR-DOC-6): a document staff send for signing goes to Documenso as an envelope
 * with one signer and a signature field on the last page. Documenso emails the signer; its webhook (or
 * OpenRent asking) brings the result, and the signed PDF is kept with the document.
 */
const LANGUAGES = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pl', 'ja'];

const base = (ctx: ProviderContext) => `${String(ctx.config.api_url || 'https://app.documenso.com').replace(/\/$/, '')}/api/v2`;

async function call(ctx: ProviderContext, path: string, init: { method?: string; json?: unknown; form?: FormData } = {}) {
  const res = await fetch(`${base(ctx)}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: String(ctx.config.api_key ?? ''), ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const b: any = await res.json().catch(() => ({}));
    throw new Error(`Documenso ${res.status}: ${b.message ?? res.statusText}`);
  }
  return res;
}

/** Where the signature goes: on the last page, near the bottom (positions are percentages). */
export async function signatureField(pdf: Uint8Array) {
  const pages = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
  return { type: 'SIGNATURE', page: pages, positionX: 10, positionY: 84, width: 30, height: 6 };
}

export function createDocumensoProvider(): SignatureProvider {
  return {
    id: 'documenso',
    isConfigured: (ctx) => typeof ctx.config.api_key === 'string' && ctx.config.api_key.length > 8,
    async requestSignature(ctx, req) {
      const pdf = await req.pdf?.();
      if (!pdf) throw new Error('Documenso needs the document as a PDF; this installation makes no PDFs');
      const payload = {
        title: req.title ?? req.documentId, type: 'DOCUMENT', externalId: req.documentId,
        recipients: [{ name: req.signer.name, email: req.signer.email, role: 'SIGNER', fields: [await signatureField(pdf)] }],
      };
      const form = new FormData();
      form.append('payload', JSON.stringify(payload));
      form.append('files', new Blob([Buffer.from(pdf)], { type: 'application/pdf' }), `${req.documentId}.pdf`);
      const created = (await (await call(ctx, '/envelope/create', { method: 'POST', form })).json()) as { id: string };
      const language = req.locale && LANGUAGES.includes(req.locale) ? req.locale : undefined;
      const sent: any = await (await call(ctx, '/envelope/distribute', { method: 'POST', json: { envelopeId: created.id, meta: { subject: req.title, ...(language ? { language } : {}) } } })).json();
      return { ref: created.id, url: sent.recipients?.find((r: any) => r.email === req.signer.email)?.signingUrl ?? null };
    },
    async status(ctx, ref) {
      const e: any = await (await call(ctx, `/envelope/${encodeURIComponent(ref)}`)).json();
      return e.status === 'COMPLETED' ? 'signed' : e.status === 'REJECTED' || e.status === 'CANCELLED' ? 'declined' : 'pending';
    },
    async handleWebhook(ctx, req) {
      const secret = Buffer.from(String(ctx.config.webhook_secret ?? ''));
      const sent = Buffer.from(String(req.headers['x-documenso-secret'] ?? ''));
      // Documenso sends the secret itself; without one set here, nothing is trusted.
      if (!secret.length || sent.length !== secret.length || !timingSafeEqual(sent, secret)) throw Object.assign(new Error('Invalid Documenso secret'), { status: 401, code: 'invalid_signature' });
      const body = JSON.parse(req.rawBody.toString('utf8'));
      const ref = body?.payload?.envelopeId;
      if (!ref) return null;
      if (body.event === 'DOCUMENT_COMPLETED') return { ref, status: 'signed' };
      if (body.event === 'DOCUMENT_REJECTED' || body.event === 'DOCUMENT_CANCELLED') return { ref, status: 'declined' };
      return null;
    },
    async signedPdf(ctx, ref) {
      const e: any = await (await call(ctx, `/envelope/${encodeURIComponent(ref)}`)).json();
      const item = e.envelopeItems?.[0]?.id;
      if (!item) return null;
      return new Uint8Array(await (await call(ctx, `/envelope/item/${encodeURIComponent(item)}/download?version=signed`)).arrayBuffer());
    },
  };
}

export default definePlugin({
  id: 'sign-documenso',
  name: 'Documenso e-signatures',
  version: '1.0.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.9.0',
  permissions: ['documents:read', 'network'],
  settings: [
    { key: 'api_key', label: 'API token', type: 'secret', required: true, help: 'Documenso → Settings → API tokens' },
    { key: 'webhook_secret', label: 'Webhook secret', type: 'secret', required: true, help: 'The secret of the webhook you add in Documenso for “Document completed” and “Document rejected”' },
    { key: 'api_url', label: 'Documenso address', type: 'text', default: 'https://app.documenso.com', help: 'For a Documenso you host yourself' },
  ],
  setup(api) {
    api.registerSignatureProvider(createDocumensoProvider());
  },
});
