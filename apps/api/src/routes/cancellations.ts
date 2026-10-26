import { accounts, customers } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Type } from '../schemas.ts';

/** Staff side of customer cancellation requests, and customers' storefront sessions. */
export function registerCancellations(r: Router) {
  const T = ['Cancellation requests'];
  r.get(
    '/cancellation_requests',
    {
      permission: 'orders:read',
      tags: T,
      summary: 'Cancellation requests, newest first',
      querystring: Type.Object({
        status: Type.Optional(
          Type.Union([
            Type.Literal('pending'),
            Type.Literal('approved'),
            Type.Literal('declined'),
            Type.Literal('withdrawn'),
          ]),
        ),
      }),
    },
    async (ctx, req) => ({ object: 'list', data: await accounts.listCancellationRequests(ctx, req.query) }),
  );
  r.get(
    '/orders/:id/cancellation_request',
    {
      permission: 'orders:read',
      tags: T,
      summary: "The order's latest cancellation request, or null",
      params: IdParams,
    },
    async (ctx, req) => ({
      object: 'cancellation_request_lookup',
      request: await accounts.cancellationRequestFor(ctx, req.params.id),
    }),
  );
  r.post(
    '/cancellation_requests/:id/actions/approve',
    {
      permission: 'orders:write',
      tags: T,
      summary: 'Approve: cancels the order, refunds by the given or tiered percentage and tells the customer',
      params: IdParams,
      body: Type.Object({
        refund_pct: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
        note: Type.Optional(Type.String({ maxLength: 1000 })),
      }),
      status: 200,
    },
    async (ctx, req) =>
      accounts.decideCancellation(ctx, req.params.id, {
        approve: true,
        refund_pct: req.body?.refund_pct,
        note: req.body?.note,
      }),
  );
  r.post(
    '/cancellation_requests/:id/actions/decline',
    {
      permission: 'orders:write',
      tags: T,
      summary: 'Decline: the booking stays and the customer gets the note',
      params: IdParams,
      body: Type.Object({ note: Type.Optional(Type.String({ maxLength: 1000 })) }),
      status: 200,
    },
    async (ctx, req) =>
      accounts.decideCancellation(ctx, req.params.id, { approve: false, note: req.body?.note }),
  );

  const X = ['Extension requests'];
  r.get(
    '/extension_requests',
    { permission: 'orders:read', tags: X, summary: 'Customer requests to keep a booking longer, newest first', querystring: Type.Object({ status: Type.Optional(Type.Union(['pending', 'approved', 'declined', 'withdrawn'].map((s) => Type.Literal(s)))) }) },
    async (ctx, req) => ({ object: 'list', data: await accounts.listExtensionRequests(ctx, req.query) }),
  );
  r.get('/orders/:id/extension_request', { permission: 'orders:read', tags: X, summary: "The order's latest extension request, or null", params: IdParams }, async (ctx, req) => ({
    object: 'extension_request_lookup',
    request: await accounts.extensionRequestFor(ctx, req.params.id),
  }));
  r.post(
    '/extension_requests/:id/actions/approve',
    {
      permission: 'orders:write',
      tags: X,
      summary: 'Approve: extends the order to the requested (or given) time, adds the price difference and tells the customer; 409 if the stock is taken',
      params: IdParams,
      body: Type.Object({ ends_at: Type.Optional(Type.String({ format: 'date-time' })), note: Type.Optional(Type.String({ maxLength: 1000 })) }),
      status: 200,
    },
    async (ctx, req) => accounts.decideExtension(ctx, req.params.id, { approve: true, ends_at: req.body?.ends_at, note: req.body?.note }),
  );
  r.post(
    '/extension_requests/:id/actions/decline',
    { permission: 'orders:write', tags: X, summary: 'Decline: the booking keeps its return and the customer gets the note', params: IdParams, body: Type.Object({ note: Type.Optional(Type.String({ maxLength: 1000 })) }), status: 200 },
    async (ctx, req) => accounts.decideExtension(ctx, req.params.id, { approve: false, note: req.body?.note }),
  );

  const C = ['Customers'];
  r.get(
    '/customers/:id/sessions',
    {
      permission: 'customers:read',
      tags: C,
      summary: "The customer's signed-in storefront sessions",
      params: IdParams,
    },
    async (ctx, req) => {
      const c = await customers.getCustomerRow(ctx, req.params.id);
      return { object: 'list', data: await accounts.listSessions(ctx, c.email) };
    },
  );
  r.delete(
    '/customers/:id/sessions',
    {
      permission: 'customers:write',
      tags: C,
      summary: 'Sign the customer out of the storefront everywhere',
      params: Type.Object({ id: Id }),
      status: 200,
    },
    async (ctx, req) => {
      const c = await customers.getCustomerRow(ctx, req.params.id);
      return accounts.revokeSessions(ctx, c.id, c.email);
    },
  );
}
