import { assertCan, files, jobs } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Type } from '../schemas.ts';

/** Background exports (FR-MIG-1, FR-REP-2): start a job, follow its progress, download the result. */
export function registerJobs(r: Router) {
  const J = ['Jobs'];
  r.post(
    '/tenant/export',
    { permission: 'tenant:write', tags: J, summary: 'Start a full data export (ZIP with every table, document and file); returns the job. A running export is returned instead of a second one.', status: 202 },
    async (ctx) => jobs.enqueueJob(ctx, 'tenant_export'),
  );
  r.post(
    '/reports/:name/export',
    {
      permission: 'reports:read',
      tags: J,
      summary: 'Build a report download in the background; returns the job',
      params: Type.Object({ name: Type.String() }),
      body: Type.Object({
        format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('xlsx')])),
        from: Type.Optional(Type.String()),
        to: Type.Optional(Type.String()),
        group_by: Type.Optional(Type.String()),
        location_id: Type.Optional(Id),
        variant_id: Type.Optional(Id),
      }),
      status: 202,
    },
    async (ctx, req) => {
      const { format, ...query } = req.body ?? {};
      return jobs.enqueueJob(ctx, 'report_export', { name: req.params.name, format: format ?? 'csv', query });
    },
  );
  r.get(
    '/jobs',
    { permission: 'tenant:read', tags: J, summary: 'Recent jobs, newest first', querystring: Type.Object({ kind: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }) },
    async (ctx, req) => ({ object: 'list', data: await jobs.listJobs(ctx, req.query) }),
  );
  r.get('/jobs/:id', { permission: 'tenant:read', tags: J, summary: 'A job with its status, progress and result', params: IdParams }, async (ctx, req) => jobs.getJob(ctx, req.params.id));
  r.get('/jobs/:id/download', { permission: 'tenant:read', tags: J, summary: 'Download the finished job’s file (409 until it has finished)', params: IdParams, raw: true }, async (ctx, req, reply) => {
    const job = await jobs.getJob(ctx, req.params.id);
    // Full exports hold every customer's details: only members who may change the shop download them.
    if (job.kind === 'tenant_export') assertCan(ctx.actor, 'tenant:write');
    const f = await jobs.jobFile(ctx, req.params.id);
    return reply.type(f.content_type).header('Cache-Control', 'private, no-store').header('Content-Disposition', `attachment; filename="${f.filename}"`).send(await files.readFile(ctx, f));
  });
}
