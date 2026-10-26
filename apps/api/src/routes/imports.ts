import { AppError, assertCan, files, imports, serverT, type Ctx } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Type } from '../schemas.ts';
import { readSheet, sendSheet } from '../spreadsheets.ts';

const Entity = Type.Union([Type.Literal('products'), Type.Literal('stock_items'), Type.Literal('prices'), Type.Literal('customers'), Type.Literal('orders')]);
const Mapping = Type.Record(Type.String({ maxLength: 200 }), Type.String({ maxLength: 60 }), { description: 'File column → OpenRent column; "" skips the column' });
const Format = Type.Union([Type.Literal('csv'), Type.Literal('xlsx')]);
const PERM = { products: 'catalog:write', stock_items: 'inventory:write', prices: 'pricing:write', customers: 'customers:write', orders: 'orders:write' } as const;

async function sheetOf(ctx: Ctx, fileId: string) {
  const f = await files.getFile(ctx, fileId);
  if (f.kind !== 'import') throw new AppError('validation_error', 422, serverT('imports.not_import_file'), { errors: [{ field: 'file_id', code: 'invalid', message: serverT('imports.not_import_file') }] });
  return { file: f, sheet: await readSheet(await files.readFile(ctx, f), f.filename) };
}

/** CSV/XLSX import with a dry run and a column mapping, moves from other systems, and exports in the same columns (FR-CAT-8, FR-MIG-2). */
export function registerImports(r: Router) {
  const I = ['Imports'];
  r.post(
    '/imports',
    {
      permission: 'catalog:read',
      tags: I,
      summary: 'Validate an uploaded CSV or XLSX file (POST /files?purpose=import) and return the dry-run report; nothing is changed yet. Without a mapping, the one saved for files with the same columns is used.',
      body: Type.Object({ entity: Entity, file_id: Id, mapping: Type.Optional(Mapping) }),
    },
    async (ctx, req) => {
      assertCan(ctx.actor, PERM[req.body.entity as keyof typeof PERM]);
      const { file, sheet } = await sheetOf(ctx, req.body.file_id);
      return (await imports.createImport(ctx, { entity: req.body.entity, filename: file.filename, fileId: file.id, sheet, mapping: req.body.mapping })).api;
    },
  );
  r.get('/imports/columns/:entity', { permission: 'catalog:read', tags: I, summary: 'The columns an import can fill, for mapping a file’s columns', params: Type.Object({ entity: Entity }) }, async (_ctx, req) => ({
    object: 'list',
    data: imports.columnsOf(req.params.entity),
  }));
  r.patch(
    '/imports/:id',
    { permission: 'catalog:read', tags: I, summary: 'Map the file’s columns and check it again; the mapping is kept for files with the same columns', params: IdParams, body: Type.Object({ mapping: Mapping }) },
    async (ctx, req) => {
      const rec = await imports.getImport(ctx, req.params.id);
      assertCan(ctx.actor, PERM[rec.entity as keyof typeof PERM]);
      if (!rec.file_id) throw new AppError('import_file_missing', 409, serverT('imports.file_missing'));
      const { sheet } = await sheetOf(ctx, rec.file_id);
      return imports.remapImport(ctx, rec.id, sheet, req.body.mapping);
    },
  );
  r.get('/imports', { permission: 'catalog:read', tags: I, summary: 'Recent imports' }, async (ctx) => ({ object: 'list', data: await imports.listImports(ctx) }));
  r.get('/imports/:id', { permission: 'catalog:read', tags: I, summary: 'One import with its report', params: IdParams }, async (ctx, req) => imports.getImport(ctx, req.params.id));
  r.post('/imports/:id/actions/apply', { permission: 'catalog:read', tags: I, summary: 'Apply a validated import in one transaction (re-validated first)', params: IdParams, status: 200 }, async (ctx, req) => {
    const rec = await imports.getImport(ctx, req.params.id);
    assertCan(ctx.actor, PERM[rec.entity as keyof typeof PERM]);
    if (!rec.file_id) throw new AppError('import_file_missing', 409, serverT('imports.file_missing'));
    const { sheet } = await sheetOf(ctx, rec.file_id);
    return imports.applyImport(ctx, rec.id, sheet);
  });
  // Moves from another system (FR-MIG-2): read, checked together, applied in one go in the background.
  const B = ['Imports'];
  r.post(
    '/import_batches',
    {
      permission: 'tenant:write', tags: B, status: 201,
      summary: 'Start a move from Shelf.nu (its CSV export as file_id), Booqable (company and API key) or Snipe-IT (base URL and API token). Booqable and Snipe-IT are read by a background job.',
      body: Type.Object({
        source: Type.Union([Type.Literal('shelf'), Type.Literal('booqable'), Type.Literal('snipeit')]),
        file_id: Type.Optional(Id),
        company: Type.Optional(Type.String({ maxLength: 63 })),
        base_url: Type.Optional(Type.String({ maxLength: 500 })),
        api_key: Type.Optional(Type.String({ maxLength: 500 })),
      }, { additionalProperties: false }),
    },
    async (ctx, req) => {
      if (req.body.source !== 'shelf') return imports.createRemoteBatch(ctx, req.body);
      if (!req.body.file_id) throw new AppError('validation_error', 422, serverT('imports.required'), { errors: [{ field: 'file_id', code: 'required', message: serverT('imports.required') }] });
      return imports.createShelfBatch(ctx, (await sheetOf(ctx, req.body.file_id)).sheet);
    },
  );
  r.get('/import_batches', { permission: 'tenant:write', tags: B, summary: 'Recent moves from other systems' }, async (ctx) => ({ object: 'list', data: await imports.listBatches(ctx) }));
  r.get('/import_batches/:id', { permission: 'tenant:write', tags: B, summary: 'A move with its imports and their reports', params: IdParams }, async (ctx, req) => imports.getBatch(ctx, req.params.id));
  r.post('/import_batches/:id/actions/apply', { permission: 'tenant:write', tags: B, summary: 'Apply every import of the move in one transaction, in the background', params: IdParams, status: 202 }, async (ctx, req) =>
    imports.applyBatchLater(ctx, req.params.id),
  );
  r.get('/imports/templates/:entity', { permission: 'catalog:read', tags: I, summary: 'Empty file with the expected columns', params: Type.Object({ entity: Entity }), querystring: Type.Object({ format: Type.Optional(Format) }), raw: true }, async (_ctx, req, reply) =>
    sendSheet(reply, { headers: imports.exportHeaders(req.params.entity), rows: [] }, `${req.params.entity}-template`, req.query.format ?? 'csv'),
  );
  r.get('/exports/:entity', { permission: 'catalog:read', tags: I, summary: 'Export products, stock items, prices, customers or bookings in the import columns', params: Type.Object({ entity: Entity }), querystring: Type.Object({ format: Type.Optional(Format) }), raw: true }, async (ctx, req, reply) => {
    if (req.params.entity === 'customers') assertCan(ctx.actor, 'customers:read');
    if (req.params.entity === 'orders') assertCan(ctx.actor, 'orders:read');
    return sendSheet(reply, await imports.exportRows(ctx, req.params.entity), req.params.entity, req.query.format ?? 'csv');
  });
}
