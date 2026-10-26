import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { emit } from '../events.ts';
import { makeCrud } from '../crud.ts';
import { exec, many, must, one } from '../sql.ts';
import { zonedParts, zonedTimeToUtc } from '../time.ts';
import { enqueueJob, type JobRow } from '../jobs/index.ts';
import { queue } from '../notifications/index.ts';
import type { FileRow } from '../files/index.ts';
import { RANGES, REPORTS, resolveRange, runReport, type ReportQuery, type ReportRange } from './index.ts';

/**
 * Saved reports (FR-REP-4): a report with its filters under a name. With a schedule the worker builds
 * it through the report export job and emails the file to the recipients; staff can also send it now.
 */

export const SCHEDULES = ['daily', 'weekly', 'monthly'] as const;
export type Schedule = (typeof SCHEDULES)[number];
/** Scheduled reports go out at this local hour, so they cover whole days. */
const SEND_HOUR = 7;
const MAX_RECIPIENTS = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARAM_KEYS = ['range', 'from', 'to', 'group_by', 'location_id', 'variant_id'] as const;

export function savedReportToApi(r: any) {
  return {
    id: r.id, object: 'saved_report', name: r.name, report: r.report, params: r.params ?? {}, format: r.format, schedule: r.schedule ?? null,
    recipients: r.recipients ?? [], next_run_at: r.next_run_at ?? null, last_run_at: r.last_run_at ?? null, last_error: r.last_error ?? null,
    created_by: r.created_by ?? null, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** The next send time after `now`: 07:00 shop time each day, each Monday or on the 1st. */
export function nextRunAt(schedule: Schedule, now: Date, zone: string): Date {
  const p = zonedParts(now, zone);
  const at = (day: number, month = p.month, year = p.year) => zonedTimeToUtc(year, month, day, SEND_HOUR, 0, zone);
  if (schedule === 'daily') {
    const today = at(p.day);
    return today > now ? today : at(p.day + 1);
  }
  if (schedule === 'weekly') {
    const ahead = (8 - p.weekday) % 7; // days until Monday
    const monday = at(p.day + ahead);
    return monday > now ? monday : at(p.day + ahead + 7);
  }
  const first = at(1);
  return first > now ? first : p.month === 12 ? at(1, 1, p.year + 1) : at(1, p.month + 1);
}

async function shopZone(ctx: Ctx) {
  return (await must<{ timezone: string }>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).timezone;
}

function cleanParams(p: Record<string, unknown> | null | undefined): ReportQuery {
  const out: Record<string, string> = {};
  for (const k of PARAM_KEYS) if (typeof p?.[k] === 'string' && p[k]) out[k] = p[k] as string;
  return out;
}

/** Checks the whole saved report; filters are checked by running the report once (errors under `params.`). */
async function check(ctx: Ctx, r: Record<string, any>) {
  const errors: FieldError[] = [];
  if (!String(r.name ?? '').trim()) errors.push({ field: 'name', code: 'required', message: msg('saved_report.name_required') });
  if (!(REPORTS as readonly string[]).includes(r.report)) errors.push({ field: 'report', code: 'invalid', message: msg('error.unknown_report_available', { name: String(r.report), join: REPORTS.join(', ') }) });
  if (r.schedule != null && !(SCHEDULES as readonly string[]).includes(r.schedule)) errors.push({ field: 'schedule', code: 'invalid', message: msg('saved_report.schedule_invalid') });
  const recipients: unknown[] = Array.isArray(r.recipients) ? r.recipients : [];
  const bad = recipients.findIndex((e) => typeof e !== 'string' || !EMAIL.test(e));
  if (bad >= 0) errors.push({ field: 'recipients', code: 'invalid', message: msg('saved_report.recipient_invalid', { email: String(recipients[bad]) }) });
  else if (recipients.length > MAX_RECIPIENTS) errors.push({ field: 'recipients', code: 'too_many', message: msg('saved_report.too_many_recipients', { max: MAX_RECIPIENTS }) });
  else if (r.schedule && !recipients.length) errors.push({ field: 'recipients', code: 'required', message: msg('saved_report.recipients_required') });
  // A schedule with fixed dates would send the same days every time.
  if (r.schedule && !r.params?.range) errors.push({ field: 'params.range', code: 'required', message: msg('saved_report.range_required') });
  if (!errors.some((e) => e.field === 'report')) {
    try {
      await runReport(ctx, r.report, r.params);
    } catch (e) {
      if (e instanceof AppError && e.code === 'not_found' && r.params?.location_id) errors.push({ field: 'params.location_id', code: 'not_found', message: e.message });
      else if (!(e instanceof AppError) || e.status !== 422) throw e;
      else if (e.errors?.length) errors.push(...e.errors.map((f) => ({ ...f, field: `params.${f.field}` })));
      else errors.push({ field: 'params', code: 'invalid', message: e.message });
    }
  }
  if (errors.length) throw invalid(msg('saved_report.invalid'), errors);
}

export const savedReports = makeCrud({
  table: 'saved_reports',
  prefix: 'svr',
  entity: 'saved_report',
  event: 'saved_report',
  columns: { name: {}, report: {}, params: { json: true }, format: {}, schedule: {}, recipients: { json: true }, next_run_at: {}, created_by: {} },
  list: { filters: { report: 'report', schedule: 'schedule' }, sorts: { name: 'name', created_at: 'created_at' }, defaultSort: 'name', search: ['name'] },
  defaults: (ctx) => ({ format: 'csv', params: {}, recipients: [], schedule: null, created_by: ctx.actor.type === 'user' ? ctx.actor.id : null }),
  toApi: savedReportToApi,
  beforeWrite: async (ctx, data, existing) => {
    if ('name' in data && typeof data.name === 'string') data.name = data.name.trim().slice(0, 200);
    if ('params' in data) data.params = cleanParams(data.params);
    if ('recipients' in data && Array.isArray(data.recipients)) data.recipients = [...new Set(data.recipients.map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean))];
    const merged = { ...(existing ?? {}), ...data };
    await check(ctx, merged);
    if (!existing || 'schedule' in data) data.next_run_at = merged.schedule ? nextRunAt(merged.schedule, ctx.now, await shopZone(ctx)) : null;
  },
});

function exportParams(r: any, recipients: string[]) {
  return { name: r.report, format: r.format, query: cleanParams(r.params), saved_report_id: r.id, recipients };
}

/** Builds the report now and emails it to its recipients, or to the address given (`POST /saved_reports/{id}/actions/send`). */
export async function sendNow(ctx: Ctx, id: string, to?: string[]) {
  const r = await savedReports.getRow(ctx, id);
  const recipients = to?.length ? to.map((e) => e.trim().toLowerCase()) : (r.recipients as string[]);
  const bad = recipients.find((e) => !EMAIL.test(e));
  if (bad) throw invalid(msg('saved_report.invalid'), [{ field: 'recipients', code: 'invalid', message: msg('saved_report.recipient_invalid', { email: bad }) }]);
  if (!recipients.length) throw invalid(msg('saved_report.invalid'), [{ field: 'recipients', code: 'required', message: msg('saved_report.recipients_required') }]);
  if (recipients.length > MAX_RECIPIENTS) throw invalid(msg('saved_report.invalid'), [{ field: 'recipients', code: 'too_many', message: msg('saved_report.too_many_recipients', { max: MAX_RECIPIENTS }) }]);
  return enqueueJob(ctx, 'report_export', exportParams(r, recipients));
}

/** Worker: queues the export of every scheduled report that is due and moves it to its next time. */
export async function queueDueReports(ctx: Ctx) {
  const due = await many<any>(ctx, `SELECT * FROM saved_reports WHERE schedule IS NOT NULL AND next_run_at <= $1 ORDER BY next_run_at LIMIT 50 FOR UPDATE SKIP LOCKED`, [ctx.now]);
  if (!due.length) return 0;
  const zone = await shopZone(ctx);
  for (const r of due) {
    await enqueueJob(ctx, 'report_export', exportParams(r, r.recipients ?? []));
    await exec(ctx, `UPDATE saved_reports SET last_run_at = $2, next_run_at = $3 WHERE id = $1`, [r.id, ctx.now, nextRunAt(r.schedule, ctx.now, zone)]);
  }
  return due.length;
}

/** Worker, once the export job has its file: one email per recipient with the file attached. */
export async function deliverSavedReport(ctx: Ctx, job: JobRow, file: FileRow) {
  const id = job.params.saved_report_id as string | undefined;
  if (!id) return;
  const r = await one<any>(ctx, `SELECT * FROM saved_reports WHERE id = $1`, [id]);
  if (!r) return;
  const q = (job.params.query ?? {}) as ReportQuery;
  const span = q.range && (RANGES as readonly string[]).includes(q.range) ? resolveRange(q.range as ReportRange, ctx.now, await shopZone(ctx)) : null;
  const from = span?.from ?? (q.from ? new Date(q.from) : null);
  const to = span?.to ?? (q.to ? new Date(q.to) : null);
  const recipients = (job.params.recipients ?? r.recipients ?? []) as string[];
  const url = `${ctx.config.adminUrl.replace(/\/$/, '')}/reports?saved=${r.id}`;
  for (const email of recipients) {
    await queue(ctx, {
      template: 'scheduled_report', to: email, audience: 'staff', attachments: [file.id],
      data: { name: r.name, from: from?.toISOString() ?? null, until: to ? new Date(to.getTime() - 1).toISOString() : null, filename: file.filename, url },
    });
  }
  await exec(ctx, `UPDATE saved_reports SET last_error = NULL WHERE id = $1`, [r.id]);
  await emit(ctx, 'saved_report.sent', { type: 'saved_report', id: r.id }, { ...savedReportToApi(r), last_error: null, job_id: job.id, file_id: file.id, sent_to: recipients });
}

/** Worker, when the export failed: the error shows on the saved report. */
export async function savedReportFailed(ctx: Ctx, job: JobRow, error: string) {
  const id = job.params.saved_report_id as string | undefined;
  if (id) await exec(ctx, `UPDATE saved_reports SET last_error = $2 WHERE id = $1`, [id, error.slice(0, 1000)]);
}
