import { documents, notifications, payments, plugins, tenancy, AppError, serverT } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Locale, Money, Nullable, Type, ok } from '../schemas.ts';

export function registerDocuments(r: Router) {
  const D = ['Documents'];
  r.get('/documents', { permission: 'documents:read', tags: D, summary: 'List documents', querystring: Type.Object({ order_id: Type.Optional(Id), type: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }) }, async (ctx, req) => ({
    object: 'list',
    data: await documents.listDocuments(ctx, req.query),
  }));
  r.get('/documents/:id', { permission: 'documents:read', tags: D, summary: 'Get a document with its frozen data', params: IdParams }, async (ctx, req) => {
    const d = await documents.getDocument(ctx, req.params.id);
    return { ...documents.documentToApi(d), data: d.data };
  });
  r.get('/documents/:id/html', { permission: 'documents:read', tags: D, summary: 'Rendered HTML (print to PDF from the browser)', params: IdParams, raw: true }, async (ctx, req, reply) => {
    const d = await documents.getDocument(ctx, req.params.id);
    return reply.type('text/html; charset=utf-8').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:").send(d.html);
  });
  r.get('/documents/:id/pdf', { permission: 'documents:read', tags: D, summary: 'PDF, rendered once with headless Chromium and stored', params: IdParams, querystring: Type.Object({ download: Type.Optional(Type.Boolean()) }), raw: true }, async (ctx, req, reply) => {
    const d = await documents.getDocument(ctx, req.params.id);
    if (r.deps.config.pdfRenderer !== 'playwright') throw new AppError('pdf_renderer_disabled', 501, serverT('pdf.disabled'));
    const { documentPdf } = await import('../pdf.ts');
    const pdf = await documentPdf(ctx, d);
    return reply
      .type('application/pdf')
      .header('Cache-Control', 'private, max-age=3600')
      .header('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pdf.filename}"`)
      .send(pdf.body);
  });
  r.get('/einvoice_formats', { permission: 'documents:read', tags: D, summary: 'E-invoice formats the shop can send (plugins that are on and set up)', querystring: Type.Object({ locale: Type.Optional(Type.String()) }) }, async (ctx, req) => ({
    object: 'list',
    data: await documents.einvoiceFormats(ctx, req.query.locale ?? null),
  }));
  r.get('/documents/:id/einvoice', { permission: 'documents:read', tags: D, summary: 'The e-invoice of an invoice or credit note, in the format the customer’s billing details ask for (FR-DOC-6)', params: IdParams, raw: true }, async (ctx, req, reply) => {
    const f = await documents.einvoiceFile(ctx, req.params.id);
    return reply.type(f.contentType).header('Cache-Control', 'private, max-age=3600').header('Content-Disposition', `attachment; filename="${f.filename.replace(/[^\w.-]+/g, '-')}"`).send(f.content);
  });
  r.post('/documents/:id/actions/void', { permission: 'documents:write', tags: D, summary: 'Void; invoices get a credit note', params: IdParams, body: Type.Object({ reason: Type.Optional(Type.String()) }), status: 200 }, async (ctx, req) =>
    documents.voidDocument(ctx, req.params.id, req.body?.reason),
  );
  // Customer invoices without a booking (ADR 0014), e.g. a membership fee: issued, paid and owed on their own.
  const InvoiceBalance = Type.Object({ id: Type.String(), object: Type.Literal('invoice_balance'), number: Nullable(Type.String()), status: Type.String(), total: Money, paid: Money, due: Money, einvoice_format: Nullable(Type.String()) }, { additionalProperties: false });
  r.get('/customers/:id/invoices', { permission: 'documents:read', tags: D, summary: 'The customer’s own invoices that belong to no booking, with what is owed on each', params: IdParams, querystring: Type.Object({ open: Type.Optional(Type.Boolean()) }) }, async (ctx, req) => ({
    object: 'list',
    data: await payments.listCustomerInvoices(ctx, req.params.id, { open: req.query.open }),
  }));
  r.post(
    '/customers/:id/invoices',
    {
      permission: 'documents:write', tags: D, summary: 'Invoice the customer for something that is no booking; with `key`, the same invoice comes back instead of a second one', params: IdParams, status: 201,
      body: Type.Object(
        {
          lines: Type.Array(Type.Object({ description: Type.String({ minLength: 1, maxLength: 500 }), amount: Type.Integer({ minimum: 0 }), quantity: Type.Optional(Type.Integer({ minimum: 1 })), tax_rate_bp: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })) }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
          key: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          period: Type.Optional(Nullable(Type.Object({ from: Type.String({ format: 'date-time' }), to: Type.String({ format: 'date-time' }) }))),
          request_payment: Type.Optional(Type.Boolean({ description: 'Also email the customer the invoice with a link to pay it online' })),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => {
      const doc = await documents.issueCustomerInvoice(ctx, req.params.id, req.body);
      if (req.body.request_payment) await payments.requestInvoicePayment(ctx, doc.id);
      return doc;
    },
  );
  r.get('/documents/:id/balance', { permission: 'documents:read', tags: D, summary: 'What is owed on a customer invoice', params: IdParams, response: ok(InvoiceBalance) }, async (ctx, req) => payments.invoiceDue(ctx, req.params.id));
  r.post(
    '/documents/:id/payments',
    { permission: 'payments:write', tags: D, summary: 'Record cash, a bank transfer or a card terminal payment of a customer invoice', params: IdParams, status: 201, body: Type.Object({ amount: Type.Integer({ minimum: 1 }), method: Type.String({ minLength: 1, maxLength: 40 }), note: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false }) },
    async (ctx, req) => payments.recordInvoicePayment(ctx, req.params.id, req.body),
  );
  r.post(
    '/documents/:id/actions/request_payment',
    { permission: 'payments:write', tags: D, summary: 'Email the customer a link to pay the invoice online', params: IdParams, status: 200, body: Type.Object({ notify: Type.Optional(Type.Boolean()) }, { additionalProperties: false }) },
    async (ctx, req) => payments.requestInvoicePayment(ctx, req.params.id, { notify: req.body?.notify }),
  );
  r.post(
    '/documents/:id/actions/charge_card',
    { permission: 'payments:write', tags: D, summary: 'Charge the card the customer saved with an earlier payment', params: IdParams, status: 200 },
    async (ctx, req) => {
      const r = await payments.chargeInvoiceCard(ctx, req.params.id, `charge:${req.params.id}:${ctx.idempotencyKey ?? Date.now()}`);
      if (!r) throw new AppError('no_saved_card', 409, serverT('payments.no_saved_card'));
      if ('failed' in r) throw new AppError('card_declined', 409, serverT('payments.card_declined', { reason: r.failed }));
      return r.payment;
    },
  );
  r.post('/documents/:id/actions/send', { permission: 'documents:write', tags: D, summary: 'Email the document link to the customer', params: IdParams, status: 202 }, async (ctx, req) => {
    const d = await documents.getDocument(ctx, req.params.id);
    if (!d.order_id) throw new AppError('no_order', 422, serverT('error.only_order_documents_can_be_sent'));
    const tpl = d.type === 'quote' ? 'quote_sent' : 'order_confirmed';
    // An invoice for customers who asked for e-invoices goes with its e-invoice file too (FR-DOC-6).
    const attachments = d.data?.einvoice?.format && ['invoice', 'credit_note'].includes(d.type) ? [d.id, `einvoice:${d.id}`] : [d.id];
    await notifications.notifyCustomer(ctx, d.order_id, tpl, {}, undefined, { attachments });
    await documents.markSent(ctx, d.id);
    return { object: 'document', id: d.id, status: 'sent' };
  });

  r.get(
    '/document_templates',
    { permission: 'documents:read', tags: D, summary: 'Templates: with ?locale= one per type (the shop’s own or the built-in), else all', querystring: Type.Object({ locale: Type.Optional(Type.String()) }) },
    async (ctx, req) => ({ object: 'list', data: await documents.listTemplates(ctx, req.query.locale) }),
  );
  r.get('/document_templates/variables', { permission: 'documents:read', tags: D, summary: 'Data and helpers a template can use' }, async () => documents.TEMPLATE_VARIABLES);
  r.get('/document_templates/:id', { permission: 'documents:read', tags: D, summary: 'One template (builtin:<type> is the built-in one)', params: IdParams }, async (ctx, req) => documents.getTemplate(ctx, req.params.id));
  r.patch(
    '/document_templates/:id',
    { permission: 'documents:write', tags: D, summary: 'Change a template; changing a built-in one creates the shop’s own', params: IdParams, body: Type.Object({ name: Type.Optional(Type.String()), locale: Type.Optional(Type.String()), body: Type.Optional(Type.String({ minLength: 1 })), css: Type.Optional(Type.String()) }) },
    async (ctx, req) => documents.updateTemplate(ctx, req.params.id, req.body),
  );
  r.post(
    '/document_templates/:id/preview',
    { permission: 'documents:read', tags: D, summary: 'Render a stored template against a real order', params: IdParams, body: Type.Object({ order_id: Type.Optional(Id), locale: Type.Optional(Type.String()) }), raw: true },
    async (ctx, req, reply) => {
      const tpl = await documents.getTemplate(ctx, req.params.id);
      const html = await documents.previewTemplate(ctx, { type: tpl.type, body: tpl.body, css: tpl.css, order_id: req.body.order_id, locale: req.body.locale ?? tpl.locale });
      return reply.type('text/html; charset=utf-8').send(html);
    },
  );
  r.delete('/document_templates/:id', { permission: 'documents:write', tags: D, summary: 'Go back to the built-in template (issued documents keep their HTML)', params: IdParams }, async (ctx, req) => documents.resetTemplate(ctx, req.params.id));
  r.post(
    '/document_templates',
    { permission: 'documents:write', tags: D, summary: 'Create or replace the template for a type and locale', body: Type.Object({ type: Type.String(), name: Type.Optional(Type.String()), locale: Type.Optional(Type.String()), body: Type.String({ minLength: 1 }), css: Type.Optional(Type.String()) }) },
    async (ctx, req) => documents.upsertTemplate(ctx, req.body as any),
  );
  r.post(
    '/document_templates/preview',
    { permission: 'documents:read', tags: D, summary: 'Render a template against a real order without issuing', body: Type.Object({ type: Type.String(), body: Type.Optional(Type.String()), css: Type.Optional(Type.String()), order_id: Type.Optional(Id), locale: Type.Optional(Type.String()) }), raw: true },
    async (ctx, req, reply) => reply.type('text/html; charset=utf-8').send(await documents.previewTemplate(ctx, req.body as any)),
  );

  const N = ['Notifications'];
  r.get('/notifications', { permission: 'orders:read', tags: N, summary: 'Outgoing message log', querystring: Type.Object({ order_id: Type.Optional(Id), status: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }) }, async (ctx, req) => ({
    object: 'list',
    data: await notifications.listNotifications(ctx, req.query),
  }));
  r.get('/notifications/stats', { permission: 'orders:read', tags: N, summary: 'Delivery counts for the last 30 days, last success and last error' }, async (ctx) => notifications.notificationStats(ctx));
  r.get('/notifications/:id', { permission: 'orders:read', tags: N, summary: 'One message with its HTML body, attempts and last error', params: IdParams }, async (ctx, req) => notifications.getNotification(ctx, req.params.id));
  r.post('/notifications/:id/actions/retry', { permission: 'documents:write', tags: N, summary: 'Send a waiting or failed message at the next worker run', params: IdParams, status: 200 }, async (ctx, req) =>
    notifications.retryNotification(ctx, req.params.id),
  );
  r.post('/notifications/:id/actions/cancel', { permission: 'documents:write', tags: N, summary: 'Stop a message that has not been sent', params: IdParams, status: 200 }, async (ctx, req) =>
    notifications.cancelNotification(ctx, req.params.id),
  );
  r.post('/notifications/:id/actions/resend', { permission: 'documents:write', tags: N, summary: 'Queue a fresh copy of a message', params: IdParams, status: 201 }, async (ctx, req) =>
    notifications.resendNotification(ctx, req.params.id),
  );
  r.post(
    '/notifications/actions/retry_all',
    { permission: 'documents:write', tags: N, summary: 'Send all waiting messages now, or requeue all failed ones', body: Type.Object({ status: Type.Union([Type.Literal('queued'), Type.Literal('failed')]) }), status: 200 },
    async (ctx, req) => notifications.retryAllNotifications(ctx, req.body.status),
  );
  r.post(
    '/notifications/actions/test_email',
    { permission: 'plugins:manage', tags: N, summary: 'Send a test email right away with the current email settings and report the server response', body: Type.Object({ to: Type.String({ format: 'email' }) }), status: 200 },
    async (ctx, req) => {
      const picked = await plugins.emailChannel(ctx);
      if (!picked) throw new AppError('no_email_channel', 409, serverT('email.no_channel'));
      const { channel, enabled, config } = picked;
      const pctx = { tenantId: ctx.tenantId, config, logger: ctx.logger };
      if (!enabled || !channel.isConfigured(pctx)) throw new AppError('email_not_configured', 409, serverT('email.error.not_configured'));
      const tenant = await tenancy.getTenant(ctx);
      try {
        const res = await channel.send(pctx, {
          to: req.body.to,
          subject: serverT('email.test_subject', { shop: tenant.name }),
          html: `<p>${serverT('email.test_body', { shop: tenant.name })}</p>`,
        });
        return { object: 'email_test', status: 'sent', to: req.body.to, provider_ref: res.ref };
      } catch (err: any) {
        throw new AppError('email_failed', 502, notifications.deliveryErrorMessage(err), { extra: { cause_code: err?.code ?? null } });
      }
    },
  );
  r.post(
    '/notifications/actions/test_text',
    {
      permission: 'plugins:manage', tags: N, summary: 'Send a test SMS or WhatsApp message right away with the chosen plugin and report the response',
      body: Type.Object({ to: Type.String({ maxLength: 40 }), channel: Type.Union([Type.Literal('sms'), Type.Literal('whatsapp')]) }), status: 200,
    },
    async (ctx, req) => {
      const to = notifications.normalizePhone(req.body.to);
      if (!to) throw new AppError('validation_error', 422, serverT('error.field.phone_e164'), { errors: [{ field: 'to', code: 'invalid', message: serverT('error.field.phone_e164') }] });
      const picked = await plugins.textChannel(ctx, req.body.channel);
      if (!picked) throw new AppError('no_text_channel', 409, serverT('notifications.no_text_channel'));
      const tenant = await tenancy.getTenant(ctx);
      try {
        const res = await picked.channel.send(
          { tenantId: ctx.tenantId, config: picked.config, logger: ctx.logger, webhookUrl: notifications.textWebhookUrl(ctx, picked.pluginId) },
          { to, subject: '', html: '', text: serverT('notifications.test_text', { shop: tenant.name }), template: 'test' },
        );
        return { object: 'text_test', status: 'sent', to, provider_ref: res.ref };
      } catch (err: any) {
        throw new AppError('text_failed', 502, notifications.deliveryErrorMessage(err), { extra: { cause_code: err?.code ?? null } });
      }
    },
  );
  r.get('/notification_templates', { permission: 'documents:read', tags: N, summary: 'Message templates in one language (?locale=, default the shop language)', querystring: Type.Object({ locale: Type.Optional(Locale) }) }, async (ctx, req) => ({
    object: 'list',
    data: await notifications.listNotificationTemplates(ctx, req.query.locale),
  }));
  r.get('/notification_templates/:id', { permission: 'documents:read', tags: N, summary: 'One message template (id = builtin:<event> or the shop’s own)', params: IdParams, querystring: Type.Object({ locale: Type.Optional(Locale) }) }, async (ctx, req) =>
    notifications.getNotificationTemplate(ctx, req.params.id, req.query.locale),
  );
  r.patch(
    '/notification_templates/:id',
    { permission: 'documents:write', tags: N, summary: 'Override a message template (id = event name, e.g. order_confirmed)', params: IdParams, body: Type.Object({ subject: Type.Optional(Type.String()), body: Type.Optional(Type.String()), locale: Type.Optional(Locale), enabled: Type.Optional(Type.Boolean()), text: Type.Optional(Nullable(Type.String({ description: 'The SMS and WhatsApp text; empty sends none, null restores the built-in one' }))) }) },
    async (ctx, req) => notifications.upsertNotificationTemplate(ctx, req.params.id.replace(/^builtin:/, ''), req.body),
  );
  r.post(
    '/notification_templates/preview',
    { permission: 'documents:read', tags: N, summary: 'Render a template draft against a real order without saving', body: Type.Object({ event: Type.String(), subject: Type.String(), body: Type.String(), order_id: Type.Optional(Id), locale: Type.Optional(Locale) }), status: 200 },
    async (ctx, req) => notifications.previewNotification(ctx, req.body),
  );
  r.post('/notification_templates/:id/test', { permission: 'documents:write', tags: N, summary: 'Send a test message to yourself', params: IdParams, body: Type.Object({ to: Type.String({ format: 'email' }), order_id: Type.Optional(Id), locale: Type.Optional(Locale) }), status: 202 }, async (ctx, req) => {
    const key = req.params.id.replace(/^builtin:/, '');
    const data = req.body.order_id ? await notifications.orderMessageData(ctx, req.body.order_id) : { order: { number: 1001 }, customer: { name: 'Test customer' }, totals: { total: 0 }, lines: [] };
    const id = await notifications.queue(ctx, { template: key, to: req.body.to, audience: 'staff', data, locale: req.body.locale });
    return { object: 'notification', id, status: 'queued' };
  });
}
