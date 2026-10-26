import { deliveries } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Json, Nullable, Type } from '../schemas.ts';

/** Deliveries and collections (FR-OR-12): booking, the day board, the driver's run and route exports. */
export function registerDeliveries(r: Router) {
  const D = ['Deliveries'];
  const Day = Type.String({ format: 'date', description: 'Route day (YYYY-MM-DD, shop time zone)' });
  const Contact = Type.Object({ name: Type.Optional(Type.String({ maxLength: 200 })), phone: Type.Optional(Type.String({ maxLength: 40 })) }, { additionalProperties: false });
  const Fields = {
    window_start: Type.String({ format: 'date-time' }),
    window_end: Type.String({ format: 'date-time' }),
    address: Type.Optional(Json),
    contact: Type.Optional(Contact),
    driver_user_id: Type.Optional(Nullable(Id)),
    notes: Type.Optional(Type.String({ maxLength: 2000 })),
  };
  r.get(
    '/deliveries',
    {
      permission: 'deliveries:read',
      tags: D,
      summary: 'Deliveries and collections; a day comes back in route order',
      querystring: Type.Object({
        date: Type.Optional(Day), driver_user_id: Type.Optional(Id), order_id: Type.Optional(Id), location_id: Type.Optional(Id),
        status: Type.Optional(Type.Union(['scheduled', 'dispatched', 'completed', 'failed', 'cancelled'].map((s) => Type.Literal(s)))),
      }),
    },
    async (ctx, req) => ({ object: 'list', data: await deliveries.listDeliveries(ctx, req.query) }),
  );
  r.get('/deliveries/:id', { permission: 'deliveries:read', tags: D, summary: 'Get a delivery', params: IdParams }, async (ctx, req) => deliveries.getDelivery(ctx, req.params.id));
  r.post(
    '/orders/:id/deliveries',
    { permission: 'deliveries:write', tags: D, summary: 'Book a delivery or collection; the order\'s bookings stretch to cover its window', params: IdParams, body: Type.Object({ kind: Type.Union([Type.Literal('delivery'), Type.Literal('collection')]), ...Fields }, { additionalProperties: false }) },
    async (ctx, req) => deliveries.scheduleDelivery(ctx, req.params.id, req.body),
  );
  r.patch(
    '/deliveries/:id',
    { permission: 'deliveries:write', tags: D, summary: 'Reschedule, re-address or assign a driver', params: IdParams, body: Type.Partial(Type.Object(Fields, { additionalProperties: false })) },
    async (ctx, req) => deliveries.updateDelivery(ctx, req.params.id, req.body),
  );
  r.post(
    '/deliveries/actions/reorder',
    { permission: 'deliveries:write', tags: D, summary: 'Set the run order of a day', body: Type.Object({ date: Day, ids: Type.Array(Id, { minItems: 1, maxItems: 200 }) }), status: 200 },
    async (ctx, req) => ({ object: 'list', data: await deliveries.reorderRoute(ctx, req.body.date, req.body.ids) }),
  );
  r.post('/deliveries/:id/actions/dispatch', { permission: 'deliveries:write', tags: D, summary: 'On its way: issues the delivery note and emails the customer', params: IdParams, status: 200 }, async (ctx, req) =>
    deliveries.dispatchDelivery(ctx, req.params.id),
  );
  r.post(
    '/deliveries/:id/actions/complete',
    {
      permission: 'deliveries:write',
      tags: D,
      summary: 'Done at the door: signature and photos; by default records the pickup (delivery) or return (collection) on the order',
      params: IdParams,
      body: Type.Object({ signed_name: Type.Optional(Type.String({ maxLength: 200 })), signature_file_id: Type.Optional(Id), photo_file_ids: Type.Optional(Type.Array(Id, { maxItems: 20 })), record_on_order: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      status: 200,
    },
    async (ctx, req) => deliveries.completeDelivery(ctx, req.params.id, req.body),
  );
  r.post('/deliveries/:id/actions/fail', { permission: 'deliveries:write', tags: D, summary: 'Could not hand over or collect; staff are told', params: IdParams, body: Type.Object({ reason: Type.String({ maxLength: 500 }) }), status: 200 }, async (ctx, req) =>
    deliveries.failDelivery(ctx, req.params.id, req.body.reason),
  );
  r.post('/deliveries/:id/actions/cancel', { permission: 'deliveries:write', tags: D, summary: 'Cancel; the order\'s bookings go back to the rental period', params: IdParams, status: 200 }, async (ctx, req) =>
    deliveries.cancelDelivery(ctx, req.params.id),
  );
  r.get(
    '/deliveries/route',
    { permission: 'deliveries:read', tags: D, summary: 'A day\'s run as CSV, or GPX for stops with coordinates', querystring: Type.Object({ date: Day, driver_user_id: Type.Optional(Id), format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('gpx')])) }), raw: true },
    async (ctx, req, reply) => {
      const gpx = req.query.format === 'gpx';
      const body = gpx ? await deliveries.routeGpx(ctx, req.query.date, req.query.driver_user_id) : await deliveries.routeCsv(ctx, req.query.date, req.query.driver_user_id);
      reply
        .header('content-type', gpx ? 'application/gpx+xml' : 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="route-${req.query.date}.${gpx ? 'gpx' : 'csv'}"`)
        .send(body);
    },
  );
}
