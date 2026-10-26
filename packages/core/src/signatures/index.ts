import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Ctx } from '../context.ts';
import { AppError, invalid, notFound } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId, sha256 } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, must, one } from '../sql.ts';
import { putFile } from '../files/index.ts';
import { orderMessageData, queue } from '../notifications/index.ts';
import { storefrontBase } from '../domains/index.ts';
import { enabledProvider } from '../plugins/index.ts';

/**
 * Signing issued documents with an emailed code (FR-DOC-5). Staff request a signature; the customer
 * opens the link, gets a six-digit code by email, and signs with their name and, if they like, a drawn
 * signature. The signature records who signed, how, and hashes of exactly what was signed; the issued
 * document itself never changes. A signature plugin, when installed, can take over the signing.
 */
const REQUEST_DAYS = 14;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const SIGNABLE = ['issued', 'sent'];

export function requestToApi(r: any) {
  return {
    id: r.id, object: 'signature_request', document_id: r.document_id, order_id: r.order_id, signer_name: r.signer_name, signer_email: r.signer_email,
    status: r.status, provider: r.provider, provider_url: r.provider_url ?? null, viewed_at: r.viewed_at, signed_at: r.signed_at, expires_at: r.expires_at, created_at: r.created_at,
  };
}

export function signatureToApi(s: any) {
  return {
    id: s.id, object: 'signature', request_id: s.request_id, document_id: s.document_id, signer_name: s.signer_name, signer_email: s.signer_email, method: s.method,
    html_sha256: s.html_sha256, pdf_sha256: s.pdf_sha256, has_pdf: !!s.pdf_file_id, ip: s.ip, created_at: s.created_at,
  };
}

const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'•'.repeat(Math.min(6, Math.max(1, b.length)))}${c}`);

/** Expired pending requests are marked so; done lazily wherever a request is read. */
async function expireOld(ctx: Ctx) {
  await exec(ctx, `UPDATE signature_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < $1`, [ctx.now]);
}

/** Staff ask the customer to sign an issued document; the link goes out by email. */
export async function requestSignature(ctx: Ctx, documentId: string, input: { signer_name?: string; signer_email?: string } = {}) {
  await expireOld(ctx);
  const doc = await must<any>(ctx, `SELECT * FROM documents WHERE id = $1`, [documentId], 'document', documentId);
  if (!SIGNABLE.includes(doc.status)) throw new AppError('not_signable', 409, msg('signature.not_signable', { status: doc.status }));
  if (!doc.order_id) throw new AppError('no_order', 422, msg('error.only_order_documents_can_be_sent'));
  if (await one(ctx, `SELECT 1 FROM signature_requests WHERE document_id = $1 AND status = 'pending'`, [documentId]))
    throw new AppError('signature_pending', 409, msg('signature.already_pending'));
  const customer = await one<any>(ctx, `SELECT c.name, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [doc.order_id]);
  const name = input.signer_name?.trim() || customer?.name || '';
  const email = input.signer_email?.trim() || customer?.email || '';
  const errors = [];
  if (!name) errors.push({ field: 'signer_name', code: 'required', message: msg('error.field.enter_a_name') });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: 'signer_email', code: 'invalid', message: msg('error.field.invalid_email') });
  if (errors.length) throw invalid(msg('signature.check_signer'), errors);

  const token = randomBytes(24).toString('base64url');
  const id = newId('sgr');
  const expires = new Date(ctx.now.getTime() + REQUEST_DAYS * 86400_000);
  // A signature plugin that is on and set up does the signing; otherwise the built-in emailed code does.
  const plugin = await enabledProvider(ctx, ctx.plugins.signatureProvider());
  const ext = plugin ? await plugin.provider.requestSignature(plugin.pctx, { documentId, documentUrl: `${await storefrontBase(ctx)}/sign/${token}`, signer: { name, email } }) : null;
  await exec(
    ctx,
    `INSERT INTO signature_requests (id, tenant_id, document_id, order_id, signer_name, signer_email, token_hash, expires_at, provider, provider_ref, provider_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, ctx.tenantId, documentId, doc.order_id, name, email, sha256(token), expires, plugin ? plugin.provider.id : 'builtin', ext?.ref ?? null, ext?.url ?? null, ctx.actor.id],
  );
  if (!ext) {
    const link = `${await storefrontBase(ctx)}/sign/${token}`;
    await queue(ctx, { template: 'signature_requested', to: email, audience: 'customer', orderId: doc.order_id, data: await orderMessageData(ctx, doc.order_id, { link, signer: name, document_title: msg(`doc.title.${doc.type}` as any), document_number: doc.number ?? '' }) });
  }
  const api = requestToApi(await must(ctx, `SELECT * FROM signature_requests WHERE id = $1`, [id], 'signature_request'));
  await audit(ctx, { entity_type: 'document', entity_id: documentId, action: 'request_signature', after: api });
  await emit(ctx, 'document.signature_requested', { type: 'document', id: documentId }, api);
  return api;
}

export async function cancelSignatureRequest(ctx: Ctx, id: string) {
  const r = await must<any>(ctx, `SELECT * FROM signature_requests WHERE id = $1 FOR UPDATE`, [id], 'signature_request', id);
  if (r.status !== 'pending') throw new AppError('not_pending', 409, msg('signature.not_pending'));
  await exec(ctx, `UPDATE signature_requests SET status = 'cancelled' WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'document', entity_id: r.document_id, action: 'cancel_signature_request', extra: { request_id: id } });
  return requestToApi({ ...r, status: 'cancelled' });
}

/** Requests and signatures of a document, newest first. */
export async function documentSignatures(ctx: Ctx, documentId: string) {
  await expireOld(ctx);
  return {
    object: 'document_signatures',
    requests: (await many(ctx, `SELECT * FROM signature_requests WHERE document_id = $1 ORDER BY created_at DESC`, [documentId])).map(requestToApi),
    signatures: (await many(ctx, `SELECT * FROM signatures WHERE document_id = $1 ORDER BY created_at DESC`, [documentId])).map(signatureToApi),
  };
}

export async function getSignature(ctx: Ctx, id: string) {
  return must<any>(ctx, `SELECT * FROM signatures WHERE id = $1`, [id], 'signature', id);
}

// ---------------------------------------------------------------------------
// The customer's side, by link token
// ---------------------------------------------------------------------------

async function byToken(ctx: Ctx, token: string, lock = false) {
  await expireOld(ctx);
  const r = await one<any>(ctx, `SELECT * FROM signature_requests WHERE token_hash = $1${lock ? ' FOR UPDATE' : ''}`, [sha256(String(token))]);
  if (!r) throw notFound('signature_request');
  return r;
}

/** What the signing page shows. The first look is recorded (document.viewed). */
export async function viewByToken(ctx: Ctx, token: string, meta: { ip?: string | null } = {}) {
  const r = await byToken(ctx, token, true);
  const doc = await must<any>(ctx, `SELECT id, type, number, issued_at, status FROM documents WHERE id = $1`, [r.document_id], 'document');
  if (r.status === 'pending' && !r.viewed_at) {
    await exec(ctx, `UPDATE signature_requests SET viewed_at = $2 WHERE id = $1`, [r.id, ctx.now]);
    await emit(ctx, 'document.viewed', { type: 'document', id: doc.id }, { object: 'document', id: doc.id, request_id: r.id, viewed_at: ctx.now.toISOString(), ip: meta.ip ?? null });
  }
  return {
    object: 'signature_request', status: r.status, signer_name: r.signer_name, signer_email: maskEmail(r.signer_email), expires_at: r.expires_at, signed_at: r.signed_at,
    code_sent: !!r.code_hash && r.code_expires_at && new Date(r.code_expires_at) > ctx.now,
    document: { id: doc.id, type: doc.type, title: msg(`doc.title.${doc.type}` as any), number: doc.number, issued_at: doc.issued_at },
  };
}

/** The document's HTML, for the signing page to show before signing. */
export async function documentHtmlByToken(ctx: Ctx, token: string) {
  const r = await byToken(ctx, token);
  return (await must<{ html: string }>(ctx, `SELECT html FROM documents WHERE id = $1`, [r.document_id], 'document')).html;
}

function needPending(r: any) {
  if (r.status !== 'pending') throw new AppError(`request_${r.status}`, 409, msg(`signature.status_${r.status as 'signed'}`));
  if (r.attempts >= MAX_ATTEMPTS) throw new AppError('request_locked', 409, msg('signature.locked'));
}

/** Emails a fresh six-digit code (valid ten minutes, at most five per request). */
export async function sendCode(ctx: Ctx, token: string) {
  const r = await byToken(ctx, token, true);
  needPending(r);
  if (r.code_sends >= MAX_SENDS) throw new AppError('too_many_codes', 429, msg('signature.too_many_codes'));
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await exec(ctx, `UPDATE signature_requests SET code_hash = $2, code_expires_at = $3, code_sends = code_sends + 1 WHERE id = $1`, [r.id, sha256(`${r.id}:${code}`), new Date(ctx.now.getTime() + CODE_MINUTES * 60_000)]);
  await queue(ctx, { template: 'signature_code', to: r.signer_email, audience: 'customer', orderId: r.order_id, data: await orderMessageData(ctx, r.order_id, { code, minutes: CODE_MINUTES }) });
  return { object: 'result', sent_to: maskEmail(r.signer_email), expires_in_minutes: CODE_MINUTES };
}

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface SignInput {
  code: string;
  name: string;
  /** A drawn signature as a PNG data URL; without one the typed name is the signature. */
  image?: string | null;
  consent: boolean;
}

/**
 * Signs with the emailed code. `signedPdf` (supplied by the API, which renders PDFs) receives the
 * signature and returns the issued PDF with a signature page added; it is stored with its hash.
 */
export async function signByToken(
  ctx: Ctx,
  token: string,
  input: SignInput,
  meta: { ip?: string | null; user_agent?: string | null } = {},
  signedPdf?: (s: { signer_name: string; signer_email: string; method: string; image: Buffer | null; signed_at: Date; html_sha256: string; ip: string | null }) => Promise<Buffer | null>,
) {
  const r = await byToken(ctx, token, true);
  needPending(r);
  const errors = [];
  if (!input.name?.trim()) errors.push({ field: 'name', code: 'required', message: msg('error.field.enter_a_name') });
  if (!input.consent) errors.push({ field: 'consent', code: 'required', message: msg('signature.consent_required') });
  let image: Buffer | null = null;
  if (input.image) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.image);
    image = m ? Buffer.from(m[1]!, 'base64') : null;
    if (!image || image.length > 512_000 || image.subarray(1, 4).toString() !== 'PNG') errors.push({ field: 'image', code: 'invalid', message: msg('signature.bad_image') });
  }
  if (errors.length) throw invalid(msg('signature.check_signer'), errors);
  const code = String(input.code ?? '').replace(/\D/g, '');
  const valid = !!r.code_hash && r.code_expires_at && new Date(r.code_expires_at) > ctx.now && sameHash(sha256(`${r.id}:${code}`), r.code_hash);
  if (!valid) {
    // Returned, not thrown: the wrong try must be counted, so the transaction has to commit.
    await exec(ctx, `UPDATE signature_requests SET attempts = attempts + 1 WHERE id = $1`, [r.id]);
    const left = MAX_ATTEMPTS - r.attempts - 1;
    return {
      object: 'signature_error' as const, code: 'wrong_code', message: msg('signature.wrong_code'),
      errors: [{ field: 'code', code: 'invalid', message: left > 0 ? msg('signature.wrong_code_left', { count: left }) : msg('signature.locked') }],
    };
  }
  const doc = await must<any>(ctx, `SELECT * FROM documents WHERE id = $1`, [r.document_id], 'document');
  const htmlSha = sha256(doc.html);
  const id = newId('sig');
  const method = image ? 'drawn' : 'typed';
  const imageFile = image ? await putFile(ctx, { kind: 'signature', ownerType: 'signature', ownerId: id, filename: 'signature.png', contentType: 'image/png', body: image }) : null;
  const pdf = signedPdf ? await signedPdf({ signer_name: input.name.trim(), signer_email: r.signer_email, method, image, signed_at: ctx.now, html_sha256: htmlSha, ip: meta.ip ?? null }) : null;
  const pdfFile = pdf ? await putFile(ctx, { kind: 'pdf', ownerType: 'signature', ownerId: id, filename: `${doc.type}-${(doc.number ?? doc.id).replace(/[^\w.-]+/g, '-')}-signed.pdf`, contentType: 'application/pdf', body: pdf }) : null;
  await exec(
    ctx,
    `INSERT INTO signatures (id, tenant_id, request_id, document_id, signer_name, signer_email, method, image_file_id, ip, user_agent, html_sha256, pdf_sha256, pdf_file_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, ctx.tenantId, r.id, doc.id, input.name.trim(), r.signer_email, method, imageFile?.id ?? null, meta.ip ?? null, meta.user_agent?.slice(0, 500) ?? null, htmlSha, pdf ? sha256(pdf) : null, pdfFile?.id ?? null],
  );
  await exec(ctx, `UPDATE signature_requests SET status = 'signed', signed_at = $2, code_hash = NULL WHERE id = $1`, [r.id, ctx.now]);
  const sig = signatureToApi(await must(ctx, `SELECT * FROM signatures WHERE id = $1`, [id], 'signature'));
  await audit(ctx, { entity_type: 'document', entity_id: doc.id, action: 'sign', after: sig });
  await emit(ctx, 'document.signed', { type: 'document', id: doc.id }, sig);
  await queue(ctx, { template: 'document_signed', to: r.signer_email, audience: 'customer', orderId: r.order_id, data: await orderMessageData(ctx, r.order_id, { document_title: msg(`doc.title.${doc.type}` as any), document_number: doc.number ?? '' }) });
  return { object: 'signature_request' as const, status: 'signed', signed_at: ctx.now.toISOString(), signature: sig };
}
