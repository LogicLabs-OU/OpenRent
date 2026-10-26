import { storefront, accounts, availability, customers, orders, themes, AppError, invalid, serverT } from '@openrent/core';
import type { FastifyReply } from 'fastify';
import { imageBytes } from '../images.ts';
import type { Router } from '../http.ts';
import { Address, Id, IdParams, Nullable, QuoteOptions, Type } from '../schemas.ts';

const CartLine = Type.Object({ variant_id: Id, quantity: Type.Integer({ minimum: 0, maximum: 1000 }), picks: Type.Optional(Nullable(Type.Record(Type.String({ maxLength: 80 }), Id, { description: 'Choice bundles: the option picked per slot' }))) });

export function registerStorefront(r: Router) {
  const S = ['Storefront'];
  const loc = async (ctx: any, id?: string) => id ?? (await ctx.db.query(`SELECT id FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC LIMIT 1`)).rows[0]?.id;

  r.get('/storefront/settings', { tags: S, summary: 'Shop, locations, categories, terms, payment and theme settings in one storefront language. X-Theme-Preview renders a previewed theme', querystring: Type.Object({ locale: Type.Optional(Type.String()) }) }, async (ctx, req, reply) => {
    const token = req.headers['x-theme-preview'];
    const preview = typeof token === 'string' && token ? themes.verifyPreviewToken(r.deps.config.sessionSecret, token, ctx.now) : null;
    if (typeof token === 'string' && token && (!preview || preview.tenantId !== ctx.tenantId)) throw new AppError('preview_invalid', 403, serverT('themes.preview_invalid'));
    reply.header('Cache-Control', preview ? 'private, no-store' : 'public, max-age=30, stale-while-revalidate=300');
    if (preview) reply.header('Vary', 'X-Theme-Preview');
    return { ...(await storefront.storefrontSettings(ctx, { previewThemeId: preview?.themeId ?? null, locale: req.query.locale })), features: { document_pdfs: r.deps.config.pdfRenderer === 'playwright' } };
  });
  r.get('/storefront/catalog/categories', { tags: S, summary: 'Categories' }, async (ctx) => (await storefront.storefrontSettings(ctx)).categories);
  r.get(
    '/storefront/catalog/products',
    { tags: S, summary: 'Public products; pass from/to for live availability', querystring: Type.Object({ category: Type.Optional(Type.String()), q: Type.Optional(Type.String()), from: Type.Optional(Type.String()), to: Type.Optional(Type.String()), location_id: Type.Optional(Id), locale: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), cursor: Type.Optional(Type.String()), sort: Type.Optional(Type.Union([Type.Literal('relevance'), Type.Literal('name'), Type.Literal('newest')])), available: Type.Optional(Type.Boolean()) }) },
    async (ctx, req, reply) => {
      if (!req.query.from) reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
      return storefront.catalogProducts(ctx, req.query);
    },
  );
  r.get(
    '/storefront/catalog/products/:slug',
    { tags: S, summary: 'One public product', params: Type.Object({ slug: Type.String() }), querystring: Type.Object({ from: Type.Optional(Type.String()), to: Type.Optional(Type.String()), location_id: Type.Optional(Id), locale: Type.Optional(Type.String()) }) },
    async (ctx, req) => storefront.catalogProduct(ctx, req.params.slug, req.query),
  );
  r.get(
    '/storefront/availability',
    { tags: S, summary: 'Availability for a range, or a month calendar with per-day status', querystring: Type.Object({ variant_id: Id, location_id: Type.Optional(Id), from: Type.Optional(Type.String()), to: Type.Optional(Type.String()), month: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}$' })) }) },
    async (ctx, req) => {
      const v = await ctx.db.query(`SELECT p.visibility FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [req.query.variant_id]);
      if (v.rows[0]?.visibility !== 'public') throw new AppError('not_found', 404, serverT('error.product_not_found'));
      const locationId = await loc(ctx, req.query.location_id);
      if (req.query.month) return { object: 'list', data: await availability.calendar(ctx, { variantId: req.query.variant_id, locationId, month: req.query.month }) };
      if (!req.query.from || !req.query.to) throw invalid(serverT('error.pass_month_or_from_and_to'));
      const res = await availability.check(ctx, { variantId: req.query.variant_id, locationId, from: new Date(req.query.from), to: new Date(req.query.to) });
      const problems = await availability.assertBookable(ctx, { variantId: req.query.variant_id, locationId, startsAt: new Date(req.query.from), endsAt: new Date(req.query.to), strict: true });
      return { variant_id: res.variant_id, available: res.available, bookable: problems.length === 0 && (res.available === null || res.available > 0), problems };
    },
  );
  r.post(
    '/storefront/price_quote',
    {
      tags: S,
      summary: 'Price breakdown for a cart',
      body: Type.Object({ location_id: Type.Optional(Id), starts_at: Type.String(), ends_at: Type.String(), lines: Type.Array(CartLine, { minItems: 1, maxItems: 50 }), coupon_codes: Type.Optional(Type.Array(Type.String())), locale: Type.Optional(Type.String()), options: Type.Optional(QuoteOptions) }),
      rateLimit: { max: 60, timeWindow: '1 minute' },
      status: 200,
    },
    async (ctx, req) => orders.breakdownToApi((await orders.priceQuote(ctx, { ...req.body, lines: req.body.lines.filter((l: any) => l.quantity > 0) })).breakdown),
  );
  const SessionPatch = Type.Object({
    location_id: Type.Optional(Id),
    starts_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    ends_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    lines: Type.Optional(Type.Array(CartLine, { maxItems: 50 })),
    coupon_codes: Type.Optional(Type.Array(Type.String())),
    customer: Type.Optional(Type.Object({ name: Type.Optional(Type.String()), email: Type.Optional(Type.String()), phone: Type.Optional(Type.String()) })),
    options: Type.Optional(QuoteOptions),
  });
  r.post('/storefront/checkout_sessions', { tags: S, summary: 'Start a cart (server-created, expires after 3 h idle)', body: SessionPatch }, async (ctx, req) => storefront.createCheckoutSession(ctx, req.body as any));
  r.get('/storefront/checkout_sessions/:id', { tags: S, summary: 'Cart with live quote and availability; ?locale= names lines in a storefront language', params: IdParams, querystring: Type.Object({ locale: Type.Optional(Type.String()) }) }, async (ctx, req) =>
    storefront.getCheckoutSession(ctx, req.params.id, req.query.locale),
  );
  const ReminderToken = Type.Object({ token: Type.String({ minLength: 20, maxLength: 1000 }) });
  r.post('/storefront/checkout_sessions/restore', { tags: S, summary: 'A new cart with the items of the cart a reminder email named (FR-SF-9)', body: ReminderToken, rateLimit: { max: 20, timeWindow: '1 minute' } }, async (ctx, req) =>
    storefront.restoreCart(ctx, req.body.token),
  );
  r.post('/storefront/cart_reminders/opt_out', { tags: S, summary: 'No more cart reminders to the email a reminder went to', body: ReminderToken, rateLimit: { max: 20, timeWindow: '1 minute' }, status: 200 }, async (ctx, req) =>
    storefront.stopCartReminders(ctx, req.body.token),
  );
  r.patch('/storefront/checkout_sessions/:id', { tags: S, summary: 'Change dates, lines, coupons or contact details', params: IdParams, body: SessionPatch }, async (ctx, req) => storefront.updateCheckoutSession(ctx, req.params.id, req.body as any));
  r.post(
    '/storefront/checkout_sessions/:id/actions/complete',
    {
      tags: S,
      summary: 'Place the order. Returns a payment client secret when online payment is enabled, or with return_url a payment page to send the customer to.',
      params: IdParams,
      body: Type.Object({
        customer: Type.Object({
          name: Type.String({ minLength: 1 }),
          email: Type.String({ format: 'email' }),
          phone: Type.Optional(Type.String()),
          locale: Type.Optional(Type.String()),
          marketing_consent: Type.Optional(Type.Boolean()),
          sms_opt_in: Type.Optional(Type.Boolean()),
          whatsapp_opt_in: Type.Optional(Type.Boolean()),
          company_name: Type.Optional(Type.String({ maxLength: 200 })),
          tax_id: Type.Optional(Type.String({ maxLength: 40 })),
          billing_address: Type.Optional(Address),
        }),
        terms_accepted: Type.Boolean(),
        terms_hash: Type.String(),
        notes: Type.Optional(Type.String({ maxLength: 2000 })),
        extra: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Plugin checkout fields by "<plugin id>.<key>"; b2b.pay_on_account and b2b.po_number for customers on account (signed in)' })),
        return_url: Type.Optional(Type.String({ maxLength: 2000, description: 'Widget checkout: the embedding page to return to after paying (its origin must be in settings.widget_origins)' })),
      }),
      rateLimit: { max: 20, timeWindow: '1 minute' },
      status: 200,
    },
    async (ctx, req) => {
      // Booking on account needs the customer signed in (X-Customer-Session from the storefront server).
      const token = req.headers['x-customer-session'];
      const email = token ? await accounts.resolveSession(ctx, String(token)).then((s) => s.email, () => null) : null;
      return storefront.completeCheckout(ctx, req.params.id, req.body as any, email);
    },
  );
  r.get('/storefront/orders/:id', { tags: S, summary: 'Order confirmation by id or token (?token= required)', params: IdParams, querystring: Type.Object({ token: Type.String({ minLength: 16 }) }), rateLimit: { max: 120, timeWindow: '1 minute' } }, async (ctx, req) =>
    storefront.publicOrder(ctx, req.params.id, req.query.token),
  );
  r.post('/storefront/orders/:id/payment_intents', { tags: S, summary: 'New payment attempt for an unpaid storefront order', params: IdParams, body: Type.Object({ token: Type.String({ minLength: 16 }) }), status: 200 }, async (ctx, req) => {
    const o = await storefront.publicOrder(ctx, req.params.id, req.body.token);
    const { payments } = await import('@openrent/core');
    const due = await payments.amountDue(ctx, o.id);
    if (!o.payable || due.amount <= 0) throw new AppError('not_payable', 409, serverT('payments.not_payable'));
    return payments.createPaymentIntent(ctx, o.id, { purpose: 'rental', amount: due.amount, paymentRequestId: due.request_id });
  });
  r.post(
    '/storefront/orders/:id/payments/sync',
    { tags: S, summary: 'Refresh payment state from the provider after the customer returns from the payment page', params: IdParams, body: Type.Object({ token: Type.String({ minLength: 16 }) }), rateLimit: { max: 30, timeWindow: '1 minute' }, status: 200 },
    async (ctx, req) => {
      const o = await storefront.publicOrder(ctx, req.params.id, req.body.token);
      const { payments } = await import('@openrent/core');
      await payments.syncOrderPayments(ctx, o.id, { onRentalPaid: (orderId) => storefront.confirmPaidOrder(ctx, orderId) });
      return storefront.publicOrder(ctx, o.id, req.body.token);
    },
  );

  registerAccount(r, S);
}

/** Streams a customer-facing document as PDF (rendered once and stored, like the staff route). */
function sendFile(reply: FastifyReply, f: { file: { content_type: string; filename: string }; body: Buffer }) {
  return reply.type(f.file.content_type).header('Cache-Control', 'private, max-age=300').header('Content-Disposition', `attachment; filename="${encodeURIComponent(f.file.filename)}"`).send(f.body);
}

async function sendPdf(r: Router, ctx: any, doc: any, reply: FastifyReply) {
  if (r.deps.config.pdfRenderer !== 'playwright') throw new AppError('pdf_renderer_disabled', 501, serverT('pdf.disabled'));
  const { documentPdf } = await import('../pdf.ts');
  const pdf = await documentPdf(ctx, doc);
  return reply.type('application/pdf').header('Cache-Control', 'private, max-age=3600').header('Content-Disposition', `attachment; filename="${pdf.filename}"`).send(pdf.body);
}

/**
 * Customer accounts (email-link sign-in). The storefront server keeps the session in an httpOnly
 * cookie and forwards it as X-Customer-Session; browsers never call these routes directly.
 */
function registerAccount(r: Router, S: string[]) {
  const A = [...S, 'Accounts'];
  const session = (req: any) => String(req.headers['x-customer-session'] ?? '');
  const signedIn = async (ctx: any, req: any) => (await accounts.resolveSession(ctx, session(req))).email;
  const OrderParams = Type.Object({ id: Id });
  const Reason = Type.Object({ reason: Type.Optional(Type.String({ maxLength: 1000 })) });

  r.post(
    '/storefront/account/login',
    {
      tags: A,
      summary: 'Email a one-time sign-in link to a customer who has bookings. The answer is the same either way.',
      body: Type.Object({ email: Type.String({ maxLength: 320 }) }),
      rateLimit: { max: 5, timeWindow: '15 minutes', hook: 'preHandler', keyGenerator: (req: any) => `account-login:${String(req.body?.email ?? '').trim().toLowerCase()}` },
      status: 202,
    },
    async (ctx, req) => accounts.requestLogin(ctx, req.body.email),
  );
  r.post('/storefront/account/verify', { tags: A, summary: 'Exchange a sign-in link token for a session token', body: Type.Object({ token: Type.String({ minLength: 16, maxLength: 200 }) }), rateLimit: { max: 10, timeWindow: '1 minute' }, status: 200 }, async (ctx, req) =>
    accounts.verifyLogin(ctx, req.body.token),
  );
  r.post('/storefront/account/logout', { tags: A, summary: 'End the session', status: 200 }, async (ctx, req) => accounts.logout(ctx, session(req)));
  r.get('/storefront/account', { tags: A, summary: 'Profile, bookings, cancellation requests and documents' }, async (ctx, req) => accounts.overview(ctx, await signedIn(ctx, req)));
  r.get('/storefront/account/b2b', { tags: A, summary: 'Whether the signed-in customer can book on account, with their terms and credit left (FR-CUS-7)' }, async (ctx, req) => {
    const token = session(req);
    const email = token ? await accounts.resolveSession(ctx, token).then((s) => s.email, () => null) : null;
    const terms = email ? await customers.accountTermsFor(ctx, email) : null;
    return terms ? { object: 'b2b', on_account: true, po_required: terms.po_required, payment_terms_days: terms.payment_terms_days, available_credit: terms.available_credit } : { object: 'b2b', on_account: false };
  });
  r.patch(
    '/storefront/account',
    {
      tags: A,
      summary: 'Update name, phone, language, marketing consent and text message updates',
      body: Type.Object({
        name: Type.Optional(Type.String({ maxLength: 200 })),
        phone: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
        locale: Type.Optional(Type.Union([Type.String({ maxLength: 10 }), Type.Null()])),
        marketing_consent: Type.Optional(Type.Boolean()),
        sms_opt_in: Type.Optional(Type.Boolean()),
        whatsapp_opt_in: Type.Optional(Type.Boolean()),
      }),
    },
    async (ctx, req) => accounts.updateProfile(ctx, await signedIn(ctx, req), req.body),
  );
  r.post('/storefront/account/orders/:id/cancellation_request', { tags: A, summary: 'Ask the shop to cancel a booking', params: OrderParams, body: Reason, rateLimit: { max: 10, timeWindow: '1 minute' } }, async (ctx, req) =>
    accounts.requestCancellation(ctx, await signedIn(ctx, req), req.params.id, req.body?.reason),
  );
  r.delete('/storefront/account/orders/:id/cancellation_request', { tags: A, summary: 'Withdraw a pending cancellation request', params: OrderParams, status: 200 }, async (ctx, req) =>
    accounts.withdrawCancellation(ctx, await signedIn(ctx, req), req.params.id),
  );
  const ExtensionBody = Type.Object({ ends_at: Type.String({ format: 'date-time' }), reason: Type.Optional(Type.String({ maxLength: 1000 })) });
  r.post('/storefront/account/orders/:id/extension_request', { tags: A, summary: 'Ask the shop to keep a booking longer', params: OrderParams, body: ExtensionBody, rateLimit: { max: 10, timeWindow: '1 minute' } }, async (ctx, req) =>
    accounts.requestExtension(ctx, await signedIn(ctx, req), req.params.id, req.body),
  );
  r.delete('/storefront/account/orders/:id/extension_request', { tags: A, summary: 'Withdraw a pending extension request', params: OrderParams, status: 200 }, async (ctx, req) =>
    accounts.withdrawExtension(ctx, await signedIn(ctx, req), req.params.id),
  );
  r.get('/storefront/account/attachments/:id/file', { tags: A, summary: 'Download a file the shop shared on one of your bookings', params: IdParams, raw: true }, async (ctx, req, reply) =>
    sendFile(reply, await accounts.attachmentForEmail(ctx, await signedIn(ctx, req), req.params.id)),
  );
  r.get('/storefront/account/documents/:id/pdf', { tags: A, summary: 'Download a document of one of your bookings', params: IdParams, raw: true }, async (ctx, req, reply) =>
    sendPdf(r, ctx, await accounts.documentForEmail(ctx, await signedIn(ctx, req), req.params.id), reply),
  );

  // The same for whoever holds the private order link from the confirmation email.
  const TokenBody = Type.Object({ token: Type.String({ minLength: 16 }), reason: Type.Optional(Type.String({ maxLength: 1000 })) });
  r.post('/storefront/orders/:id/cancellation_request', { tags: S, summary: 'Ask the shop to cancel (order link holder)', params: IdParams, body: TokenBody, rateLimit: { max: 10, timeWindow: '1 minute' } }, async (ctx, req) =>
    accounts.requestCancellationByToken(ctx, req.params.id, req.body.token, req.body.reason),
  );
  r.delete('/storefront/orders/:id/cancellation_request', { tags: S, summary: 'Withdraw a pending cancellation request (order link holder)', params: IdParams, querystring: Type.Object({ token: Type.String({ minLength: 16 }) }), status: 200 }, async (ctx, req) =>
    accounts.withdrawCancellationByToken(ctx, req.params.id, req.query.token),
  );
  r.post(
    '/storefront/orders/:id/extension_request',
    { tags: S, summary: 'Ask the shop to keep a booking longer (order link holder)', params: IdParams, body: Type.Object({ token: Type.String({ minLength: 16 }), ends_at: Type.String({ format: 'date-time' }), reason: Type.Optional(Type.String({ maxLength: 1000 })) }), rateLimit: { max: 10, timeWindow: '1 minute' } },
    async (ctx, req) => accounts.requestExtensionByToken(ctx, req.params.id, req.body.token, req.body),
  );
  r.delete('/storefront/orders/:id/extension_request', { tags: S, summary: 'Withdraw a pending extension request (order link holder)', params: IdParams, querystring: Type.Object({ token: Type.String({ minLength: 16 }) }), status: 200 }, async (ctx, req) =>
    accounts.withdrawExtensionByToken(ctx, req.params.id, req.query.token),
  );
  r.get(
    '/storefront/orders/:id/damage_photos/:file',
    { tags: S, summary: 'A photo of a damage charge on this booking (order link holder)', params: Type.Object({ id: Type.String(), file: Id }), querystring: Type.Object({ token: Type.String({ minLength: 16 }) }), raw: true },
    async (ctx, req, reply) => {
      const { file, body } = await imageBytes(ctx, await storefront.damagePhotoForToken(ctx, req.params.id, req.query.token, req.params.file), 'lg');
      return reply.type(file.content_type).header('Cache-Control', 'private, max-age=3600').send(body);
    },
  );
  r.get(
    '/storefront/orders/:id/attachments/:attachment/file',
    { tags: S, summary: 'Download a file the shop shared on this booking (order link holder)', params: Type.Object({ id: Type.String(), attachment: Id }), querystring: Type.Object({ token: Type.String({ minLength: 16 }) }), raw: true },
    async (ctx, req, reply) => sendFile(reply, await accounts.attachmentForToken(ctx, req.params.id, req.query.token, req.params.attachment)),
  );
  r.get(
    '/storefront/orders/:id/documents/:doc/pdf',
    { tags: S, summary: 'Download a document of this booking (order link holder)', params: Type.Object({ id: Type.String(), doc: Id }), querystring: Type.Object({ token: Type.String({ minLength: 16 }) }), raw: true },
    async (ctx, req, reply) => sendPdf(r, ctx, await accounts.documentForToken(ctx, req.params.id, req.query.token, req.params.doc), reply),
  );
}
