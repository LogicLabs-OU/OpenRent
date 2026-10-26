import { inventory, availability, scans, maintenance, planner, AppError, invalid, serverT } from '@openrent/core';
import type { Router } from '../http.ts';
import { parseList } from '../http.ts';
import { renderLabels } from '../labels.ts';
import { Availability, Id, IdParams, Json, ListQuery, Nullable, Page, StockItem, Type, ok } from '../schemas.ts';

const StockItemBody = Type.Object(
  {
    variant_id: Id, location_id: Type.Optional(Id), barcode: Type.Optional(Type.String({ maxLength: 64 })), serial: Type.Optional(Nullable(Type.String())), condition: Type.Optional(Type.String()),
    purchase_date: Type.Optional(Nullable(Type.String({ format: 'date' }))), purchase_price: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))), notes: Type.Optional(Type.String()), bin: Type.Optional(Nullable(Type.String({ maxLength: 40 }))), custom_fields: Type.Optional(Json),
  },
  { additionalProperties: false },
);

const Status = Type.Union(['available', 'needs_inspection', 'soft_down', 'hard_down', 'retired', 'lost'].map((s) => Type.Literal(s)));

export function registerInventory(r: Router) {
  const I = ['Inventory'];
  r.get('/stock_items', { permission: 'inventory:read', tags: I, summary: 'List stock items (filters: variant_id, product_id, location_id, status)', querystring: ListQuery, response: ok(Page(StockItem)) }, async (ctx, req) =>
    inventory.listStockItems(ctx, parseList(req.query)),
  );
  r.post('/stock_items', { permission: 'inventory:write', tags: I, summary: 'Create a serialised unit (barcode generated when omitted)', body: StockItemBody, response: ok(StockItem, 201) }, async (ctx, req) => inventory.createStockItem(ctx, req.body));
  r.post(
    '/stock_items/batch',
    { permission: 'inventory:write', tags: I, summary: 'Create up to 100 units with per-item results', body: Type.Object({ items: Type.Optional(Type.Array(StockItemBody, { maxItems: 100 })), variant_id: Type.Optional(Id), location_id: Type.Optional(Id), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }) },
    async (ctx, req) => inventory.createStockItemsBatch(ctx, req.body),
  );
  r.get('/stock_items/by_barcode/:code', { permission: 'inventory:read', tags: I, summary: 'Look up a unit by barcode', params: Type.Object({ code: Type.String() }) }, async (ctx, req) => inventory.getStockItemByBarcode(ctx, req.params.code));
  r.get('/stock_items/:id', { permission: 'inventory:read', tags: I, summary: 'Get a unit with its photos', params: IdParams }, async (ctx, req) => ({
    ...(await inventory.getStockItem(ctx, req.params.id)),
    photos: (await maintenance.photosOf(ctx, 'stock_item', [req.params.id])).get(req.params.id) ?? [],
  }));
  r.get('/stock_items/:id/history', { permission: 'inventory:read', tags: I, summary: 'Rental history of a unit', params: IdParams }, async (ctx, req) => ({ object: 'list', data: await inventory.stockItemHistory(ctx, req.params.id) }));
  r.patch('/stock_items/:id', { permission: 'inventory:write', tags: I, summary: 'Update a unit', params: IdParams, body: Type.Partial(StockItemBody) }, async (ctx, req) => inventory.updateStockItem(ctx, req.params.id, req.body));
  r.delete('/stock_items/:id', { permission: 'inventory:write', tags: I, summary: 'Delete a unit with no history', params: IdParams }, async (ctx, req) => inventory.deleteStockItem(ctx, req.params.id));
  r.post(
    '/stock_items/:id/actions/set_status',
    { permission: 'inventory:write', tags: I, summary: 'Change status with a reason; down statuses block availability (FR-MNT-1)', params: IdParams, body: Type.Object({ status: Status, reason: Type.Optional(Type.String()) }), status: 200 },
    async (ctx, req) => inventory.setStockItemStatus(ctx, req.params.id, req.body.status, req.body.reason),
  );
  r.post('/stock_items/:id/actions/retire', { permission: 'inventory:write', tags: I, summary: 'Retire a unit', params: IdParams, body: Type.Object({ reason: Type.Optional(Type.String()) }), status: 200 }, async (ctx, req) =>
    inventory.setStockItemStatus(ctx, req.params.id, 'retired', req.body?.reason),
  );

  r.get('/stock_levels', { permission: 'inventory:read', tags: I, summary: 'Bulk stock levels', querystring: Type.Object({ variant_id: Type.Optional(Id), location_id: Type.Optional(Id) }) }, async (ctx, req) => ({
    object: 'list',
    data: await inventory.listStockLevels(ctx, req.query),
  }));
  r.put(
    '/stock_levels/:variant_id/:location_id',
    { permission: 'inventory:write', tags: I, summary: 'Set a bulk quantity (records an adjustment)', params: Type.Object({ variant_id: Id, location_id: Id }), body: Type.Object({ quantity: Type.Integer({ minimum: 0 }), reason: Type.Optional(Type.String()) }) },
    async (ctx, req) => inventory.setStockLevel(ctx, req.params.variant_id, req.params.location_id, req.body.quantity, req.body.reason),
  );
  r.post(
    '/stock_levels/:variant_id/:location_id/actions/adjust',
    { permission: 'inventory:write', tags: I, summary: 'Adjust a bulk quantity by a delta with a reason', params: Type.Object({ variant_id: Id, location_id: Id }), body: Type.Object({ delta: Type.Integer(), reason: Type.String({ minLength: 1 }), reference: Type.Optional(Type.String()) }), status: 200 },
    async (ctx, req) => inventory.adjustStockLevel(ctx, req.params.variant_id, req.params.location_id, req.body.delta, req.body.reason, req.body.reference),
  );

  const A = ['Availability'];
  const range = (q: any) => {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw invalid(serverT('error.from_and_to_must_be_iso_date'));
    return { from, to };
  };
  const defaultLocation = async (ctx: any, id?: string) => id ?? (await ctx.db.query(`SELECT id FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC LIMIT 1`)).rows[0]?.id;
  r.get(
    '/availability',
    {
      permission: 'inventory:read', tags: A, summary: 'Availability of a variant over [from, to); location_id=* lists every location',
      querystring: Type.Object({ variant_id: Id, location_id: Type.Optional(Id), from: Type.String(), to: Type.String() }),
      response: ok(Type.Union([Availability, Type.Object({ object: Type.Literal('list'), data: Type.Array(Availability) })])),
    },
    async (ctx, req) =>
      req.query.location_id === '*'
        ? { object: 'list' as const, data: await availability.checkAcrossLocations(ctx, { variantId: req.query.variant_id, ...range(req.query) }) }
        : availability.check(ctx, { variantId: req.query.variant_id, locationId: await defaultLocation(ctx, req.query.location_id), ...range(req.query) }),
  );
  r.post(
    '/availability/batch',
    { permission: 'inventory:read', tags: A, summary: 'Up to 100 variants × one range', body: Type.Object({ variant_ids: Type.Array(Id, { minItems: 1, maxItems: 100 }), location_id: Type.Optional(Id), from: Type.String(), to: Type.String() }), status: 200 },
    async (ctx, req) => ({ object: 'list', data: await availability.checkBatch(ctx, { variantIds: req.body.variant_ids, locationId: await defaultLocation(ctx, req.body.location_id), ...range(req.body) }) }),
  );
  r.get(
    '/availability/calendar',
    { permission: 'inventory:read', tags: A, summary: 'Per-day minimum availability for a month', querystring: Type.Object({ variant_id: Id, location_id: Type.Optional(Id), month: Type.String({ pattern: '^\\d{4}-\\d{2}$' }) }) },
    async (ctx, req) => ({ object: 'list', data: await availability.calendar(ctx, { variantId: req.query.variant_id, locationId: await defaultLocation(ctx, req.query.location_id), month: req.query.month }) }),
  );

  // Stock rented in from a supplier for a while (FR-CAT-9).
  r.get(
    '/external_stock',
    { permission: 'inventory:read', tags: I, summary: 'Stock rented in from suppliers, by variant, location, status and dates', querystring: Type.Object({ variant_id: Type.Optional(Id), location_id: Type.Optional(Id), status: Type.Optional(Type.Union([Type.Literal('booked'), Type.Literal('cancelled')])), from: Type.Optional(Type.String({ format: 'date-time' })), to: Type.Optional(Type.String({ format: 'date-time' })) }) },
    async (ctx, req) => ({ object: 'list', data: await inventory.listExternalStock(ctx, req.query) }),
  );
  r.post(
    '/external_stock',
    {
      permission: 'inventory:write', tags: I, summary: 'Rent stock in for some dates: it raises capacity then only, and settles overbookings it covers',
      body: Type.Object({
        variant_id: Id, location_id: Id, supplier: Type.String({ maxLength: 200 }), quantity: Type.Integer({ description: '1 or more' }), starts_at: Type.String({ format: 'date-time' }), ends_at: Type.String({ format: 'date-time' }),
        unit_cost: Type.Optional(Type.Integer({ description: 'What one unit costs for the whole time, minor units' })), reference: Type.Optional(Nullable(Type.String({ maxLength: 100 }))), note: Type.Optional(Type.String({ maxLength: 1000 })),
      }, { additionalProperties: false }),
    },
    async (ctx, req) => inventory.createExternalStock(ctx, req.body),
  );
  r.post('/external_stock/:id/actions/cancel', { permission: 'inventory:write', tags: I, summary: 'Cancel rented-in stock; refused while bookings need it unless force', params: IdParams, body: Type.Object({ force: Type.Optional(Type.Boolean()) }), status: 200 }, async (ctx, req) =>
    inventory.cancelExternalStock(ctx, req.params.id, req.body ?? {}),
  );
  r.get('/downtimes', { permission: 'inventory:read', tags: A, summary: 'Downtime blocks', querystring: Type.Object({ variant_id: Type.Optional(Id), stock_item_id: Type.Optional(Id), active: Type.Optional(Type.Boolean()), location_id: Type.Optional(Id) }) }, async (ctx, req) => ({
    object: 'list',
    data: await inventory.listDowntimes(ctx, req.query),
  }));
  r.post(
    '/downtimes',
    {
      permission: 'inventory:write',
      tags: A,
      summary: 'Block capacity for maintenance or internal use (FR-AV-5)',
      body: Type.Object({ stock_item_id: Type.Optional(Nullable(Id)), variant_id: Type.Optional(Id), location_id: Type.Optional(Id), quantity: Type.Optional(Type.Integer({ minimum: 1 })), starts_at: Type.String({ format: 'date-time' }), ends_at: Type.Optional(Nullable(Type.String({ format: 'date-time' }))), reason: Type.Optional(Type.String()) }),
    },
    async (ctx, req) => inventory.createDowntime(ctx, req.body),
  );
  r.delete('/downtimes/:id', { permission: 'inventory:write', tags: A, summary: 'End or delete a downtime', params: IdParams }, async (ctx, req) => inventory.deleteDowntime(ctx, req.params.id));

  const S = ['Labels & scanning'];
  r.post(
    '/labels/batch',
    {
      permission: 'inventory:read',
      tags: S,
      summary: 'Printable labels (HTML sheet with SVG Code 128/QR, or ZPL)',
      body: Type.Object({
        stock_item_ids: Type.Optional(Type.Array(Id, { maxItems: 100 })),
        variant_ids: Type.Optional(Type.Array(Id, { maxItems: 100 })),
        format: Type.Optional(Type.Union([Type.Literal('html'), Type.Literal('zpl')])),
        symbology: Type.Optional(Type.Union([Type.Literal('code128'), Type.Literal('qr')])),
        layout: Type.Optional(Type.Union([Type.Literal('avery_l7160'), Type.Literal('dymo_99012'), Type.Literal('brother_62x29')])),
      }),
      raw: true,
    },
    async (ctx, req, reply) => {
      const b = req.body as any;
      const items: { code: string; title: string; subtitle: string }[] = [];
      if (b.stock_item_ids?.length) {
        const rows = (await ctx.db.query(`SELECT s.barcode, s.serial, p.name, v.name AS vname FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.id = ANY($1) ORDER BY s.barcode`, [b.stock_item_ids])).rows;
        items.push(...rows.map((x: any) => ({ code: x.barcode, title: x.name, subtitle: [x.vname !== x.name ? x.vname : null, x.serial].filter(Boolean).join(' · ') })));
      }
      if (b.variant_ids?.length) {
        const rows = (await ctx.db.query(`SELECT sl.barcode, p.name, v.name AS vname FROM stock_levels sl JOIN variants v ON v.id = sl.variant_id JOIN products p ON p.id = v.product_id WHERE sl.variant_id = ANY($1) AND sl.barcode IS NOT NULL`, [b.variant_ids])).rows;
        items.push(...rows.map((x: any) => ({ code: x.barcode, title: x.name, subtitle: x.vname !== x.name ? x.vname : 'bulk' })));
      }
      if (!items.length) throw new AppError('nothing_to_print', 422, serverT('error.no_matching_units_or_bulk_stock_levels'));
      const out = renderLabels(items, { format: b.format ?? 'html', symbology: b.symbology ?? 'code128', layout: b.layout ?? 'avery_l7160' });
      return reply.type(out.contentType).send(out.body);
    },
  );
  r.post(
    '/scans',
    { permission: 'inventory:read', tags: S, summary: 'Resolve a scanned code to an entity and next action', body: Type.Object({ code: Type.String({ minLength: 1 }), mode: Type.Optional(Type.String()), order_id: Type.Optional(Id) }), status: 200 },
    async (ctx, req) => ({ object: 'scan_result', ...(await scans.resolveScan(ctx, req.body)) }),
  );
  r.post(
    '/scans/replay',
    {
      permission: 'orders:fulfil', tags: S, summary: 'Send scans made offline (up to 100); each is applied on its own, with the time it happened', status: 200,
      body: Type.Object(
        {
          items: Type.Array(
            Type.Object(
              {
                client_id: Type.String({ minLength: 8, maxLength: 64 }), mode: Type.Union(['lookup', 'prepare', 'check_out', 'check_in', 'stock_take', 'receive'].map((m) => Type.Literal(m))),
                code: Type.String({ minLength: 1, maxLength: 128 }), occurred_at: Type.String({ format: 'date-time' }), order_id: Type.Optional(Nullable(Id)), stock_take_id: Type.Optional(Nullable(Id)),
              },
              { additionalProperties: false },
            ),
            { maxItems: 100 },
          ),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => scans.replayScans(ctx, req.body.items as any),
  );
  r.get(
    '/planner',
    {
      permission: 'orders:read', tags: A, summary: 'Units of a location with their bookings over at most 31 days (at most 200 units)',
      querystring: Type.Object({ from: Type.String({ format: 'date-time' }), days: Type.Optional(Type.Integer({ minimum: 1, maximum: 31 })), location_id: Type.Optional(Id), product_id: Type.Optional(Id), category_id: Type.Optional(Id) }),
    },
    async (ctx, req) => planner.planner(ctx, { ...req.query, location_id: await defaultLocation(ctx, req.query.location_id) }),
  );
  r.get('/search', { permission: 'orders:read', tags: S, summary: 'Global search for the command palette', querystring: Type.Object({ q: Type.String({ minLength: 1 }) }) }, async (ctx, req) => scans.search(ctx, req.query.q));
}
