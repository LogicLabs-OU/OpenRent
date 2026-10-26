import type { Ctx } from '../context.ts';
import { AppError } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { json, many, must, one } from '../sql.ts';
import { getLocation } from '../tenancy/index.ts';
import { setStockItemStatus, updateStockItem } from '../inventory/index.ts';

/** Units a stock take expects on the shelf: everything at the location that is not out, retired or lost. */
const ON_SHELF = `('available', 'needs_inspection', 'soft_down', 'hard_down')`;

const UNIT = `SELECT s.id, s.barcode, s.serial, s.status, s.location_id, s.bin, p.name AS product_name, v.name AS variant_name, l.name AS location_name
  FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = s.location_id`;

export async function stockTakeToApi(ctx: Ctx, st: any) {
  const expected = await many(ctx, `${UNIT} WHERE s.location_id = $1 AND s.status IN ${ON_SHELF} ORDER BY s.bin NULLS LAST, p.name, s.barcode`, [st.location_id]);
  const scans = await many<{ code: string; stock_item_id: string | null; scanned_at: Date }>(ctx, `SELECT code, stock_item_id, scanned_at FROM stock_take_scans WHERE stock_take_id = $1 ORDER BY scanned_at`, [st.id]);
  const seenIds = new Set(scans.map((s) => s.stock_item_id).filter(Boolean));
  const seenUnits = seenIds.size ? await many(ctx, `${UNIT} WHERE s.id = ANY($1)`, [[...seenIds]]) : [];
  return {
    id: st.id,
    object: 'stock_take',
    status: st.status,
    location_id: st.location_id,
    created_at: st.created_at,
    applied_at: st.applied_at,
    counts: { expected: expected.length, scanned: scans.length },
    found: expected.filter((u) => seenIds.has(u.id)),
    missing: expected.filter((u) => !seenIds.has(u.id)),
    /** Seen here but registered at another location (or out, retired, lost). */
    elsewhere: seenUnits.filter((u) => u.location_id !== st.location_id || !['available', 'needs_inspection', 'soft_down', 'hard_down'].includes(u.status)),
    unknown: scans.filter((s) => !s.stock_item_id).map((s) => s.code),
    result: st.summary ?? {},
  };
}

/** Opens a stock take for a location, or returns the one already open there. */
export async function startStockTake(ctx: Ctx, locationId?: string | null) {
  const loc = await getLocation(ctx, locationId);
  const open = await one(ctx, `SELECT * FROM stock_takes WHERE location_id = $1 AND status = 'open'`, [loc.id]);
  if (open) return stockTakeToApi(ctx, open);
  const row = (await many(ctx, `INSERT INTO stock_takes (id, tenant_id, location_id, started_by) VALUES ($1,$2,$3,$4) RETURNING *`, [newId('stk'), ctx.tenantId, loc.id, ctx.actor.id]))[0];
  await audit(ctx, { entity_type: 'stock_take', entity_id: row.id, action: 'start', extra: { location_id: loc.id } });
  return stockTakeToApi(ctx, row);
}

async function openTake(ctx: Ctx, id: string) {
  const st = await must<any>(ctx, `SELECT * FROM stock_takes WHERE id = $1 FOR UPDATE`, [id], 'stock_take', id);
  if (st.status !== 'open') throw new AppError('stock_take_closed', 409, t('stocktake.not_open'));
  return st;
}

export async function getStockTake(ctx: Ctx, id: string) {
  return stockTakeToApi(ctx, await must(ctx, `SELECT * FROM stock_takes WHERE id = $1`, [id], 'stock_take', id));
}

/** Records one scanned code. Scanning the same code twice is harmless. */
export async function scanStockTake(ctx: Ctx, id: string, code: string) {
  const st = await openTake(ctx, id);
  const c = code.trim();
  const unit = await one<any>(ctx, `${UNIT} WHERE s.barcode = $1`, [c]);
  const ins = await many(ctx, `INSERT INTO stock_take_scans (id, tenant_id, stock_take_id, stock_item_id, code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stock_take_id, code) DO NOTHING RETURNING id`, [
    newId('sts'), ctx.tenantId, id, unit?.id ?? null, c,
  ]);
  const result = !unit ? 'unknown' : unit.location_id !== st.location_id || !['available', 'needs_inspection', 'soft_down', 'hard_down'].includes(unit.status) ? 'elsewhere' : 'found';
  return { object: 'stock_take_scan', code: c, result, repeated: ins.length === 0, unit: unit ?? null, message: result === 'unknown' ? t('stocktake.unknown_code') : null };
}

/**
 * Applies the count: missing units are marked lost and units found here but registered elsewhere are
 * moved to this location. Each part is optional; units that cannot be moved are reported.
 */
export async function applyStockTake(ctx: Ctx, id: string, input: { mark_missing_lost?: boolean; move_found?: boolean }) {
  const st = await openTake(ctx, id);
  const view = await stockTakeToApi(ctx, st);
  const lost: string[] = [];
  const moved: string[] = [];
  const skipped: { barcode: string; reason: string }[] = [];
  if (input.mark_missing_lost) {
    for (const u of view.missing) {
      await setStockItemStatus(ctx, u.id, 'lost', `missing in stock take ${st.id}`, { system: true });
      lost.push(u.barcode);
    }
  }
  if (input.move_found) {
    for (const u of view.elsewhere.filter((x: any) => x.location_id !== st.location_id && x.status !== 'out')) {
      await ctx.db.query('SAVEPOINT stock_take_move');
      try {
        await updateStockItem(ctx, u.id, { location_id: st.location_id });
        if (['lost', 'retired'].includes(u.status)) await setStockItemStatus(ctx, u.id, 'needs_inspection', `found in stock take ${st.id}`, { system: true });
        await ctx.db.query('RELEASE SAVEPOINT stock_take_move');
        moved.push(u.barcode);
      } catch (err: any) {
        await ctx.db.query('ROLLBACK TO SAVEPOINT stock_take_move');
        skipped.push({ barcode: u.barcode, reason: String(err?.message ?? err) });
      }
    }
  }
  const summary = { expected: view.counts.expected, found: view.found.length, lost, moved, skipped, unknown: view.unknown };
  const row = (await many(ctx, `UPDATE stock_takes SET status = 'applied', applied_at = now(), summary = $2 WHERE id = $1 RETURNING *`, [id, json(summary)]))[0];
  await audit(ctx, { entity_type: 'stock_take', entity_id: id, action: 'apply', extra: summary });
  return stockTakeToApi(ctx, row);
}

export async function cancelStockTake(ctx: Ctx, id: string) {
  await openTake(ctx, id);
  const row = (await many(ctx, `UPDATE stock_takes SET status = 'cancelled' WHERE id = $1 RETURNING *`, [id]))[0];
  return stockTakeToApi(ctx, row);
}
