import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { exec, many, must, one } from '../sql.ts';
import { putFile } from '../files/index.ts';
import { toCsv } from '../reports/index.ts';
import { enqueueJob, type JobRow } from '../jobs/index.ts';
import { ENTITY_ORDER } from './spec.ts';
import { addPending, applyImport, createImport, importToApi, type Sheet } from './index.ts';
import { noPending } from './bookings.ts';
import { SOURCES, booqableSheets, checkBaseUrl, shelfSheets, snipeitSheets, type Source, type SourceSheets } from './sources.ts';

/**
 * A move from another system (FR-MIG-2): what it holds is read into one import per kind of record,
 * checked together (bookings may name products the same batch creates), and applied in one
 * transaction by a background job, customers and products first.
 */

export function batchToApi(b: any, imports: any[] = []) {
  return {
    id: b.id, object: 'import_batch', source: b.source, status: b.status, error: b.error ?? null, job_id: b.job_id ?? null,
    imports: imports.map(importToApi), applied_at: b.applied_at ?? null, created_at: b.created_at,
  };
}

async function importsOf(ctx: Ctx, batchId: string) {
  const rows = await many<any>(ctx, `SELECT * FROM imports WHERE batch_id = $1`, [batchId]);
  return rows.sort((a, b) => ENTITY_ORDER.indexOf(a.entity) - ENTITY_ORDER.indexOf(b.entity));
}

export async function getBatch(ctx: Ctx, id: string) {
  const b = await must<any>(ctx, `SELECT * FROM import_batches WHERE id = $1`, [id], 'import_batch', id);
  return batchToApi(b, await importsOf(ctx, id));
}

export async function listBatches(ctx: Ctx, limit = 20) {
  const rows = await many<any>(ctx, `SELECT * FROM import_batches ORDER BY created_at DESC LIMIT $1`, [Math.min(limit, 100)]);
  return rows.map((b) => batchToApi(b));
}

async function locationNames(ctx: Ctx) {
  return (await many<{ name: string }>(ctx, `SELECT name FROM locations WHERE deleted_at IS NULL`)).map((l) => l.name);
}

/** Turns a source's sheets into the batch's imports, each checked with what the earlier ones create. */
async function addImports(ctx: Ctx, batchId: string, source: Source, sheets: SourceSheets) {
  const pending = noPending();
  for (const entity of ENTITY_ORDER) {
    const sheet = sheets[entity];
    if (!sheet?.rows.length) continue;
    const csv = toCsv(sheet.rows.map((r) => Object.fromEntries(sheet.headers.map((h, i) => [h, r[i] ?? '']))));
    const filename = `${source}-${entity}.csv`;
    const f = await putFile(ctx, { kind: 'import', filename, contentType: 'text/csv; charset=utf-8', body: Buffer.from(csv, 'utf8') });
    const { analysis } = await createImport(ctx, { entity, filename, fileId: f.id, sheet, source, batchId, pending });
    addPending(pending, analysis);
  }
  const n = await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM imports WHERE batch_id = $1`, [batchId]);
  await exec(ctx, `UPDATE import_batches SET status = $2, error = $3 WHERE id = $1`, [batchId, n?.n ? 'validated' : 'failed', n?.n ? null : t('imports.source_empty')]);
}

/** Shelf.nu: its CSV export, read at once. */
export async function createShelfBatch(ctx: Ctx, sheet: Sheet) {
  const id = newId('imb');
  await exec(ctx, `INSERT INTO import_batches (id, tenant_id, source, status, created_by) VALUES ($1,$2,'shelf','fetching',$3)`, [id, ctx.tenantId, ctx.actor.type === 'user' ? ctx.actor.id : null]);
  await addImports(ctx, id, 'shelf', shelfSheets(sheet, await locationNames(ctx)));
  await audit(ctx, { entity_type: 'import_batch', entity_id: id, action: 'create', extra: { source: 'shelf' } });
  return getBatch(ctx, id);
}

/** Booqable or Snipe-IT: the credentials are checked here and the records read by a background job. */
export async function createRemoteBatch(ctx: Ctx, input: { source: string; company?: string; base_url?: string; api_key?: string }) {
  const errors = [];
  const required = (field: string) => errors.push({ field, code: 'required', message: t('imports.required') });
  if (!(SOURCES as readonly string[]).includes(input.source) || input.source === 'shelf') errors.push({ field: 'source', code: 'invalid', message: t('imports.invalid_choice', { choices: 'booqable, snipeit' }) });
  if (!input.api_key?.trim()) required('api_key');
  let baseUrl: string | null = null;
  if (input.source === 'booqable') {
    if (input.base_url) baseUrl = checkBaseUrl(input.base_url);
    else if (!input.company?.trim()) required('company');
    else if (!/^[a-z0-9-]{1,63}$/i.test(input.company.trim())) errors.push({ field: 'company', code: 'invalid', message: t('imports.invalid_company') });
  }
  if (input.source === 'snipeit') {
    if (!input.base_url?.trim()) required('base_url');
    else baseUrl = checkBaseUrl(input.base_url.trim());
  }
  if (errors.length) throw invalid(t('imports.source_invalid'), errors);
  const id = newId('imb');
  await exec(ctx, `INSERT INTO import_batches (id, tenant_id, source, status, created_by) VALUES ($1,$2,$3,'fetching',$4)`, [id, ctx.tenantId, input.source, ctx.actor.type === 'user' ? ctx.actor.id : null]);
  // The key is kept encrypted with the job and never shown again.
  const job = await enqueueJob(ctx, 'import_fetch', { batch_id: id, source: input.source, company: input.company?.trim() || null, base_url: baseUrl, token: ctx.secrets.encrypt(input.api_key!.trim()) });
  await exec(ctx, `UPDATE import_batches SET job_id = $2 WHERE id = $1`, [id, job.id]);
  await audit(ctx, { entity_type: 'import_batch', entity_id: id, action: 'create', extra: { source: input.source, base_url: baseUrl, company: input.company ?? null } });
  return getBatch(ctx, id);
}

/** Worker: reads the other system into the batch's imports. */
export async function fetchBatch(ctx: Ctx, job: JobRow) {
  const p = job.params as { batch_id: string; source: Source; company: string | null; base_url: string | null; token: string };
  const token = ctx.secrets.decrypt(p.token);
  const sheets = p.source === 'booqable'
    ? await booqableSheets({ company: p.company ?? undefined, baseUrl: p.base_url ?? undefined, apiKey: token })
    : await snipeitSheets({ baseUrl: p.base_url!, token }, await locationNames(ctx));
  await addImports(ctx, p.batch_id, p.source, sheets);
}

/** Starts applying a checked batch in the background. */
export async function applyBatchLater(ctx: Ctx, id: string) {
  const b = await must<any>(ctx, `SELECT * FROM import_batches WHERE id = $1 FOR UPDATE`, [id], 'import_batch', id);
  if (b.status === 'applied') throw new AppError('import_applied', 409, t('imports.already_applied'));
  if (b.status === 'fetching' || b.status === 'applying') throw new AppError('import_busy', 409, t('imports.batch_busy'));
  const imports = await importsOf(ctx, id);
  if (!imports.length) throw new AppError('import_empty', 409, t('imports.source_empty'));
  const job = await enqueueJob(ctx, 'import_apply', { batch_id: id });
  await exec(ctx, `UPDATE import_batches SET status = 'applying', error = NULL, job_id = $2 WHERE id = $1`, [id, job.id]);
  return getBatch(ctx, id);
}

/** Worker: applies every import of the batch in order, in the job's one transaction. */
export async function applyBatch(ctx: Ctx, job: JobRow, read: (fileId: string) => Promise<Sheet>) {
  const id = job.params.batch_id as string;
  const counts: Record<string, unknown> = {};
  for (const imp of await importsOf(ctx, id)) {
    if (imp.status === 'applied') continue;
    const done = await applyImport(ctx, imp.id, await read(imp.file_id), { quiet: true });
    counts[imp.entity] = done.report?.counts ?? null;
  }
  await exec(ctx, `UPDATE import_batches SET status = 'applied', applied_at = now(), error = NULL WHERE id = $1`, [id]);
  const b = await getBatch(ctx, id);
  await audit(ctx, { entity_type: 'import_batch', entity_id: id, action: 'apply', extra: { counts } });
  await emit(ctx, 'import.completed', { type: 'import_batch', id }, { ...b, imports: b.imports.map((i) => ({ id: i.id, entity: i.entity, counts: i.report?.counts ?? null })), counts });
}

/** Worker, when reading or applying failed: the reason shows on the batch. */
export async function batchFailed(ctx: Ctx, job: JobRow, error: string) {
  const id = job.params.batch_id as string | undefined;
  if (!id) return;
  // An apply that failed leaves the checked imports as they were: it can be tried again.
  const status = job.kind === 'import_apply' ? 'validated' : 'failed';
  await exec(ctx, `UPDATE import_batches SET status = $2, error = $3 WHERE id = $1`, [id, status, error.slice(0, 1000)]);
}
