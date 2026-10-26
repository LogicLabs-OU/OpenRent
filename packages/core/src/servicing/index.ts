import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, must, one } from '../sql.ts';
import { notifyStaff } from '../notifications/index.ts';
import { createTicket, openTicketOf } from '../maintenance/index.ts';
import { recordServiceEvent } from './events.ts';

export { recordServiceEvent } from './events.ts';

/**
 * Meters, service intervals and depreciation (FR-CAT-10, FR-MNT-4). A unit's meter only goes up; a
 * service comes due after so many days, rentals or meter units since the last one (or since the unit
 * was bought); a daily job tells staff and opens a ticket for overdue services.
 */

// ---------------------------------------------------------------------------
// Meter readings
// ---------------------------------------------------------------------------

export type MeterSource = 'manual' | 'check_out' | 'check_in' | 'service';

export function readingToApi(r: any) {
  return { id: r.id, object: 'meter_reading', stock_item_id: r.stock_item_id, value: Number(r.value), source: r.source, order_id: r.order_id, recorded_by: r.recorded_by, recorded_at: r.recorded_at };
}

/** Adds a reading; it must not be below the last one (a trigger holds the same rule). */
export async function addMeterReading(ctx: Ctx, stockItemId: string, input: { value: number; recorded_at?: string | null; source?: MeterSource; order_id?: string | null; field?: string }) {
  const field = input.field ?? 'value';
  const unit = await must<any>(
    ctx,
    `SELECT s.id, s.barcode, s.meter_value, p.meter_unit FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.id = $1 FOR UPDATE OF s`,
    [stockItemId],
    'stock_item',
    stockItemId,
  );
  if (!unit.meter_unit) throw invalid(msg('error.check_the_reading'), [{ field, code: 'no_meter', message: msg('error.field.no_meter', { barcode: unit.barcode }) }]);
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) throw invalid(msg('error.check_the_reading'), [{ field, code: 'invalid', message: msg('error.field.meter_value') }]);
  const at = input.recorded_at ? new Date(input.recorded_at) : ctx.now;
  if (Number.isNaN(at.getTime()) || at > new Date(ctx.now.getTime() + 60_000)) throw invalid(msg('error.check_the_reading'), [{ field: 'recorded_at', code: 'invalid', message: msg('error.field.reading_time') }]);
  const before = await one<{ value: number }>(ctx, `SELECT value FROM meter_readings WHERE stock_item_id = $1 AND recorded_at <= $2 ORDER BY recorded_at DESC, created_at DESC LIMIT 1`, [unit.id, at]);
  const after = await one<{ value: number }>(ctx, `SELECT value FROM meter_readings WHERE stock_item_id = $1 AND recorded_at > $2 ORDER BY recorded_at, created_at LIMIT 1`, [unit.id, at]);
  if ((before && value < Number(before.value)) || (after && value > Number(after.value)))
    throw invalid(msg('error.check_the_reading'), [{ field, code: 'meter_decreasing', message: msg('error.field.meter_below_last', { value: Number(before?.value ?? after?.value), unit: unit.meter_unit }) }]);
  const id = newId('mtr');
  await exec(ctx, `INSERT INTO meter_readings (id, tenant_id, stock_item_id, value, source, order_id, recorded_by, recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    id, ctx.tenantId, unit.id, value, input.source ?? 'manual', input.order_id ?? null, ctx.actor.type === 'user' ? ctx.actor.id : null, at,
  ]);
  await exec(ctx, `UPDATE stock_items SET meter_value = (SELECT value FROM meter_readings WHERE stock_item_id = $1 ORDER BY recorded_at DESC, created_at DESC LIMIT 1) WHERE id = $1`, [unit.id]);
  const row = readingToApi(await must(ctx, `SELECT * FROM meter_readings WHERE id = $1`, [id], 'meter_reading'));
  await audit(ctx, { entity_type: 'stock_item', entity_id: unit.id, action: 'meter_reading', after: row });
  await emit(ctx, 'stock_item.meter_read', { type: 'stock_item', id: unit.id }, row);
  return row;
}

export async function listMeterReadings(ctx: Ctx, stockItemId: string) {
  return (await many(ctx, `SELECT * FROM meter_readings WHERE stock_item_id = $1 ORDER BY recorded_at DESC, created_at DESC LIMIT 200`, [stockItemId])).map(readingToApi);
}

/** Readings given at pickup or return, by unit id or barcode; each problem is reported against its line. */
export async function recordReadings(ctx: Ctx, orderId: string, source: 'check_out' | 'check_in', readings: { stock_item_id?: string; barcode?: string; value: number }[] = []) {
  const errors: FieldError[] = [];
  for (const [i, r] of readings.entries()) {
    const id = r.stock_item_id ?? (r.barcode ? (await one<{ id: string }>(ctx, `SELECT id FROM stock_items WHERE barcode = $1`, [r.barcode.trim()]))?.id : undefined);
    if (!id) {
      errors.push({ field: `meter_readings[${i}]`, code: 'not_found', message: msg('scan.not_found', { code: r.barcode ?? r.stock_item_id ?? '' }) });
      continue;
    }
    try {
      await addMeterReading(ctx, id, { value: r.value, source, order_id: orderId, field: `meter_readings[${i}].value` });
    } catch (e) {
      if (e instanceof AppError && e.errors) errors.push(...e.errors);
      else throw e;
    }
  }
  if (errors.length) throw invalid(msg('error.check_the_reading'), errors);
}

// ---------------------------------------------------------------------------
// Service intervals
// ---------------------------------------------------------------------------

export interface IntervalInput {
  name?: string;
  product_id?: string | null;
  category_id?: string | null;
  every_days?: number | null;
  every_rentals?: number | null;
  every_meter?: number | null;
  opens_ticket?: boolean;
  active?: boolean;
}

export function intervalToApi(r: any) {
  return {
    id: r.id, object: 'service_interval', name: r.name, product_id: r.product_id, product_name: r.product_name ?? null, category_id: r.category_id, category_name: r.category_name ?? null,
    every_days: r.every_days, every_rentals: r.every_rentals, every_meter: r.every_meter == null ? null : Number(r.every_meter), opens_ticket: r.opens_ticket, active: r.active,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

const INTERVAL_SELECT = `SELECT si.*, p.name AS product_name, c.name AS category_name FROM service_intervals si
  LEFT JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = si.category_id`;

async function checkInterval(ctx: Ctx, input: IntervalInput, merged: IntervalInput) {
  const errors: FieldError[] = [];
  if (input.name !== undefined && !input.name.trim()) errors.push({ field: 'name', code: 'required', message: msg('error.field.enter_a_name') });
  for (const k of ['every_days', 'every_rentals', 'every_meter'] as const) {
    const v = input[k];
    if (v != null && (!(Number(v) > 0) || (k !== 'every_meter' && !Number.isInteger(v)))) errors.push({ field: k, code: 'invalid', message: msg('error.field.interval_value') });
  }
  if (!(merged.every_days || merged.every_rentals || merged.every_meter)) errors.push({ field: 'every_days', code: 'required', message: msg('error.field.interval_some') });
  if (merged.product_id && merged.category_id) errors.push({ field: 'category_id', code: 'invalid', message: msg('error.field.interval_one_scope') });
  if (input.product_id && !(await one(ctx, `SELECT 1 FROM products WHERE id = $1 AND deleted_at IS NULL`, [input.product_id]))) errors.push({ field: 'product_id', code: 'not_found', message: msg('error.field.unknown_product') });
  if (input.category_id && !(await one(ctx, `SELECT 1 FROM categories WHERE id = $1`, [input.category_id]))) errors.push({ field: 'category_id', code: 'not_found', message: msg('error.field.unknown_category') });
  if (merged.every_meter && merged.product_id) {
    const p = await one<{ meter_unit: string | null }>(ctx, `SELECT meter_unit FROM products WHERE id = $1`, [merged.product_id]);
    if (p && !p.meter_unit) errors.push({ field: 'every_meter', code: 'no_meter', message: msg('error.field.interval_no_meter') });
  }
  if (errors.length) throw invalid(msg('error.check_the_interval'), errors);
}

export async function listIntervals(ctx: Ctx) {
  return (await many(ctx, `${INTERVAL_SELECT} WHERE si.deleted_at IS NULL ORDER BY si.name`)).map(intervalToApi);
}

export async function createInterval(ctx: Ctx, input: IntervalInput) {
  if (input.name === undefined) input = { ...input, name: '' };
  await checkInterval(ctx, input, input);
  const id = newId('svi');
  await exec(
    ctx,
    `INSERT INTO service_intervals (id, tenant_id, name, product_id, category_id, every_days, every_rentals, every_meter, opens_ticket, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, ctx.tenantId, input.name!.trim(), input.product_id || null, input.category_id || null, input.every_days || null, input.every_rentals || null, input.every_meter || null, input.opens_ticket ?? true, input.active ?? true],
  );
  const row = intervalToApi(await must(ctx, `${INTERVAL_SELECT} WHERE si.id = $1`, [id], 'service_interval'));
  await audit(ctx, { entity_type: 'service_interval', entity_id: id, action: 'create', after: row });
  return row;
}

export async function updateInterval(ctx: Ctx, id: string, input: IntervalInput) {
  const before = await must<any>(ctx, `SELECT * FROM service_intervals WHERE id = $1 AND deleted_at IS NULL`, [id], 'service_interval', id);
  const merged = { ...intervalToApi(before), ...input };
  await checkInterval(ctx, input, merged);
  const cols = ['name', 'product_id', 'category_id', 'every_days', 'every_rentals', 'every_meter', 'opens_ticket', 'active'] as const;
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const c of cols)
    if (input[c] !== undefined) {
      vals.push(c === 'name' ? input.name!.trim() : typeof input[c] === 'boolean' ? input[c] : input[c] || null);
      sets.push(`${c} = $${vals.length}`);
    }
  if (sets.length) await exec(ctx, `UPDATE service_intervals SET ${sets.join(', ')} WHERE id = $1`, vals);
  const after = intervalToApi(await must(ctx, `${INTERVAL_SELECT} WHERE si.id = $1`, [id], 'service_interval'));
  await audit(ctx, { entity_type: 'service_interval', entity_id: id, action: 'update', before, after });
  return after;
}

export async function deleteInterval(ctx: Ctx, id: string) {
  const before = await must<any>(ctx, `SELECT * FROM service_intervals WHERE id = $1 AND deleted_at IS NULL`, [id], 'service_interval', id);
  await exec(ctx, `UPDATE service_intervals SET deleted_at = now(), active = false WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'service_interval', entity_id: id, action: 'delete', before });
}

// ---------------------------------------------------------------------------
// What is due
// ---------------------------------------------------------------------------

const DAY = 86400_000;
/** "Due soon": within a week, one rental, or 10% of the meter interval. */
const SOON_DAYS = 7;

export interface DueRow {
  object: 'service_due';
  status: 'overdue' | 'due_soon';
  interval: ReturnType<typeof intervalToApi>;
  stock_item: { id: string; barcode: string; status: string; location_id: string; product_name: string; meter_value: number | null; meter_unit: string | null };
  last_service_at: string | null;
  /** Each limit with how far along the unit is. */
  reasons: { kind: 'days' | 'rentals' | 'meter'; due_at?: string; rentals?: number; meter_since?: number; every: number; overdue: boolean }[];
  open_ticket_id: string | null;
}

/** Units whose service is overdue or due soon, overdue first. */
export async function serviceDue(ctx: Ctx, f: { location_id?: string; interval_id?: string; stock_item_id?: string; status?: 'overdue' | 'due_soon' } = {}): Promise<DueRow[]> {
  const intervals = (await many(ctx, `${INTERVAL_SELECT} WHERE si.deleted_at IS NULL AND si.active AND ($1::text IS NULL OR si.id = $1)`, [f.interval_id ?? null])).map(intervalToApi);
  const out: DueRow[] = [];
  for (const iv of intervals) {
    const units = await many<any>(
      ctx,
      `SELECT s.id, s.barcode, s.status, s.location_id, s.meter_value, s.purchase_date, s.created_at, p.name AS product_name, p.meter_unit,
              (SELECT max(e.performed_at) FROM service_events e WHERE e.stock_item_id = s.id AND e.interval_id = $1) AS last_at,
              (SELECT e.meter_value FROM service_events e WHERE e.stock_item_id = s.id AND e.interval_id = $1 ORDER BY e.performed_at DESC LIMIT 1) AS last_meter
         FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
        WHERE s.status NOT IN ('retired','lost') AND v.deleted_at IS NULL
          AND ($2::text IS NULL OR p.id = $2)
          AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = $3))
          AND ($4::text IS NULL OR s.location_id = $4) AND ($5::text IS NULL OR s.id = $5)
        ORDER BY s.barcode LIMIT 5000`,
      [iv.id, iv.product_id, iv.category_id, f.location_id ?? null, f.stock_item_id ?? null],
    );
    for (const u of units) {
      const since = new Date(u.last_at ?? u.purchase_date ?? u.created_at);
      const reasons: DueRow['reasons'] = [];
      if (iv.every_days) {
        const due = new Date(since.getTime() + iv.every_days * DAY);
        if (due.getTime() - ctx.now.getTime() <= SOON_DAYS * DAY) reasons.push({ kind: 'days', due_at: due.toISOString(), every: iv.every_days, overdue: due <= ctx.now });
      }
      if (iv.every_rentals) {
        const n = (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM order_line_units WHERE stock_item_id = $1 AND checked_out_at > $2`, [u.id, since]))!.n;
        if (n >= iv.every_rentals - 1) reasons.push({ kind: 'rentals', rentals: n, every: iv.every_rentals, overdue: n >= iv.every_rentals });
      }
      if (iv.every_meter && u.meter_unit && u.meter_value != null) {
        const run = Number(u.meter_value) - Number(u.last_meter ?? 0);
        if (run >= iv.every_meter * 0.9) reasons.push({ kind: 'meter', meter_since: run, every: iv.every_meter, overdue: run >= iv.every_meter });
      }
      if (!reasons.length) continue;
      const status = reasons.some((r) => r.overdue) ? 'overdue' : 'due_soon';
      if (f.status && f.status !== status) continue;
      out.push({
        object: 'service_due', status, interval: iv,
        stock_item: { id: u.id, barcode: u.barcode, status: u.status, location_id: u.location_id, product_name: u.product_name, meter_value: u.meter_value == null ? null : Number(u.meter_value), meter_unit: u.meter_unit },
        last_service_at: u.last_at ? new Date(u.last_at).toISOString() : null, reasons,
        open_ticket_id: (await openTicketOf(ctx, u.id))?.id ?? null,
      });
    }
  }
  return out.sort((a, b) =>
    a.status !== b.status ? (a.status === 'overdue' ? -1 : 1) : a.stock_item.barcode.localeCompare(b.stock_item.barcode) || a.interval.name.localeCompare(b.interval.name),
  );
}

/** Records a service done without a ticket (from the unit page). */
export async function recordService(ctx: Ctx, stockItemId: string, input: { interval_id: string; notes?: string; performed_at?: string | null }) {
  await must(ctx, `SELECT 1 FROM stock_items WHERE id = $1`, [stockItemId], 'stock_item', stockItemId);
  if (!(await one(ctx, `SELECT 1 FROM service_intervals WHERE id = $1 AND deleted_at IS NULL`, [input.interval_id])))
    throw invalid(msg('error.check_the_interval'), [{ field: 'interval_id', code: 'not_found', message: msg('error.field.unknown_interval') }]);
  return recordServiceEvent(ctx, stockItemId, input);
}

export async function listServiceEvents(ctx: Ctx, stockItemId: string) {
  return many(
    ctx,
    `SELECT e.id, 'service_event' AS object, e.stock_item_id, e.interval_id, si.name AS interval_name, e.performed_at, e.meter_value, e.ticket_id, e.notes, e.performed_by, u.name AS performed_by_name
       FROM service_events e JOIN service_intervals si ON si.id = e.interval_id LEFT JOIN users u ON u.id = e.performed_by
      WHERE e.stock_item_id = $1 ORDER BY e.performed_at DESC LIMIT 100`,
    [stockItemId],
  );
}

/**
 * Daily (FR-MNT-4): staff hear about each overdue service once, and services that open tickets get one
 * (the unit stays in service until staff decide otherwise).
 */
export async function runServiceDue(ctx: Ctx) {
  let tickets = 0;
  const overdue = await serviceDue(ctx, { status: 'overdue' });
  for (const d of overdue) {
    const key = `service:${d.stock_item.id}:${d.interval.id}:${d.last_service_at ?? 'never'}`;
    await notifyStaff(ctx, null, 'staff_service_due', { name: d.interval.name, barcode: d.stock_item.barcode, product: d.stock_item.product_name }, key);
    if (d.interval.opens_ticket && !d.open_ticket_id && ['available', 'reserved'].includes(d.stock_item.status)) {
      await createTicket(ctx, {
        stock_item_ids: [d.stock_item.id], title: msg('service.ticket_title', { name: d.interval.name, barcode: d.stock_item.barcode }), keep_in_service: true, service_interval_id: d.interval.id,
      });
      tickets++;
    }
  }
  return { overdue: overdue.length, tickets };
}

// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

/** Months between two dates, counting part months as fractions. */
const monthsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (DAY * 30.436875);

/**
 * Straight-line book value of a unit (FR-CAT-10): the purchase price goes down evenly over the product's
 * life to its residual share. Null when the unit has no price or date, or the product no life.
 */
export function depreciation(unit: { purchase_price: number | null; purchase_date: string | Date | null }, product: { depreciation_months: number | null; residual_bp: number }, now: Date) {
  if (unit.purchase_price == null || !unit.purchase_date || !product.depreciation_months) return null;
  const price = Number(unit.purchase_price);
  const residual = Math.round((price * Number(product.residual_bp ?? 0)) / 10000);
  const start = new Date(unit.purchase_date);
  const months = Math.max(0, Math.min(product.depreciation_months, monthsBetween(start, now)));
  const monthly = (price - residual) / product.depreciation_months;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + product.depreciation_months);
  return {
    purchase_price: price, residual_value: residual, book_value: Math.round(price - monthly * months), depreciated: Math.round(monthly * months),
    monthly: Math.round(monthly), months_elapsed: Math.floor(months), life_months: product.depreciation_months, fully_depreciated_at: end.toISOString().slice(0, 10),
  };
}

/** A unit's meter, service and value at a glance, for the unit page. */
export async function unitUpkeep(ctx: Ctx, stockItemId: string) {
  const u = await must<any>(
    ctx,
    `SELECT s.*, p.meter_unit, p.depreciation_months, p.residual_bp FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.id = $1`,
    [stockItemId],
    'stock_item',
    stockItemId,
  );
  const tenant = await must<{ currency: string }>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  return {
    object: 'unit_upkeep',
    meter: { unit: u.meter_unit, value: u.meter_value == null ? null : Number(u.meter_value), readings: await listMeterReadings(ctx, stockItemId) },
    service: { due: await serviceDue(ctx, { stock_item_id: stockItemId }), history: await listServiceEvents(ctx, stockItemId) },
    depreciation: depreciation(u, u, ctx.now),
    currency: tenant.currency.trim(),
  };
}
