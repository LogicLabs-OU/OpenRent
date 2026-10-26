import type { Ctx } from '../context.ts';
import { AppError, invalid, notFound } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, must, one } from '../sql.ts';
import { deleteFile, getFile, readFile, setOwner, fileToApi, type FileRow } from '../files/index.ts';

/**
 * Files attached to an order, a customer or a unit (FR-OR-13): contracts, delivery notes, ID scans,
 * insurance certificates. Upload first (POST /files?purpose=attachment), then attach.
 */
export type OwnerType = 'order' | 'customer' | 'stock_item';
export type Visibility = 'internal' | 'customer';
export type AttachmentKind = 'attachment' | 'insurance' | 'id_document';

const OWNER_TABLE: Record<OwnerType, string> = { order: 'orders', customer: 'customers', stock_item: 'stock_items' };

/** Content types staff may attach: documents, images, spreadsheets and plain text. */
export const ATTACHMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
];

interface Row {
  id: string;
  owner_type: OwnerType;
  owner_id: string;
  file_id: string;
  label: string;
  visibility: Visibility;
  kind: AttachmentKind;
  created_by: string | null;
  created_at: string;
}

const SELECT = `SELECT a.*, f.filename, f.content_type, f.size FROM attachments a JOIN files f ON f.id = a.file_id`;

export function attachmentToApi(a: Row & { filename: string; content_type: string; size: number }) {
  return {
    id: a.id, object: 'attachment', owner_type: a.owner_type, owner_id: a.owner_id, file_id: a.file_id, label: a.label || a.filename, filename: a.filename,
    content_type: a.content_type, size: a.size, visibility: a.visibility, kind: a.kind, created_by: a.created_by, created_at: a.created_at,
  };
}

async function assertOwner(ctx: Ctx, ownerType: OwnerType, ownerId: string) {
  await must(ctx, `SELECT id FROM ${OWNER_TABLE[ownerType]} WHERE id = $1`, [ownerId], ownerType, ownerId);
}

export async function listAttachments(ctx: Ctx, ownerType: OwnerType, ownerId: string) {
  await assertOwner(ctx, ownerType, ownerId);
  return (await many<any>(ctx, `${SELECT} WHERE a.owner_type = $1 AND a.owner_id = $2 ORDER BY a.created_at`, [ownerType, ownerId])).map(attachmentToApi);
}

export async function addAttachment(ctx: Ctx, ownerType: OwnerType, ownerId: string, input: { file_id: string; label?: string; visibility?: Visibility; kind?: AttachmentKind }) {
  await assertOwner(ctx, ownerType, ownerId);
  const f = await getFile(ctx, input.file_id);
  if (f.kind !== 'attachment') throw invalid(msg('attachments.not_an_attachment'), [{ field: 'file_id', code: 'not_attachment', message: msg('attachments.not_an_attachment') }]);
  if (f.owner_type && !(f.owner_type === ownerType && f.owner_id === ownerId)) throw new AppError('file_in_use', 409, msg('images.in_use'));
  const id = newId('att');
  await exec(ctx, `INSERT INTO attachments (id, tenant_id, owner_type, owner_id, file_id, label, visibility, kind, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    id, ctx.tenantId, ownerType, ownerId, f.id, (input.label ?? '').trim().slice(0, 200), input.visibility ?? 'internal', input.kind ?? 'attachment', ctx.actor.id,
  ]);
  await setOwner(ctx, f.id, ownerType, ownerId);
  const api = attachmentToApi((await one<any>(ctx, `${SELECT} WHERE a.id = $1`, [id]))!);
  await audit(ctx, { entity_type: ownerType, entity_id: ownerId, action: 'add_attachment', after: api });
  await emit(ctx, 'attachment.created', { type: ownerType, id: ownerId }, api);
  return api;
}

async function attachmentRow(ctx: Ctx, ownerType: OwnerType, ownerId: string, id: string) {
  const a = await one<any>(ctx, `${SELECT} WHERE a.id = $1 AND a.owner_type = $2 AND a.owner_id = $3`, [id, ownerType, ownerId]);
  if (!a) throw notFound('attachment', id);
  return a;
}

export async function updateAttachment(ctx: Ctx, ownerType: OwnerType, ownerId: string, id: string, patch: { label?: string; visibility?: Visibility; kind?: AttachmentKind }) {
  const before = await attachmentRow(ctx, ownerType, ownerId, id);
  await exec(ctx, `UPDATE attachments SET label = coalesce($2, label), visibility = coalesce($3, visibility), kind = coalesce($4, kind) WHERE id = $1`, [
    id, patch.label === undefined ? null : patch.label.trim().slice(0, 200), patch.visibility ?? null, patch.kind ?? null,
  ]);
  const api = attachmentToApi(await attachmentRow(ctx, ownerType, ownerId, id));
  await audit(ctx, { entity_type: ownerType, entity_id: ownerId, action: 'update_attachment', before: attachmentToApi(before), after: api });
  return api;
}

export async function removeAttachment(ctx: Ctx, ownerType: OwnerType, ownerId: string, id: string) {
  const a = await attachmentRow(ctx, ownerType, ownerId, id);
  // The file goes too; the row follows by cascade.
  await deleteFile(ctx, a.file_id);
  await audit(ctx, { entity_type: ownerType, entity_id: ownerId, action: 'remove_attachment', before: attachmentToApi(a) });
  await emit(ctx, 'attachment.deleted', { type: ownerType, id: ownerId }, attachmentToApi(a));
}

/** Customer-visible attachments of these orders, for the account and the order page. */
export async function customerAttachments(ctx: Ctx, orderIds: string[]) {
  if (!orderIds.length) return [];
  return (await many<any>(ctx, `${SELECT} WHERE a.owner_type = 'order' AND a.owner_id = ANY($1) AND a.visibility = 'customer' ORDER BY a.created_at`, [orderIds])).map((a) => ({
    id: a.id, order_id: a.owner_id, label: a.label || a.filename, filename: a.filename, content_type: a.content_type, size: a.size,
  }));
}

/** The file of a customer-visible attachment on one of `orderIds`, for download. */
export async function customerAttachmentFile(ctx: Ctx, id: string, orderIds: string[]): Promise<{ file: FileRow; body: Buffer }> {
  const a = orderIds.length ? await one<any>(ctx, `SELECT file_id FROM attachments WHERE id = $1 AND owner_type = 'order' AND owner_id = ANY($2) AND visibility = 'customer'`, [id, orderIds]) : null;
  if (!a) throw notFound('attachment', id);
  const file = await getFile(ctx, a.file_id);
  return { file, body: await readFile(ctx, file) };
}

/** Staff download of any attachment. */
export async function attachmentFile(ctx: Ctx, ownerType: OwnerType, ownerId: string, id: string) {
  const a = await attachmentRow(ctx, ownerType, ownerId, id);
  const file = await getFile(ctx, a.file_id);
  return { file, body: await readFile(ctx, file), api: fileToApi(file) };
}

/** Removes a customer's own attachments (ID scans, certificates) when the customer is anonymised. */
export async function removeCustomerAttachments(ctx: Ctx, customerId: string) {
  const rows = await many<{ file_id: string }>(ctx, `SELECT file_id FROM attachments WHERE owner_type = 'customer' AND owner_id = $1`, [customerId]);
  for (const r of rows) await deleteFile(ctx, r.file_id);
  return rows.length;
}
