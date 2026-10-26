import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { json, many, must, one } from '../sql.ts';
import { slugify } from '../tenancy/index.ts';
import { categories, createProduct, createVariant, updateProduct, updateVariant } from '../catalog/index.ts';
import { createStockItem, setStockLevel, updateStockItem } from '../inventory/index.ts';
import { SPECS, exportHeaders, mapHeaders, type ImportEntity } from './spec.ts';

export { SPECS, exportHeaders, normaliseHeader, parseMoney, parseDate, type ImportEntity } from './spec.ts';

/** A spreadsheet as plain text cells (the API parses CSV and XLSX into this). */
export interface Sheet {
  headers: string[];
  rows: string[][];
}

export interface CellError {
  field: string;
  message: string;
}

export interface RowResult {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  action: 'create' | 'update' | 'unchanged' | 'error';
  key: string;
  errors: CellError[];
  data: Record<string, any>;
}

export interface Analysis {
  entity: ImportEntity;
  columns: Record<string, string>;
  unknown_columns: string[];
  file_errors: string[];
  counts: { create: number; update: number; unchanged: number; error: number };
  rows: RowResult[];
}

const MAX_ROWS = 5000;
const err = (field: string, key: MessageKey, params?: Record<string, string | number>): CellError => ({ field, message: t(key, params ?? {}) });
const major = (minor: number | null | undefined) => (minor == null ? '' : (Number(minor) / 100).toFixed(2));

/** Parses every row against the entity's columns; no database access. */
function parseRows(entity: ImportEntity, sheet: Sheet) {
  const { mapping, unknown, missing } = mapHeaders(entity, sheet.headers);
  const fileErrors = missing.map((k) => t('imports.missing_column', { column: k }));
  if (sheet.rows.length > MAX_ROWS) fileErrors.push(t('imports.too_many_rows', { max: MAX_ROWS }));
  const columns = Object.fromEntries(Object.entries(mapping).map(([i, k]) => [sheet.headers[Number(i)]!.trim(), k]));
  const rows: RowResult[] = [];
  sheet.rows.slice(0, MAX_ROWS).forEach((cells, i) => {
    if (cells.every((c) => !String(c ?? '').trim())) return;
    const r: RowResult = { row: i + 2, action: 'create', key: '', errors: [], data: {} };
    for (const [idx, key] of Object.entries(mapping)) {
      const raw = String(cells[Number(idx)] ?? '').trim();
      if (!raw) continue;
      const col = SPECS[entity].find((c) => c.key === key)!;
      const p = col.parse ? col.parse(raw) : { value: raw };
      if ('error' in p) r.errors.push(err(key, p.error, p.params));
      else r.data[key] = p.value;
    }
    for (const c of SPECS[entity]) if (c.required && r.data[c.key] === undefined && !r.errors.some((e) => e.field === c.key)) r.errors.push(err(c.key, 'imports.required'));
    rows.push(r);
  });
  return { columns, unknown, fileErrors, rows };
}

async function variantsBySku(ctx: Ctx, skus: string[]) {
  const rows = skus.length ? await many(ctx, `SELECT v.*, to_jsonb(ps.*) AS ps FROM variants v LEFT JOIN price_structures ps ON ps.id = v.price_structure_id WHERE v.sku = ANY($1) AND v.deleted_at IS NULL`, [skus]) : [];
  return new Map(rows.map((v) => [v.sku as string, v]));
}

function priceInput(d: Record<string, any>) {
  if (d.price === undefined) return undefined;
  const p = d.price_period ?? 'day';
  return p === 'fixed' ? { kind: 'fixed' as const, amount: d.price } : { kind: 'per_period' as const, period_unit: p, amount: d.price };
}

function priceDiffers(v: any, d: Record<string, any>) {
  const want = priceInput(d);
  if (!want) return false;
  const ps = v.ps;
  if (!ps) return true;
  return ps.kind !== want.kind || Number(ps.amount) !== want.amount || (want.kind === 'per_period' && ps.period_unit !== want.period_unit);
}

async function locationsByName(ctx: Ctx) {
  const rows = await many<{ id: string; name: string; is_default: boolean }>(ctx, `SELECT id, name, is_default FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at`);
  return { byName: new Map(rows.map((l) => [l.name.trim().toLowerCase(), l.id])), fallback: rows[0]?.id ?? null };
}

// --- Analysis per entity ----------------------------------------------------------

async function analyseProducts(ctx: Ctx, rows: RowResult[]) {
  const vs = await variantsBySku(ctx, rows.map((r) => r.data.sku).filter(Boolean));
  const seenSku = new Set<string>();
  const products = new Map<string, any>();
  for (const r of rows) {
    const slug = slugify(String(r.data.slug ?? r.data.name ?? ''));
    r.key = slug;
    r.data._slug = slug;
    if (r.errors.length) continue;
    if (!products.has(slug)) products.set(slug, await one(ctx, `SELECT * FROM products WHERE slug = $1 AND deleted_at IS NULL`, [slug]));
    const p = products.get(slug);
    if (r.data.sku) {
      if (seenSku.has(r.data.sku)) r.errors.push(err('sku', 'imports.duplicate_in_file'));
      seenSku.add(r.data.sku);
      const v = vs.get(r.data.sku);
      if (v && p && v.product_id !== p.id) r.errors.push(err('sku', 'imports.sku_other_product'));
      if (v && !p) r.errors.push(err('sku', 'imports.sku_other_product'));
      if (v && p && v.product_id === p.id) {
        r.data._variant_id = v.id;
        const changed =
          priceDiffers(v, r.data) ||
          (r.data.variant && r.data.variant !== v.name) ||
          (r.data.tracking && r.data.tracking !== v.tracking) ||
          (r.data.name && r.data.name !== p.name) ||
          (r.data.description !== undefined && r.data.description !== p.description) ||
          (r.data.visibility && r.data.visibility !== p.visibility) ||
          (r.data.deposit !== undefined && r.data.deposit !== Number(p.deposit_amount));
        r.action = changed ? 'update' : 'unchanged';
        continue;
      }
    }
    r.action = p ? 'update' : 'create';
    if (p) r.data._product_id = p.id;
  }
}

async function analyseStockItems(ctx: Ctx, rows: RowResult[]) {
  const vs = await variantsBySku(ctx, rows.map((r) => r.data.sku).filter(Boolean));
  const locs = await locationsByName(ctx);
  const seenBarcode = new Set<string>();
  for (const r of rows) {
    r.key = String(r.data.barcode ?? r.data.sku ?? '');
    if (r.errors.length) continue;
    const v = vs.get(r.data.sku);
    if (!v) {
      r.errors.push(err('sku', 'imports.unknown_sku'));
      continue;
    }
    r.data._variant_id = v.id;
    r.data._tracking = v.tracking;
    const loc = r.data.location ? locs.byName.get(String(r.data.location).toLowerCase()) : locs.fallback;
    if (!loc) {
      r.errors.push(err('location', 'imports.unknown_location'));
      continue;
    }
    r.data._location_id = loc;
    if (v.tracking === 'bulk') {
      if (r.data.quantity === undefined) {
        r.errors.push(err('quantity', 'imports.required'));
        continue;
      }
      const lvl = await one<{ quantity: number }>(ctx, `SELECT quantity FROM stock_levels WHERE variant_id = $1 AND location_id = $2`, [v.id, loc]);
      r.action = lvl ? (Number(lvl.quantity) === r.data.quantity ? 'unchanged' : 'update') : 'create';
      continue;
    }
    if (v.tracking !== 'serialized') {
      r.errors.push(err('sku', 'imports.not_stocked'));
      continue;
    }
    if (r.data.barcode) {
      if (seenBarcode.has(r.data.barcode)) {
        r.errors.push(err('barcode', 'imports.duplicate_in_file'));
        continue;
      }
      seenBarcode.add(r.data.barcode);
      const unit = await one(ctx, `SELECT * FROM stock_items WHERE barcode = $1`, [r.data.barcode]);
      if (unit && unit.variant_id !== v.id) {
        r.errors.push(err('barcode', 'imports.barcode_other_variant'));
        continue;
      }
      if (unit) {
        r.data._stock_item_id = unit.id;
        const changed =
          (r.data.serial !== undefined && r.data.serial !== unit.serial) ||
          (r.data.condition !== undefined && r.data.condition !== unit.condition) ||
          (r.data.purchase_price !== undefined && r.data.purchase_price !== Number(unit.purchase_price)) ||
          (r.data.purchase_date !== undefined && r.data.purchase_date !== (unit.purchase_date ? new Date(unit.purchase_date).toISOString().slice(0, 10) : null)) ||
          (r.data.notes !== undefined && r.data.notes !== unit.notes) ||
          (r.data.bin !== undefined && r.data.bin !== unit.bin) ||
          loc !== unit.location_id;
        r.action = changed ? 'update' : 'unchanged';
        continue;
      }
    } else if ((r.data.quantity ?? 1) > 100) {
      r.errors.push(err('quantity', 'imports.too_many_units', { max: 100 }));
      continue;
    }
    r.action = 'create';
  }
}

async function analysePrices(ctx: Ctx, rows: RowResult[]) {
  const vs = await variantsBySku(ctx, rows.map((r) => r.data.sku).filter(Boolean));
  for (const r of rows) {
    r.key = String(r.data.sku ?? '');
    if (r.errors.length) continue;
    const v = vs.get(r.data.sku);
    if (!v) {
      r.errors.push(err('sku', 'imports.unknown_sku'));
      continue;
    }
    r.data._variant_id = v.id;
    const depositChanged = r.data.deposit !== undefined && r.data.deposit !== (v.deposit_amount == null ? null : Number(v.deposit_amount));
    r.action = priceDiffers(v, r.data) || depositChanged ? 'update' : 'unchanged';
  }
}

/** Dry run: what an import would do, row by row, without changing anything (FR-CAT-8). */
export async function analyse(ctx: Ctx, entity: ImportEntity, sheet: Sheet): Promise<Analysis> {
  const { columns, unknown, fileErrors, rows } = parseRows(entity, sheet);
  if (!fileErrors.length) {
    if (entity === 'products') await analyseProducts(ctx, rows);
    else if (entity === 'stock_items') await analyseStockItems(ctx, rows);
    else await analysePrices(ctx, rows);
  }
  for (const r of rows) if (r.errors.length) r.action = 'error';
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  if (!rows.length && !fileErrors.length) fileErrors.push(t('imports.empty'));
  return { entity, columns, unknown_columns: unknown, file_errors: fileErrors, counts, rows };
}

// --- Apply ------------------------------------------------------------------------

async function categoryIds(ctx: Ctx, names: string[] | undefined, cache: Map<string, string>) {
  if (!names) return undefined;
  const ids: string[] = [];
  for (const name of names) {
    const slug = slugify(name);
    let id = cache.get(slug) ?? (await one<{ id: string }>(ctx, `SELECT id FROM categories WHERE (slug = $1 OR lower(name) = lower($2)) AND deleted_at IS NULL`, [slug, name]))?.id;
    if (!id) id = ((await categories.create(ctx, { name })) as { id: string }).id;
    cache.set(slug, id);
    ids.push(id);
  }
  return ids;
}

async function applyProducts(ctx: Ctx, rows: RowResult[]) {
  const cats = new Map<string, string>();
  const groups = new Map<string, RowResult[]>();
  for (const r of rows.filter((x) => x.action !== 'unchanged')) groups.set(r.data._slug, [...(groups.get(r.data._slug) ?? []), r]);
  for (const [slug, group] of groups) {
    const first = group[0]!.data;
    const productFields = {
      ...(first.name ? { name: first.name } : {}),
      ...(first.description !== undefined ? { description: first.description } : {}),
      ...(first.visibility ? { visibility: first.visibility } : {}),
      ...(first.tags ? { tags: first.tags } : {}),
      ...(first.deposit !== undefined ? { deposit_amount: first.deposit } : {}),
      ...(first.buffer_after_min !== undefined ? { buffer_after_min: first.buffer_after_min } : {}),
    };
    const category_ids = await categoryIds(ctx, first.category, cats);
    const existing = await one<{ id: string }>(ctx, `SELECT id FROM products WHERE slug = $1 AND deleted_at IS NULL`, [slug]);
    if (!existing) {
      await createProduct(ctx, {
        type: first.type ?? 'rental',
        name: first.name,
        slug,
        ...productFields,
        category_ids,
        variants: group.map((r) => ({ name: r.data.variant ?? r.data.name, sku: r.data.sku ?? null, tracking: r.data.tracking, price: priceInput(r.data) })),
      });
      continue;
    }
    if (Object.keys(productFields).length || category_ids) await updateProduct(ctx, existing.id, { ...productFields, ...(category_ids ? { category_ids } : {}) });
    for (const r of group) {
      const v = { ...(r.data.variant ? { name: r.data.variant } : {}), ...(r.data.sku ? { sku: r.data.sku } : {}), ...(r.data.tracking ? { tracking: r.data.tracking } : {}), ...(priceInput(r.data) ? { price: priceInput(r.data) } : {}) };
      if (r.data._variant_id) await updateVariant(ctx, r.data._variant_id, v);
      else await createVariant(ctx, existing.id, { name: r.data.variant ?? r.data.name, ...v });
    }
  }
}

async function applyStockItems(ctx: Ctx, rows: RowResult[]) {
  for (const r of rows.filter((x) => x.action !== 'unchanged')) {
    const d = r.data;
    if (d._tracking === 'bulk') {
      await setStockLevel(ctx, d._variant_id, d._location_id, d.quantity, 'import');
      continue;
    }
    const fields = {
      ...(d.serial !== undefined ? { serial: d.serial } : {}),
      ...(d.condition !== undefined ? { condition: d.condition } : {}),
      ...(d.purchase_date !== undefined ? { purchase_date: d.purchase_date } : {}),
      ...(d.purchase_price !== undefined ? { purchase_price: d.purchase_price } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.bin !== undefined ? { bin: d.bin } : {}),
    };
    if (d._stock_item_id) await updateStockItem(ctx, d._stock_item_id, { ...fields, location_id: d._location_id });
    else for (let i = 0; i < (d.barcode ? 1 : d.quantity ?? 1); i++) await createStockItem(ctx, { variant_id: d._variant_id, location_id: d._location_id, barcode: d.barcode, ...fields });
  }
}

async function applyPrices(ctx: Ctx, rows: RowResult[]) {
  for (const r of rows.filter((x) => x.action === 'update')) {
    await updateVariant(ctx, r.data._variant_id, { price: priceInput(r.data), ...(r.data.deposit !== undefined ? { deposit_amount: r.data.deposit } : {}) });
  }
}

// --- Import records -----------------------------------------------------------------

/** What is kept of an analysis: counts and every row that is not unchanged (capped). */
function reportOf(a: Analysis) {
  const interesting = a.rows.filter((r) => r.action !== 'unchanged');
  return {
    columns: a.columns,
    unknown_columns: a.unknown_columns,
    file_errors: a.file_errors,
    counts: a.counts,
    rows: interesting.slice(0, 1000).map((r) => ({ row: r.row, action: r.action, key: r.key, errors: r.errors })),
    rows_truncated: interesting.length > 1000,
  };
}

export function importToApi(r: any) {
  return { id: r.id, object: 'import', entity: r.entity, status: r.status, filename: r.filename, file_id: r.file_id, row_count: r.row_count, error_count: r.error_count, report: r.report, applied_at: r.applied_at, created_at: r.created_at };
}

export async function createImport(ctx: Ctx, input: { entity: ImportEntity; filename: string; fileId: string | null; sheet: Sheet }) {
  const a = await analyse(ctx, input.entity, input.sheet);
  const errors = a.counts.error + a.file_errors.length;
  const row = (
    await many(
      ctx,
      `INSERT INTO imports (id, tenant_id, entity, status, filename, file_id, report, row_count, error_count, created_by) VALUES ($1,$2,$3,'validated',$4,$5,$6,$7,$8,$9) RETURNING *`,
      [newId('imp'), ctx.tenantId, input.entity, input.filename, input.fileId, json(reportOf(a)), a.rows.length, errors, ctx.actor.id],
    )
  )[0];
  return importToApi(row);
}

export async function getImport(ctx: Ctx, id: string) {
  return importToApi(await must(ctx, `SELECT * FROM imports WHERE id = $1`, [id], 'import', id));
}

export async function listImports(ctx: Ctx, limit = 20) {
  return (await many(ctx, `SELECT * FROM imports ORDER BY created_at DESC LIMIT $1`, [Math.min(limit, 100)])).map(importToApi);
}

/**
 * Applies a validated import in the caller's transaction. The file is analysed again first, so rows
 * that changed since the dry run are caught; any error leaves everything untouched.
 */
export async function applyImport(ctx: Ctx, id: string, sheet: Sheet) {
  const rec = await must<any>(ctx, `SELECT * FROM imports WHERE id = $1 FOR UPDATE`, [id], 'import', id);
  if (rec.status === 'applied') throw new AppError('import_applied', 409, t('imports.already_applied'));
  const a = await analyse(ctx, rec.entity, sheet);
  if (a.counts.error || a.file_errors.length) {
    await many(ctx, `UPDATE imports SET report = $2, error_count = $3 WHERE id = $1 RETURNING id`, [id, json(reportOf(a)), a.counts.error + a.file_errors.length]);
    throw invalid(t('imports.has_errors'), a.rows.flatMap((r) => r.errors.map((e) => ({ field: `row_${r.row}.${e.field}`, code: 'invalid', message: e.message }))).slice(0, 50));
  }
  if (rec.entity === 'products') await applyProducts(ctx, a.rows);
  else if (rec.entity === 'stock_items') await applyStockItems(ctx, a.rows);
  else await applyPrices(ctx, a.rows);
  const row = (await many(ctx, `UPDATE imports SET status = 'applied', applied_at = now(), report = $2, row_count = $3, error_count = 0 WHERE id = $1 RETURNING *`, [id, json(reportOf(a)), a.rows.length]))[0];
  await audit(ctx, { entity_type: 'import', entity_id: id, action: 'apply', extra: { entity: rec.entity, counts: a.counts } });
  return importToApi(row);
}

// --- Export ---------------------------------------------------------------------------

/** Rows in the same columns the import reads, so an export can be edited and imported back. */
export async function exportRows(ctx: Ctx, entity: ImportEntity): Promise<Sheet> {
  const headers = exportHeaders(entity);
  if (entity === 'products') {
    const rows = await many(
      ctx,
      `SELECT p.name, p.slug, p.type, p.description, p.tags, p.visibility, p.deposit_amount, p.buffer_after_min, v.name AS variant, v.sku, v.tracking,
              ps.kind, ps.period_unit, ps.amount,
              (SELECT string_agg(c.name, '; ' ORDER BY c.name) FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id) AS category
         FROM products p JOIN variants v ON v.product_id = p.id AND v.deleted_at IS NULL LEFT JOIN price_structures ps ON ps.id = v.price_structure_id
        WHERE p.deleted_at IS NULL AND p.type <> 'bundle' ORDER BY p.name, v.position`,
    );
    return {
      headers,
      rows: rows.map((r) => [r.name, r.slug, r.type, r.description ?? '', r.category ?? '', (r.tags ?? []).join(', '), r.visibility, major(r.deposit_amount), r.variant, r.sku ?? '', r.tracking, major(r.amount), r.kind === 'fixed' ? 'fixed' : r.period_unit ?? '', String(r.buffer_after_min ?? '')]),
    };
  }
  if (entity === 'stock_items') {
    const units = await many(
      ctx,
      `SELECT v.sku, s.barcode, s.serial, l.name AS location, s.condition, s.purchase_date, s.purchase_price, s.notes, s.bin
         FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN locations l ON l.id = s.location_id WHERE s.status NOT IN ('retired') ORDER BY v.sku, s.barcode`,
    );
    const levels = await many(ctx, `SELECT v.sku, l.name AS location, sl.quantity FROM stock_levels sl JOIN variants v ON v.id = sl.variant_id JOIN locations l ON l.id = sl.location_id ORDER BY v.sku`);
    return {
      headers,
      rows: [
        ...units.map((u) => [u.sku ?? '', u.barcode, u.serial ?? '', u.location, '', u.condition ?? '', u.purchase_date ? new Date(u.purchase_date).toISOString().slice(0, 10) : '', major(u.purchase_price), u.notes ?? '', u.bin ?? '']),
        ...levels.map((l) => [l.sku ?? '', '', '', l.location, String(l.quantity), '', '', '', '', '']),
      ],
    };
  }
  const rows = await many(
    ctx,
    `SELECT v.sku, v.deposit_amount, ps.kind, ps.period_unit, ps.amount FROM variants v LEFT JOIN price_structures ps ON ps.id = v.price_structure_id
      WHERE v.deleted_at IS NULL AND v.sku IS NOT NULL ORDER BY v.sku`,
  );
  return { headers, rows: rows.map((r) => [r.sku, major(r.amount), r.kind === 'fixed' ? 'fixed' : r.period_unit ?? '', major(r.deposit_amount)]) };
}
