import { serverT } from '@openrent/core';
import { orders, payments, documents, notifications, AppError, ORDER_ACTIONS } from '../core-extras.ts';
import type { Router } from '../http.ts';
import { expandOf, ifMatchOf, parseList } from '../http.ts';
import { sendSheet } from '../spreadsheets.ts';
import { DepositPolicy, ExportQuery, Id, IdParams, LineInput, ListQuery, Nullable, Order, OrderInput, Page, PriceQuote, QuoteInput, QuoteOptions, Type, UnitsBody, ok } from '../schemas.ts';

const ActionParams = Type.Object({ id: Id });
const ExpandQuery = Type.Object({ expand: Type.Optional(Type.String({ description: 'customer,location,payments,payment_requests,deposits,documents,damage_charges,notifications' })) });

export function registerOrders(r: Router) {
  const O = ['Orders'];
  r.post('/price_quote', { permission: 'pricing:read', tags: ['Pricing'], summary: 'Deterministic price breakdown (FR-PR-5)', body: QuoteInput, response: ok(PriceQuote), status: 200 }, async (ctx, req) =>
    orders.breakdownToApi((await orders.priceQuote(ctx, req.body)).breakdown),
  );

  r.get('/orders', { permission: 'orders:read', tags: O, summary: 'List orders (filters: status, payment_status, customer_id, location_id, source, starts_at, ends_at)', querystring: ListQuery, response: ok(Page(Order)) }, async (ctx, req) =>
    orders.listOrders(ctx, parseList(req.query)),
  );
  r.get('/orders/export', { permission: 'orders:read', tags: O, summary: 'Download the order list as CSV or XLSX, with the list filters', querystring: ExportQuery, raw: true }, async (ctx, req, reply) =>
    sendSheet(reply, await orders.exportOrders(ctx, parseList(req.query)), 'orders', req.query.format ?? 'csv'),
  );
  r.post('/orders', { permission: 'orders:write', tags: O, summary: 'Create a draft order; response includes availability per line', body: OrderInput, response: ok(Order, 201) }, async (ctx, req, reply) => {
    const o = await orders.createOrder(ctx, req.body);
    reply.header('ETag', `W/"${o.version}"`);
    return o;
  });
  r.get('/orders/:id', { permission: 'orders:read', tags: O, summary: 'Get an order by id or number (#1042)', params: IdParams, querystring: ExpandQuery, response: ok(Order) }, async (ctx, req, reply) => {
    const o = await orders.getOrder(ctx, req.params.id, expandOf(req.query));
    reply.header('ETag', `W/"${o.version}"`);
    return o;
  });
  r.patch(
    '/orders/:id',
    {
      permission: 'orders:write',
      tags: O,
      summary: 'Update an order. Dates, location, customer, coupons and deposit only while draft or quote; notes, tags and custom fields anytime. Honours If-Match.',
      params: IdParams,
      body: Type.Object(
        {
          customer_id: Type.Optional(Nullable(Id)), location_id: Type.Optional(Id), starts_at: Type.Optional(Type.String({ format: 'date-time' })), ends_at: Type.Optional(Type.String({ format: 'date-time' })),
          coupon_codes: Type.Optional(Type.Array(Type.String())), deposit: Type.Optional(DepositPolicy), notes: Type.Optional(Type.Object({ internal: Type.Optional(Type.String()), customer: Type.Optional(Type.String()) })),
          tags: Type.Optional(Type.Array(Type.String())), custom_fields: Type.Optional(Type.Record(Type.String(), Type.Unknown())), options: Type.Optional(QuoteOptions),
          po_number: Type.Optional(Nullable(Type.String({ maxLength: 100 }))),
          billing_cycle: Type.Optional(Nullable(Type.String({ description: 'weekly or monthly, until pickup' }))),
        },
        { additionalProperties: false },
      ),
      response: ok(Order),
    },
    async (ctx, req, reply) => {
      const o = await orders.updateOrder(ctx, req.params.id, req.body, ifMatchOf(req));
      reply.header('ETag', `W/"${o.version}"`);
      return o;
    },
  );
  r.get('/orders/:id/lines', { permission: 'orders:read', tags: O, summary: 'Order lines', params: IdParams }, async (ctx, req) => ({ object: 'list', data: (await orders.getOrder(ctx, req.params.id)).lines }));
  r.post('/orders/:id/lines', { permission: 'orders:write', tags: O, summary: 'Add a line (draft or quote)', params: IdParams, body: LineInput, response: ok(Order, 201) }, async (ctx, req) => orders.addLine(ctx, req.params.id, req.body));
  r.patch(
    '/orders/:id/lines/:line_id',
    { permission: 'orders:write', tags: O, summary: 'Change a line (draft or quote)', params: Type.Object({ id: Id, line_id: Id }), body: Type.Object({ quantity: Type.Optional(Type.Integer({ minimum: 1 })), amount: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))), description: Type.Optional(Type.String()), buffer_before_min: Type.Optional(Type.Integer({ minimum: 0 })), buffer_after_min: Type.Optional(Type.Integer({ minimum: 0 })), stock_item_ids: Type.Optional(Type.Array(Id)), picks: Type.Optional(Type.Record(Type.String({ maxLength: 80 }), Id)) }) },
    async (ctx, req) => orders.updateLine(ctx, req.params.id, req.params.line_id, req.body),
  );
  r.delete('/orders/:id/lines/:line_id', { permission: 'orders:write', tags: O, summary: 'Remove a line (draft or quote)', params: Type.Object({ id: Id, line_id: Id }), status: 200 }, async (ctx, req) =>
    orders.removeLine(ctx, req.params.id, req.params.line_id),
  );
  r.get('/orders/:id/timeline', { permission: 'orders:read', tags: O, summary: 'Activity timeline', params: IdParams }, async (ctx, req) => orders.timeline(ctx, req.params.id));
  r.get('/orders/:id/pick_list', { permission: 'orders:read', tags: O, summary: 'What to pick, with assigned and missing units', params: IdParams }, async (ctx, req) => orders.pickList(ctx, req.params.id));
  r.get('/orders/:id/availability', { permission: 'orders:read', tags: O, summary: 'Availability check per line for this order', params: IdParams }, async (ctx, req) => {
    const o = await ctx.db.query(`SELECT * FROM orders WHERE id = $1`, [await orders.resolveOrderId(ctx, req.params.id)]);
    if (!o.rows[0]) throw new AppError('not_found', 404, serverT('error.order_not_found'));
    return { object: 'list', data: await orders.availabilityCheck(ctx, o.rows[0]) };
  });

  const MeterReadings = Type.Array(Type.Object({ stock_item_id: Type.Optional(Id), barcode: Type.Optional(Type.String({ maxLength: 64 })), value: Type.Number({ minimum: 0 }) }, { additionalProperties: false }), { maxItems: 200 });
  // State transitions as sub-resources (PRD §5.1.2).
  const transitionBodies: Record<string, unknown> = {
    send_quote: Type.Object({ ttl_hours: Type.Optional(Type.Number({ minimum: 0.1 })), notify: Type.Optional(Type.Boolean()) }),
    reserve: Type.Object({
      notify: Type.Optional(Type.Boolean()),
      overbook: Type.Optional(Type.Object({ reason: Type.String({ maxLength: 500, description: 'Why stock is booked past capacity (needs orders:overbook)' }) })),
      override_credit_limit: Type.Optional(Type.Boolean({ description: 'Book over the customer’s credit limit on purpose (written to the audit log)' })),
    }),
    prepare: Type.Object({}),
    // Meter readings taken at the counter (FR-CAT-10).
    check_out: Type.Object({
      stock_item_ids: Type.Optional(Type.Array(Id)), barcodes: Type.Optional(Type.Array(Type.String())), allow_partial: Type.Optional(Type.Boolean()),
      lines: Type.Optional(Type.Array(Type.Object({ line_id: Id, quantity: Type.Integer({ minimum: 0 }) }))),
      signature: Type.Optional(Type.Object({ name: Type.String({ minLength: 1 }), method: Type.Optional(Type.Union([Type.Literal('click'), Type.Literal('typed'), Type.Literal('drawn')])), file_id: Type.Optional(Id) })),
      meter_readings: Type.Optional(MeterReadings),
    }),
    check_in: Type.Object({
      meter_readings: Type.Optional(MeterReadings),
      all: Type.Optional(Type.Boolean({ description: 'Return everything that is out as ok' })),
      units: Type.Optional(Type.Array(Type.Object({ stock_item_id: Type.Optional(Id), barcode: Type.Optional(Type.String()), outcome: Type.Optional(Type.Union(['ok', 'needs_inspection', 'damaged', 'lost'].map((s) => Type.Literal(s)))) }))),
      lines: Type.Optional(Type.Array(Type.Object({ line_id: Id, returned: Type.Optional(Type.Integer({ minimum: 0 })), damaged: Type.Optional(Type.Integer({ minimum: 0 })), lost: Type.Optional(Type.Integer({ minimum: 0 })) }))),
    }),
    inspect: Type.Object({
      units: Type.Optional(Type.Array(Type.Object({ stock_item_id: Id, status: Type.Optional(Type.Union(['available', 'soft_down', 'hard_down', 'retired', 'needs_inspection'].map((s) => Type.Literal(s)))), condition: Type.Optional(Type.String()), notes: Type.Optional(Type.String()) }))),
      damage_charges: Type.Optional(Type.Array(Type.Object({ stock_item_id: Type.Optional(Nullable(Id)), description: Type.String({ minLength: 1 }), amount: Type.Integer({ minimum: 0 }) }))),
    }),
    close: Type.Object({}),
    cancel: Type.Object({ reason: Type.Optional(Type.String()), refund: Type.Optional(Type.Boolean()), refund_pct: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })), notify: Type.Optional(Type.Boolean()) }),
    reopen: Type.Object({}),
  };
  for (const action of ORDER_ACTIONS) {
    const t = orders.transitionFor(action);
    r.post(
      `/orders/:id/actions/${action}`,
      {
        permission: ['check_out', 'check_in', 'inspect', 'prepare'].includes(action) ? 'orders:fulfil' : 'orders:write',
        tags: O,
        summary: `${t.label} (from ${t.from.join(', ')})`,
        params: ActionParams,
        body: transitionBodies[action],
        response: ok(Order),
        status: 200,
      },
      async (ctx, req, reply) => {
        const o = await orders.runAction(ctx, req.params.id, action, req.body ?? {}, { ifMatch: ifMatchOf(req) });
        reply.header('ETag', `W/"${o.version}"`);
        return o;
      },
    );
  }
  r.post('/orders/:id/actions/assign_units', { permission: 'orders:fulfil', tags: O, summary: 'Assign scanned units to lines (late binding)', params: ActionParams, body: UnitsBody, response: ok(Order), status: 200 }, async (ctx, req) =>
    orders.assignUnits(ctx, req.params.id, req.body),
  );
  r.post('/orders/:id/actions/unassign_units', { permission: 'orders:fulfil', tags: O, summary: 'Release assigned units back to a quantity hold', params: ActionParams, body: UnitsBody, response: ok(Order), status: 200 }, async (ctx, req) =>
    orders.unassignUnits(ctx, req.params.id, req.body),
  );
  const EndChange = Type.Object(
    {
      ends_at: Type.String({ format: 'date-time', description: 'The new return time' }),
      dry_run: Type.Optional(Type.Boolean({ description: 'Only check availability and price the change' })),
      credit: Type.Optional(Type.Boolean({ description: 'return_early: credit the unused time (default true)' })),
      notify: Type.Optional(Type.Boolean({ description: 'extend: email the customer (default true)' })),
    },
    { additionalProperties: false },
  );
  r.post('/orders/:id/actions/extend', { permission: 'orders:write', tags: O, summary: 'Keep a confirmed or picked-up rental longer: checks availability and adds the price difference (FR-OR-9)', params: ActionParams, body: EndChange, status: 200 }, async (ctx, req) =>
    orders.extendOrder(ctx, req.params.id, req.body),
  );
  r.post('/orders/:id/actions/return_early', { permission: 'orders:write', tags: O, summary: 'Bring the return forward: frees the stock and credits the unused time (FR-OR-9)', params: ActionParams, body: EndChange, status: 200 }, async (ctx, req) =>
    orders.returnEarly(ctx, req.params.id, req.body),
  );
  r.post(
    '/orders/:id/actions/swap_unit',
    {
      permission: 'orders:fulfil',
      tags: O,
      summary: 'Replace a unit that is out with another of the same item, from now on (FR-OR-10); the old one is inspected or taken out of service with a ticket',
      params: ActionParams,
      body: Type.Object(
        {
          from_stock_item_id: Type.Optional(Id), from_barcode: Type.Optional(Type.String({ minLength: 1 })),
          to_stock_item_id: Type.Optional(Id), to_barcode: Type.Optional(Type.String({ minLength: 1 })),
          old_status: Type.Optional(Type.Union([Type.Literal('needs_inspection'), Type.Literal('soft_down'), Type.Literal('hard_down')])),
          reason: Type.Optional(Type.String({ maxLength: 500 })),
        },
        { additionalProperties: false },
      ),
      response: ok(Order),
      status: 200,
    },
    async (ctx, req) => orders.swapUnit(ctx, req.params.id, req.body),
  );
  r.post(
    '/orders/:id/actions/reassign_unit',
    {
      permission: 'orders:write', tags: O, summary: 'Move a booked unit to another unit of the same item before pickup (the planner, FR-AV-9); 409 when it is not free',
      params: ActionParams, body: Type.Object({ from_stock_item_id: Id, to_stock_item_id: Id }, { additionalProperties: false }), response: ok(Order), status: 200,
    },
    async (ctx, req) => orders.reassignUnit(ctx, req.params.id, req.body),
  );
  r.post('/orders/:id/actions/duplicate', { permission: 'orders:write', tags: O, summary: 'Copy into a new draft', params: ActionParams, response: ok(Order, 201) }, async (ctx, req) => orders.duplicateOrder(ctx, req.params.id));
  r.post(
    '/orders/:id/actions/send_notification',
    { permission: 'orders:write', tags: O, summary: 'Send a customer message from a template', params: ActionParams, body: Type.Object({ template: Type.String() }), status: 202 },
    async (ctx, req) => {
      const id = await orders.resolveOrderId(ctx, req.params.id);
      const n = await notifications.notifyCustomer(ctx, id, req.body.template);
      if (!n) throw new AppError('no_recipient', 422, serverT('error.the_customer_has_no_email_address'));
      return { object: 'notification', id: n, status: 'queued' };
    },
  );

  // Documents per order.
  const D = ['Documents'];
  r.post(
    '/orders/:id/documents',
    { permission: 'documents:write', tags: D, summary: 'Issue a document for the order', params: IdParams, body: Type.Object({ type: Type.Union(documents.DOCUMENT_TYPES.map((t: string) => Type.Literal(t))) }) },
    async (ctx, req) => documents.issueDocument(ctx, await orders.resolveOrderId(ctx, req.params.id), req.body.type),
  );

  // Payments.
  const P = ['Payments'];
  r.get('/payments', { permission: 'payments:read', tags: P, summary: 'List payments', querystring: Type.Object({ order_id: Type.Optional(Id), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }) }, async (ctx, req) => ({ object: 'list', data: await payments.listPayments(ctx, req.query) }));
  r.get('/payments/:id', { permission: 'payments:read', tags: P, summary: 'Get a payment', params: IdParams }, async (ctx, req) => payments.getPayment(ctx, req.params.id));
  r.post(
    '/orders/:id/payments',
    { permission: 'payments:write', tags: P, summary: 'Record a manual payment (cash, bank transfer, terminal)', params: IdParams, body: Type.Object({ amount: Type.Integer({ minimum: 1 }), method: Type.String({ minLength: 1 }), purpose: Type.Optional(Type.Union(['rental', 'deposit', 'damage', 'late_fee'].map((s) => Type.Literal(s)))), note: Type.Optional(Type.String()) }) },
    async (ctx, req) => payments.recordManualPayment(ctx, await orders.resolveOrderId(ctx, req.params.id), req.body),
  );
  r.post(
    '/orders/:id/payment_intents',
    { permission: 'payments:write', tags: P, summary: 'Create an online payment intent for the balance (client secret for the payment element)', params: IdParams, body: Type.Object({ amount: Type.Optional(Type.Integer({ minimum: 1 })), purpose: Type.Optional(Type.Union(['rental', 'damage', 'late_fee'].map((s) => Type.Literal(s)))) }) },
    async (ctx, req) => payments.createPaymentIntent(ctx, await orders.resolveOrderId(ctx, req.params.id), req.body ?? {}),
  );
  r.get('/orders/:id/payment_requests', { permission: 'payments:read', tags: P, summary: 'Payment requests (down payment, balance, payment links)', params: IdParams }, async (ctx, req) => ({
    object: 'list',
    data: await payments.listPaymentRequests(ctx, await orders.resolveOrderId(ctx, req.params.id)),
  }));
  r.post(
    '/orders/:id/payment_requests',
    {
      permission: 'payments:write',
      tags: P,
      summary: 'Ask the customer to pay (defaults to the balance). Replaces any open request; notify=false skips the email so you can share the order link yourself',
      params: IdParams,
      body: Type.Object({ amount: Type.Optional(Type.Integer({ minimum: 1 })), message: Type.Optional(Type.String({ maxLength: 1000 })), due_at: Type.Optional(Type.String({ format: 'date-time' })), notify: Type.Optional(Type.Boolean()) }),
    },
    async (ctx, req) => payments.createPaymentRequest(ctx, await orders.resolveOrderId(ctx, req.params.id), req.body ?? {}),
  );
  r.post(
    '/orders/:id/payment_links',
    {
      permission: 'payments:write',
      tags: P,
      summary: 'A payment link for an amount (a payment request; the provider hosts the page when it can, else the order page takes the payment)',
      params: IdParams,
      body: Type.Object({ amount: Type.Optional(Type.Integer({ minimum: 1 })), message: Type.Optional(Type.String({ maxLength: 1000 })), due_at: Type.Optional(Type.String({ format: 'date-time' })), notify: Type.Optional(Type.Boolean()) }),
    },
    async (ctx, req) => payments.createPaymentRequest(ctx, await orders.resolveOrderId(ctx, req.params.id), { ...(req.body ?? {}), kind: 'custom' }),
  );
  r.get(
    '/payment_reconciliation_issues',
    { permission: 'payments:read', tags: P, summary: 'Differences between OpenRent and the payment provider (nightly check)', querystring: Type.Object({ open: Type.Optional(Type.Boolean()) }) },
    async (ctx, req) => ({ object: 'list', data: await payments.listReconciliationIssues(ctx, req.query) }),
  );
  r.post(
    '/payment_reconciliation_issues/:id/actions/resolve',
    { permission: 'payments:write', tags: P, summary: 'Mark a difference as handled', params: IdParams, body: Type.Object({ resolution: Type.Optional(Type.String({ maxLength: 500 })) }), status: 200 },
    async (ctx, req) => payments.resolveReconciliationIssue(ctx, req.params.id, req.body ?? {}),
  );
  r.post('/orders/:id/payment_requests/:request_id/actions/cancel', { permission: 'payments:write', tags: P, summary: 'Withdraw an open payment request', params: Type.Object({ id: Id, request_id: Id }), status: 200 }, async (ctx, req) =>
    payments.cancelPaymentRequest(ctx, await orders.resolveOrderId(ctx, req.params.id), req.params.request_id),
  );
  r.post('/payments/:id/actions/refund', { permission: 'payments:refund', tags: P, summary: 'Refund all or part of a payment', params: IdParams, body: Type.Object({ amount: Type.Optional(Type.Integer({ minimum: 1 })), reason: Type.Optional(Type.String()) }), status: 200 }, async (ctx, req) =>
    payments.refundPayment(ctx, req.params.id, req.body ?? {}),
  );
  r.post('/payments/:id/actions/void', { permission: 'payments:refund', tags: P, summary: 'Cancel a payment that has not settled: a pending online payment or an authorisation not captured', params: IdParams, body: Type.Object({ reason: Type.Optional(Type.String({ maxLength: 500 })) }), status: 200 }, async (ctx, req) =>
    payments.voidPayment(ctx, req.params.id, req.body ?? {}),
  );

  // Deposits.
  r.get('/deposits', { permission: 'payments:read', tags: P, summary: 'List deposits', querystring: Type.Object({ order_id: Type.Optional(Id), status: Type.Optional(Type.String()) }) }, async (ctx, req) => ({ object: 'list', data: await payments.listDeposits(ctx, req.query) }));
  r.get('/deposits/:id', { permission: 'payments:read', tags: P, summary: 'Get a deposit', params: IdParams }, async (ctx, req) => payments.getDeposit(ctx, req.params.id));
  r.post(
    '/orders/:id/deposits',
    { permission: 'payments:write', tags: P, summary: 'Create a deposit manually', params: IdParams, body: Type.Object({ amount: Type.Integer({ minimum: 0 }), method: Type.Union(['card_auth', 'charge', 'cash', 'waived'].map((s) => Type.Literal(s))) }) },
    async (ctx, req) => payments.createDeposit(ctx, await orders.resolveOrderId(ctx, req.params.id), req.body),
  );
  r.post(
    '/deposits/:id/actions/authorize',
    {
      permission: 'payments:write',
      tags: P,
      summary: 'Take the deposit: a card hold, a charge (online through the provider when a card is saved, else recorded) or cash',
      params: IdParams,
      body: Type.Object({
        method: Type.Optional(Type.Union([Type.Literal('card_auth'), Type.Literal('cash'), Type.Literal('charge')])),
        via: Type.Optional(Type.Union([Type.Literal('provider'), Type.Literal('manual')], { description: 'For charges: provider charges the saved card, manual records a payment taken elsewhere' })),
      }),
      status: 200,
    },
    async (ctx, req) =>
    payments.authorizeDeposit(ctx, req.params.id, req.body ?? {}),
  );
  r.post(
    '/deposits/:id/actions/capture',
    { permission: 'payments:write', tags: P, summary: 'Capture part or all of a held deposit for damage', params: IdParams, body: Type.Object({ amount: Type.Integer({ minimum: 1 }), reason: Type.Optional(Type.String()), damage_charge_ids: Type.Optional(Type.Array(Id)) }), status: 200 },
    async (ctx, req) => payments.captureDeposit(ctx, req.params.id, req.body),
  );
  r.post('/deposits/:id/actions/release', { permission: 'payments:write', tags: P, summary: 'Release a held or pending deposit', params: IdParams, status: 200 }, async (ctx, req) => payments.releaseDeposit(ctx, req.params.id));
  r.post('/deposits/:id/actions/reauthorize', { permission: 'payments:write', tags: P, summary: 'Replace an expiring card hold with a fresh one', params: IdParams, status: 200 }, async (ctx, req) => payments.reauthorizeDeposit(ctx, req.params.id));

  // Damage.
  r.get('/orders/:id/damage_charges', { permission: 'orders:read', tags: P, summary: 'Damage charges on an order', params: IdParams }, async (ctx, req) => ({ object: 'list', data: await payments.listDamageCharges(ctx, await orders.resolveOrderId(ctx, req.params.id)) }));
  r.post(
    '/orders/:id/damage_charges',
    { permission: 'orders:fulfil', tags: P, summary: 'Record a damage charge', params: IdParams, body: Type.Object({ description: Type.String({ minLength: 1 }), amount: Type.Integer({ minimum: 0 }), stock_item_id: Type.Optional(Nullable(Id)), notes: Type.Optional(Type.String()) }) },
    async (ctx, req) => payments.createDamageCharge(ctx, await orders.resolveOrderId(ctx, req.params.id), req.body),
  );
  r.patch('/damage_charges/:id', { permission: 'orders:fulfil', tags: P, summary: 'Edit an open damage charge', params: IdParams, body: Type.Object({ description: Type.Optional(Type.String()), amount: Type.Optional(Type.Integer({ minimum: 0 })), notes: Type.Optional(Type.String()) }) }, async (ctx, req) =>
    payments.updateDamageCharge(ctx, req.params.id, req.body),
  );
  r.delete('/damage_charges/:id', { permission: 'orders:fulfil', tags: P, summary: 'Delete an open damage charge', params: IdParams }, async (ctx, req) => payments.deleteDamageCharge(ctx, req.params.id));
  r.post('/damage_charges/:id/actions/waive', { permission: 'payments:write', tags: P, summary: 'Waive a damage charge', params: IdParams, status: 200 }, async (ctx, req) => payments.waiveDamageCharge(ctx, req.params.id));
  r.post('/damage_charges/:id/actions/invoice', { permission: 'payments:write', tags: P, summary: 'Invoice a damage charge separately', params: IdParams, status: 200 }, async (ctx, req) => payments.invoiceDamageCharge(ctx, req.params.id));
}
