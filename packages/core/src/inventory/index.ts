import { t as msg } from '../i18n/index.ts';
import { validateCustomFields } from '../customfields/index.ts';
import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newBarcode, newId } from '../ids.ts';
import { exec, json, listPage, many, must, one, updateSql, type ListParams } from '../sql.ts';
import { allocateDowntime, bumpFutureAssignments, deleteUnitAllocations, endAllocationsAt, variantInfo } from '../availability/index.ts';
import { getLocation } from '../tenancy/index.ts';
import { ensureTicket, releaseUnit } from '../maintenance/tickets.ts';

export type StockStatus = 'available' | 'reserved' | 'out' | 'needs_inspection' | 'soft_down' | 'hard_down' | 'retired' | 'lost' | 'in_transit';
export const DOWN_STATUSES: StockStatus[] = ['needs_inspection', 'soft_down', 'hard_down'];
const MANUAL_STATUSES: StockStatus[] = ['available', 'needs_inspection', 'soft_down', 'hard_down', 'retired', 'lost'];

export function stockItemToApi(s: any) {
  return {
    id: s.id, object: 'stock_item', variant_id: s.variant_id, location_id: s.location_id, barcode: s.barcode, serial: s.serial, status: s.status,
    condition: s.condition, purchase_date: s.purchase_date, purchase_price: s.purchase_price == null ? null : Number(s.purchase_price), notes: s.notes, bin: s.bin ?? null,
    custom_fields: s.custom_fields, retired_at: s.retired_at, product_name: s.product_name, variant_name: s.variant_name, meter_value: s.meter_value == null ? null : Number(s.meter_value),
    created_at: s.created_at, updated_at: s.updated_at,
  };
}

const ITEM_SELECT = `SELECT s.*, p.name AS product_name, v.name AS variant_name FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id`;

export async function getStockItem(ctx: Ctx, id: string) {
  return stockItemToApi(await must(ctx, `${ITEM_SELECT} WHERE s.id = $1`, [id], 'stock_item', id));
}

export async function getStockItemByBarcode(ctx: Ctx, code: string) {
  return stockItemToApi(await must(ctx, `${ITEM_SELECT} WHERE s.barcode = $1`, [code], 'stock_item', code));
}

export async function listStockItems(ctx: Ctx, p: ListParams) {
  const page = await listPage<any>(
    ctx,
    {
      table: `(${ITEM_SELECT}) s`,
      filters: { variant_id: 'variant_id', location_id: 'location_id', status: 'status', product_id: '(SELECT product_id FROM variants WHERE id = s.variant_id)' },
      sorts: { barcode: 'barcode', created_at: 'created_at', status: 'status' },
      defaultSort: 'barcode',
      search: ['barcode', 'serial', 'product_name'],
    },
    p,
  );
  return { ...page, data: page.data.map(stockItemToApi) };
}

export interface StockItemInput {
  variant_id: string;
  location_id?: string;
  barcode?: string;
  serial?: string | null;
  condition?: string;
  purchase_date?: string | null;
  purchase_price?: number | null;
  notes?: string;
  bin?: string | null;
  custom_fields?: Record<string, unknown>;
}

export async function createStockItem(ctx: Ctx, input: StockItemInput) {
  const v = await variantInfo(ctx, input.variant_id);
  if (v.tracking !== 'serialized') throw new AppError('not_serialized', 422, msg('error.stock_items_only_exist_for_serialised_variants'));
  input = { ...input, custom_fields: await validateCustomFields(ctx, 'stock_item', input.custom_fields) };
  const loc = await getLocation(ctx, input.location_id);
  const row = (
    await many(
      ctx,
      `INSERT INTO stock_items (id, tenant_id, variant_id, location_id, barcode, serial, condition, purchase_date, purchase_price, notes, custom_fields, bin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [newId('sti'), ctx.tenantId, v.id, loc.id, input.barcode?.trim() || newBarcode(), input.serial ?? null, input.condition ?? 'good',
        input.purchase_date ?? null, input.purchase_price ?? null, input.notes ?? '', json(input.custom_fields ?? {}), input.bin?.trim() || null],
    )
  )[0];
  await audit(ctx, { entity_type: 'stock_item', entity_id: row.id, action: 'create', after: row });
  const api = await getStockItem(ctx, row.id);
  await emit(ctx, 'stock_item.created', { type: 'stock_item', id: row.id }, api);
  return api;
}

/** POST /stock_items/batch: explicit items, or `count` generated units (max 100, PRD §5.1.15). */
export async function createStockItemsBatch(ctx: Ctx, input: { items?: StockItemInput[]; variant_id?: string; location_id?: string; count?: number }) {
  const items = input.items ?? Array.from({ length: input.count ?? 0 }, () => ({ variant_id: input.variant_id!, location_id: input.location_id }));
  if (items.length === 0 || items.length > 100) throw invalid(msg('error.send_between_1_and_100_items'));
  const results: { index: number; ok: boolean; data?: unknown; error?: { code: string; message: string } }[] = [];
  let i = 0;
  for (const it of items) {
    try {
      await ctx.db.query('SAVEPOINT batch_item');
      results.push({ index: i, ok: true, data: await createStockItem(ctx, it) });
      await ctx.db.query('RELEASE SAVEPOINT batch_item');
    } catch (err: any) {
      await ctx.db.query('ROLLBACK TO SAVEPOINT batch_item');
      results.push({ index: i, ok: false, error: { code: err.code ?? 'error', message: err.message } });
    }
    i++;
  }
  return { data: results };
}

export async function updateStockItem(ctx: Ctx, id: string, patch: Partial<StockItemInput>) {
  const before = await must(ctx, `SELECT * FROM stock_items WHERE id = $1`, [id], 'stock_item', id);
  if (patch.location_id && patch.location_id !== before.location_id) {
    const busy = await one(ctx, `SELECT 1 FROM allocations WHERE stock_item_id = $1 AND kind = 'reservation' AND (upper(period) > now()) LIMIT 1`, [id]);
    if (busy) throw new AppError('unit_assigned', 409, msg('error.unassign_this_unit_from_upcoming_orders_before'));
  }
  if (patch.custom_fields !== undefined) patch = { ...patch, custom_fields: await validateCustomFields(ctx, 'stock_item', patch.custom_fields) };
  const q = updateSql('stock_items', id, patch, { barcode: {}, serial: {}, location_id: {}, condition: {}, purchase_date: {}, purchase_price: {}, notes: {}, bin: {}, custom_fields: { json: true } });
  const after = q ? (await many(ctx, q.text, q.values))[0] : before;
  await audit(ctx, { entity_type: 'stock_item', entity_id: id, action: 'update', before, after });
  return getStockItem(ctx, id);
}

export async function deleteStockItem(ctx: Ctx, id: string) {
  const s = await must(ctx, `SELECT * FROM stock_items WHERE id = $1`, [id], 'stock_item', id);
  const used = await one(ctx, `SELECT 1 FROM order_line_units WHERE stock_item_id = $1 LIMIT 1`, [id]);
  if (used) throw new AppError('unit_has_history', 409, msg('error.this_unit_has_rental_history_retire_it'));
  await deleteUnitAllocations(ctx, id);
  await exec(ctx, `DELETE FROM downtimes WHERE stock_item_id = $1`, [id]);
  await exec(ctx, `DELETE FROM stock_items WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'stock_item', entity_id: id, action: 'delete', before: s });
}

async function closeUnitDowntimes(ctx: Ctx, stockItemId: string) {
  const open = await many<{ id: string; s: Date }>(
    ctx,
    `SELECT id, lower(period) AS s FROM downtimes WHERE stock_item_id = $1 AND (upper(period) IS NULL OR upper(period) > $2)`,
    [stockItemId, ctx.now],
  );
  for (const d of open) {
    if (d.s >= ctx.now) {
      await exec(ctx, `DELETE FROM downtimes WHERE id = $1`, [d.id]);
    } else {
      await exec(ctx, `UPDATE downtimes SET period = tstzrange(lower(period), $2, '[)') WHERE id = $1`, [d.id, ctx.now]);
      await endAllocationsAt(ctx, { downtimeId: d.id }, ctx.now);
    }
  }
}

/**
 * FR-MNT-1: status change with a reason. Down statuses open a downtime allocation from now on;
 * returning to `available` closes it. Future assignments of the unit are released first.
 */
export async function setStockItemStatus(ctx: Ctx, id: string, status: StockStatus, reason = '', opts: { system?: boolean } = {}) {
  if (!opts.system && !MANUAL_STATUSES.includes(status)) throw invalid(msg('error.status_is_set_by_orders_not_by', { status }));
  const before = await must(ctx, `SELECT * FROM stock_items WHERE id = $1 FOR UPDATE`, [id], 'stock_item', id);
  if (!opts.system && before.status === 'out' && status !== 'lost') throw new AppError('unit_is_out', 409, msg('maintenance.unit_out'));
  if (!opts.system && before.status === 'in_transit') throw new AppError('unit_in_transit', 409, msg('error.unit_in_transit', { barcode: before.barcode }));
  const bumped: number[] = [];
  if (DOWN_STATUSES.includes(status) || status === 'retired' || status === 'lost') {
    bumped.push(...(await bumpFutureAssignments(ctx, id, ctx.now)));
  }
  if (DOWN_STATUSES.includes(status)) {
    const open = await one(ctx, `SELECT id FROM downtimes WHERE stock_item_id = $1 AND (upper(period) IS NULL OR upper(period) > $2)`, [id, ctx.now]);
    if (!open) await createDowntime(ctx, { stock_item_id: id, starts_at: ctx.now.toISOString(), reason: reason || status });
  } else {
    await closeUnitDowntimes(ctx, id);
  }
  const row = (
    await many(ctx, `UPDATE stock_items SET status = $2, retired_at = CASE WHEN $2 IN ('retired','lost') THEN now() ELSE retired_at END WHERE id = $1 RETURNING *`, [id, status])
  )[0];
  // Units taken out of service get a maintenance ticket; back in service (or gone) closes it.
  if (status === 'soft_down' || status === 'hard_down') await ensureTicket(ctx, id, status, reason);
  else if (['available', 'retired', 'lost'].includes(status)) await releaseUnit(ctx, id);
  await audit(ctx, { entity_type: 'stock_item', entity_id: id, action: 'set_status', before, after: row, extra: { reason } });
  const api = await getStockItem(ctx, id);
  if (before.status !== status) await emit(ctx, 'stock_item.status_changed', { type: 'stock_item', id }, api, { status: before.status });
  return { ...api, unassigned_from_orders: bumped };
}

// ---------------------------------------------------------------------------
// Bulk stock levels (ledger: stock_adjustments)
// ---------------------------------------------------------------------------

export async function listStockLevels(ctx: Ctx, filter: { variant_id?: string; location_id?: string } = {}) {
  return many(
    ctx,
    `SELECT sl.variant_id, sl.location_id, sl.quantity, sl.barcode, sl.updated_at, p.name AS product_name, v.name AS variant_name
       FROM stock_levels sl JOIN variants v ON v.id = sl.variant_id JOIN products p ON p.id = v.product_id
      WHERE ($1::text IS NULL OR sl.variant_id = $1) AND ($2::text IS NULL OR sl.location_id = $2)
      ORDER BY p.name, v.name`,
    [filter.variant_id ?? null, filter.location_id ?? null],
  ).then((rows) => rows.map((r) => ({ object: 'stock_level', ...r })));
}

export async function adjustStockLevel(ctx: Ctx, variantId: string, locationId: string, delta: number, reason: string, reference?: string) {
  const v = await variantInfo(ctx, variantId);
  if (v.tracking !== 'bulk') throw new AppError('not_bulk', 422, msg('error.stock_levels_only_apply_to_bulk_variants'));
  await getLocation(ctx, locationId);
  if (!Number.isInteger(delta) || delta === 0) throw invalid(msg('error.delta_must_be_a_non_zero_integer'));
  // Update first: an upsert would check the CHECK constraint on the negative delta itself and refuse every decrease.
  let row = (await many(ctx, `UPDATE stock_levels SET quantity = quantity + $3, updated_at = now() WHERE variant_id = $1 AND location_id = $2 RETURNING *`, [variantId, locationId, delta]))[0];
  if (!row) {
    if (delta < 0) throw invalid(msg('error.quantity_must_be_a_non_negative_integer'));
    row = (
      await many(
        ctx,
        `INSERT INTO stock_levels (tenant_id, variant_id, location_id, quantity, barcode) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (variant_id, location_id) DO UPDATE SET quantity = stock_levels.quantity + $4, updated_at = now()
         RETURNING *`,
        [ctx.tenantId, variantId, locationId, delta, newBarcode('BK')],
      )
    )[0];
  }
  await exec(ctx, `INSERT INTO stock_adjustments (id, tenant_id, variant_id, location_id, delta, reason, reference, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    newId('adj'), ctx.tenantId, variantId, locationId, delta, reason, reference ?? null, ctx.actor.id,
  ]);
  await audit(ctx, { entity_type: 'stock_level', entity_id: `${variantId}:${locationId}`, action: 'adjust', after: row, extra: { delta, reason } });
  await emit(ctx, 'stock_level.adjusted', { type: 'variant', id: variantId }, { object: 'stock_level', ...row, delta, reason });
  return { object: 'stock_level', ...row };
}

export async function setStockLevel(ctx: Ctx, variantId: string, locationId: string, quantity: number, reason = 'set') {
  if (!Number.isInteger(quantity) || quantity < 0) throw invalid(msg('error.quantity_must_be_a_non_negative_integer'));
  const cur = (await one<{ quantity: number }>(ctx, `SELECT quantity FROM stock_levels WHERE variant_id = $1 AND location_id = $2`, [variantId, locationId]))?.quantity ?? 0;
  if (cur === quantity) {
    if (!(await one(ctx, `SELECT 1 FROM stock_levels WHERE variant_id = $1 AND location_id = $2`, [variantId, locationId]))) {
      await exec(ctx, `INSERT INTO stock_levels (tenant_id, variant_id, location_id, quantity, barcode) VALUES ($1,$2,$3,0,$4)`, [ctx.tenantId, variantId, locationId, newBarcode('BK')]);
    }
    return (await listStockLevels(ctx, { variant_id: variantId, location_id: locationId }))[0];
  }
  return adjustStockLevel(ctx, variantId, locationId, quantity - cur, reason);
}

// ---------------------------------------------------------------------------
// Downtimes (FR-AV-5)
// ---------------------------------------------------------------------------

export function downtimeToApi(d: any) {
  return { id: d.id, object: 'downtime', location_id: d.location_id, variant_id: d.variant_id, stock_item_id: d.stock_item_id, quantity: d.quantity, starts_at: d.starts_at, ends_at: d.ends_at, reason: d.reason, created_at: d.created_at };
}

export async function createDowntime(
  ctx: Ctx,
  input: { stock_item_id?: string | null; variant_id?: string; location_id?: string; quantity?: number; starts_at: string; ends_at?: string | null; reason?: string },
) {
  let variantId = input.variant_id;
  let locationId = input.location_id;
  if (input.stock_item_id) {
    const s = await must(ctx, `SELECT variant_id, location_id FROM stock_items WHERE id = $1`, [input.stock_item_id], 'stock_item', input.stock_item_id);
    variantId = s.variant_id;
    locationId = s.location_id;
  }
  if (!variantId) throw invalid(msg('error.variant_id_or_stock_item_id_is'));
  locationId = (await getLocation(ctx, locationId)).id;
  const qty = input.stock_item_id ? 1 : Math.max(1, input.quantity ?? 1);
  const id = newId('dwn');
  const d = (
    await many(
      ctx,
      `INSERT INTO downtimes (id, tenant_id, location_id, variant_id, stock_item_id, quantity, period, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,tstzrange($7, $8, '[)'),$9,$10)
       RETURNING *, lower(period) AS starts_at, upper(period) AS ends_at`,
      [id, ctx.tenantId, locationId, variantId, input.stock_item_id ?? null, qty, input.starts_at, input.ends_at ?? null, input.reason ?? '', ctx.actor.id],
    )
  )[0];
  await allocateDowntime(ctx, { downtimeId: id, variantId, locationId: locationId as string, stockItemId: input.stock_item_id ?? null, quantity: qty, from: input.starts_at, to: input.ends_at ?? null });
  await audit(ctx, { entity_type: 'downtime', entity_id: id, action: 'create', after: d });
  const api = downtimeToApi(d);
  await emit(ctx, 'downtime.created', { type: 'downtime', id }, api);
  return api;
}

export async function listDowntimes(ctx: Ctx, filter: { variant_id?: string; stock_item_id?: string; active?: boolean; location_id?: string } = {}) {
  const rows = await many(
    ctx,
    `SELECT *, lower(period) AS starts_at, upper(period) AS ends_at FROM downtimes
      WHERE ($1::text IS NULL OR variant_id = $1) AND ($2::text IS NULL OR stock_item_id = $2)
        AND (NOT $3 OR upper(period) IS NULL OR upper(period) > now()) AND ($4::text IS NULL OR location_id = $4)
      ORDER BY lower(period) DESC LIMIT 200`,
    [filter.variant_id ?? null, filter.stock_item_id ?? null, filter.active ?? false, filter.location_id ?? null],
  );
  return rows.map(downtimeToApi);
}

export async function deleteDowntime(ctx: Ctx, id: string) {
  const d = await must(ctx, `SELECT *, lower(period) AS starts_at FROM downtimes WHERE id = $1`, [id], 'downtime', id);
  if (d.starts_at < ctx.now) {
    // Past part stays in history; end it now.
    await exec(ctx, `UPDATE downtimes SET period = tstzrange(lower(period), $2, '[)') WHERE id = $1`, [id, ctx.now]);
    await endAllocationsAt(ctx, { downtimeId: id }, ctx.now);
  } else {
    await exec(ctx, `DELETE FROM downtimes WHERE id = $1`, [id]);
  }
  await audit(ctx, { entity_type: 'downtime', entity_id: id, action: 'delete', before: d });
  await emit(ctx, 'downtime.deleted', { type: 'downtime', id }, { id, object: 'downtime', deleted: true });
}

export async function stockItemHistory(ctx: Ctx, id: string) {
  return many(
    ctx,
    `SELECT o.id AS order_id, o.number, o.status, o.starts_at, o.ends_at, u.checked_out_at, u.checked_in_at, u.check_in_outcome
       FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id JOIN orders o ON o.id = l.order_id
      WHERE u.stock_item_id = $1 ORDER BY o.starts_at DESC LIMIT 100`,
    [id],
  );
}
