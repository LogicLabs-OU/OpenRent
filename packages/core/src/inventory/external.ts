import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { many, must, one } from '../sql.ts';
import { money } from '../crud.ts';
import * as availability from '../availability/index.ts';
import { peakConcurrent } from '../availability/sweep.ts';

/**
 * Stock rented in from a supplier (FR-CAT-9). It raises the variant's capacity at the location for its
 * dates only: the availability sweep counts it as a negative span. Booking it can settle overbookings
 * that now fit; cancelling it is refused while bookings need it, unless staff insist.
 */
export interface ExternalStockInput {
  variant_id: string;
  location_id: string;
  supplier: string;
  quantity: number;
  starts_at: string;
  ends_at: string;
  unit_cost?: number;
  reference?: string | null;
  note?: string;
}

export function externalToApi(r: any) {
  const [s, e] = periodOf(r.period);
  return {
    id: r.id, object: 'external_stock', variant_id: r.variant_id, location_id: r.location_id, supplier: r.supplier, quantity: r.quantity, starts_at: s, ends_at: e,
    unit_cost: money(r.unit_cost, String(r.currency).trim()), total_cost: money(Number(r.unit_cost) * r.quantity, String(r.currency).trim()),
    reference: r.reference, note: r.note, status: r.status, product_name: r.product_name ?? undefined, variant_name: r.variant_name ?? undefined, created_at: r.created_at,
  };
}

/** A tstzrange as written by Postgres, e.g. `["2026-11-01 10:00:00+00","2026-11-05 10:00:00+00")`. */
function periodOf(p: string): [string, string] {
  const m = /^[[(]"?([^",]+)"?,"?([^")]+)"?[)\]]$/.exec(String(p));
  return m ? [new Date(m[1]!).toISOString(), new Date(m[2]!).toISOString()] : [String(p), String(p)];
}

const SELECT = `SELECT x.*, p.name AS product_name, v.name AS variant_name FROM external_stock x JOIN variants v ON v.id = x.variant_id JOIN products p ON p.id = v.product_id`;

export async function listExternalStock(ctx: Ctx, f: { variant_id?: string; location_id?: string; status?: string; from?: string; to?: string } = {}) {
  const rows = await many<any>(
    ctx,
    `${SELECT} WHERE ($1::text IS NULL OR x.variant_id = $1) AND ($2::text IS NULL OR x.location_id = $2) AND ($3::text IS NULL OR x.status = $3)
        AND ($4::timestamptz IS NULL OR upper(x.period) > $4) AND ($5::timestamptz IS NULL OR lower(x.period) < $5)
      ORDER BY lower(x.period) LIMIT 500`,
    [f.variant_id ?? null, f.location_id ?? null, f.status ?? null, f.from ?? null, f.to ?? null],
  );
  return rows.map(externalToApi);
}

export async function createExternalStock(ctx: Ctx, input: ExternalStockInput) {
  const errors: FieldError[] = [];
  const from = new Date(input.starts_at);
  const to = new Date(input.ends_at);
  if (!input.supplier?.trim()) errors.push({ field: 'supplier', code: 'required', message: msg('error.field.enter_a_supplier') });
  if (!Number.isInteger(input.quantity) || input.quantity < 1) errors.push({ field: 'quantity', code: 'invalid', message: msg('error.quantity_must_be_at_least_1') });
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) errors.push({ field: 'ends_at', code: 'invalid_range', message: msg('error.the_return_must_be_after_the_pickup') });
  if (input.unit_cost != null && (!Number.isInteger(input.unit_cost) || input.unit_cost < 0)) errors.push({ field: 'unit_cost', code: 'invalid', message: msg('settings.invalid_amount') });
  if (errors.length) throw invalid(msg('error.check_the_highlighted_fields'), errors);
  const v = await must<any>(ctx, `SELECT v.id, v.tracking, p.type FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1 AND v.deleted_at IS NULL`, [input.variant_id], 'variant', input.variant_id);
  if (v.type === 'bundle' || v.tracking === 'none') throw invalid(msg('error.external_stock_needs_tracked'), [{ field: 'variant_id', code: 'not_tracked', message: msg('error.external_stock_needs_tracked') }]);
  await must(ctx, `SELECT 1 FROM locations WHERE id = $1 AND deleted_at IS NULL`, [input.location_id], 'location', input.location_id);
  const currency = (await one<{ currency: string }>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId]))!.currency;
  await availability.lockPools(ctx, [{ variantId: v.id, locationId: input.location_id }]);
  const row = (
    await many<any>(
      ctx,
      `INSERT INTO external_stock (id, tenant_id, variant_id, location_id, supplier, quantity, period, unit_cost, currency, reference, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,tstzrange($7,$8,'[)'),$9,$10,$11,$12,$13) RETURNING *`,
      [newId('ext'), ctx.tenantId, v.id, input.location_id, input.supplier.trim().slice(0, 200), input.quantity, from, to, input.unit_cost ?? 0, currency, input.reference?.trim() || null, (input.note ?? '').slice(0, 1000), ctx.actor.id],
    )
  )[0];
  const resolved = await availability.settleOverbookings(ctx, v.id, input.location_id);
  await audit(ctx, { entity_type: 'external_stock', entity_id: row.id, action: 'create', after: row, extra: { overbookings_resolved: resolved } });
  const api = externalToApi((await one(ctx, `${SELECT} WHERE x.id = $1`, [row.id]))!);
  await emit(ctx, 'external_stock.booked', { type: 'external_stock', id: row.id }, { ...api, overbookings_resolved: resolved });
  return { ...api, overbookings_resolved: resolved };
}

/** Cancels rented-in stock; refused while bookings in its dates need it, unless `force`. */
export async function cancelExternalStock(ctx: Ctx, id: string, opts: { force?: boolean } = {}) {
  const x = await must<any>(ctx, `SELECT x.*, v.tracking FROM external_stock x JOIN variants v ON v.id = x.variant_id WHERE x.id = $1`, [id], 'external_stock', id);
  if (x.status === 'cancelled') return externalToApi(x);
  await availability.lockPools(ctx, [{ variantId: x.variant_id, locationId: x.location_id }]);
  if (!opts.force) {
    const [s, e] = periodOf(x.period).map((d) => new Date(d));
    const cap = await availability.capacity(ctx, x.variant_id, x.location_id, x.tracking);
    const without = await availability.loadSpans(ctx, x.variant_id, x.location_id, s!, e!, null, [x.id]);
    const peak = peakConcurrent(without, s!.getTime(), e!.getTime());
    if (peak > cap) throw new AppError('external_stock_in_use', 409, msg('error.external_stock_in_use', { count: peak - cap }));
  }
  const row = (await many<any>(ctx, `UPDATE external_stock SET status = 'cancelled' WHERE id = $1 RETURNING *`, [id]))[0];
  await audit(ctx, { entity_type: 'external_stock', entity_id: id, action: 'cancel', before: x, after: row, extra: { forced: !!opts.force } });
  const api = externalToApi(row);
  await emit(ctx, 'external_stock.cancelled', { type: 'external_stock', id }, api);
  return api;
}
