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
    kind: Type.Optional(Type.Union([Type.Literal('service'), Type.Literal('electrical_test')], { description: 'electrical_test: a PAT test every every_days; pickup waits for a valid one' })),
  };
  r.get('/service_intervals', { permission: 'inventory:read', tags: S, summary: 'Service intervals' }, async (ctx) => ({ object: 'list', data: await servicing.listIntervals(ctx) }));
  r.post('/service_intervals', { permission: 'inventory:write', tags: S, summary: 'Create a service interval', body: Type.Object(Fields, { additionalProperties: false }) }, async (ctx, req) => servicing.createInterval(ctx, req.body));
  r.patch('/service_intervals/:id', { permission: 'inventory:write', tags: S, summary: 'Update a service interval', params: IdParams, body: Type.Partial(Type.Object(Fields, { additionalProperties: false })) }, async (ctx, req) =>
    servicing.updateInterval(ctx, req.params.id, req.body),
  );
  r.delete('/service_intervals/:id', { permission: 'inventory:write', tags: S, summary: 'Archive a service interval', params: IdParams }, async (ctx, req) => servicing.deleteInterval(ctx, req.params.id));
  // Electrical safety tests (FR-MNT-5).
  r.get('/stock_items/:id/electrical_tests', { permission: 'inventory:read', tags: S, summary: "The unit's electrical safety tests, newest first, and whether it may go out", params: IdParams }, async (ctx, req) => ({
    object: 'list',
    status: await servicing.electricalStatus(ctx, req.params.id),
    data: await servicing.listElectricalTests(ctx, req.params.id),
  }));
  r.post(
    '/stock_items/:id/electrical_tests',
    {
      permission: 'inventory:write',
      tags: S,
      summary: 'Record an electrical safety test; a pass counts as the interval’s service, a fail takes the unit out of service with a repair ticket',
      params: IdParams,
      body: Type.Object(
        {
          tested_at: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
          result: Type.Union([Type.Literal('pass'), Type.Literal('fail')]),
          appliance_class: Type.Optional(Nullable(Type.Union([Type.Literal('I'), Type.Literal('II'), Type.Literal('III')]))),
          readings: Type.Optional(
            Type.Object(
              {
                earth_ohm: Type.Optional(Nullable(Type.Number({ description: 'Earth continuity, ohms' }))),
                insulation_mohm: Type.Optional(Nullable(Type.Number({ description: 'Insulation resistance, megohms' }))),
                leakage_ma: Type.Optional(Nullable(Type.Number({ description: 'Leakage or touch current, milliamps' }))),
                polarity_ok: Type.Optional(Nullable(Type.Boolean())),
                visual_ok: Type.Optional(Nullable(Type.Boolean())),
              },
              { additionalProperties: false },
            ),
          ),
          tester: Type.String({ maxLength: 120 }),
          instrument: Type.Optional(Nullable(Type.String({ maxLength: 120 }))),
          notes: Type.Optional(Type.String({ maxLength: 2000 })),
        },
        { additionalProperties: false },
      ),
      status: 201,
    },
    async (ctx, req) => servicing.recordElectricalTest(ctx, req.params.id, req.body),
  );
  r.get(
    '/electrical_tests/:id/certificate',
    { permission: 'inventory:read', tags: S, summary: 'The test certificate: a PDF where this installation makes PDFs, else HTML to print', params: IdParams, raw: true },
    async (ctx, req, reply) => {
      const html = await servicing.certificateHtml(ctx, req.params.id);
      if (ctx.config.renderPdf) {
        const pdf = await ctx.config.renderPdf(html);
        return reply.type('application/pdf').header('Content-Disposition', `inline; filename="pat-${req.params.id}.pdf"`).send(pdf);
      }
      return reply.type('text/html; charset=utf-8').send(html);
    },
  );
  r.get(
    '/service_due',
    { permission: 'inventory:read', tags: S, summary: 'Units whose service is overdue or due soon', querystring: Type.Object({ location_id: Type.Optional(Id), interval_id: Type.Optional(Id), status: Type.Optional(Type.Union([Type.Literal('overdue'), Type.Literal('due_soon')])) }) },
    async (ctx, req) => ({ object: 'list', data: await servicing.serviceDue(ctx, req.query) }),
  );
}
