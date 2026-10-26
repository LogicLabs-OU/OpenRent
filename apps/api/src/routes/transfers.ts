import { transfers } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Nullable, Type } from '../schemas.ts';

/** Stock transfers between locations (FR-LOC-2, ADR 0007): plan, send, receive or cancel. */
export function registerTransfers(r: Router) {
  const T = ['Transfers'];
  const Line = Type.Object(
    {
      stock_item_id: Type.Optional(Id), barcode: Type.Optional(Type.String({ maxLength: 64 })),
      variant_id: Type.Optional(Id), quantity: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
    },
    { additionalProperties: false, description: 'A unit (stock_item_id or barcode), or a bulk variant with a quantity' },
  );
  r.get(
    '/transfers',
    { permission: 'inventory:read', tags: T, summary: 'List transfers (status: comma-separated; location_id matches either end)', querystring: Type.Object({ status: Type.Optional(Type.String()), location_id: Type.Optional(Id), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }) },
    async (ctx, req) => ({ object: 'list', data: await transfers.listTransfers(ctx, req.query) }),
  );
  r.get('/transfers/:id', { permission: 'inventory:read', tags: T, summary: 'One transfer with its lines', params: IdParams }, async (ctx, req) => transfers.getTransfer(ctx, req.params.id));
  r.post(
    '/transfers',
    {
      permission: 'inventory:write', tags: T, summary: 'Plan a transfer; its stock is held at the source from ships_at (default now)',
      body: Type.Object(
        {
          from_location_id: Id, to_location_id: Id, ships_at: Type.Optional(Type.String({ format: 'date-time' })), eta: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
          notes: Type.Optional(Type.String({ maxLength: 2000 })), lines: Type.Array(Line, { maxItems: 200 }),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => transfers.createTransfer(ctx, req.body),
  );
  r.patch(
    '/transfers/:id',
    { permission: 'inventory:write', tags: T, summary: 'Change the notes, or the expected arrival before it ships', params: IdParams, body: Type.Object({ notes: Type.Optional(Type.String({ maxLength: 2000 })), eta: Type.Optional(Nullable(Type.String({ format: 'date-time' }))) }, { additionalProperties: false }) },
    async (ctx, req) => transfers.updateTransfer(ctx, req.params.id, req.body),
  );
  r.post('/transfers/:id/actions/dispatch', { permission: 'inventory:write', tags: T, summary: 'Send the stock: it moves to the destination and travels until the ETA', params: IdParams, status: 200 }, async (ctx, req) =>
    transfers.dispatchTransfer(ctx, req.params.id),
  );
  r.post(
    '/transfers/:id/actions/receive',
    {
      permission: 'inventory:write', tags: T, summary: 'Book what arrived (everything when nothing is listed); complete writes the rest off as lost', params: IdParams, status: 200,
      body: Type.Object(
        {
          lines: Type.Optional(Type.Array(Type.Object({ line_id: Id, quantity: Type.Integer({ minimum: 0 }) }), { maxItems: 200 })),
          barcodes: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 200 })),
          complete: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => transfers.receiveTransfer(ctx, req.params.id, req.body ?? {}),
  );
  r.post('/transfers/:id/actions/cancel', { permission: 'inventory:write', tags: T, summary: 'Call off a planned transfer', params: IdParams, status: 200 }, async (ctx, req) => transfers.cancelTransfer(ctx, req.params.id));
  r.post(
    '/stock_items/:id/actions/transfer',
    {
      permission: 'inventory:write', tags: ['Inventory'], summary: 'Send one unit to another location now (received: booked in there at once)', params: IdParams, status: 200,
      body: Type.Object({ to_location_id: Id, eta: Type.Optional(Nullable(Type.String({ format: 'date-time' }))), received: Type.Optional(Type.Boolean()), notes: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false }),
    },
    async (ctx, req) => transfers.transferUnit(ctx, req.params.id, req.body),
  );
}
