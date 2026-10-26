import type { Ctx } from '../context.ts';
import { invalid } from '../errors.ts';
import { t as msg } from '../i18n/index.ts';
import { many } from '../sql.ts';

/**
 * The unit planner (FR-AV-9): every unit of a location as a row, with its bookings, transfers and
 * downtime as bars over at most 31 days; quantity still waiting for a unit is listed per product.
 */
export const MAX_DAYS = 31;
export const MAX_UNITS = 200;

export interface PlannerQuery {
  from: string;
  days?: number;
  location_id: string;
  product_id?: string;
  category_id?: string;
}

export async function planner(ctx: Ctx, q: PlannerQuery) {
  const days = q.days ?? 14;
  const from = new Date(q.from);
  if (Number.isNaN(from.getTime())) throw invalid(msg('error.from_and_to_must_be_iso_dates'), [{ field: 'from', code: 'invalid', message: msg('error.field.invalid_date_time') }]);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw invalid(msg('error.planner_days', { max: MAX_DAYS }), [{ field: 'days', code: 'out_of_range', message: msg('error.planner_days', { max: MAX_DAYS }) }]);
  const to = new Date(from.getTime() + days * 86400_000);
  const units = await many<any>(
    ctx,
    `SELECT s.id, s.barcode, s.status, s.variant_id, s.bin, p.id AS product_id, p.name AS product_name, v.name AS variant_name
       FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
      WHERE s.location_id = $1 AND s.status NOT IN ('retired','lost') AND v.deleted_at IS NULL AND p.deleted_at IS NULL
        AND ($2::text IS NULL OR p.id = $2) AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = $3))
      ORDER BY p.name, v.name, s.barcode LIMIT $4`,
    [q.location_id, q.product_id ?? null, q.category_id ?? null, MAX_UNITS + 1],
  );
  const truncated = units.length > MAX_UNITS;
  const shown = units.slice(0, MAX_UNITS);
  const bars = await many<any>(
    ctx,
    `SELECT a.id, a.kind, a.stock_item_id, lower(a.period) AS s, upper(a.period) AS e, a.order_id, a.order_line_id, a.transfer_line_id,
            o.number AS order_number, o.status AS order_status, c.name AS customer_name,
            EXISTS (SELECT 1 FROM order_line_units u WHERE u.allocation_id = a.id AND u.checked_out_at IS NOT NULL) AS checked_out
       FROM allocations a LEFT JOIN orders o ON o.id = a.order_id LEFT JOIN customers c ON c.id = o.customer_id
      WHERE a.stock_item_id = ANY($1::text[]) AND a.period && tstzrange($2, $3, '[)')
      ORDER BY lower(a.period)`,
    [shown.map((u) => u.id), from, to],
  );
  const byUnit = new Map<string, any[]>();
  for (const b of bars) {
    byUnit.set(b.stock_item_id, [
      ...(byUnit.get(b.stock_item_id) ?? []),
      {
        allocation_id: b.id, kind: b.kind, starts_at: new Date(b.s).toISOString(), ends_at: b.e ? new Date(b.e).toISOString() : null,
        order: b.order_id ? { id: b.order_id, number: b.order_number, status: b.order_status, customer_name: b.customer_name } : null,
        order_line_id: b.order_line_id, picked_up: b.checked_out,
        // Moving a booking to another unit is possible until it is picked up.
        movable: b.kind === 'reservation' && !b.checked_out && ['reserved', 'prepared'].includes(b.order_status),
      },
    ]);
  }
  const unassigned = await many<any>(
    ctx,
    // One row per line and period: an overbooked line holds its quantity in two allocations.
    `SELECT a.order_line_id, sum(a.quantity)::int AS quantity, lower(a.period) AS s, upper(a.period) AS e, a.variant_id, o.id AS order_id, o.number, o.status,
            c.name AS customer_name, p.name AS product_name, v.name AS variant_name
       FROM allocations a JOIN orders o ON o.id = a.order_id LEFT JOIN customers c ON c.id = o.customer_id
       JOIN variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
      WHERE a.kind = 'reservation' AND a.stock_item_id IS NULL AND v.tracking = 'serialized' AND a.location_id = $1 AND a.period && tstzrange($2, $3, '[)')
        AND ($4::text IS NULL OR p.id = $4)
      GROUP BY a.order_line_id, lower(a.period), upper(a.period), a.variant_id, o.id, o.number, o.status, c.name, p.name, v.name
      ORDER BY lower(a.period)`,
    [q.location_id, from, to, q.product_id ?? null],
  );
  // Stock rented in during the window (FR-CAT-9), shown under the rows it adds to.
  const external = await many<any>(
    ctx,
    `SELECT x.id, x.supplier, x.quantity, lower(x.period) AS s, upper(x.period) AS e, x.variant_id, p.id AS product_id, p.name AS product_name, v.name AS variant_name
       FROM external_stock x JOIN variants v ON v.id = x.variant_id JOIN products p ON p.id = v.product_id
      WHERE x.status = 'booked' AND x.location_id = $1 AND x.period && tstzrange($2, $3, '[)') AND ($4::text IS NULL OR p.id = $4)
      ORDER BY lower(x.period)`,
    [q.location_id, from, to, q.product_id ?? null],
  );
  return {
    object: 'planner', from: from.toISOString(), to: to.toISOString(), days, truncated,
    external: external.map((x) => ({
      id: x.id, supplier: x.supplier, quantity: x.quantity, variant_id: x.variant_id, product_id: x.product_id, product_name: x.product_name, variant_name: x.variant_name,
      starts_at: new Date(x.s).toISOString(), ends_at: new Date(x.e).toISOString(),
    })),
    units: shown.map((u) => ({
      id: u.id, barcode: u.barcode, status: u.status, bin: u.bin, variant_id: u.variant_id, product_id: u.product_id,
      product_name: u.product_name, variant_name: u.variant_name, bars: byUnit.get(u.id) ?? [],
    })),
    unassigned: unassigned.map((a) => ({
      order: { id: a.order_id, number: a.number, status: a.status, customer_name: a.customer_name }, order_line_id: a.order_line_id, variant_id: a.variant_id,
      product_name: a.product_name, variant_name: a.variant_name, quantity: a.quantity, starts_at: new Date(a.s).toISOString(), ends_at: a.e ? new Date(a.e).toISOString() : null,
    })),
  };
}
