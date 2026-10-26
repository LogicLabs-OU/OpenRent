import type { Ctx } from '../context.ts';
import { AppError, invalid, notFound } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, json, many, one } from '../sql.ts';
import { getFile, type FileRow } from '../files/index.ts';
import { REPORTS } from '../reports/index.ts';

/**
 * Background work started from the admin or the API (FR-MIG-1, FR-REP-2). The worker runs queued jobs
 * (see apps/worker) and stores the result as a file; members download it from GET /jobs/{id}/download.
 */
export const JOB_KINDS = ['tenant_export', 'report_export', 'import_fetch', 'import_apply'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** A running job that has not finished in this long is tried again (the worker probably stopped). */
export const STALE_MINUTES = 60;
export const MAX_ATTEMPTS = 3;

export interface JobRow {
  id: string;
  tenant_id: string;
  kind: JobKind;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  params: Record<string, any>;
  result_file_id: string | null;
  error: string | null;
  attempts: number;
  created_by: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

export function jobToApi(j: JobRow, file?: FileRow | null) {
  return {
    id: j.id,
    object: 'job',
    kind: j.kind,
    status: j.status,
    progress: j.progress,
    // Credentials a job carries (encrypted) never leave the server.
    params: Object.fromEntries(Object.entries(j.params ?? {}).filter(([k]) => k !== 'token')),
    error: j.error,
    result: file ? { file_id: file.id, filename: file.filename, size: file.size, content_type: file.content_type } : null,
    created_at: j.created_at,
    started_at: j.started_at,
    finished_at: j.finished_at,
  };
}

export async function enqueueJob(ctx: Ctx, kind: JobKind, params: Record<string, unknown> = {}) {
  if (kind === 'report_export') {
    if (!(REPORTS as readonly string[]).includes(String(params.name))) throw invalid(msg('error.unknown_report_available', { name: String(params.name), join: REPORTS.join(', ') }));
    if (!['csv', 'xlsx'].includes(String(params.format ?? 'csv'))) throw invalid(msg('jobs.invalid_format'), [{ field: 'format', code: 'invalid', message: msg('jobs.invalid_format') }]);
  }
  // One full export at a time per shop: a second request returns the one in progress.
  if (kind === 'tenant_export') {
    const open = await one<JobRow>(ctx, `SELECT * FROM jobs WHERE kind = 'tenant_export' AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`);
    if (open) return jobToApi(open);
  }
  const row = (await many<JobRow>(ctx, `INSERT INTO jobs (id, tenant_id, kind, params, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [newId('job'), ctx.tenantId, kind, json(params), ctx.actor.type === 'user' ? ctx.actor.id : null]))[0]!;
  await audit(ctx, { entity_type: 'job', entity_id: row.id, action: 'create', extra: { kind, params } });
  await ctx.db.query(`SELECT pg_notify('openrent_jobs', $1)`, [row.id]);
  return jobToApi(row);
}

export async function getJob(ctx: Ctx, id: string) {
  const row = await one<JobRow>(ctx, `SELECT * FROM jobs WHERE id = $1`, [id]);
  if (!row) throw notFound('job', id);
  const file = row.result_file_id ? await getFile(ctx, row.result_file_id).catch(() => null) : null;
  return jobToApi(row, file);
}

export async function listJobs(ctx: Ctx, q: { kind?: string; limit?: number } = {}) {
  const rows = await many<JobRow>(ctx, `SELECT * FROM jobs WHERE ($1::text IS NULL OR kind = $1) ORDER BY created_at DESC LIMIT $2`, [q.kind ?? null, Math.min(q.limit ?? 20, 100)]);
  return rows.map((r) => jobToApi(r));
}

/** The finished job's file, for download. */
export async function jobFile(ctx: Ctx, id: string): Promise<FileRow> {
  const row = await one<JobRow>(ctx, `SELECT * FROM jobs WHERE id = $1`, [id]);
  if (!row) throw notFound('job', id);
  if (row.status !== 'succeeded' || !row.result_file_id) throw new AppError('job_not_finished', 409, msg('jobs.not_finished'));
  return getFile(ctx, row.result_file_id);
}

// --- Worker side ---------------------------------------------------------------

/**
 * Claims queued jobs (system access, committed at once so other workers skip them). Jobs left running
 * by a stopped worker go back to the queue, or fail after MAX_ATTEMPTS.
 */
export async function claimJobs(db: Ctx['db'], limit: number): Promise<JobRow[]> {
  await db.query(
    `UPDATE jobs SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'queued' END,
            error = CASE WHEN attempts >= $1 THEN $3 ELSE error END, finished_at = CASE WHEN attempts >= $1 THEN now() ELSE NULL END
      WHERE status = 'running' AND started_at < now() - make_interval(mins => $2)`,
    [MAX_ATTEMPTS, STALE_MINUTES, msg('jobs.worker_stopped')],
  );
  const r = await db.query<JobRow>(
    `UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1, progress = 0, error = NULL
      WHERE id IN (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`,
    [limit],
  );
  return r.rows;
}

/** Records the result in the job's tenant transaction, so the file and the status commit together. Imports make no file. */
export async function finishJob(ctx: Ctx, job: JobRow, file: FileRow | null) {
  await exec(ctx, `UPDATE jobs SET status = 'succeeded', progress = 100, result_file_id = $2, finished_at = now() WHERE id = $1`, [job.id, file?.id ?? null]);
  if (!file) return;
  const done = (await one<JobRow>(ctx, `SELECT * FROM jobs WHERE id = $1`, [job.id]))!;
  await emit(ctx, job.kind === 'tenant_export' ? 'export.completed' : 'report_export.completed', { type: 'job', id: job.id }, jobToApi(done, file));
  if (job.created_by) {
    await exec(ctx, `INSERT INTO staff_notifications (id, tenant_id, user_id, kind, params, entity_type, entity_id) VALUES ($1,$2,$3,'staff_export_ready',$4,'job',$5)`, [
      newId('stn'), ctx.tenantId, job.created_by, json({ filename: file.filename }), job.id,
    ]);
  }
}

export async function failJob(ctx: Ctx, job: JobRow, error: string) {
  await exec(ctx, `UPDATE jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [job.id, error.slice(0, 1000)]);
}

/** Best effort: progress is written in its own transaction and never blocks the job. */
export async function setProgress(ctx: Ctx, jobId: string, progress: number) {
  await exec(ctx, `UPDATE jobs SET progress = $2 WHERE id = $1 AND status = 'running'`, [jobId, Math.max(0, Math.min(99, Math.round(progress)))]);
}
