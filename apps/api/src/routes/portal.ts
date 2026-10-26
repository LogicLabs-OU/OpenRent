import { accounts, portal, AppError, serverT } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Type } from '../schemas.ts';

/**
 * The customer portal (FR-CUS-6, PRD §5.4 `/portal`). The shop is named like the storefront's (publishable
 * key or X-Tenant-Slug); the customer by the session token from /portal/auth/verify in X-Customer-Session.
 */
export function registerPortal(r: Router) {
  const P = ['Portal'];
  const token = (req: any) => String(req.headers['x-customer-session'] ?? '');
  const signedIn = async (ctx: any, req: any) => (await accounts.resolveSession(ctx, token(req))).email;
  const OrderParams = Type.Object({ id: Id });

  r.post(
    '/portal/auth/request_link',
    {
      tags: P,
      summary: 'Email a one-time sign-in link to a customer who has bookings. The answer is the same either way.',
      body: Type.Object({ email: Type.String({ maxLength: 320 }) }),
      rateLimit: { max: 5, timeWindow: '15 minutes', hook: 'preHandler', keyGenerator: (req: any) => `portal-login:${String(req.body?.email ?? '').trim().toLowerCase()}` },
      status: 202,
    },
    async (ctx, req) => accounts.requestLogin(ctx, req.body.email),
  );
  r.post('/portal/auth/verify', { tags: P, summary: 'Exchange the token from the sign-in link for a session token (send it as X-Customer-Session)', body: Type.Object({ token: Type.String({ minLength: 16, maxLength: 200 }) }), rateLimit: { max: 10, timeWindow: '1 minute' }, status: 200 }, async (ctx, req) =>
    accounts.verifyLogin(ctx, req.body.token),
  );
  r.post('/portal/auth/logout', { tags: P, summary: 'End the session', status: 200 }, async (ctx, req) => accounts.logout(ctx, token(req)));

  r.get('/portal/me', { tags: P, summary: 'Profile, account terms, what is owed, insurance documents and signatures waiting' }, async (ctx, req) => portal.me(ctx, await signedIn(ctx, req)));
  r.patch(
    '/portal/me',
    {
      tags: P,
      summary: 'Update name, phone, language, marketing consent and text message updates',
      body: Type.Object(
        {
          name: Type.Optional(Type.String({ maxLength: 200 })),
          phone: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
          locale: Type.Optional(Type.Union([Type.String({ maxLength: 10 }), Type.Null()])),
          marketing_consent: Type.Optional(Type.Boolean()),
          sms_opt_in: Type.Optional(Type.Boolean()),
          whatsapp_opt_in: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => {
      const email = await signedIn(ctx, req);
      await accounts.updateProfile(ctx, email, req.body);
      return portal.me(ctx, email);
    },
  );
  r.get('/portal/orders', { tags: P, summary: 'The customer’s bookings with what is left to pay' }, async (ctx, req) => ({ object: 'list', data: await portal.orders(ctx, await signedIn(ctx, req)) }));
  r.get('/portal/orders/:id', { tags: P, summary: 'One booking: lines, totals, payments and deliveries', params: OrderParams }, async (ctx, req) => portal.order(ctx, await signedIn(ctx, req), req.params.id));
  r.get('/portal/documents/:id/pdf', { tags: P, summary: 'Download a document of one of the customer’s bookings', params: IdParams, raw: true }, async (ctx, req, reply) => {
    const doc = await accounts.documentForEmail(ctx, await signedIn(ctx, req), req.params.id);
    if (r.deps.config.pdfRenderer !== 'playwright') throw new AppError('pdf_renderer_disabled', 501, serverT('pdf.disabled'));
    const { documentPdf } = await import('../pdf.ts');
    const pdf = await documentPdf(ctx, doc);
    return reply.type('application/pdf').header('Cache-Control', 'private, max-age=3600').header('Content-Disposition', `attachment; filename="${pdf.filename}"`).send(pdf.body);
  });
  r.post(
    '/portal/orders/:id/actions/request_extension',
    { tags: P, summary: 'Ask the shop to keep a booking longer', params: OrderParams, body: Type.Object({ ends_at: Type.String({ format: 'date-time' }), reason: Type.Optional(Type.String({ maxLength: 1000 })) }), rateLimit: { max: 10, timeWindow: '1 minute' } },
    async (ctx, req) => accounts.requestExtension(ctx, await signedIn(ctx, req), req.params.id, req.body),
  );
  r.post('/portal/orders/:id/payment_intents', { tags: P, summary: 'Pay what is left on a booking online (a payment client secret for the provider’s form)', params: OrderParams, status: 200 }, async (ctx, req) =>
    portal.payBalance(ctx, await signedIn(ctx, req), req.params.id),
  );
  r.post(
    '/portal/insurance',
    { tags: P, summary: 'Upload an insurance certificate as multipart/form-data (field "file", optional field "label"); it counts for pickup (FR-PAY-8)', raw: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
    async (ctx, req, reply) => {
      const email = await signedIn(ctx, req);
      const part = await req.file();
      if (!part) throw new AppError('validation_error', 422, serverT('files.no_file'), { errors: [{ field: 'file', code: 'required', message: serverT('files.no_file') }] });
      const body = await part.toBuffer();
      const label = (part.fields as any)?.label?.value as string | undefined;
      const filename = part.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'insurance';
      return reply.status(201).send(await portal.uploadInsurance(ctx, email, { filename, contentType: part.mimetype, body }, label));
    },
  );
}
