import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, assertCan, attachments, can, catalog, files, serverT } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import type { Router } from '../http.ts';
import { Id, IdParams, Nullable, Type } from '../schemas.ts';
import { imageBytes, storeImage } from '../images.ts';
import { systemCtx } from '../context.ts';

export const MAX_UPLOAD_MB = 15;
const Purpose = Type.Union([Type.Literal('image'), Type.Literal('photo'), Type.Literal('import'), Type.Literal('attachment')]);
const Alt = Type.Record(Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }), Type.String({ maxLength: 300 }));
const VariantParams = Type.Object({ id: Id, variant: Type.Union([Type.Literal('sm'), Type.Literal('lg'), Type.Literal('original')]) });

/** Uploads and stored files (PRD §5.4 Files), and the product photo gallery. */
export function registerFiles(r: Router) {
  const F = ['Files'];
  r.post(
    '/files',
    {
      tags: F,
      summary: `Upload a file as multipart/form-data (field "file", up to ${MAX_UPLOAD_MB} MB). purpose=image for product photos, photo for inspection and unit photos, import for CSV/XLSX, attachment for documents on orders, customers and units`,
      querystring: Type.Object({ purpose: Purpose }),
      raw: true,
    },
    async (ctx, req, reply) => {
      const purpose = req.query.purpose as 'image' | 'photo' | 'import' | 'attachment';
      // Attachments go on orders, customers or units; staff who may change any of them may upload.
      if (purpose === 'attachment') {
        if (!(['orders:write', 'customers:write', 'inventory:write'] as const).some((p) => can(ctx.actor, p))) assertCan(ctx.actor, 'orders:write');
      } else assertCan(ctx.actor, purpose === 'photo' ? 'orders:fulfil' : 'catalog:write');
      const part = await req.file();
      if (!part) throw new AppError('validation_error', 422, serverT('files.no_file'), { errors: [{ field: 'file', code: 'required', message: serverT('files.no_file') }] });
      let body: Buffer;
      try {
        body = await part.toBuffer();
      } catch {
        throw new AppError('payload_too_large', 413, serverT('images.too_large', { mb: MAX_UPLOAD_MB }));
      }
      const filename = part.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'upload';
      if (purpose === 'attachment' && !attachments.ATTACHMENT_TYPES.includes(part.mimetype))
        throw new AppError('unsupported_media_type', 415, serverT('attachments.unsupported'));
      const f =
        purpose === 'import' || purpose === 'attachment'
          ? await files.putFile(ctx, { kind: purpose, filename, contentType: part.mimetype, body })
          : await storeImage(ctx, { kind: purpose, filename, body });
      return reply.status(201).send({ ...files.fileToApi(f), ...(purpose === 'import' || purpose === 'attachment' ? {} : catalog.imageUrls(ctx, f.id)) });
    },
  );
  r.get('/files/:id', { permission: 'catalog:read', tags: F, summary: 'File metadata', params: IdParams }, async (ctx, req) => files.fileToApi(await files.getFile(ctx, req.params.id)));
  r.get('/files/:id/content', { permission: 'catalog:read', tags: F, summary: 'Download a file (images accept ?variant=sm|lg)', params: IdParams, querystring: Type.Object({ variant: Type.Optional(Type.Union([Type.Literal('sm'), Type.Literal('lg'), Type.Literal('original')])) }), raw: true }, async (ctx, req, reply) => {
    // Data exports hold every customer's details: they download only through GET /jobs/{id}/download.
    if ((await files.getFile(ctx, req.params.id)).kind === 'export') throw new AppError('not_found', 404, serverT('files.not_found'));
    const { file, body } = await imageBytes(ctx, req.params.id, req.query.variant ?? 'original');
    return reply.type(file.content_type).header('Cache-Control', 'private, max-age=3600').header('Content-Disposition', `inline; filename="${file.filename}"`).send(body);
  });

  // Product photos are public once attached to a product: no session or shop header needed, so plain <img> tags work anywhere.
  r.get('/public/files/:id/:variant', { public: true, tx: 'none', tags: F, summary: 'Product photo (sm = 480 px, lg = 1600 px WebP, or the original)', params: VariantParams, raw: true }, async (_ctx, req, reply) => {
    const deps = r.deps;
    const owner = await withSystem(deps.db, (c) => c.query<{ tenant_id: string }>(`SELECT pi.tenant_id FROM product_images pi WHERE pi.file_id = $1 LIMIT 1`, [req.params.id]));
    const tenantId = owner.rows[0]?.tenant_id;
    if (!tenantId) throw new AppError('not_found', 404, serverT('images.not_found'));
    const { file, body } = await withTenant(deps.db, tenantId, (c) => imageBytes(systemCtx(deps, c, tenantId, req.log), req.params.id, req.params.variant));
    if (req.headers['if-none-match'] === `"${file.sha256}"`) return reply.status(304).send();
    return reply.type(file.content_type).header('Cache-Control', 'public, max-age=31536000, immutable').header('ETag', `"${file.sha256}"`).send(body);
  });

  // Files of child themes (FR-THM-8): public, and never changed once stored (a new version gets new ids).
  r.get('/public/theme_assets/:id/:name', { public: true, tx: 'none', tags: F, summary: 'An asset of a child theme', params: Type.Object({ id: Id, name: Type.String({ maxLength: 200 }) }), raw: true }, async (_ctx, req, reply) => {
    const deps = r.deps;
    const owner = await withSystem(deps.db, (c) => c.query<{ tenant_id: string }>(`SELECT tenant_id FROM files WHERE id = $1 AND kind = 'theme_asset'`, [req.params.id]));
    const tenantId = owner.rows[0]?.tenant_id;
    if (!tenantId) throw new AppError('not_found', 404, serverT('files.not_found'));
    const { file, body } = await withTenant(deps.db, tenantId, async (c) => {
      const ctx = systemCtx(deps, c, tenantId, req.log);
      const f = await files.getFile(ctx, req.params.id);
      return { file: f, body: await files.readFile(ctx, f) };
    });
    return reply.type(file.content_type).header('Cache-Control', 'public, max-age=31536000, immutable').header('Access-Control-Allow-Origin', '*').header('X-Content-Type-Options', 'nosniff').send(body);
  });

  // Preview images of code themes (the thumbnails on Admin → Themes), read from the theme's own folder.
  const PREVIEW_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  r.get(
    '/public/theme_previews/:theme/:index',
    { public: true, tx: 'none', tags: F, summary: 'A preview image of an installed code theme', params: Type.Object({ theme: Type.String({ maxLength: 100 }), index: Type.Integer({ minimum: 0, maximum: 20 }) }), raw: true },
    async (_ctx, req, reply) => {
      const theme = r.deps.themes.find((x) => x.manifest.id === req.params.theme);
      const rel = theme?.manifest.preview_images?.[req.params.index];
      const file = theme?.dir && rel ? path.resolve(theme.dir, rel) : null;
      const type = file ? PREVIEW_TYPES[path.extname(file).toLowerCase()] : undefined;
      // Only image files inside the theme's folder.
      if (!file || !type || !file.startsWith(path.resolve(theme!.dir!) + path.sep) || !existsSync(file)) throw new AppError('not_found', 404, serverT('files.not_found'));
      return reply.type(type).header('Cache-Control', 'public, max-age=3600').header('X-Content-Type-Options', 'nosniff').send(await readFile(file));
    },
  );

  const P = ['Products'];
  const ImageParams = Type.Object({ id: Id, image_id: Id });
  r.get('/products/:id/images', { permission: 'catalog:read', tags: P, summary: 'Product photos in display order', params: IdParams }, async (ctx, req) => ({
    object: 'list',
    data: (await catalog.imagesFor(ctx, [req.params.id])).get(req.params.id) ?? [],
  }));
  r.post('/products/:id/images', { permission: 'catalog:write', tags: P, summary: 'Add an uploaded image (POST /files?purpose=image) to the end of the gallery', params: IdParams, body: Type.Object({ file_id: Id, alt: Type.Optional(Alt) }) }, async (ctx, req) =>
    catalog.addProductImage(ctx, req.params.id, req.body),
  );
  r.patch('/products/:id/images/:image_id', { permission: 'catalog:write', tags: P, summary: 'Change alt text', params: ImageParams, body: Type.Object({ alt: Type.Optional(Nullable(Alt)) }) }, async (ctx, req) =>
    catalog.updateProductImage(ctx, req.params.id, req.params.image_id, { alt: req.body.alt ?? undefined }),
  );
  r.delete('/products/:id/images/:image_id', { permission: 'catalog:write', tags: P, summary: 'Remove a photo and its files', params: ImageParams }, async (ctx, req) => {
    await catalog.deleteProductImage(ctx, req.params.id, req.params.image_id);
  });
  r.put('/products/:id/images/order', { permission: 'catalog:write', tags: P, summary: 'Set the gallery order (every image id once)', params: IdParams, body: Type.Object({ ids: Type.Array(Id) }) }, async (ctx, req) => ({
    object: 'list',
    data: await catalog.reorderProductImages(ctx, req.params.id, req.body.ids),
  }));
}
