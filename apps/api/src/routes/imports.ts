import { AppError, assertCan, files, imports, serverT, type Ctx } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Type } from '../schemas.ts';
import { readSheet, sendSheet } from '../spreadsheets.ts';

const Entity = Type.Union([Type.Literal('products'), Type.Literal('stock_items'), Type.Literal('prices')]);
const Format = Type.Union([Type.Literal('csv'), Type.Literal('xlsx')]);
const PERM = { products: 'catalog:write', stock_items: 'inventory:write', prices: 'pricing:write' } as const;

async function sheetOf(ctx: Ctx, fileId: string) {
  const f = await files.getFile(ctx, fileId);
  if (f.kind !== 'import') throw new AppError('validation_error', 422, serverT('imports.not_import_file'), { errors: [{ field: 'file_id', code: 'invalid', message: serverT('imports.not_import_file') }] });
  return { file: f, sheet: await readSheet(await files.readFile(ctx, f), f.filename) };
}

/** CSV/XLSX import with a dry run, and exports in the same columns (FR-CAT-8). */
export function registerImports(r: Router) {
  const I = ['Imports'];
  r.post(
    '/imports',
    {
      permission: 'catalog:read',
      tags: I,
      summary: 'Validate an uploaded CSV or XLSX file (POST /files?purpose=import) and return the dry-run report; nothing is changed yet',
      body: Type.Object({ entity: Entity, file_id: Id }),
    },
    async (ctx, req) => {
      assertCan(ctx.actor, PERM[req.body.entity as keyof typeof PERM]);
      const { file, sheet } = await sheetOf(ctx, req.body.file_id);
      return imports.createImport(ctx, { entity: req.body.entity, filename: file.filename, fileId: file.id, sheet });
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
  r.get('/imports/templates/:entity', { permission: 'catalog:read', tags: I, summary: 'Empty file with the expected columns', params: Type.Object({ entity: Entity }), querystring: Type.Object({ format: Type.Optional(Format) }), raw: true }, async (_ctx, req, reply) =>
    sendSheet(reply, { headers: imports.exportHeaders(req.params.entity), rows: [] }, `${req.params.entity}-template`, req.query.format ?? 'csv'),
  );
  r.get('/exports/:entity', { permission: 'catalog:read', tags: I, summary: 'Export products, stock items or prices in the import columns', params: Type.Object({ entity: Entity }), querystring: Type.Object({ format: Type.Optional(Format) }), raw: true }, async (ctx, req, reply) =>
    sendSheet(reply, await imports.exportRows(ctx, req.params.entity), req.params.entity, req.query.format ?? 'csv'),
  );
}
