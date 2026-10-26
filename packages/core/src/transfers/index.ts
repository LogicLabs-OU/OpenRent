import type { Ctx } from '../context.ts';
import { conflict, invalid, notFound, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, must, one } from '../sql.ts';
import * as availability from '../availability/index.ts';
import { adjustStockLevel, setStockItemStatus, type StockStatus } from '../inventory/index.ts';

/**
 * Stock transfers between locations (FR-LOC-2, ADR 0007). A planned transfer holds its units and
 * quantities at the source from the day it ships; dispatch moves the stock to the destination, where it
 * stays held until the ETA; receiving puts it into service there, and whatever never arrives is lost.
 */
export type TransferStatus = 'planned' | 'in_transit' | 'received' | 'cancelled';

export interface TransferLineInput {
  stock_item_id?: string;
  barcode?: string;
  variant_id?: string;
  quantity?: number;
}

export interface TransferInput {
  from_location_id: string;
  to_location_id: string;
  ships_at?: string;
  eta?: string | null;
  notes?: string;
  lines: TransferLineInput[];
}

/** Unit statuses that may travel. Units out of service keep their downtime where they are. */
const MOVABLE = ['available', 'reserved'];

export function transferToApi(t: any, lines: any[]) {
  return {
    id: t.id, object: 'transfer', number: t.number, status: t.status as TransferStatus,
    from_location_id: t.from_location_id, from_location_name: t.from_location_name ?? null,
    to_location_id: t.to_location_id, to_location_name: t.to_location_name ?? null,
    ships_at: t.ships_at, eta: t.eta, notes: t.notes, dispatched_at: t.dispatched_at, received_at: t.received_at, cancelled_at: t.cancelled_at,
    lines: lines.map((l) => ({
      id: l.id, variant_id: l.variant_id, product_name: l.product_name, variant_name: l.variant_name, stock_item_id: l.stock_item_id, barcode: l.barcode ?? null,
      quantity: l.quantity, received_quantity: l.received_quantity, lost_quantity: l.lost_quantity, outstanding: l.quantity - l.received_quantity - l.lost_quantity,
    })),
    created_at: t.created_at, updated_at: t.updated_at,
  };
}

const SELECT = `SELECT t.*, f.name AS from_location_name, d.name AS to_location_name FROM transfers t
  JOIN locations f ON f.id = t.from_location_id JOIN locations d ON d.id = t.to_location_id`;

async function lineRows(ctx: Ctx, transferIds: string[]) {
  return many<any>(
    ctx,
    `SELECT l.*, p.name AS product_name, v.name AS variant_name, v.tracking, s.barcode FROM transfer_lines l
       JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN stock_items s ON s.id = l.stock_item_id
      WHERE l.transfer_id = ANY($1::text[]) ORDER BY l.position, l.created_at`,
    [transferIds],
  );
}

async function row(ctx: Ctx, id: string, lock = false) {
  const t = await one<any>(ctx, `${SELECT} WHERE t.id = $1${lock ? ' FOR UPDATE OF t' : ''}`, [id]);
  if (!t) throw notFound('transfer', id);
  return t;
}

export async function getTransfer(ctx: Ctx, id: string) {
  return transferToApi(await row(ctx, id), await lineRows(ctx, [id]));
}

/** Transfers by status, newest first; `location_id` matches either end. */
export async function listTransfers(ctx: Ctx, f: { status?: string; location_id?: string; limit?: number } = {}) {
  const statuses = f.status ? f.status.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const rows = await many<any>(
    ctx,
    `${SELECT} WHERE ($1::text[] IS NULL OR t.status = ANY($1)) AND ($2::text IS NULL OR $2 IN (t.from_location_id, t.to_location_id))
     ORDER BY t.number DESC LIMIT $3`,
    [statuses, f.location_id ?? null, Math.min(f.limit ?? 100, 200)],
  );
  const lines = await lineRows(ctx, rows.map((r) => r.id));
  return rows.map((r) => transferToApi(r, lines.filter((l) => l.transfer_id === r.id)));
}

function needStatus(t: any, ...ok: TransferStatus[]) {
  if (!ok.includes(t.status)) throw conflict('invalid_transition', msg('error.transfer_has_status', { number: t.number, status: msg(`transfer.status.${t.status as TransferStatus}`) }));
}

/** Resolves the lines: units by id or barcode, bulk variants by quantity. Every problem is reported against its line. */
async function resolveLines(ctx: Ctx, from: { id: string; name: string }, lines: TransferLineInput[]) {
  const errors: FieldError[] = [];
  const out: { variant_id: string; stock_item_id: string | null; quantity: number; ref: string }[] = [];
  const seen = new Set<string>();
  for (const [i, l] of lines.entries()) {
    const field = `lines[${i}]`;
    if (l.stock_item_id || l.barcode) {
      const u = await one<any>(ctx, `SELECT id, barcode, variant_id, location_id, status FROM stock_items WHERE ${l.stock_item_id ? 'id' : 'barcode'} = $1`, [l.stock_item_id ?? l.barcode!.trim()]);
      if (!u) errors.push({ field, code: 'not_found', message: msg('scan.not_found', { code: l.barcode ?? l.stock_item_id! }) });
      else if (seen.has(u.id)) errors.push({ field, code: 'duplicate', message: msg('error.field.transfer_unit_twice', { barcode: u.barcode }) });
      else if (u.location_id !== from.id) errors.push({ field, code: 'wrong_location', message: msg('error.field.transfer_unit_elsewhere', { barcode: u.barcode, location: from.name }) });
      else if (!MOVABLE.includes(u.status)) errors.push({ field, code: 'unit_unavailable', message: msg('error.field.transfer_unit_status', { barcode: u.barcode, status: msg(`stock.status.${u.status as StockStatus}`) }) });
      else {
        seen.add(u.id);
        out.push({ variant_id: u.variant_id, stock_item_id: u.id, quantity: 1, ref: field });
      }
      continue;
    }
    const v = l.variant_id ? await one<{ tracking: string }>(ctx, `SELECT tracking FROM variants WHERE id = $1 AND deleted_at IS NULL`, [l.variant_id]) : null;
    if (!v) errors.push({ field, code: 'required', message: msg('error.field.transfer_choose_stock') });
    else if (v.tracking === 'serialized') errors.push({ field, code: 'units_required', message: msg('error.field.transfer_needs_units') });
    else if (v.tracking === 'none') errors.push({ field, code: 'untracked', message: msg('error.field.transfer_untracked') });
    else if (!Number.isInteger(l.quantity) || l.quantity! < 1) errors.push({ field: `${field}.quantity`, code: 'invalid', message: msg('error.field.enter_a_quantity') });
    else out.push({ variant_id: l.variant_id!, stock_item_id: null, quantity: l.quantity!, ref: field });
  }
  if (errors.length) throw invalid(msg('error.check_the_transfer'), errors);
  return out;
}

async function nextNumber(ctx: Ctx) {
  await exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, [`${ctx.tenantId}|transfers`]);
  return (await one<{ n: number }>(ctx, `SELECT coalesce(max(number), 0)::int + 1 AS n FROM transfers`))!.n;
}

/** Plans a transfer and holds its stock at the source from `ships_at` (default now). */
export async function createTransfer(ctx: Ctx, input: TransferInput) {
  const errors: FieldError[] = [];
  const from = await one<any>(ctx, `SELECT id, name FROM locations WHERE id = $1 AND deleted_at IS NULL`, [input.from_location_id]);
  const to = await one<any>(ctx, `SELECT id, name FROM locations WHERE id = $1 AND deleted_at IS NULL`, [input.to_location_id]);
  if (!from) errors.push({ field: 'from_location_id', code: 'not_found', message: msg('error.field.choose_a_location') });
  if (!to) errors.push({ field: 'to_location_id', code: 'not_found', message: msg('error.field.choose_a_location') });
  else if (from && from.id === to.id) errors.push({ field: 'to_location_id', code: 'same_location', message: msg('error.field.transfer_same_location') });
  const shipsAt = input.ships_at ? new Date(input.ships_at) : ctx.now;
  const eta = input.eta ? new Date(input.eta) : null;
  if (Number.isNaN(shipsAt.getTime())) errors.push({ field: 'ships_at', code: 'invalid', message: msg('error.field.invalid_date_time') });
  if (eta && (Number.isNaN(eta.getTime()) || eta <= shipsAt)) errors.push({ field: 'eta', code: 'invalid_range', message: msg('error.field.transfer_eta_before_ship') });
  if (!input.lines?.length) errors.push({ field: 'lines', code: 'required', message: msg('error.field.transfer_add_lines') });
  if (errors.length) throw invalid(msg('error.check_the_transfer'), errors);
  const lines = await resolveLines(ctx, from, input.lines);

  const id = newId('trf');
  const number = await nextNumber(ctx);
  await exec(
    ctx,
    `INSERT INTO transfers (id, tenant_id, number, from_location_id, to_location_id, ships_at, eta, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, ctx.tenantId, number, from.id, to.id, shipsAt, eta, input.notes?.trim() ?? '', ctx.actor.id],
  );
  for (const [i, l] of lines.entries()) {
    const lineId = newId('trl');
    await exec(ctx, `INSERT INTO transfer_lines (id, tenant_id, transfer_id, variant_id, stock_item_id, quantity, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      lineId, ctx.tenantId, id, l.variant_id, l.stock_item_id, l.quantity, i,
    ]);
    await availability.holdForTransfer(ctx, { transferLineId: lineId, variantId: l.variant_id, locationId: from.id, stockItemId: l.stock_item_id, quantity: l.quantity, from: shipsAt, ref: l.ref });
  }
  const api = await getTransfer(ctx, id);
  await audit(ctx, { entity_type: 'transfer', entity_id: id, action: 'create', after: api });
  await emit(ctx, 'transfer.created', { type: 'transfer', id }, api);
  return api;
}

/** Notes and the expected arrival can change until the transfer leaves. */
export async function updateTransfer(ctx: Ctx, id: string, patch: { notes?: string; eta?: string | null }) {
  const t = await row(ctx, id, true);
  if (patch.eta !== undefined) {
    needStatus(t, 'planned');
    const eta = patch.eta ? new Date(patch.eta) : null;
    if (eta && (Number.isNaN(eta.getTime()) || eta <= new Date(t.ships_at)))
      throw invalid(msg('error.check_the_transfer'), [{ field: 'eta', code: 'invalid_range', message: msg('error.field.transfer_eta_before_ship') }]);
  }
  const before = await getTransfer(ctx, id);
  await exec(ctx, `UPDATE transfers SET notes = coalesce($2, notes), eta = CASE WHEN $3 THEN $4::timestamptz ELSE eta END WHERE id = $1`, [
    id, patch.notes?.trim() ?? null, patch.eta !== undefined, patch.eta || null,
  ]);
  const after = await getTransfer(ctx, id);
  await audit(ctx, { entity_type: 'transfer', entity_id: id, action: 'update', before, after });
  return after;
}

/** Sends the stock: units and quantities move to the destination and travel until the ETA. */
export async function dispatchTransfer(ctx: Ctx, id: string) {
  const t = await row(ctx, id, true);
  needStatus(t, 'planned');
  const lines = await lineRows(ctx, [id]);
  const reference = `#${t.number}`;
  for (const l of lines) {
    await availability.startTransit(ctx, l.id, {
      at: ctx.now,
      toLocationId: t.to_location_id,
      until: t.eta ? new Date(t.eta) : null,
      move: async () => {
        if (l.stock_item_id) {
          const u = await must<any>(ctx, `SELECT id, barcode, status, location_id FROM stock_items WHERE id = $1 FOR UPDATE`, [l.stock_item_id], 'stock_item');
          if (u.location_id !== t.from_location_id || !MOVABLE.includes(u.status))
            throw conflict('unit_unavailable', msg('error.field.transfer_unit_status', { barcode: u.barcode, status: msg(`stock.status.${u.status as StockStatus}`) }));
          await exec(ctx, `UPDATE stock_items SET location_id = $2, status = 'in_transit' WHERE id = $1`, [u.id, t.to_location_id]);
          await audit(ctx, { entity_type: 'stock_item', entity_id: u.id, action: 'transfer', before: { location_id: u.location_id, status: u.status }, after: { location_id: t.to_location_id, status: 'in_transit' }, extra: { transfer_id: id } });
          return;
        }
        const have = (await one<{ quantity: number }>(ctx, `SELECT quantity FROM stock_levels WHERE variant_id = $1 AND location_id = $2 FOR UPDATE`, [l.variant_id, t.from_location_id]))?.quantity ?? 0;
        if (have < l.quantity) throw conflict('not_enough_stock', msg('error.transfer_not_enough_stock', { count: have, name: l.product_name, location: t.from_location_name }));
        await adjustStockLevel(ctx, l.variant_id, t.from_location_id, -l.quantity, 'transfer_out', reference);
        await adjustStockLevel(ctx, l.variant_id, t.to_location_id, l.quantity, 'transfer_in', reference);
      },
    });
  }
  await exec(ctx, `UPDATE transfers SET status = 'in_transit', dispatched_at = $2 WHERE id = $1`, [id, ctx.now]);
  const api = await getTransfer(ctx, id);
  await audit(ctx, { entity_type: 'transfer', entity_id: id, action: 'dispatch', after: api });
  await emit(ctx, 'transfer.dispatched', { type: 'transfer', id }, api);
  return api;
}

export interface ReceiveInput {
  /** Quantities that arrived, per line. */
  lines?: { line_id: string; quantity: number }[];
  /** Units that arrived, by barcode (the scan page sends these). */
  barcodes?: string[];
  /** Closes the transfer: whatever has not arrived is written off as lost. */
  complete?: boolean;
}

/**
 * Books what arrived. Without lines or barcodes everything still on the way arrives. The transfer is
 * received once nothing is outstanding, or when `complete` writes the rest off as lost.
 */
export async function receiveTransfer(ctx: Ctx, id: string, input: ReceiveInput = {}) {
  const t = await row(ctx, id, true);
  needStatus(t, 'in_transit');
  const lines = await lineRows(ctx, [id]);
  const outstanding = (l: any) => l.quantity - l.received_quantity - l.lost_quantity;
  const arrived = new Map<string, number>();
  const errors: FieldError[] = [];
  const given = (input.lines?.length ?? 0) + (input.barcodes?.length ?? 0) > 0;
  if (!given && !input.complete) for (const l of lines) if (outstanding(l) > 0) arrived.set(l.id, outstanding(l));
  for (const [i, x] of (input.lines ?? []).entries()) {
    const l = lines.find((y) => y.id === x.line_id);
    if (!l) errors.push({ field: `lines[${i}].line_id`, code: 'not_found', message: msg('error.field.not_on_this_transfer') });
    else if (!Number.isInteger(x.quantity) || x.quantity < 0 || x.quantity + (arrived.get(l.id) ?? 0) > outstanding(l))
      errors.push({ field: `lines[${i}].quantity`, code: 'invalid', message: msg('error.field.transfer_receive_too_many', { count: outstanding(l) - (arrived.get(l.id) ?? 0) }) });
    else if (x.quantity > 0) arrived.set(l.id, (arrived.get(l.id) ?? 0) + x.quantity);
  }
  for (const [i, code] of (input.barcodes ?? []).entries()) {
    const l = lines.find((y) => y.barcode && y.barcode === code.trim());
    if (!l) errors.push({ field: `barcodes[${i}]`, code: 'not_found', message: msg('error.field.unit_not_on_this_transfer', { barcode: code }) });
    else if (outstanding(l) > 0 && !arrived.has(l.id)) arrived.set(l.id, 1);
  }
  if (errors.length) throw invalid(msg('error.check_the_transfer'), errors);

  const reference = `#${t.number}`;
  for (const l of lines) {
    const n = arrived.get(l.id) ?? 0;
    if (!n) continue;
    await availability.endTransit(ctx, l.id, n, ctx.now);
    await exec(ctx, `UPDATE transfer_lines SET received_quantity = received_quantity + $2 WHERE id = $1`, [l.id, n]);
    l.received_quantity += n;
    if (l.stock_item_id) {
      await exec(ctx, `UPDATE stock_items SET status = 'available' WHERE id = $1 AND status = 'in_transit'`, [l.stock_item_id]);
      await emit(ctx, 'stock_item.transferred', { type: 'stock_item', id: l.stock_item_id }, {
        object: 'stock_item', id: l.stock_item_id, barcode: l.barcode, from_location_id: t.from_location_id, to_location_id: t.to_location_id, transfer_id: id,
      });
    }
  }
  const done = lines.every((l) => outstanding(l) === 0);
  if (input.complete || done) {
    for (const l of lines) {
      const missing = outstanding(l);
      if (missing <= 0) continue;
      await availability.endTransit(ctx, l.id, missing, ctx.now);
      await exec(ctx, `UPDATE transfer_lines SET lost_quantity = lost_quantity + $2 WHERE id = $1`, [l.id, missing]);
      if (l.stock_item_id) await setStockItemStatus(ctx, l.stock_item_id, 'lost', msg('transfer.lost_reason', { number: t.number }), { system: true });
      else await adjustStockLevel(ctx, l.variant_id, t.to_location_id, -missing, 'lost_in_transit', reference);
    }
    await exec(ctx, `UPDATE transfers SET status = 'received', received_at = $2 WHERE id = $1`, [id, ctx.now]);
  }
  const api = await getTransfer(ctx, id);
  await audit(ctx, { entity_type: 'transfer', entity_id: id, action: 'receive', after: api, extra: { arrived: Object.fromEntries(arrived) } });
  if (api.status === 'received') await emit(ctx, 'transfer.received', { type: 'transfer', id }, api);
  return api;
}

/** Calls off a planned transfer; its stock is free again at the source. */
export async function cancelTransfer(ctx: Ctx, id: string) {
  const t = await row(ctx, id, true);
  needStatus(t, 'planned');
  await availability.releaseTransferHolds(ctx, id);
  await exec(ctx, `UPDATE transfers SET status = 'cancelled', cancelled_at = $2 WHERE id = $1`, [id, ctx.now]);
  const api = await getTransfer(ctx, id);
  await audit(ctx, { entity_type: 'transfer', entity_id: id, action: 'cancel', after: api });
  await emit(ctx, 'transfer.cancelled', { type: 'transfer', id }, api);
  return api;
}

/** Sends one unit to another location now; with `received` it is booked in there at once (carried across). */
export async function transferUnit(ctx: Ctx, stockItemId: string, input: { to_location_id: string; eta?: string | null; received?: boolean; notes?: string }) {
  const unit = await must<any>(ctx, `SELECT id, location_id FROM stock_items WHERE id = $1`, [stockItemId], 'stock_item', stockItemId);
  const planned = await createTransfer(ctx, { from_location_id: unit.location_id, to_location_id: input.to_location_id, eta: input.eta, notes: input.notes, lines: [{ stock_item_id: unit.id }] });
  const sent = await dispatchTransfer(ctx, planned.id);
  return input.received ? receiveTransfer(ctx, sent.id) : sent;
}
