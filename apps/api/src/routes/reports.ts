import { reports } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, Type } from '../schemas.ts';
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
      querystring: Type.Object({ from: Type.Optional(Type.String()), to: Type.Optional(Type.String()), group_by: Type.Optional(Type.String()), location_id: Type.Optional(Id), variant_id: Type.Optional(Id), format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv'), Type.Literal('xlsx')])) }),
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
}
