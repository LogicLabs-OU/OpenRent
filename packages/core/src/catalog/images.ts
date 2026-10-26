import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { deleteFile, getFile, setOwner } from '../files/index.ts';

export type ImageVariant = 'sm' | 'lg' | 'original';

/** Public, cacheable URLs of an image file and its WebP variants. */
export function imageUrls(ctx: Pick<Ctx, 'config'>, fileId: string) {
  const base = `${ctx.config.publicUrl.replace(/\/$/, '')}/api/v1/public/files/${fileId}`;
  return { url: `${base}/lg`, url_sm: `${base}/sm`, url_original: `${base}/original` };
}

export function productImageToApi(ctx: Pick<Ctx, 'config'>, r: any) {
  return { id: r.id, object: 'product_image', file_id: r.file_id, position: r.position, alt: r.alt ?? {}, width: r.width ?? null, height: r.height ?? null, ...imageUrls(ctx, r.file_id) };
}

export async function imagesFor(ctx: Ctx, productIds: string[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>();
  if (!productIds.length) return out;
  const rows = await many(
    ctx,
    `SELECT pi.*, f.width, f.height FROM product_images pi JOIN files f ON f.id = pi.file_id WHERE pi.product_id = ANY($1) ORDER BY pi.position, pi.created_at`,
    [productIds],
  );
  for (const r of rows) out.set(r.product_id, [...(out.get(r.product_id) ?? []), productImageToApi(ctx, r)]);
  return out;
}

async function product(ctx: Ctx, productId: string) {
  return must<{ id: string }>(ctx, `SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL`, [productId], 'product', productId);
}

const cleanAlt = (alt: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(typeof alt === 'object' && alt ? (alt as Record<string, unknown>) : {}).filter(([k, v]) => /^[a-z]{2}(-[A-Z]{2})?$/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim().slice(0, 300)]));

/** Attaches an uploaded image (POST /files) to a product, at the end of its gallery. */
export async function addProductImage(ctx: Ctx, productId: string, input: { file_id: string; alt?: Record<string, string> }) {
  await product(ctx, productId);
  const f = await getFile(ctx, input.file_id);
  if (f.kind !== 'image') throw invalid(t('images.not_an_image'), [{ field: 'file_id', code: 'not_image', message: t('images.not_an_image') }]);
  if (f.owner_type && !(f.owner_type === 'product' && f.owner_id === productId)) throw new AppError('file_in_use', 409, t('images.in_use'));
  const pos = Number((await one<{ n: number }>(ctx, `SELECT coalesce(max(position) + 1, 0)::int AS n FROM product_images WHERE product_id = $1`, [productId]))?.n ?? 0);
  const row = (await many(ctx, `INSERT INTO product_images (id, tenant_id, product_id, file_id, position, alt) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [newId('pim'), ctx.tenantId, productId, f.id, pos, json(cleanAlt(input.alt))]))[0];
  await setOwner(ctx, f.id, 'product', productId);
  await exec(ctx, `UPDATE products SET updated_at = now() WHERE id = $1`, [productId]);
  await audit(ctx, { entity_type: 'product', entity_id: productId, action: 'add_image', extra: { image_id: row.id, file_id: f.id } });
  return productImageToApi(ctx, { ...row, width: f.width, height: f.height });
}

export async function updateProductImage(ctx: Ctx, productId: string, imageId: string, patch: { alt?: Record<string, string> }) {
  const row = (await many(ctx, `UPDATE product_images SET alt = coalesce($3, alt) WHERE id = $1 AND product_id = $2 RETURNING *`, [imageId, productId, patch.alt ? json(cleanAlt(patch.alt)) : null]))[0];
  if (!row) throw new AppError('not_found', 404, t('images.not_found'));
  await audit(ctx, { entity_type: 'product', entity_id: productId, action: 'update_image', extra: { image_id: imageId } });
  return productImageToApi(ctx, row);
}

export async function deleteProductImage(ctx: Ctx, productId: string, imageId: string) {
  const row = (await many<{ file_id: string }>(ctx, `DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING file_id`, [imageId, productId]))[0];
  if (!row) throw new AppError('not_found', 404, t('images.not_found'));
  await deleteFile(ctx, row.file_id);
  await audit(ctx, { entity_type: 'product', entity_id: productId, action: 'delete_image', extra: { image_id: imageId } });
}

/** Sets the gallery order; `ids` must list every image of the product exactly once. */
export async function reorderProductImages(ctx: Ctx, productId: string, ids: string[]) {
  await product(ctx, productId);
  const current = await many<{ id: string }>(ctx, `SELECT id FROM product_images WHERE product_id = $1`, [productId]);
  const known = new Set(current.map((r) => r.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw invalid(t('images.order_mismatch'), [{ field: 'ids', code: 'mismatch', message: t('images.order_mismatch') }]);
  }
  for (const [i, id] of ids.entries()) await exec(ctx, `UPDATE product_images SET position = $2 WHERE id = $1`, [id, i]);
  await audit(ctx, { entity_type: 'product', entity_id: productId, action: 'reorder_images' });
  return (await imagesFor(ctx, [productId])).get(productId) ?? [];
}
