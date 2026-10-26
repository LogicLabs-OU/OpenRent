import { reports } from '@openrent/core';
import type { Router } from '../http.ts';
import { parseList } from '../http.ts';
import { Id, IdParams, ListQuery, Nullable, Type } from '../schemas.ts';
import { rowsSheet, sendSheet } from '../spreadsheets.ts';

export function registerReports(r: Router) {
  const R = ['Reports'];
  r.get('/reports/dashboard', { permission: 'reports:read', tags: R, summary: "Today's pickups and returns, overdue, revenue MTD, utilisation, open quotes", querystring: Type.Object({ location_id: Type.Optional(Id) }) }, async (ctx, req) =>
    reports.dashboard(ctx, req.query),
  );
  r.get(
    '/reports/:name',
    {
      permission: 'reports:read',
      tags: R,
      summary: `Run a report: ${reports.REPORTS.join(', ')}. Add format=csv or format=xlsx for a download.`,
      params: Type.Object({ name: Type.String() }),
      querystring: Type.Object({ from: Type.Optional(Type.String()), to: Type.Optional(Type.String()), range: Type.Optional(Type.String({ description: `A relative period instead of from and to: ${reports.RANGES.join(', ')}` })), group_by: Type.Optional(Type.String()), location_id: Type.Optional(Id), variant_id: Type.Optional(Id), format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv'), Type.Literal('xlsx')])) }),
      raw: true,
    },
    async (ctx, req, reply) => {
      const out = await reports.runReport(ctx, req.params.name, req.query);
      if (req.query.format === 'csv' || req.query.format === 'xlsx') {
        return sendSheet(reply, rowsSheet(out.data as Record<string, unknown>[]), req.params.name, req.query.format);
      }
      return reply.send(out);
    },
  );

  // Saved reports with filters, optionally emailed on a schedule (FR-REP-4).
  const Params = Type.Object(
    {
      range: Type.Optional(Type.String()),
      from: Type.Optional(Type.String()),
      to: Type.Optional(Type.String()),
      group_by: Type.Optional(Type.String()),
      location_id: Type.Optional(Id),
      variant_id: Type.Optional(Id),
    },
    { additionalProperties: false },
  );
  const SavedInput = Type.Object(
    {
      name: Type.String({ maxLength: 200 }),
      report: Type.String({ description: reports.REPORTS.join(', ') }),
      params: Type.Optional(Params),
      format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('xlsx')])),
      schedule: Type.Optional(Nullable(Type.Union(reports.SCHEDULES.map((s) => Type.Literal(s)), { description: 'Sent at 07:00 shop time: daily, on Mondays or on the 1st' }))),
      recipients: Type.Optional(Type.Array(Type.String({ maxLength: 254 }), { maxItems: 50 })),
    },
    { additionalProperties: false },
  );
  r.get('/saved_reports', { permission: 'reports:read', tags: R, summary: 'List saved reports', querystring: ListQuery }, async (ctx, req) => reports.savedReports.list(ctx, parseList(req.query)));
  r.post('/saved_reports', { permission: 'reports:write', tags: R, summary: 'Save a report with its filters, optionally with a schedule and recipients', body: SavedInput, status: 201 }, async (ctx, req) => reports.savedReports.create(ctx, req.body));
  r.get('/saved_reports/:id', { permission: 'reports:read', tags: R, summary: 'Get a saved report', params: IdParams }, async (ctx, req) => reports.savedReports.get(ctx, req.params.id));
  r.patch('/saved_reports/:id', { permission: 'reports:write', tags: R, summary: 'Update a saved report', params: IdParams, body: Type.Partial(SavedInput) }, async (ctx, req) => reports.savedReports.update(ctx, req.params.id, req.body));
  r.delete('/saved_reports/:id', { permission: 'reports:write', tags: R, summary: 'Delete a saved report', params: IdParams }, async (ctx, req) => reports.savedReports.remove(ctx, req.params.id));
  r.post(
    '/saved_reports/:id/actions/send',
    {
      permission: 'reports:write', tags: R, summary: 'Build the report now and email it to its recipients (or to the addresses given); returns the export job', params: IdParams,
      body: Type.Optional(Type.Object({ recipients: Type.Optional(Type.Array(Type.String({ maxLength: 254 }), { maxItems: 50 })) }, { additionalProperties: false })),
      status: 202,
    },
    async (ctx, req) => reports.sendNow(ctx, req.params.id, req.body?.recipients),
  );
}
