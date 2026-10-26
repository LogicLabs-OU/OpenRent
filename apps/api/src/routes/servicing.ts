import { servicing } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Nullable, Type } from '../schemas.ts';

/** Meters, service intervals and what is due (FR-CAT-10, FR-MNT-4). */
export function registerServicing(r: Router) {
  const S = ['Service'];
  r.post(
    '/stock_items/:id/actions/add_meter_reading',
    { permission: 'inventory:write', tags: S, summary: 'Record a meter reading (never below the last one)', params: IdParams, status: 200, body: Type.Object({ value: Type.Number({ minimum: 0 }), recorded_at: Type.Optional(Nullable(Type.String({ format: 'date-time' }))) }, { additionalProperties: false }) },
    async (ctx, req) => servicing.addMeterReading(ctx, req.params.id, req.body),
  );
  r.get('/stock_items/:id/meter_readings', { permission: 'inventory:read', tags: S, summary: "A unit's meter readings, newest first", params: IdParams }, async (ctx, req) => ({ object: 'list', data: await servicing.listMeterReadings(ctx, req.params.id) }));
  r.get('/stock_items/:id/upkeep', { permission: 'inventory:read', tags: S, summary: "A unit's meter, services due and done, and book value", params: IdParams }, async (ctx, req) => servicing.unitUpkeep(ctx, req.params.id));
  r.post(
    '/stock_items/:id/actions/record_service',
    { permission: 'inventory:write', tags: S, summary: 'Record a service done; the next one is due from now', params: IdParams, status: 200, body: Type.Object({ interval_id: Id, notes: Type.Optional(Type.String({ maxLength: 2000 })), performed_at: Type.Optional(Nullable(Type.String({ format: 'date-time' }))) }, { additionalProperties: false }) },
    async (ctx, req) => servicing.recordService(ctx, req.params.id, req.body),
  );

  const Fields = {
    name: Type.String({ maxLength: 200 }), product_id: Type.Optional(Nullable(Id)), category_id: Type.Optional(Nullable(Id)),
    every_days: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))), every_rentals: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))), every_meter: Type.Optional(Nullable(Type.Number({ minimum: 0 }))),
    opens_ticket: Type.Optional(Type.Boolean()), active: Type.Optional(Type.Boolean()),
  };
  r.get('/service_intervals', { permission: 'inventory:read', tags: S, summary: 'Service intervals' }, async (ctx) => ({ object: 'list', data: await servicing.listIntervals(ctx) }));
  r.post('/service_intervals', { permission: 'inventory:write', tags: S, summary: 'Create a service interval', body: Type.Object(Fields, { additionalProperties: false }) }, async (ctx, req) => servicing.createInterval(ctx, req.body));
  r.patch('/service_intervals/:id', { permission: 'inventory:write', tags: S, summary: 'Update a service interval', params: IdParams, body: Type.Partial(Type.Object(Fields, { additionalProperties: false })) }, async (ctx, req) =>
    servicing.updateInterval(ctx, req.params.id, req.body),
  );
  r.delete('/service_intervals/:id', { permission: 'inventory:write', tags: S, summary: 'Archive a service interval', params: IdParams }, async (ctx, req) => servicing.deleteInterval(ctx, req.params.id));
  r.get(
    '/service_due',
    { permission: 'inventory:read', tags: S, summary: 'Units whose service is overdue or due soon', querystring: Type.Object({ location_id: Type.Optional(Id), interval_id: Type.Optional(Id), status: Type.Optional(Type.Union([Type.Literal('overdue'), Type.Literal('due_soon')])) }) },
    async (ctx, req) => ({ object: 'list', data: await servicing.serviceDue(ctx, req.query) }),
  );
}
