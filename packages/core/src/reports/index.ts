import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { invalid } from '../errors.ts';
import { assertCan } from '../permissions.ts';
import { many, must, one } from '../sql.ts';
import * as availability from '../availability/index.ts';
import { addLocalDays, localDate, startOfLocalDay, zonedParts } from '../time.ts';
import { depreciation } from '../servicing/index.ts';

export { savedReports, savedReportToApi, sendNow, queueDueReports, deliverSavedReport, savedReportFailed, nextRunAt, SCHEDULES } from './saved.ts';

async function tz(ctx: Ctx, locationId?: string) {
  if (locationId) return (await must<any>(ctx, `SELECT timezone FROM locations WHERE id = $1`, [locationId], 'location')).timezone as string;
  return (await must<any>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).timezone as string;
}

/** FR-REP-1: today's pickups and returns, overdue, revenue month to date, utilisation, open quotes. */
export async function dashboard(ctx: Ctx, q: { location_id?: string } = {}) {
  const zone = await tz(ctx, q.location_id);
  const today = localDate(ctx.now, zone);
  const dayStart = startOfLocalDay(today, zone);
  const dayEnd = startOfLocalDay(addLocalDays(today, 1), zone);
  const monthStart = startOfLocalDay(`${today.slice(0, 7)}-01`, zone);
  const loc = q.location_id ?? null;
  const listSql = (where: string) =>
    `SELECT o.id, o.number, o.status, o.starts_at, o.ends_at, o.payment_status, c.name AS customer_name
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE ($1::text IS NULL OR o.location_id = $1) AND ${where} ORDER BY 4 LIMIT 50`;
  const pickups = await many(ctx, listSql(`o.status IN ('reserved','prepared') AND o.starts_at >= $2 AND o.starts_at < $3`), [loc, dayStart, dayEnd]);
  const returns = await many(ctx, listSql(`o.status IN ('out','returned_partial') AND o.ends_at >= $2 AND o.ends_at < $3`), [loc, dayStart, dayEnd]);
  const overdue = await many(ctx, listSql(`o.status IN ('out','returned_partial') AND o.ends_at < $2`), [loc, ctx.now]);
  const late = await many(ctx, listSql(`o.status IN ('reserved','prepared') AND o.starts_at < $2`), [loc, dayStart]);
  const revenue = await one<{ amount: number }>(
    ctx,
    `SELECT coalesce(sum(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0)::bigint AS amount
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded' AND p.purpose <> 'deposit' AND p.created_at >= $2 AND ($1::text IS NULL OR o.location_id = $1)`,
    [loc, monthStart],
  );
  const booked = await one<{ amount: number }>(
    ctx,
    `SELECT coalesce(sum((totals->>'total')::bigint), 0)::bigint AS amount FROM orders
      WHERE status NOT IN ('draft','quote','cancelled','expired') AND starts_at >= $2 AND ($1::text IS NULL OR location_id = $1)`,
    [loc, monthStart],
  );
  const quotes = await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM orders WHERE status = 'quote' AND ($1::text IS NULL OR location_id = $1)`, [loc]);
  const units = await one<{ total: number; out: number; down: number }>(
    ctx,
    `SELECT count(*) FILTER (WHERE status NOT IN ('retired','lost'))::int AS total, count(*) FILTER (WHERE status = 'out')::int AS out,
            count(*) FILTER (WHERE status IN ('needs_inspection','soft_down','hard_down'))::int AS down
       FROM stock_items WHERE ($1::text IS NULL OR location_id = $1)`,
    [loc],
  );
  const currency = (await must<any>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).currency.trim();
  return {
    object: 'dashboard',
    date: today,
    timezone: zone,
    pickups_today: pickups,
    returns_today: returns,
    overdue,
    late_pickups: late,
    revenue_mtd: { amount: Number(revenue?.amount ?? 0), currency },
    booked_mtd: { amount: Number(booked?.amount ?? 0), currency },
    open_quotes: quotes?.n ?? 0,
    units: { total: units?.total ?? 0, out: units?.out ?? 0, down: units?.down ?? 0, utilization_now: units?.total ? (units.out / units.total) : 0 },
  };
}

export const REPORTS = [
  'revenue', 'utilization', 'availability_forecast', 'overdue', 'deposits_held', 'tax_summary', 'coupon_usage', 'fulfilment', 'depreciation',
  'customer_value', 'product_roi', 'damage_frequency', 'staff_activity',
] as const;
export type ReportName = (typeof REPORTS)[number];

/** The groupings each report offers; the first is the default. */
export const REPORT_GROUPS: Partial<Record<ReportName, string[]>> = {
  revenue: ['day', 'month', 'product', 'category', 'location'],
  utilization: ['variant', 'location'],
  tax_summary: ['rate', 'location'],
  depreciation: ['unit', 'location'],
  damage_frequency: ['product', 'unit'],
  staff_activity: ['user', 'action'],
};

/** Periods that stay relative, so a saved or scheduled report always covers the right days (FR-REP-4). */
export const RANGES = ['today', 'last_7_days', 'last_30_days', 'this_month', 'last_month', 'year_to_date', 'last_year', 'all_time', 'next_7_days', 'next_14_days'] as const;
export type ReportRange = (typeof RANGES)[number];

/** Reports over everything so far unless a period is given: a customer's or product's whole history. */
const LIFETIME: readonly string[] = ['customer_value', 'product_roi'];
const EPOCH = new Date('2000-01-01T00:00:00Z');
/** "All time" includes bookings still ahead. */
const FOREVER = new Date('2100-01-01T00:00:00Z');

/** A relative period in the shop's time zone: whole local days, ending with today or before it. */
export function resolveRange(range: ReportRange, now: Date, zone: string): { from: Date; to: Date } {
  const today = localDate(now, zone);
  const day = (d: string) => startOfLocalDay(d, zone);
  const { year, month } = zonedParts(now, zone);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const prevMonth = month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, '0')}-01`;
  const tomorrow = day(addLocalDays(today, 1));
  switch (range) {
    case 'today': return { from: day(today), to: tomorrow };
    case 'last_7_days': return { from: day(addLocalDays(today, -7)), to: day(today) };
    case 'last_30_days': return { from: day(addLocalDays(today, -30)), to: day(today) };
    case 'this_month': return { from: day(monthStart), to: tomorrow };
    case 'last_month': return { from: day(prevMonth), to: day(monthStart) };
    case 'year_to_date': return { from: day(`${year}-01-01`), to: tomorrow };
    case 'last_year': return { from: day(`${year - 1}-01-01`), to: day(`${year}-01-01`) };
    case 'all_time': return { from: EPOCH, to: FOREVER };
    case 'next_7_days': return { from: day(today), to: day(addLocalDays(today, 7)) };
    case 'next_14_days': return { from: day(today), to: day(addLocalDays(today, 14)) };
  }
}

export interface ReportQuery {
  from?: string;
  to?: string;
  /** A relative period instead of from and to. */
  range?: string;
  group_by?: string;
  location_id?: string;
  variant_id?: string;
}

export async function runReport(ctx: Ctx, name: string, q: ReportQuery) {
  if (!(REPORTS as readonly string[]).includes(name)) throw invalid(msg('error.unknown_report_available', { name, join: REPORTS.join(', ') }));
  // Who did what comes from the audit log, which needs its own permission.
  if (name === 'staff_activity') assertCan(ctx.actor, 'audit:read');
  const loc = q.location_id ?? null;
  if (loc) await must(ctx, `SELECT 1 FROM locations WHERE id = $1`, [loc], 'location', loc);
  if (q.range && !(RANGES as readonly string[]).includes(q.range)) {
    throw invalid(msg('error.unknown_report_range'), [{ field: 'range', code: 'invalid', message: msg('error.field.report_ranges', { join: RANGES.join(', ') }) }]);
  }
  const span = q.range ? resolveRange(q.range as ReportRange, ctx.now, await tz(ctx, loc ?? undefined)) : null;
  // The forecast looks ahead (default the next 14 days); the others look back (default the last 30).
  const ahead = name === 'availability_forecast';
  const to = span?.to ?? (q.to ? new Date(q.to) : ahead ? new Date(ctx.now.getTime() + 14 * 86400_000) : LIFETIME.includes(name) && !q.from ? FOREVER : ctx.now);
  const from = span?.from ?? (q.from ? new Date(q.from) : ahead ? ctx.now : LIFETIME.includes(name) ? EPOCH : new Date(to.getTime() - 30 * 86400_000));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw invalid(msg('error.from_and_to_must_be_iso_dates'));
  const groups = REPORT_GROUPS[name as ReportName];
  if (q.group_by && !groups?.includes(q.group_by))
    throw invalid(msg('error.unknown_report_grouping'), [{ field: 'group_by', code: 'invalid', message: msg('error.field.report_groups', { join: (groups ?? []).join(', ') || '–' }) }]);
  const group = q.group_by ?? groups?.[0];
  let rows: any[];
  switch (name) {
    case 'revenue': {
      const key =
        group === 'product' ? `coalesce(p.name, l.description)` : group === 'category' ? `coalesce((SELECT string_agg(c.name, ', ') FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = l.product_id), 'Uncategorised')`
        : group === 'location' ? `(SELECT name FROM locations WHERE id = o.location_id)` : group === 'month' ? `to_char(o.starts_at, 'YYYY-MM')` : `to_char(o.starts_at, 'YYYY-MM-DD')`;
      rows = await many(
        ctx,
        `SELECT ${key} AS key, count(DISTINCT o.id)::int AS orders, sum(l.subtotal - l.discount)::bigint AS net, sum(l.tax)::bigint AS tax, sum(l.total)::bigint AS total
           FROM orders o JOIN order_lines l ON l.order_id = o.id AND l.parent_line_id IS NULL LEFT JOIN products p ON p.id = l.product_id
          WHERE o.status NOT IN ('draft','quote','cancelled','expired') AND o.starts_at >= $1 AND o.starts_at < $2 AND ($3::text IS NULL OR o.location_id = $3)
          GROUP BY 1 ORDER BY 1`,
        [from, to, loc],
      );
      break;
    }
    case 'utilization': {
      if (group === 'location') {
        rows = await many(
          ctx,
          `WITH cap AS (
             SELECT s.location_id, count(*) AS capacity FROM stock_items s JOIN variants v ON v.id = s.variant_id AND v.tracking = 'serialized' AND v.deleted_at IS NULL
              WHERE s.status NOT IN ('retired','lost') GROUP BY 1
             UNION ALL
             SELECT sl.location_id, sum(sl.quantity) FROM stock_levels sl JOIN variants v ON v.id = sl.variant_id AND v.tracking = 'bulk' AND v.deleted_at IS NULL GROUP BY 1
           ), used AS (
             SELECT location_id, sum(quantity * extract(epoch FROM (least(coalesce(upper(period), $2), $2) - greatest(lower(period), $1)))) / 3600 AS unit_hours
               FROM allocations WHERE kind = 'reservation' AND period && tstzrange($1, $2) GROUP BY 1
           ), total AS (SELECT location_id, sum(capacity) AS capacity FROM cap GROUP BY 1)
           SELECT l.name AS location, total.capacity::int, round(coalesce(used.unit_hours, 0)::numeric, 1) AS booked_unit_hours,
                  CASE WHEN total.capacity > 0 THEN round((coalesce(used.unit_hours, 0) / (total.capacity * extract(epoch FROM ($2::timestamptz - $1::timestamptz)) / 3600))::numeric, 4) ELSE 0 END AS utilization
             FROM total JOIN locations l ON l.id = total.location_id LEFT JOIN used ON used.location_id = total.location_id
            WHERE ($3::text IS NULL OR total.location_id = $3) ORDER BY l.name`,
          [from, to, loc],
        );
        break;
      }
      rows = await many(
        ctx,
        `WITH cap AS (
           SELECT v.id AS variant_id, p.name AS product, v.name AS variant, v.tracking,
                  CASE v.tracking WHEN 'serialized' THEN (SELECT count(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status NOT IN ('retired','lost') AND ($3::text IS NULL OR s.location_id = $3))
                                  ELSE (SELECT coalesce(sum(quantity),0) FROM stock_levels sl WHERE sl.variant_id = v.id AND ($3::text IS NULL OR sl.location_id = $3)) END AS capacity
             FROM variants v JOIN products p ON p.id = v.product_id WHERE v.tracking IN ('serialized','bulk') AND v.deleted_at IS NULL
         ), used AS (
           SELECT variant_id, sum(quantity * extract(epoch FROM (least(coalesce(upper(period), $2), $2) - greatest(lower(period), $1)))) / 3600 AS unit_hours
             FROM allocations WHERE kind = 'reservation' AND period && tstzrange($1, $2) AND ($3::text IS NULL OR location_id = $3) GROUP BY 1
         )
         SELECT cap.product, cap.variant, cap.tracking, cap.capacity::int, round(coalesce(used.unit_hours, 0)::numeric, 1) AS booked_unit_hours,
                CASE WHEN cap.capacity > 0 THEN round((coalesce(used.unit_hours, 0) / (cap.capacity * extract(epoch FROM ($2::timestamptz - $1::timestamptz)) / 3600))::numeric, 4) ELSE 0 END AS utilization
           FROM cap LEFT JOIN used ON used.variant_id = cap.variant_id ORDER BY utilization DESC, product`,
        [from, to, loc],
      );
      break;
    }
    case 'availability_forecast': {
      const zone = await tz(ctx, loc ?? undefined);
      const day = (v: string | undefined, d: Date) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localDate(d, zone));
      const first = day(span ? undefined : q.from, from);
      const last = day(span ? undefined : q.to, to);
      const days = Math.round((Date.parse(last) - Date.parse(first)) / 86400_000);
      if (days < 1 || days > 62) throw invalid(msg('error.forecast_range'), [{ field: 'to', code: 'out_of_range', message: msg('error.forecast_range') }]);
      rows = await availability.forecast(ctx, { from: first, days, locationId: loc, variantId: q.variant_id ?? null });
      break;
    }
    case 'overdue':
      rows = await many(
        ctx,
        `SELECT o.number, o.id, c.name AS customer, c.phone, o.ends_at, round(extract(epoch FROM (now() - o.ends_at)) / 3600)::int AS hours_overdue, o.payment_status,
                (SELECT name FROM locations WHERE id = o.location_id) AS location
           FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.status IN ('out','returned_partial') AND o.ends_at < now() AND ($1::text IS NULL OR o.location_id = $1) ORDER BY o.ends_at`,
        [loc],
      );
      break;
    case 'deposits_held':
      rows = await many(
        ctx,
        `SELECT o.number, d.id, c.name AS customer, d.amount, d.method, d.status, d.authorized_at, d.expires_at,
                (SELECT name FROM locations WHERE id = o.location_id) AS location FROM deposits d JOIN orders o ON o.id = d.order_id
           LEFT JOIN customers c ON c.id = o.customer_id WHERE d.status IN ('held','pending') AND ($1::text IS NULL OR o.location_id = $1) ORDER BY d.expires_at NULLS LAST`,
        [loc],
      );
      break;
    case 'tax_summary':
      // By location, each location's rates are listed under it (a branch may charge its own tax).
      rows = await many(
        ctx,
        `SELECT ${group === 'location' ? `(SELECT name FROM locations WHERE id = o.location_id) AS location, ` : ''}coalesce((l.price_snapshot->>'tax_rate_bp')::int, 0) AS rate_bp,
                sum(l.subtotal - l.discount)::bigint AS net, sum(l.tax)::bigint AS tax
           FROM orders o JOIN order_lines l ON l.order_id = o.id AND l.parent_line_id IS NULL
          WHERE o.status NOT IN ('draft','quote','cancelled','expired') AND o.starts_at >= $1 AND o.starts_at < $2 AND ($3::text IS NULL OR o.location_id = $3)
          GROUP BY ${group === 'location' ? '1, 2 ORDER BY 1, 2' : '1 ORDER BY 1'}`,
        [from, to, loc],
      );
      break;
    case 'coupon_usage':
      rows = await many(
        ctx,
        `SELECT c.code, c.kind, c.value, c.uses_count, count(o.id)::int AS orders_in_period FROM coupons c
           LEFT JOIN orders o ON c.code = ANY(o.coupon_codes) AND o.status NOT IN ('draft','cancelled','expired') AND o.created_at >= $1 AND o.created_at < $2
          GROUP BY c.id ORDER BY c.code`,
        [from, to],
      );
      break;
    case 'fulfilment':
      rows = await many(
        ctx,
        `SELECT o.number, (SELECT name FROM locations WHERE id = o.location_id) AS location, o.starts_at, o.ends_at,
                (SELECT min(created_at) FROM order_events e WHERE e.order_id = o.id AND e.type = 'checked_out') AS picked_up_at,
                (SELECT max(created_at) FROM order_events e WHERE e.order_id = o.id AND e.type = 'checked_in' AND e.to_status = 'returned') AS returned_at
           FROM orders o WHERE o.starts_at >= $1 AND o.starts_at < $2 AND o.status NOT IN ('draft','quote','cancelled','expired') AND ($3::text IS NULL OR o.location_id = $3)
          ORDER BY o.starts_at`,
        [from, to, loc],
      );
      rows = rows.map((r) => ({
        ...r,
        on_time_pickup: r.picked_up_at ? new Date(r.picked_up_at).getTime() - new Date(r.starts_at).getTime() < 3600_000 : null,
        on_time_return: r.returned_at ? new Date(r.returned_at) <= new Date(new Date(r.ends_at).getTime() + 3600_000) : null,
      }));
      break;
    case 'depreciation': {
      // Book value of each unit at the end of the period (FR-CAT-10); units without a price, date or life are left out.
      const units = await many<any>(
        ctx,
        `SELECT s.barcode, s.purchase_date, s.purchase_price, p.name AS product, l.name AS location, p.depreciation_months, p.residual_bp
           FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = s.location_id
          WHERE s.status NOT IN ('retired','lost') AND s.purchase_price IS NOT NULL AND s.purchase_date IS NOT NULL AND p.depreciation_months IS NOT NULL
            AND ($1::text IS NULL OR s.location_id = $1)
          ORDER BY l.name, p.name, s.barcode`,
        [loc],
      );
      const at = q.range === 'all_time' ? ctx.now : to;
      const valued = units.map((u) => ({ u, d: depreciation(u, u, at)! }));
      if (group === 'location') {
        const by = new Map<string, { location: string; units: number; purchase_price: number; depreciated: number; book_value: number }>();
        for (const { u, d } of valued) {
          const r = by.get(u.location) ?? { location: u.location, units: 0, purchase_price: 0, depreciated: 0, book_value: 0 };
          r.units++;
          r.purchase_price += d.purchase_price;
          r.depreciated += d.depreciated;
          r.book_value += d.book_value;
          by.set(u.location, r);
        }
        rows = [...by.values()];
      } else {
        rows = valued.map(({ u, d }) => ({
          product: u.product, barcode: u.barcode, location: u.location, purchase_date: String(u.purchase_date).slice(0, 10), purchase_price: d.purchase_price,
          depreciated: d.depreciated, book_value: d.book_value, fully_depreciated_at: d.fully_depreciated_at,
        }));
      }
      break;
    }
    case 'customer_value':
      rows = (
        await many<any>(
          ctx,
          `SELECT c.id, c.name AS customer, c.email, count(o.id)::int AS orders, coalesce(sum((o.totals->>'total')::bigint), 0)::bigint AS total,
                  coalesce(sum((o.totals->>'paid')::bigint), 0)::bigint AS paid, min(o.starts_at) AS first_order, max(o.starts_at) AS last_order
             FROM orders o JOIN customers c ON c.id = o.customer_id
            WHERE o.status NOT IN ('draft','quote','cancelled','expired') AND o.starts_at >= $1 AND o.starts_at < $2 AND ($3::text IS NULL OR o.location_id = $3)
            GROUP BY c.id ORDER BY 5 DESC, 2 LIMIT 5000`,
          [from, to, loc],
        )
      ).map((r) => ({
        id: r.id, customer: r.customer, email: r.email, orders: r.orders, total: Number(r.total), paid: Number(r.paid),
        average_order: r.orders ? Math.round(Number(r.total) / r.orders) : 0, first_order: r.first_order, last_order: r.last_order,
      }));
      break;
    case 'product_roi': {
      // Rental revenue in the period against what the units cost, their wear, sub-rental and repairs (FR-REP-3, FR-CAT-9).
      const totals = await many<any>(
        ctx,
        `WITH rev AS (
           SELECT l.product_id, count(DISTINCT o.id)::int AS orders, sum(l.subtotal - l.discount)::bigint AS revenue
             FROM orders o JOIN order_lines l ON l.order_id = o.id AND l.parent_line_id IS NULL
            WHERE o.status NOT IN ('draft','quote','cancelled','expired') AND o.starts_at >= $1 AND o.starts_at < $2 AND ($3::text IS NULL OR o.location_id = $3)
              AND l.product_id IS NOT NULL GROUP BY 1
         ), sub AS (
           SELECT v.product_id, sum(e.unit_cost * e.quantity)::bigint AS cost FROM external_stock e JOIN variants v ON v.id = e.variant_id
            WHERE e.status = 'booked' AND lower(e.period) < $2 AND upper(e.period) > $1 AND ($3::text IS NULL OR e.location_id = $3) GROUP BY 1
         ), rep AS (
           SELECT v.product_id, sum(t.cost + coalesce((SELECT sum((p->>'quantity')::numeric * (p->>'unit_cost')::numeric) FROM jsonb_array_elements(t.parts) p), 0))::bigint AS cost
             FROM maintenance_tickets t JOIN stock_items s ON s.id = t.stock_item_id JOIN variants v ON v.id = s.variant_id
            WHERE t.status <> 'cancelled' AND t.created_at >= $1 AND t.created_at < $2 AND ($3::text IS NULL OR s.location_id = $3) GROUP BY 1
         )
         SELECT p.id, p.name AS product, p.depreciation_months, p.residual_bp, coalesce(rev.orders, 0) AS orders, coalesce(rev.revenue, 0)::bigint AS revenue,
                coalesce(sub.cost, 0)::bigint AS subrental_cost, coalesce(rep.cost, 0)::bigint AS repair_cost
           FROM products p LEFT JOIN rev ON rev.product_id = p.id LEFT JOIN sub ON sub.product_id = p.id LEFT JOIN rep ON rep.product_id = p.id
          WHERE p.deleted_at IS NULL`,
        [from, to, loc],
      );
      const units = await many<any>(
        ctx,
        `SELECT v.product_id, s.purchase_price, s.purchase_date FROM stock_items s JOIN variants v ON v.id = s.variant_id
          WHERE s.purchase_price IS NOT NULL AND ($1::text IS NULL OR s.location_id = $1)`,
        [loc],
      );
      const cost = new Map<string, { purchase_price: number; depreciated: number }>();
      const byId = new Map(totals.map((t) => [t.id, t]));
      for (const u of units) {
        const c = cost.get(u.product_id) ?? { purchase_price: 0, depreciated: 0 };
        c.purchase_price += Number(u.purchase_price);
        const p = byId.get(u.product_id);
        // Wear so far: a period ending ahead is valued now.
        c.depreciated += p ? (depreciation(u, p, to < ctx.now ? to : ctx.now)?.depreciated ?? 0) : 0;
        cost.set(u.product_id, c);
      }
      rows = totals
        .map((t) => {
          const c = cost.get(t.id) ?? { purchase_price: 0, depreciated: 0 };
          const revenue = Number(t.revenue);
          const net = revenue - Number(t.subrental_cost) - Number(t.repair_cost);
          return {
            id: t.id, product: t.product, orders: t.orders, revenue, purchase_price: c.purchase_price, depreciated: c.depreciated,
            subrental_cost: Number(t.subrental_cost), repair_cost: Number(t.repair_cost), net_return: net,
            roi: c.purchase_price > 0 ? Math.round((net / c.purchase_price) * 10000) / 10000 : null,
          };
        })
        .filter((r) => r.orders || r.purchase_price || r.subrental_cost || r.repair_cost)
        .sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity) || b.net_return - a.net_return || a.product.localeCompare(b.product));
      break;
    }
    case 'damage_frequency': {
      // Returns checked in during the period and how many came back damaged or lost; charges raised in it.
      const unit = group === 'unit';
      const key = unit ? `s.id` : `v.product_id`;
      rows = (
        await many<any>(
          ctx,
          `WITH ret AS (
             SELECT ${key} AS k, count(*)::int AS returns, count(*) FILTER (WHERE u.check_in_outcome = 'damaged')::int AS damaged,
                    count(*) FILTER (WHERE u.check_in_outcome = 'lost')::int AS lost
               FROM order_line_units u JOIN stock_items s ON s.id = u.stock_item_id JOIN variants v ON v.id = s.variant_id
               JOIN order_lines l ON l.id = u.order_line_id JOIN orders o ON o.id = l.order_id
              WHERE u.checked_in_at >= $1 AND u.checked_in_at < $2 AND ($3::text IS NULL OR o.location_id = $3) GROUP BY 1
           ), ch AS (
             SELECT ${key} AS k, count(*)::int AS charges, sum(d.amount)::bigint AS charged
               FROM damage_charges d JOIN stock_items s ON s.id = d.stock_item_id JOIN variants v ON v.id = s.variant_id
              WHERE d.created_at >= $1 AND d.created_at < $2 AND d.status <> 'waived' AND ($3::text IS NULL OR s.location_id = $3) GROUP BY 1
           ), k AS (SELECT k FROM ret UNION SELECT k FROM ch)
           SELECT ${unit ? `p.name AS product, s.barcode,` : `p.name AS product,`} coalesce(ret.returns, 0) AS returns, coalesce(ret.damaged, 0) AS damaged,
                  coalesce(ret.lost, 0) AS lost, coalesce(ch.charges, 0) AS charges, coalesce(ch.charged, 0)::bigint AS charged
             FROM k LEFT JOIN ret ON ret.k = k.k LEFT JOIN ch ON ch.k = k.k
             ${unit ? `JOIN stock_items s ON s.id = k.k JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id` : `JOIN products p ON p.id = k.k`}`,
          [from, to, loc],
        )
      )
        .map((r) => ({ ...r, charged: Number(r.charged), damage_rate: r.returns ? Math.round(((r.damaged + r.lost) / r.returns) * 10000) / 10000 : null }))
        .sort((a, b) => (b.damage_rate ?? -1) - (a.damage_rate ?? -1) || b.charges - a.charges || a.product.localeCompare(b.product));
      break;
    }
    case 'staff_activity':
      // From the audit log: what each team member did in the period (FR-REP-3, FR-AUD-1).
      rows =
        group === 'action'
          ? await many(
              ctx,
              `SELECT coalesce(nullif(u.name, ''), u.email) AS staff, a.entity_type AS entity, a.action, count(*)::int AS actions
                 FROM audit_log a JOIN users u ON u.id = a.actor_id
                WHERE a.actor_type = 'user' AND a.created_at >= $1 AND a.created_at < $2 GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC, 2, 3`,
              [from, to],
            )
          : await many(
              ctx,
              `SELECT coalesce(nullif(u.name, ''), u.email) AS staff, u.email, count(*)::int AS actions,
                      count(*) FILTER (WHERE a.entity_type = 'order' AND a.action = 'create')::int AS orders_created,
                      count(*) FILTER (WHERE a.entity_type = 'order' AND a.action = 'transition:checked_out')::int AS check_outs,
                      count(*) FILTER (WHERE a.entity_type = 'order' AND a.action = 'transition:checked_in')::int AS check_ins,
                      count(*) FILTER (WHERE a.entity_type = 'payment' AND a.action = 'create')::int AS payments,
                      max(a.created_at) AS last_active
                 FROM audit_log a JOIN users u ON u.id = a.actor_id
                WHERE a.actor_type = 'user' AND a.created_at >= $1 AND a.created_at < $2 GROUP BY u.id ORDER BY 3 DESC, 1`,
              [from, to],
            );
      break;
    default:
      throw invalid(msg('error.unknown_report_available', { name, join: REPORTS.join(', ') }));
  }
  return { object: 'report', name, from: from.toISOString(), to: to.toISOString(), data: rows };
}

/** Rows → CSV (RFC 4180), for every report and list export (FR-REP-2, FR-INT-2). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}
