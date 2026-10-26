import { maintenance, stocktakes } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Nullable, Type } from '../schemas.ts';

const PhotoBody = Type.Object({ file_id: Id });

/** Maintenance tickets, inspection photos and stock takes (PRD §3.10, §3.11). */
export function registerWarehouse(r: Router) {
  const M = ['Maintenance'];
  const Priority = Type.Union(['low', 'normal', 'high', 'urgent'].map((s) => Type.Literal(s)));
  const Part = Type.Object({ name: Type.String({ maxLength: 200 }), quantity: Type.Number({ minimum: 0 }), unit_cost: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
  const Fields = {
    title: Type.Optional(Type.String({ maxLength: 200 })), notes: Type.Optional(Type.String({ maxLength: 5000 })), priority: Type.Optional(Priority),
    assignee_id: Type.Optional(Nullable(Id)), due_at: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
    cost: Type.Optional(Type.Integer({ minimum: 0 })), parts: Type.Optional(Type.Array(Part, { maxItems: 50 })),
  };
  r.get(
    '/maintenance_tickets',
    {
      permission: 'inventory:read', tags: M, summary: 'Repair tickets, most urgent first (status=active by default: open and in progress)',
      querystring: Type.Object({
        status: Type.Optional(Type.Union(['active', 'open', 'in_progress', 'done', 'cancelled'].map((s) => Type.Literal(s)))), location_id: Type.Optional(Id),
        assignee_id: Type.Optional(Type.String({ maxLength: 64, description: 'A user id, or "me"' })), priority: Type.Optional(Priority), overdue: Type.Optional(Type.Boolean()),
      }),
    },
    async (ctx, req) => ({
      object: 'list',
      data: await maintenance.listTickets(ctx, { ...req.query, assignee_id: req.query.assignee_id === 'me' ? (ctx.actor.id ?? undefined) : req.query.assignee_id }),
    }),
  );
  r.post(
    '/maintenance_tickets',
    {
      permission: 'inventory:write', tags: M, summary: 'Open a ticket for one or more units; they go out of service',
      body: Type.Object({ ...Fields, stock_item_ids: Type.Array(Id, { maxItems: 50 }), severity: Type.Optional(Type.Union([Type.Literal('soft_down'), Type.Literal('hard_down')])) }, { additionalProperties: false }),
    },
    async (ctx, req) => maintenance.createTicket(ctx, req.body),
  );
  r.get('/maintenance_tickets/:id', { permission: 'inventory:read', tags: M, summary: 'One ticket with its units and photos', params: IdParams }, async (ctx, req) => maintenance.getTicket(ctx, req.params.id));
  r.patch(
    '/maintenance_tickets/:id',
    { permission: 'inventory:write', tags: M, summary: 'Update an open ticket', params: IdParams, body: Type.Object({ ...Fields, status: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('in_progress')])) }, { additionalProperties: false }) },
    async (ctx, req) => maintenance.updateTicket(ctx, req.params.id, req.body),
  );
  r.post('/maintenance_tickets/:id/actions/start', { permission: 'inventory:write', tags: M, summary: 'Work on the repair has begun', params: IdParams, status: 200 }, async (ctx, req) => maintenance.startTicket(ctx, req.params.id));
  const Resolve = Type.Object(
    { outcome: Type.Optional(Type.Union([Type.Literal('available'), Type.Literal('retired')])), resolution: Type.Optional(Type.String({ maxLength: 5000 })), notes: Type.Optional(Type.String({ maxLength: 5000 })), cost: Fields.cost, parts: Fields.parts },
    { additionalProperties: false },
  );
  r.post('/maintenance_tickets/:id/actions/resolve', { permission: 'inventory:write', tags: M, summary: 'Finish the repair: the units go back into service or are retired', params: IdParams, body: Resolve, status: 200 }, async (ctx, req) =>
    maintenance.resolveTicket(ctx, req.params.id, req.body ?? {}),
  );
  r.post(
    '/maintenance_tickets/:id/actions/close',
    { permission: 'inventory:write', tags: M, summary: 'Deprecated: the same as resolve', params: IdParams, body: Type.Object({ outcome: Type.Union([Type.Literal('available'), Type.Literal('retired')]), notes: Type.Optional(Type.String({ maxLength: 5000 })) }), status: 200 },
    async (ctx, req) => maintenance.closeTicket(ctx, req.params.id, req.body),
  );
  r.post('/maintenance_tickets/:id/actions/cancel', { permission: 'inventory:write', tags: M, summary: 'Not needed after all: the units go back into service without a repair', params: IdParams, body: Type.Object({ reason: Type.Optional(Type.String({ maxLength: 2000 })) }), status: 200 }, async (ctx, req) =>
    maintenance.cancelTicket(ctx, req.params.id, req.body ?? {}),
  );
  r.post('/maintenance_tickets/:id/photos', { permission: 'inventory:write', tags: M, summary: 'Attach a photo uploaded with POST /files?purpose=photo', params: IdParams, body: PhotoBody }, async (ctx, req) =>
    maintenance.attachPhoto(ctx, 'maintenance_ticket', req.params.id, req.body.file_id),
  );
  r.post('/damage_charges/:id/photos', { permission: 'orders:fulfil', tags: ['Payments'], summary: 'Attach a photo of the damage', params: IdParams, body: PhotoBody }, async (ctx, req) =>
    maintenance.attachPhoto(ctx, 'damage_charge', req.params.id, req.body.file_id),
  );

  const S = ['Stock takes'];
  r.post('/stock_takes', { permission: 'inventory:write', tags: S, summary: 'Start counting a location (returns the open count if there is one)', body: Type.Object({ location_id: Type.Optional(Id) }) }, async (ctx, req) =>
    stocktakes.startStockTake(ctx, req.body?.location_id),
  );
  r.get('/stock_takes/:id', { permission: 'inventory:read', tags: S, summary: 'Expected, found, missing and misplaced units', params: IdParams }, async (ctx, req) => stocktakes.getStockTake(ctx, req.params.id));
  r.post('/stock_takes/:id/scans', { permission: 'inventory:write', tags: S, summary: 'Record a scanned barcode', params: IdParams, body: Type.Object({ code: Type.String({ minLength: 1, maxLength: 128 }) }), status: 200 }, async (ctx, req) =>
    stocktakes.scanStockTake(ctx, req.params.id, req.body.code),
  );
  r.post(
    '/stock_takes/:id/actions/apply',
    { permission: 'inventory:write', tags: S, summary: 'Finish the count: optionally mark missing units lost and move found units here', params: IdParams, body: Type.Object({ mark_missing_lost: Type.Optional(Type.Boolean()), move_found: Type.Optional(Type.Boolean()) }), status: 200 },
    async (ctx, req) => stocktakes.applyStockTake(ctx, req.params.id, req.body ?? {}),
  );
  r.post('/stock_takes/:id/actions/cancel', { permission: 'inventory:write', tags: S, summary: 'Abandon the count', params: IdParams, status: 200 }, async (ctx, req) => stocktakes.cancelStockTake(ctx, req.params.id));
}
