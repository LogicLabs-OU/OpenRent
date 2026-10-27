import type { Ctx } from '../context.ts';
import { AppError, conflict } from '../errors.ts';
import { newId, sha256 } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { exec, many, one } from '../sql.ts';
import { audit, emit } from '../events.ts';
import { assertWithinLimit } from '../tenancy/operator.ts';
import { pluginConfig } from '../plugins/index.ts';

export interface FileRow {
  id: string;
  kind: string;
  owner_type: string | null;
  owner_id: string | null;
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  storage: string;
  key: string | null;
  created_at: Date;
}

const META = `id, kind, owner_type, owner_id, filename, content_type, size, sha256, width, height, storage, key, created_at`;

export function fileToApi(f: FileRow) {
  return { id: f.id, object: 'file', kind: f.kind, owner_type: f.owner_type, owner_id: f.owner_id, filename: f.filename, content_type: f.content_type, size: f.size, sha256: f.sha256, width: f.width, height: f.height, created_at: f.created_at };
}

/** The configured StorageProvider plugin, or null for the built-in database storage. */
async function external(ctx: Ctx) {
  const p = ctx.plugins.storageProvider();
  if (!p) return null;
  const pluginId = ctx.plugins.pluginIdOf(p.id) ?? p.id;
  const { enabled, config } = await pluginConfig(ctx, pluginId);
  const pctx = { tenantId: ctx.tenantId, config, logger: ctx.logger };
  return enabled && p.isConfigured(pctx) ? { p, pctx } : null;
}

export interface PutFileInput {
  kind: string;
  ownerType?: string | null;
  ownerId?: string | null;
  filename: string;
  contentType: string;
  body: Buffer;
  width?: number | null;
  height?: number | null;
}

/**
 * Removing stored bytes waits for the transaction: the worker runs `internal.file.purge` after commit,
 * so a rollback never leaves a row pointing at a deleted object.
 */
async function purgeLater(ctx: Ctx, f: Pick<FileRow, 'id' | 'storage' | 'key'>) {
  if (f.storage !== 'database' && f.key) await emit(ctx, 'internal.file.purge', { type: 'file', id: f.id }, { storage: f.storage, key: f.key });
}

/** Deletes stored bytes (worker, after commit). A missing object is fine. */
export async function purgeStored(ctx: Ctx, f: { storage: string; key: string }) {
  const ext = await external(ctx);
  if (!ext || ext.p.id !== f.storage) {
    ctx.logger.warn({ storage: f.storage, key: f.key }, 'file purge skipped: storage not configured');
    return;
  }
  await ext.p.delete(ext.pctx, f.key);
}

/** Stores a file. A document PDF is unique per document: storing it again replaces it. */
export async function putFile(ctx: Ctx, input: PutFileInput): Promise<FileRow> {
  await assertWithinLimit(ctx, 'storage', input.body.length);
  const id = newId('fil');
  const ext = await external(ctx);
  const replaced = input.kind === 'pdf' ? await one<FileRow>(ctx, `SELECT ${META} FROM files WHERE owner_type = $1 AND owner_id = $2 AND kind = 'pdf'`, [input.ownerType ?? null, input.ownerId ?? null]) : null;
  const key = ext ? `${ctx.tenantId}/${input.kind}/${id}/${input.filename}` : null;
  if (ext) await ext.p.put(ext.pctx, key!, input.body, input.contentType);
  const upsert =
    input.kind === 'pdf'
      ? `ON CONFLICT (tenant_id, owner_type, owner_id, kind) WHERE kind = 'pdf' DO UPDATE SET filename = EXCLUDED.filename, content_type = EXCLUDED.content_type,
           size = EXCLUDED.size, sha256 = EXCLUDED.sha256, storage = EXCLUDED.storage, key = EXCLUDED.key, data = EXCLUDED.data, created_at = now()`
      : '';
  const rows = await many<FileRow>(
    ctx,
    `INSERT INTO files (id, tenant_id, kind, owner_type, owner_id, filename, content_type, size, sha256, width, height, storage, key, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ${upsert}
     RETURNING ${META}`,
    [id, ctx.tenantId, input.kind, input.ownerType ?? null, input.ownerId ?? null, input.filename, input.contentType, input.body.length, sha256(input.body), input.width ?? null, input.height ?? null, ext ? ext.p.id : 'database', key, ext ? null : input.body],
  );
  if (replaced && replaced.key !== key) await purgeLater(ctx, replaced);
  return rows[0]!;
}

export async function findFile(ctx: Ctx, ownerType: string, ownerId: string, kind: string): Promise<FileRow | null> {
  return one<FileRow>(ctx, `SELECT ${META} FROM files WHERE owner_type = $1 AND owner_id = $2 AND kind = $3`, [ownerType, ownerId, kind]);
}

export async function getFile(ctx: Ctx, id: string): Promise<FileRow> {
  const f = await one<FileRow>(ctx, `SELECT ${META} FROM files WHERE id = $1`, [id]);
  if (!f) throw new AppError('not_found', 404, t('files.not_found'));
  return f;
}

export async function readFile(ctx: Ctx, f: FileRow): Promise<Buffer> {
  if (f.storage === 'database') {
    const row = await one<{ data: Buffer }>(ctx, `SELECT data FROM files WHERE id = $1`, [f.id]);
    if (!row) throw new AppError('not_found', 404, t('files.not_found'));
    return row.data;
  }
  const ext = await external(ctx);
  if (!ext || ext.p.id !== f.storage || !f.key) throw new AppError('storage_unavailable', 503, t('files.not_found'));
  return ext.p.get(ext.pctx, f.key);
}

/** Files derived from another file (image variants), keyed by kind. */
export async function derivedFiles(ctx: Ctx, fileId: string): Promise<FileRow[]> {
  return many<FileRow>(ctx, `SELECT ${META} FROM files WHERE owner_type = 'file' AND owner_id = $1`, [fileId]);
}

export async function setOwner(ctx: Ctx, fileId: string, ownerType: string, ownerId: string) {
  await many(ctx, `UPDATE files SET owner_type = $2, owner_id = $3 WHERE id = $1 RETURNING id`, [fileId, ownerType, ownerId]);
}

/** Deletes a file and its derived variants; stored bytes go once the transaction commits. */
export async function deleteFile(ctx: Ctx, fileId: string) {
  const all = [await one<FileRow>(ctx, `SELECT ${META} FROM files WHERE id = $1`, [fileId]), ...(await derivedFiles(ctx, fileId))].filter(Boolean) as FileRow[];
  await many(ctx, `DELETE FROM files WHERE id = ANY($1) RETURNING id`, [all.map((f) => f.id)]);
  for (const f of all) await purgeLater(ctx, f);
}

/**
 * Deletes an upload nothing uses yet (`DELETE /files/{id}`). Files of photos, documents and attachments
 * go with their owner, so deleting one of those directly is refused.
 */
export async function deleteUpload(ctx: Ctx, fileId: string) {
  const f = await getFile(ctx, fileId);
  if (f.owner_type) throw conflict('file_in_use', t('files.in_use'));
  await deleteFile(ctx, f.id);
  await audit(ctx, { entity_type: 'file', entity_id: f.id, action: 'delete', before: fileToApi(f) });
}

/**
 * Moves files kept in the database to the configured storage, `limit` at a time, and returns how many
 * moved. Each file is written before its row changes, so an interrupted run only leaves extra objects.
 */
export async function migrateToStorage(ctx: Ctx, limit = 50): Promise<number> {
  const ext = await external(ctx);
  if (!ext) return 0;
  const rows = await many<FileRow & { data: Buffer }>(ctx, `SELECT ${META}, data FROM files WHERE storage = 'database' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
  for (const f of rows) {
    const key = `${ctx.tenantId}/${f.kind}/${f.id}/${f.filename}`;
    await ext.p.put(ext.pctx, key, f.data, f.content_type);
    await exec(ctx, `UPDATE files SET storage = $2, key = $3, data = NULL WHERE id = $1`, [f.id, ext.p.id, key]);
  }
  return rows.length;
}

/** Checks a sample of stored files against the storage; returns the ids whose object is missing. */
export async function verifyStorage(ctx: Ctx, sample = 50): Promise<string[]> {
  const ext = await external(ctx);
  if (!ext?.p.head) return [];
  const rows = await many<FileRow>(ctx, `SELECT ${META} FROM files WHERE storage = $1 ORDER BY random() LIMIT $2`, [ext.p.id, sample]);
  const missing: string[] = [];
  for (const f of rows) if (f.key && !(await ext.p.head(ext.pctx, f.key))) missing.push(f.id);
  return missing;
}

/**
 * Restore support (openrent restore): whether a file's object is in the configured storage, and writing
 * it back under the same key from a backup copy.
 */
export async function storedObjectState(ctx: Ctx, f: FileRow): Promise<'database' | 'present' | 'missing' | 'unknown'> {
  if (f.storage === 'database') return 'database';
  const ext = await external(ctx);
  if (!ext || ext.p.id !== f.storage || !f.key) return 'missing';
  if (!ext.p.head) return 'unknown';
  return (await ext.p.head(ext.pctx, f.key)) ? 'present' : 'missing';
}

export async function writeStoredObject(ctx: Ctx, f: FileRow, body: Buffer) {
  const ext = await external(ctx);
  if (!ext || ext.p.id !== f.storage || !f.key) throw new AppError('storage_unavailable', 503, t('files.not_found'));
  if (sha256(body) !== f.sha256) throw new AppError('checksum_mismatch', 422, t('files.checksum_mismatch'));
  await ext.p.put(ext.pctx, f.key, body, f.content_type);
}

export async function findById(ctx: Ctx, id: string): Promise<FileRow | null> {
  return one<FileRow>(ctx, `SELECT ${META} FROM files WHERE id = $1`, [id]);
}

