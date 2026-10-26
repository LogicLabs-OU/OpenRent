import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, json, one } from '../sql.ts';
import { assignUnits, runAction } from '../orders/index.ts';
import { scanStockTake } from '../stocktakes/index.ts';
import { receiveTransfer } from '../transfers/index.ts';
import { resolveScan, type ScanMode } from './index.ts';

/**
 * Offline scans sent later (FR-SCAN-5). Each item runs in its own savepoint, so one that no longer fits
 * (the unit came back another way) is reported without undoing the others. The time the scan happened
 * counts: a late return is charged up to then, not up to when the phone got its signal back.
 */
export interface ReplayItem {
  client_id: string;
  mode: ScanMode;
  code: string;
  occurred_at: string;
  order_id?: string | null;
  stock_take_id?: string | null;
}

export type ReplayStatus = 'applied' | 'conflict' | 'ignored' | 'error';

/** How far back an offline scan may be: a phone that was off for a long weekend still counts. */
const MAX_AGE_MS = 7 * 86400_000;

async function applyOne(ctx: Ctx, it: ReplayItem): Promise<{ status: ReplayStatus; message: string; entity?: Record<string, unknown> }> {
  const code = it.code.trim();
  if (it.mode === 'check_in') {
    const r: any = await resolveScan(ctx, { code, mode: 'check_in' });
    if (r.entity_type !== 'stock_item' || !r.entity.current_order_id || r.entity.status !== 'out') return { status: 'conflict', message: msg('scan.replay.not_out', { code }) };
    const out = await one<{ checked_out_at: Date }>(
      ctx,
      `SELECT u.checked_out_at FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id WHERE l.order_id = $1 AND u.stock_item_id = $2`,
      [r.entity.current_order_id, r.entity.id],
    );
    if (out?.checked_out_at && new Date(out.checked_out_at) > ctx.now) return { status: 'conflict', message: msg('scan.replay.before_pickup', { code }) };
    const o = await runAction(ctx, r.entity.current_order_id, 'check_in', { units: [{ barcode: code, outcome: 'ok' }] });
    return { status: 'applied', message: msg('scan.checked_in_unit', { code, number: o.number }), entity: { type: 'order', id: o.id, number: o.number } };
  }
  if (it.mode === 'prepare' || it.mode === 'check_out') {
    if (!it.order_id) return { status: 'ignored', message: msg('scan.replay.no_order', { code }) };
    const o: any = await assignUnits(ctx, it.order_id, { barcodes: [code] });
    return { status: 'applied', message: msg('scan.assigned_unit', { code, number: o.number }), entity: { type: 'order', id: o.id, number: o.number } };
  }
  if (it.mode === 'stock_take') {
    if (!it.stock_take_id) return { status: 'ignored', message: msg('scan.replay.no_stock_take', { code }) };
    const r: any = await scanStockTake(ctx, it.stock_take_id, code);
    return { status: r.result === 'unknown' ? 'conflict' : 'applied', message: r.message ?? code, entity: { type: 'stock_take', id: it.stock_take_id, result: r.result } };
  }
  if (it.mode === 'receive') {
    const r: any = await resolveScan(ctx, { code, mode: 'receive' });
    if (r.entity_type !== 'stock_item' || !r.entity.transfer_id) return { status: 'conflict', message: msg('scan.not_incoming', { code }) };
    const tr = await receiveTransfer(ctx, r.entity.transfer_id, { barcodes: [code] });
    return { status: 'applied', message: msg('scan.received_unit', { code, number: tr.number }), entity: { type: 'transfer', id: tr.id, number: tr.number } };
  }
  return { status: 'ignored', message: msg('scan.replay.lookup_only', { code }) };
}

export async function replayScans(ctx: Ctx, items: ReplayItem[]) {
  if (items.length > 100) throw invalid(msg('error.at_most_100_scans'), [{ field: 'items', code: 'too_many', message: msg('error.at_most_100_scans') }]);
  const results: ({ client_id: string; status: ReplayStatus; message: string; occurred_at: string; repeated?: boolean } & Record<string, unknown>)[] = [];
  for (const it of items) {
    const done = await one<{ result: any }>(ctx, `SELECT result FROM scan_replays WHERE client_id = $1`, [it.client_id]);
    if (done) {
      results.push({ ...done.result, repeated: true });
      continue;
    }
    const at = new Date(it.occurred_at);
    let result: { status: ReplayStatus; message: string; entity?: Record<string, unknown> };
    if (Number.isNaN(at.getTime()) || at.getTime() > ctx.now.getTime() + 60_000 || ctx.now.getTime() - at.getTime() > MAX_AGE_MS) {
      result = { status: 'error', message: msg('scan.replay.bad_time', { code: it.code }) };
    } else {
      await ctx.db.query('SAVEPOINT scan_replay');
      try {
        result = await applyOne({ ...ctx, now: at }, it);
        await ctx.db.query('RELEASE SAVEPOINT scan_replay');
      } catch (e) {
        await ctx.db.query('ROLLBACK TO SAVEPOINT scan_replay');
        if (!(e instanceof AppError)) throw e;
        result = { status: e.status === 409 || e.status === 422 ? 'conflict' : 'error', message: e.message };
      }
    }
    const row = { client_id: it.client_id, mode: it.mode, code: it.code, occurred_at: Number.isNaN(at.getTime()) ? it.occurred_at : at.toISOString(), ...result };
    await exec(ctx, `INSERT INTO scan_replays (id, tenant_id, client_id, mode, code, occurred_at, result, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      newId('srp'), ctx.tenantId, it.client_id, it.mode, it.code, Number.isNaN(at.getTime()) ? ctx.now : at, json(row), ctx.actor.id,
    ]);
    // The time it happened and the time it reached the server are both kept.
    await audit(ctx, { entity_type: 'scan', entity_id: it.client_id, action: 'replay', after: row, extra: { received_at: ctx.now.toISOString() } });
    results.push(row);
  }
  const count = (s: ReplayStatus) => results.filter((r) => r.status === s).length;
  return { object: 'scan_replay', results, applied: count('applied'), conflicts: count('conflict'), ignored: count('ignored'), errors: count('error') };
}
