import { signatures, documents, files, AppError, serverT, type Ctx } from '@openrent/core';
import type { Router } from '../http.ts';
import { problem } from '../errors.ts';
import { IdParams, Nullable, Type } from '../schemas.ts';

/** Signing issued documents with an emailed code (FR-DOC-5): staff requests, and the customer's signing page. */
export function registerSignatures(r: Router) {
  const D = ['Documents'];
  r.post(
    '/documents/:id/actions/request_signature',
    {
      permission: 'documents:write', tags: D, summary: 'Ask the customer to sign the document; the link is emailed', params: IdParams, status: 200,
      body: Type.Object({ signer_name: Type.Optional(Type.String({ maxLength: 200 })), signer_email: Type.Optional(Type.String({ maxLength: 200 })) }, { additionalProperties: false }),
    },
    async (ctx, req) => signatures.requestSignature(ctx, req.params.id, req.body ?? {}),
  );
  r.get('/documents/:id/signatures', { permission: 'documents:read', tags: D, summary: 'Signature requests and signatures of a document', params: IdParams }, async (ctx, req) =>
    signatures.documentSignatures(ctx, req.params.id),
  );
  r.post('/signature_requests/:id/actions/cancel', { permission: 'documents:write', tags: D, summary: 'Withdraw a signature request', params: IdParams, status: 200 }, async (ctx, req) =>
    signatures.cancelSignatureRequest(ctx, req.params.id),
  );
  r.get('/signatures/:id/pdf', { permission: 'documents:read', tags: D, summary: 'The signed PDF (the issued pages plus the signature page)', params: IdParams, raw: true }, async (ctx, req, reply) => {
    const s = await signatures.getSignature(ctx, req.params.id);
    const f = s.pdf_file_id ? await files.findById(ctx, s.pdf_file_id) : null;
    if (!f) throw new AppError('no_signed_pdf', 404, serverT('signature.no_pdf'));
    return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"`).send(await files.readFile(ctx, f));
  });

  // The customer's side: the link token is the proof, the emailed code confirms the person.
  const S = ['Storefront'];
  const Token = Type.Object({ token: Type.String({ minLength: 16, maxLength: 100 }) });
  r.get('/storefront/signatures/:token', { tags: S, summary: 'The signing page: which document, for whom, and its state', params: Token }, async (ctx, req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return signatures.viewByToken(ctx, req.params.token, { ip: req.ip });
  });
  r.get('/storefront/signatures/:token/document', { tags: S, summary: 'The document to sign, as HTML', params: Token, raw: true }, async (ctx, req, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'private, no-store')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:")
      .send(await signatures.documentHtmlByToken(ctx, req.params.token)),
  );
  r.post('/storefront/signatures/:token/actions/send_code', { tags: S, summary: 'Email a six-digit code to the signer', params: Token, status: 200 }, async (ctx, req) => signatures.sendCode(ctx, req.params.token));
  r.post(
    '/storefront/signatures/:token/actions/sign',
    {
      tags: S, summary: 'Sign with the emailed code (a wrong code counts as a try)', params: Token, raw: true,
      body: Type.Object(
        { code: Type.String({ maxLength: 12 }), name: Type.String({ maxLength: 200 }), image: Type.Optional(Nullable(Type.String({ maxLength: 700_000 }))), consent: Type.Boolean() },
        { additionalProperties: false },
      ),
    },
    async (ctx, req, reply) => {
      const maker = await pdfMaker(r, ctx, req.params.token);
      const res = await signatures.signByToken(ctx, req.params.token, req.body, { ip: req.ip, user_agent: req.headers['user-agent'] ?? null }, maker);
      // A wrong code is answered as a 422 without throwing, so the counted try is kept.
      if (res.object === 'signature_error') return reply.status(422).type('application/problem+json').send(problem(422, res.code, res.message, req, { errors: res.errors }));
      return reply.status(200).send(res);
    },
  );
}

/** The signed-PDF builder when PDFs are on; signing still works without it (the HTML hash is kept). */
async function pdfMaker(r: Router, ctx: Ctx, token: string) {
  if (r.deps.config.pdfRenderer !== 'playwright') return undefined;
  const view = await signatures.viewByToken(ctx, token);
  const doc = await documents.getDocument(ctx, view.document.id);
  const locale = (await ctx.db.query(`SELECT locale FROM tenants WHERE id = $1`, [ctx.tenantId])).rows[0]?.locale ?? 'en';
  const { signedPdfMaker } = await import('../pdf.ts');
  return signedPdfMaker(ctx, doc, locale);
}
