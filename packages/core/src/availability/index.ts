import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError, invalid, notFound, type FieldError } from '../errors.ts';
import { newId } from '../ids.ts';
import { exec, many, must, one } from '../sql.ts';
import { addLocalDays, addMinutes, daysInMonth, localDate, startOfLocalDay, WEEKDAY_KEYS, zonedParts } from '../time.ts';
import { bundleAvailable, peakConcurrent, type Span } from './sweep.ts';
import { checkBookingRules, inBlackout, type Blackout } from './rules.ts';

export * from './sweep.ts';
export * from './rules.ts';

export interface VariantInfo {
  id: string;
  product_id: string;
  tracking: 'serialized' | 'bulk' | 'none';
  product_type: string;
  buffer_before_min: number;
  buffer_after_min: number;
  min_duration_min: number | null;
  max_duration_min: number | null;
  min_notice_min: number;
  increment_min: number | null;
  name: string;
  product_name: string;
}

export async function variantInfo(ctx: Ctx, variantId: string): Promise<VariantInfo> {
  return must<VariantInfo>(
    ctx,
    `SELECT v.id, v.product_id, v.tracking, v.name, p.name AS product_name, p.type AS product_type,
            coalesce(v.buffer_before_min, p.buffer_before_min) AS buffer_before_min, coalesce(v.buffer_after_min, p.buffer_after_min) AS buffer_after_min,
            coalesce(v.min_duration_min, p.min_duration_min) AS min_duration_min, coalesce(v.max_duration_min, p.max_duration_min) AS max_duration_min,
            coalesce(v.min_notice_min, p.min_notice_min) AS min_notice_min, coalesce(v.increment_min, p.increment_min) AS increment_min
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = $1 AND v.deleted_at IS NULL`,
    [variantId],
    'variant',
    variantId,
  );
}

/** Serialised: count of units not retired or lost. Bulk: stock level. `none`: unlimited. */
export async function capacity(ctx: Ctx, variantId: string, locationId: string, tracking: VariantInfo['tracking']): Promise<number> {
  if (tracking === 'none') return Number.POSITIVE_INFINITY;
  if (tracking === 'serialized') {
    const r = await one<{ n: number }>(
      ctx,
      `SELECT count(*)::int AS n FROM stock_items WHERE variant_id = $1 AND location_id = $2 AND status NOT IN ('retired', 'lost')`,
      [variantId, locationId],
    );
    return r?.n ?? 0;
  }
  const r = await one<{ quantity: number }>(ctx, `SELECT quantity FROM stock_levels WHERE variant_id = $1 AND location_id = $2`, [variantId, locationId]);
  return r?.quantity ?? 0;
}

export async function loadSpans(
  ctx: Ctx,
  variantId: string,
  locationId: string,
  from: Date,
  to: Date,
  excludeOrderId?: string | null,
  excludeAllocationIds: string[] = [],
): Promise<Span[]> {
  const rows = await many<{ s: Date; e: Date | null; quantity: number }>(
    ctx,
    `SELECT lower(period) AS s, upper(period) AS e, quantity FROM allocations
      WHERE variant_id = $1 AND location_id = $2 AND period && tstzrange($3, $4, '[)')
        AND ($5::text IS NULL OR order_id IS DISTINCT FROM $5) AND NOT (id = ANY($6::text[]))`,
    [variantId, locationId, from, to, excludeOrderId ?? null, excludeAllocationIds],
  );
  return rows.map((r) => ({ start: r.s.getTime(), end: r.e ? r.e.getTime() : Number.POSITIVE_INFINITY, quantity: r.quantity }));
}

export interface AvailabilityResult {
  variant_id: string;
  location_id: string;
  from: string;
  to: string;
  tracking: VariantInfo['tracking'];
  capacity: number | null;
  allocated: number;
  available: number | null;
  shortage: boolean;
}

async function bundleComponents(ctx: Ctx, productId: string) {
  return many<{ variant_id: string; quantity: number; tracking: VariantInfo['tracking'] }>(
    ctx,
    `SELECT bc.variant_id, bc.quantity, v.tracking FROM bundles b
       JOIN bundle_components bc ON bc.bundle_id = b.id
       JOIN variants v ON v.id = bc.variant_id
      WHERE b.product_id = $1 ORDER BY bc.position`,
    [productId],
  );
}

/** Availability of one variant over [from, to) including buffers of existing allocations. */
export async function check(
  ctx: Ctx,
  q: { variantId: string; locationId: string; from: Date; to: Date; excludeOrderId?: string | null },
): Promise<AvailabilityResult> {
  const v = await variantInfo(ctx, q.variantId);
  const base = { variant_id: v.id, location_id: q.locationId, from: q.from.toISOString(), to: q.to.toISOString(), tracking: v.tracking };
  if (v.product_type === 'bundle') {
    const comps = await bundleComponents(ctx, v.product_id);
    const parts = await Promise.all(
      comps.map(async (c) => ({ quantity: c.quantity, r: await check(ctx, { ...q, variantId: c.variant_id }) })),
    );
    const avail = bundleAvailable(parts.map((p) => ({ available: p.r.available ?? Number.POSITIVE_INFINITY, quantity: p.quantity })));
    return { ...base, capacity: null, allocated: 0, available: avail, shortage: parts.some((p) => p.r.shortage) };
  }
  if (v.tracking === 'none') return { ...base, capacity: null, allocated: 0, available: null, shortage: false };
  const cap = await capacity(ctx, v.id, q.locationId, v.tracking);
  const spans = await loadSpans(ctx, v.id, q.locationId, q.from, q.to, q.excludeOrderId);
  const peak = peakConcurrent(spans, q.from.getTime(), q.to.getTime());
  return { ...base, capacity: cap, allocated: peak, available: Math.max(0, cap - peak), shortage: peak > cap };
}

/** One variant at every open location, default first: where else the stock is free (FR-LOC-2). */
export async function checkAcrossLocations(ctx: Ctx, q: { variantId: string; from: Date; to: Date }): Promise<(AvailabilityResult & { location_name: string; is_default: boolean })[]> {
  const locs = await many<{ id: string; name: string; is_default: boolean }>(ctx, `SELECT id, name, is_default FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC, name`);
  const out = [];
  for (const l of locs) out.push({ ...(await check(ctx, { variantId: q.variantId, locationId: l.id, from: q.from, to: q.to })), location_name: l.name, is_default: l.is_default });
  return out;
}

export async function checkBatch(
  ctx: Ctx,
  q: { variantIds: string[]; locationId: string; from: Date; to: Date },
): Promise<AvailabilityResult[]> {
  if (q.variantIds.length > 100) throw invalid(msg('error.at_most_100_variants_per_batch_request'));
  const out: AvailabilityResult[] = [];
  for (const id of q.variantIds) out.push(await check(ctx, { variantId: id, locationId: q.locationId, from: q.from, to: q.to }));
  return out;
}

export interface CalendarDay {
  date: string;
  available: number | null;
  status: 'available' | 'unavailable' | 'closed' | 'past' | 'notice';
  reason?: string;
}

/** Per-day minimum availability for a month in the location's time zone (FR-AV-7). */
export async function calendar(ctx: Ctx, q: { variantId: string; locationId: string; month: string }): Promise<CalendarDay[]> {
  const v = await variantInfo(ctx, q.variantId);
  const loc = await must<{ timezone: string; opening_hours: any }>(ctx, `SELECT timezone, opening_hours FROM locations WHERE id = $1`, [q.locationId], 'location', q.locationId);
  const days = daysInMonth(q.month);
  const from = startOfLocalDay(days[0]!, loc.timezone);
  const to = startOfLocalDay(addLocalDays(days[days.length - 1]!, 1), loc.timezone);
  const blackouts = await loadBlackouts(ctx, q.locationId, from, to);
  const noticeUntil = addMinutes(ctx.now, v.min_notice_min ?? 0);

  type Comp = { quantity: number; cap: number; spans: Span[]; none: boolean };
  let comps: Comp[];
  if (v.product_type === 'bundle') {
    const cs = await bundleComponents(ctx, v.product_id);
    comps = await Promise.all(
      cs.map(async (c) => ({
        quantity: c.quantity,
        none: c.tracking === 'none',
        cap: await capacity(ctx, c.variant_id, q.locationId, c.tracking),
        spans: await loadSpans(ctx, c.variant_id, q.locationId, from, to),
      })),
    );
  } else {
    comps = [{ quantity: 1, none: v.tracking === 'none', cap: await capacity(ctx, v.id, q.locationId, v.tracking), spans: await loadSpans(ctx, v.id, q.locationId, from, to) }];
  }

  const hasHours = loc.opening_hours && Object.keys(loc.opening_hours).length > 0;
  return days.map((date) => {
    const a = startOfLocalDay(date, loc.timezone);
    const b = startOfLocalDay(addLocalDays(date, 1), loc.timezone);
    const weekday = WEEKDAY_KEYS[zonedParts(addMinutes(a, 720), loc.timezone).weekday]!;
    const avail = comps.every((c) => c.none)
      ? null
      : bundleAvailable(comps.filter((c) => !c.none).map((c) => ({ quantity: c.quantity, available: c.cap - peakConcurrent(c.spans, a.getTime(), b.getTime()) })));
    let status: CalendarDay['status'] = avail === null || avail > 0 ? 'available' : 'unavailable';
    let reason: string | undefined = status === 'unavailable' ? 'fully_booked' : undefined;
    if (b <= ctx.now) {
      status = 'past';
      reason = 'past';
    } else if (b <= noticeUntil) {
      status = 'notice';
      reason = 'minimum_notice';
    } else if (hasHours && !(loc.opening_hours[weekday]?.length > 0)) {
      status = 'closed';
      reason = 'closed';
    } else {
      const bo = inBlackout(blackouts, addMinutes(a, 720));
      if (bo) {
        status = 'closed';
        reason = bo.reason || 'closed';
      }
    }
    return { date, available: avail, status, ...(reason ? { reason } : {}) };
  });
}

/**
 * Free stock per variant and day for the coming weeks (FR-REP-2): capacity, the most booked at once
 * that day (with buffers) and what is left. Days follow each location's time zone; at most 62 days.
 */
export async function forecast(ctx: Ctx, q: { from: string; days: number; locationId?: string | null; variantId?: string | null }) {
  const days = Math.min(Math.max(1, q.days), 62);
  const locations = await many<{ id: string; name: string; timezone: string }>(
    ctx,
    `SELECT id, name, timezone FROM locations WHERE deleted_at IS NULL AND ($1::text IS NULL OR id = $1) ORDER BY is_default DESC, name`,
    [q.locationId ?? null],
  );
  const variants = await many<{ id: string; tracking: VariantInfo['tracking']; product: string; variant: string }>(
    ctx,
    `SELECT v.id, v.tracking, p.name AS product, v.name AS variant FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.tracking IN ('serialized', 'bulk') AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.type <> 'bundle' AND ($1::text IS NULL OR v.id = $1)
      ORDER BY p.name, v.position, v.name LIMIT 500`,
    [q.variantId ?? null],
  );
  const rows: { date: string; location: string; product: string; variant: string; capacity: number; booked: number; available: number; shortage: boolean }[] = [];
  for (const l of locations) {
    const dates = Array.from({ length: days }, (_, i) => addLocalDays(q.from, i));
    const from = startOfLocalDay(dates[0]!, l.timezone);
    const to = startOfLocalDay(addLocalDays(dates[dates.length - 1]!, 1), l.timezone);
    for (const v of variants) {
      const cap = await capacity(ctx, v.id, l.id, v.tracking);
      const spans = await loadSpans(ctx, v.id, l.id, from, to);
      if (!cap && !spans.length) continue;
      for (const date of dates) {
        const a = startOfLocalDay(date, l.timezone).getTime();
        const b = startOfLocalDay(addLocalDays(date, 1), l.timezone).getTime();
        const booked = peakConcurrent(spans, a, b);
        rows.push({ date, location: l.name, product: v.product, variant: v.variant, capacity: cap, booked, available: Math.max(0, cap - booked), shortage: booked > cap });
      }
    }
  }
  return rows;
}

export async function loadBlackouts(ctx: Ctx, locationId: string, from: Date, to: Date): Promise<Blackout[]> {
  const rows = await many<{ s: Date; e: Date; reason: string | null }>(
    ctx,
    `SELECT lower(period) AS s, upper(period) AS e, reason FROM location_blackouts WHERE location_id = $1 AND period && tstzrange($2, $3, '[)')`,
    [locationId, from, to],
  );
  return rows.map((r) => ({ starts_at: r.s, ends_at: r.e, reason: r.reason }));
}

/** Validates FR-AV-4 rules for a product at a location. Throws a 422 listing every problem. */
export async function assertBookable(
  ctx: Ctx,
  q: { variantId: string; locationId: string; startsAt: Date; endsAt: Date; strict: boolean; field?: string },
): Promise<FieldError[]> {
  const v = await variantInfo(ctx, q.variantId);
  const loc = await must<any>(ctx, `SELECT timezone, opening_hours FROM locations WHERE id = $1`, [q.locationId], 'location');
  const blackouts = await loadBlackouts(ctx, q.locationId, addMinutes(q.startsAt, -1), addMinutes(q.endsAt, 1));
  return checkBookingRules(v, loc, blackouts, q.startsAt, q.endsAt, ctx.now, { enforceHours: q.strict, enforceNotice: q.strict });
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export interface AllocationRequest {
  variantId: string;
  locationId: string;
  from: Date;
  to: Date;
  quantity: number;
  kind: 'reservation' | 'downtime';
  orderId?: string | null;
  orderLineId?: string | null;
  downtimeId?: string | null;
  /** Early-pinned units (FR-AV-6). Counted inside quantity. */
  stockItemIds?: string[];
  /** Index into the caller's lines, for error reporting. */
  ref?: string;
}

/**
 * Serialises reservations per (variant, location) with a transaction-scoped advisory lock taken
 * in a stable order, so concurrent checkouts cannot both see the last unit as free (FR-AV-2, FR-AV-10).
 * Under READ COMMITTED every statement after the lock sees rows committed by the previous holder.
 */
export async function lockPools(ctx: Ctx, keys: { variantId: string; locationId: string }[]): Promise<void> {
  const uniq = [...new Set(keys.map((k) => `${ctx.tenantId}|${k.variantId}|${k.locationId}`))].sort();
  for (const k of uniq) await exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, [k]);
}

/** New or grown booking time for one pool, checked against what is already booked there. */
export interface PoolDemand {
  variantId: string;
  locationId: string;
  from: Date;
  /** `null`: open-ended. */
  to: Date | null;
  quantity: number;
  /** Only these parts are checked (the time an allocation grows by); default the whole span. */
  checks?: [Date, Date | null][];
  ref?: string;
  orderLineId?: string | null;
}

const END = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

/**
 * Throws a 409 `exceeds_availability` when the demands would put any pool over capacity during the
 * checked time. Existing allocations in `excludeAllocationIds` are left out (they are being replaced
 * by the demands). Callers hold the pool locks (`lockPools`).
 */
export async function assertPoolCapacity(ctx: Ctx, demands: PoolDemand[], infos = new Map<string, VariantInfo>(), excludeAllocationIds: string[] = []) {
  const errors: FieldError[] = [];
  const shortages: Record<string, unknown>[] = [];
  const groups = new Map<string, PoolDemand[]>();
  for (const d of demands) {
    const k = `${d.variantId}|${d.locationId}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  for (const [, ds] of groups) {
    const first = ds[0]!;
    if (!infos.has(first.variantId)) infos.set(first.variantId, await variantInfo(ctx, first.variantId));
    const info = infos.get(first.variantId)!;
    if (info.tracking === 'none') continue;
    const windows = ds.flatMap((d) => (d.checks ?? [[d.from, d.to]]).map(([s, e]) => ({ d, s: s.getTime(), e: END(e) })));
    if (!windows.length) continue;
    const from = new Date(Math.min(...windows.map((w) => w.s)));
    const toMs = Math.max(...windows.map((w) => w.e));
    const to = Number.isFinite(toMs) ? new Date(toMs) : new Date(8.64e15);
    const cap = await capacity(ctx, first.variantId, first.locationId, info.tracking);
    const existing = await loadSpans(ctx, first.variantId, first.locationId, from, to, null, excludeAllocationIds);
    const added: Span[] = ds.map((d) => ({ start: d.from.getTime(), end: END(d.to), quantity: d.quantity }));
    const failed = new Set<PoolDemand>();
    for (const w of windows) {
      if (failed.has(w.d) || w.e <= w.s) continue;
      const peakAll = peakConcurrent([...existing, ...added], w.s, w.e);
      if (peakAll <= cap) continue;
      failed.add(w.d);
      const availableNow = Math.max(0, cap - peakConcurrent(existing, w.s, w.e));
      errors.push({ field: w.d.ref ?? 'lines', code: 'exceeds_availability', message: msg('availability.only_available', { count: availableNow, name: info.name !== info.product_name ? `${info.product_name} (${info.name})` : info.product_name }) });
      shortages.push({ variant_id: w.d.variantId, location_id: w.d.locationId, requested: w.d.quantity, available: availableNow, line_id: w.d.orderLineId ?? null });
    }
  }
  if (errors.length) {
    throw new AppError('exceeds_availability', 409, errors.map((e) => e.message).join('; '), { errors, extra: { shortages } });
  }
}

/**
 * Places reservations, refusing any that would put a pool over capacity. With `overbook` (FR-AV-8) the
 * part that does not fit is booked anyway as its own allocation, tied to an overbooking record with the
 * reason; only unassigned quantity can be overbooked, never a specific unit.
 */
export async function reserve(ctx: Ctx, requests: AllocationRequest[], opts: { overbook?: { reason: string } } = {}): Promise<string[]> {
  if (requests.length === 0) return [];
  const infos = new Map<string, VariantInfo>();
  for (const r of requests) if (!infos.has(r.variantId)) infos.set(r.variantId, await variantInfo(ctx, r.variantId));
  const tracked = requests.filter((r) => infos.get(r.variantId)!.tracking !== 'none');
  await lockPools(ctx, tracked);
  const over = new Map<AllocationRequest, number>();
  try {
    await assertPoolCapacity(
      ctx,
      tracked.map((r) => ({ variantId: r.variantId, locationId: r.locationId, from: r.from, to: r.to, quantity: r.quantity, ref: r.ref, orderLineId: r.orderLineId })),
      infos,
    );
  } catch (err) {
    if (!opts.overbook || !(err instanceof AppError) || err.code !== 'exceeds_availability') throw err;
    for (const s of ((err.extra as any)?.shortages ?? []) as { variant_id: string; requested: number; available: number; line_id: string | null }[]) {
      const r = tracked.find((x) => x.variantId === s.variant_id && (x.orderLineId ?? null) === s.line_id);
      if (!r) throw err;
      const n = Math.max(0, s.requested - s.available);
      if (n > r.quantity - (r.stockItemIds?.length ?? 0)) throw err; // specific units cannot be overbooked
      over.set(r, n);
    }
  }

  const ids: string[] = [];
  for (const r of tracked) {
    const pinned = r.stockItemIds ?? [];
    if (pinned.length > r.quantity) throw invalid(msg('error.more_units_pinned_than_the_line_quantity'));
    for (const sti of pinned) {
      await assertUnitUsable(ctx, sti, r.variantId, r.locationId);
      const id = newId('alc');
      await exec(
        ctx,
        `INSERT INTO allocations (id, tenant_id, variant_id, location_id, stock_item_id, quantity, period, kind, order_id, order_line_id, downtime_id)
         VALUES ($1, $2, $3, $4, $5, 1, tstzrange($6, $7, '[)'), $8, $9, $10, $11)`,
        [id, ctx.tenantId, r.variantId, r.locationId, sti, r.from, r.to, r.kind, r.orderId ?? null, r.orderLineId ?? null, r.downtimeId ?? null],
      );
      if (r.orderLineId) {
        await exec(
          ctx,
          `INSERT INTO order_line_units (id, tenant_id, order_line_id, stock_item_id, allocation_id) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (order_line_id, stock_item_id) DO UPDATE SET allocation_id = EXCLUDED.allocation_id`,
          [newId('olu'), ctx.tenantId, r.orderLineId, sti, id],
        );
      }
      ids.push(id);
    }
    const extra = over.get(r) ?? 0;
    const rest = r.quantity - pinned.length - extra;
    if (rest > 0) {
      const id = newId('alc');
      await exec(
        ctx,
        `INSERT INTO allocations (id, tenant_id, variant_id, location_id, quantity, period, kind, order_id, order_line_id, downtime_id)
         VALUES ($1, $2, $3, $4, $5, tstzrange($6, $7, '[)'), $8, $9, $10, $11)`,
        [id, ctx.tenantId, r.variantId, r.locationId, rest, r.from, r.to, r.kind, r.orderId ?? null, r.orderLineId ?? null, r.downtimeId ?? null],
      );
      ids.push(id);
    }
    if (extra > 0) {
      const ovb = newId('ovb');
      await exec(ctx, `INSERT INTO overbookings (id, tenant_id, order_id, variant_id, location_id, quantity, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        ovb, ctx.tenantId, r.orderId, r.variantId, r.locationId, extra, opts.overbook!.reason, ctx.actor.id,
      ]);
      const id = newId('alc');
      await exec(
        ctx,
        `INSERT INTO allocations (id, tenant_id, variant_id, location_id, quantity, period, kind, order_id, order_line_id, overbooking_id)
         VALUES ($1, $2, $3, $4, $5, tstzrange($6, $7, '[)'), $8, $9, $10, $11)`,
        [id, ctx.tenantId, r.variantId, r.locationId, extra, r.from, r.to, r.kind, r.orderId ?? null, r.orderLineId ?? null, ovb],
      );
      ids.push(id);
    }
  }
  return ids;
}

export async function assertUnitUsable(ctx: Ctx, stockItemId: string, variantId: string, locationId: string) {
  const s = await must<any>(ctx, `SELECT id, barcode, variant_id, location_id, status FROM stock_items WHERE id = $1`, [stockItemId], 'stock_item', stockItemId);
  if (s.variant_id !== variantId) throw new AppError('wrong_item', 422, msg('error.is_a_different_product', { barcode: s.barcode }));
  if (s.location_id !== locationId) throw new AppError('wrong_location', 422, msg('error.is_kept_at_another_location', { barcode: s.barcode }));
  if (['retired', 'lost'].includes(s.status)) throw new AppError('unit_unavailable', 409, msg('error.unit_has_status', { barcode: s.barcode, status: s.status }));
  return s;
}

/** Removes reservation allocations of an order (cancel, expire, edit). */
export async function releaseOrder(ctx: Ctx, orderId: string): Promise<number> {
  await exec(ctx, `UPDATE overbookings SET resolved_at = now() WHERE order_id = $1 AND resolved_at IS NULL`, [orderId]);
  await exec(ctx, `UPDATE order_line_units SET allocation_id = NULL WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id = $1)`, [orderId]);
  const n = await exec(ctx, `DELETE FROM allocations WHERE order_id = $1 AND kind = 'reservation'`, [orderId]);
  await exec(ctx, `DELETE FROM order_line_units WHERE checked_out_at IS NULL AND order_line_id IN (SELECT id FROM order_lines WHERE order_id = $1)`, [orderId]);
  return n;
}

// ---------------------------------------------------------------------------
// Changing existing bookings. Every change to an allocation's time or unit goes through these, so the
// pool check and the exclusion constraint apply to extensions, early pickups, swaps and transfers alike.
// ---------------------------------------------------------------------------

/** New period for an allocation; a field left out keeps its current value. `to: null` is open-ended. */
export interface Resize {
  allocationId: string;
  from?: Date;
  to?: Date | null;
}

interface AllocationRow {
  id: string;
  variant_id: string;
  location_id: string;
  stock_item_id: string | null;
  quantity: number;
  kind: string;
  order_id: string | null;
  order_line_id: string | null;
  s: Date;
  e: Date | null;
}

async function lockedAllocations(ctx: Ctx, ids: string[]) {
  return many<AllocationRow>(
    ctx,
    `SELECT id, variant_id, location_id, stock_item_id, quantity, kind, order_id, order_line_id, lower(period) AS s, upper(period) AS e
       FROM allocations WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
}

/** Runs `fn` in a savepoint; an overlapping unit booking (23P01) becomes a 409 `unit_unavailable`. */
async function unitSafe<T>(ctx: Ctx, name: string, fn: (fail: (stockItemId: string | null) => void) => Promise<T>, message?: string): Promise<T> {
  let culprit: string | null = null;
  await ctx.db.query(`SAVEPOINT ${name}`);
  try {
    const out = await fn((id) => (culprit = id));
    await ctx.db.query(`RELEASE SAVEPOINT ${name}`);
    return out;
  } catch (err: any) {
    await ctx.db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    if (err?.code !== '23P01') throw err;
    if (message) throw new AppError('unit_unavailable', 409, message);
    const unit = culprit ? await one<{ barcode: string }>(ctx, `SELECT barcode FROM stock_items WHERE id = $1`, [culprit]) : null;
    throw new AppError('unit_unavailable', 409, msg('error.is_already_booked_for_an_overlapping_period', { barcode: unit?.barcode ?? '' }));
  }
}

/**
 * Moves the start or end of existing allocations (extend, shorten, early pickup, early return).
 * Shrinking needs no check. Time an allocation grows by is checked against its pool under the pool
 * lock, and a unit allocation is also held by the exclusion constraint; either failure leaves every
 * allocation as it was. `unitConflict` replaces the default message for a unit that is booked.
 */
export async function resizeAllocations(ctx: Ctx, changes: Resize[], opts: { unitConflict?: string } = {}): Promise<void> {
  if (!changes.length) return;
  const rows = await lockedAllocations(ctx, changes.map((c) => c.allocationId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const plan = changes.map((c) => {
    const r = byId.get(c.allocationId);
    if (!r) throw notFound('allocation', c.allocationId);
    const from = c.from ?? r.s;
    const to = c.to === undefined ? r.e : c.to;
    if (to && to <= from) throw invalid(msg('error.the_return_must_be_after_the_pickup'));
    const checks: [Date, Date | null][] = [];
    if (from < r.s) checks.push([from, r.s]);
    if (END(to) > END(r.e)) checks.push([r.e!, to]);
    return { r, from, to, checks };
  });
  const growing = plan.filter((p) => p.checks.length && p.r.kind !== 'downtime');
  if (growing.length) {
    await lockPools(ctx, growing.map((p) => ({ variantId: p.r.variant_id, locationId: p.r.location_id })));
    await assertPoolCapacity(
      ctx,
      growing.map((p) => ({ variantId: p.r.variant_id, locationId: p.r.location_id, from: p.from, to: p.to, quantity: p.r.quantity, checks: p.checks, orderLineId: p.r.order_line_id })),
      new Map(),
      growing.map((p) => p.r.id),
    );
  }
  await unitSafe(
    ctx,
    'resize_allocations',
    async (fail) => {
      for (const p of plan) {
        fail(p.r.stock_item_id);
        await ctx.db.query(`UPDATE allocations SET period = tstzrange($2, $3, '[)') WHERE id = $1`, [p.r.id, p.from, p.to]);
      }
    },
    opts.unitConflict,
  );
}

/**
 * Ends allocations at `at` when they would run longer (returns, closing downtimes). Never lengthens and
 * never leaves an empty period. Shrinking frees stock, so nothing is checked.
 */
export async function endAllocationsAt(ctx: Ctx, where: { ids?: string[]; downtimeId?: string; orderLineId?: string; transferLineId?: string }, at: Date): Promise<number> {
  const cond = where.ids ? `id = ANY($1::text[])` : where.downtimeId ? `downtime_id = $1` : where.transferLineId ? `transfer_line_id = $1` : `order_line_id = $1 AND kind = 'reservation'`;
  const arg = where.ids ?? where.downtimeId ?? where.transferLineId ?? where.orderLineId;
  if (arg === undefined) throw new Error('endAllocationsAt needs ids, downtimeId, transferLineId or orderLineId');
  return exec(
    ctx,
    `UPDATE allocations SET period = tstzrange(lower(period), greatest(lower(period) + interval '1 millisecond', least(upper(period), $2)), '[)') WHERE ${cond}`,
    [arg, at],
  );
}

/**
 * Hands a unit's booking to another unit of the same variant and location from `at` on (swap mid-rental,
 * reassign on the planner). Before the booking starts the whole allocation moves; otherwise it is split
 * at `at` and the new unit holds the rest. Returns the allocation now held by the new unit.
 */
export async function moveUnitAllocation(ctx: Ctx, allocationId: string, toStockItemId: string, at: Date): Promise<string> {
  const [r] = await lockedAllocations(ctx, [allocationId]);
  if (!r) throw notFound('allocation', allocationId);
  if (!r.stock_item_id || r.kind !== 'reservation') throw new AppError('not_a_unit_booking', 422, msg('error.not_a_unit_booking'));
  if (r.e && at >= r.e) throw invalid(msg('error.move_outside_booking'));
  await assertUnitUsable(ctx, toStockItemId, r.variant_id, r.location_id);
  return unitSafe(ctx, 'move_unit_allocation', async (fail) => {
    fail(toStockItemId);
    if (at <= r.s) {
      await ctx.db.query(`UPDATE allocations SET stock_item_id = $2 WHERE id = $1`, [r.id, toStockItemId]);
      return r.id;
    }
    await ctx.db.query(`UPDATE allocations SET period = tstzrange(lower(period), $2, '[)') WHERE id = $1`, [r.id, at]);
    const id = newId('alc');
    await ctx.db.query(
      `INSERT INTO allocations (id, tenant_id, variant_id, location_id, stock_item_id, quantity, period, kind, order_id, order_line_id)
       VALUES ($1, $2, $3, $4, $5, 1, tstzrange($6, $7, '[)'), 'reservation', $8, $9)`,
      [id, ctx.tenantId, r.variant_id, r.location_id, toStockItemId, at, r.e, r.order_id, r.order_line_id],
    );
    return id;
  });
}

/**
 * The allocation behind a downtime. It is not checked against the pool (taking stock out of service may
 * cause a shortage that staff then see), but a unit booked by a rental in that period is refused.
 */
export async function allocateDowntime(
  ctx: Ctx,
  d: { downtimeId: string; variantId: string; locationId: string; stockItemId: string | null; quantity: number; from: Date | string; to: Date | string | null },
): Promise<string> {
  const id = newId('alc');
  await unitSafe(
    ctx,
    'downtime',
    () =>
      ctx.db.query(
        `INSERT INTO allocations (id, tenant_id, variant_id, location_id, stock_item_id, quantity, period, kind, downtime_id)
         VALUES ($1,$2,$3,$4,$5,$6,tstzrange($7, $8, '[)'),'downtime',$9)`,
        [id, ctx.tenantId, d.variantId, d.locationId, d.stockItemId, d.quantity, d.from, d.to, d.downtimeId],
      ),
    msg('error.this_unit_is_assigned_to_a_rental'),
  ).catch((err) => {
    throw err instanceof AppError && err.code === 'unit_unavailable' ? new AppError('unit_assigned', 409, err.message) : err;
  });
  return id;
}

// ---------------------------------------------------------------------------
// Transfers between locations (FR-LOC-2, ADR 0007). A planned transfer holds the stock at the source
// from the day it ships, open-ended; once sent, the stock counts at the destination but stays held
// there while it is on the way.
// ---------------------------------------------------------------------------

/**
 * Holds a unit or a bulk quantity at the source of a planned transfer from `from` on. Stock booked
 * after `from` cannot be sent: the pool check refuses the quantity and the exclusion constraint the unit.
 */
export async function holdForTransfer(
  ctx: Ctx,
  h: { transferLineId: string; variantId: string; locationId: string; stockItemId: string | null; quantity: number; from: Date; ref?: string },
): Promise<string> {
  const info = await variantInfo(ctx, h.variantId);
  if (h.stockItemId) await assertUnitUsable(ctx, h.stockItemId, h.variantId, h.locationId);
  await lockPools(ctx, [h]);
  await assertPoolCapacity(ctx, [{ variantId: h.variantId, locationId: h.locationId, from: h.from, to: null, quantity: h.quantity, ref: h.ref }], new Map([[h.variantId, info]]));
  const id = newId('alc');
  await unitSafe(ctx, 'transfer_hold', async (fail) => {
    fail(h.stockItemId);
    await ctx.db.query(
      `INSERT INTO allocations (id, tenant_id, variant_id, location_id, stock_item_id, quantity, period, kind, transfer_line_id)
       VALUES ($1, $2, $3, $4, $5, $6, tstzrange($7, NULL, '[)'), 'transfer', $8)`,
      [id, ctx.tenantId, h.variantId, h.locationId, h.stockItemId, h.quantity, h.from, h.transferLineId],
    );
  });
  return id;
}

/**
 * Sends a held transfer line at `at`. Leaving earlier than planned grows the hold, which is checked like
 * any other booking; then `move` moves the stock itself and the hold becomes an in-transit allocation
 * at the destination, until `until` (open-ended without an ETA, so nothing is promised before it arrives).
 */
export async function startTransit(ctx: Ctx, transferLineId: string, t: { at: Date; toLocationId: string; until: Date | null; move: () => Promise<void> }): Promise<string> {
  const hold = await one<{ id: string; s: Date; variant_id: string; stock_item_id: string | null; quantity: number }>(
    ctx,
    `SELECT id, lower(period) AS s, variant_id, stock_item_id, quantity FROM allocations WHERE transfer_line_id = $1 AND kind = 'transfer' ORDER BY lower(period) DESC LIMIT 1 FOR UPDATE`,
    [transferLineId],
  );
  if (!hold) throw notFound('allocation', transferLineId);
  if (t.at < hold.s) await resizeAllocations(ctx, [{ allocationId: hold.id, from: t.at }]);
  await t.move();
  await exec(ctx, `DELETE FROM allocations WHERE id = $1`, [hold.id]);
  const until = t.until && t.until > t.at ? t.until : null;
  const id = newId('alc');
  await unitSafe(ctx, 'transfer_transit', async (fail) => {
    fail(hold.stock_item_id);
    await ctx.db.query(
      `INSERT INTO allocations (id, tenant_id, variant_id, location_id, stock_item_id, quantity, period, kind, transfer_line_id)
       VALUES ($1, $2, $3, $4, $5, $6, tstzrange($7, $8, '[)'), 'transfer', $9)`,
      [id, ctx.tenantId, hold.variant_id, t.toLocationId, hold.stock_item_id, hold.quantity, t.at, until, transferLineId],
    );
  });
  return id;
}

/**
 * Takes `quantity` of a line off the road at `at` (received or written off): the in-transit allocation
 * ends, and any quantity still on the way keeps an allocation of its own from `at`.
 */
export async function endTransit(ctx: Ctx, transferLineId: string, quantity: number, at: Date): Promise<void> {
  const cur = await one<{ id: string; quantity: number; s: Date; e: Date | null; variant_id: string; location_id: string; stock_item_id: string | null }>(
    ctx,
    `SELECT id, quantity, lower(period) AS s, upper(period) AS e, variant_id, location_id, stock_item_id FROM allocations
      WHERE transfer_line_id = $1 AND kind = 'transfer' ORDER BY lower(period) DESC LIMIT 1 FOR UPDATE`,
    [transferLineId],
  );
  if (!cur || quantity <= 0) return;
  await endAllocationsAt(ctx, { ids: [cur.id] }, at);
  const rest = cur.quantity - quantity;
  if (rest > 0 && (!cur.e || cur.e > at)) {
    await exec(
      ctx,
      `INSERT INTO allocations (id, tenant_id, variant_id, location_id, quantity, period, kind, transfer_line_id)
       VALUES ($1, $2, $3, $4, $5, tstzrange($6, $7, '[)'), 'transfer', $8)`,
      [newId('alc'), ctx.tenantId, cur.variant_id, cur.location_id, rest, at, cur.e, transferLineId],
    );
  }
}

/** Drops the source holds of a planned transfer that will not go (cancelled). */
export async function releaseTransferHolds(ctx: Ctx, transferId: string): Promise<number> {
  return exec(ctx, `DELETE FROM allocations WHERE kind = 'transfer' AND transfer_line_id IN (SELECT id FROM transfer_lines WHERE transfer_id = $1)`, [transferId]);
}

/** Drops an order's quantity holds that never got a unit (everything handed out has come back). */
export async function releaseUnassignedHolds(ctx: Ctx, orderId: string): Promise<number> {
  return exec(ctx, `DELETE FROM allocations WHERE order_id = $1 AND kind = 'reservation' AND stock_item_id IS NULL`, [orderId]);
}

/** Removes every allocation of a unit that is being deleted (it has no rental history). */
export async function deleteUnitAllocations(ctx: Ctx, stockItemId: string): Promise<number> {
  return exec(ctx, `DELETE FROM allocations WHERE stock_item_id = $1`, [stockItemId]);
}

/**
 * Late binding (FR-AV-6, PRD §7.4): converts quantity held on a line into a per-unit allocation
 * so the exclusion constraint takes over for that unit.
 */
export async function assignUnit(ctx: Ctx, line: { id: string; variant_id: string }, locationId: string, stockItemId: string): Promise<string> {
  const unit = await assertUnitUsable(ctx, stockItemId, line.variant_id, locationId);
  const already = await one(ctx, `SELECT 1 FROM order_line_units WHERE order_line_id = $1 AND stock_item_id = $2`, [line.id, stockItemId]);
  if (already) throw new AppError('already_assigned', 409, msg('error.is_already_assigned_to_this_line', { barcode: unit.barcode }));
  const qrow = await one<{ id: string; quantity: number; s: Date; e: Date }>(
    ctx,
    `SELECT id, quantity, lower(period) AS s, upper(period) AS e FROM allocations
      WHERE order_line_id = $1 AND stock_item_id IS NULL AND kind = 'reservation' ORDER BY quantity DESC LIMIT 1 FOR UPDATE`,
    [line.id],
  );
  if (!qrow) throw new AppError('fully_assigned', 409, msg('error.every_unit_on_this_line_is_already'));
  if (qrow.quantity > 1) await exec(ctx, `UPDATE allocations SET quantity = quantity - 1 WHERE id = $1`, [qrow.id]);
  else await exec(ctx, `DELETE FROM allocations WHERE id = $1`, [qrow.id]);
  const id = newId('alc');
  try {
    await ctx.db.query(`SAVEPOINT assign_unit`);
    await ctx.db.query(
      `INSERT INTO allocations (id, tenant_id, variant_id, location_id, stock_item_id, quantity, period, kind, order_id, order_line_id)
       SELECT $1, $2, $3, $4, $5, 1, tstzrange($6, $7, '[)'), 'reservation', order_id, id FROM order_lines WHERE id = $8`,
      [id, ctx.tenantId, line.variant_id, locationId, stockItemId, qrow.s, qrow.e, line.id],
    );
    await ctx.db.query(`RELEASE SAVEPOINT assign_unit`);
  } catch (err: any) {
    await ctx.db.query(`ROLLBACK TO SAVEPOINT assign_unit`);
    if (err?.code === '23P01') {
      throw new AppError('unit_unavailable', 409, msg('error.is_already_booked_for_an_overlapping_period', { barcode: unit.barcode }));
    }
    throw err;
  }
  await exec(ctx, `INSERT INTO order_line_units (id, tenant_id, order_line_id, stock_item_id, allocation_id) VALUES ($1, $2, $3, $4, $5)`, [
    newId('olu'), ctx.tenantId, line.id, stockItemId, id,
  ]);
  return id;
}

/** Reverse of assignUnit: the unit's allocation becomes a quantity hold again. */
export async function unassignUnit(ctx: Ctx, lineId: string, stockItemId: string): Promise<void> {
  const u = await must<any>(
    ctx,
    `SELECT olu.id, olu.checked_out_at, a.id AS allocation_id, lower(a.period) AS s, upper(a.period) AS e, a.variant_id, a.location_id, a.order_id
       FROM order_line_units olu LEFT JOIN allocations a ON a.id = olu.allocation_id
      WHERE olu.order_line_id = $1 AND olu.stock_item_id = $2`,
    [lineId, stockItemId],
    'assignment',
  );
  if (u.checked_out_at) throw new AppError('unit_checked_out', 409, msg('error.this_unit_is_already_checked_out'));
  await exec(ctx, `DELETE FROM order_line_units WHERE id = $1`, [u.id]);
  if (u.allocation_id) {
    await exec(ctx, `DELETE FROM allocations WHERE id = $1`, [u.allocation_id]);
    await exec(
      ctx,
      `INSERT INTO allocations (id, tenant_id, variant_id, location_id, quantity, period, kind, order_id, order_line_id)
       VALUES ($1, $2, $3, $4, 1, tstzrange($5, $6, '[)'), 'reservation', $7, $8)`,
      [newId('alc'), ctx.tenantId, u.variant_id, u.location_id, u.s, u.e, u.order_id, lineId],
    );
  }
}

/**
 * Unassigns a unit from every future reservation overlapping [from, ∞) so a downtime can start.
 * Returns the affected order numbers (they now hold quantity and may show a shortage).
 */
export async function bumpFutureAssignments(ctx: Ctx, stockItemId: string, from: Date): Promise<number[]> {
  const rows = await many<{ order_line_id: string; number: number }>(
    ctx,
    `SELECT a.order_line_id, o.number FROM allocations a JOIN orders o ON o.id = a.order_id
      WHERE a.stock_item_id = $1 AND a.kind = 'reservation' AND a.period && tstzrange($2, NULL)
        AND NOT EXISTS (SELECT 1 FROM order_line_units u WHERE u.allocation_id = a.id AND u.checked_out_at IS NOT NULL)`,
    [stockItemId, from],
  );
  for (const r of rows) await unassignUnit(ctx, r.order_line_id, stockItemId);
  return [...new Set(rows.map((r) => r.number))];
}

export { localDate };

/**
 * Hourly: variants with a low-availability threshold where fewer units are free in the coming days
 * (FR-NOT-3). Staff are told once per variant, location and day.
 */
export async function lowAvailabilityCheck(ctx: Ctx, daysAhead: number) {
  const variants = await many<{ id: string; product_id: string; threshold: number; product_name: string; name: string }>(
    ctx,
    `SELECT v.id, v.product_id, v.low_availability_threshold AS threshold, p.name AS product_name, v.name FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.low_availability_threshold IS NOT NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND v.tracking <> 'none'`,
  );
  const locations = await many<{ id: string; name: string }>(ctx, `SELECT id, name FROM locations WHERE deleted_at IS NULL`);
  const from = ctx.now;
  const to = new Date(ctx.now.getTime() + Math.max(1, daysAhead) * 86400_000);
  const day = ctx.now.toISOString().slice(0, 10);
  let warned = 0;
  for (const v of variants)
    for (const l of locations) {
      const r = await check(ctx, { variantId: v.id, locationId: l.id, from, to });
      if (r.available === null || r.available >= v.threshold) continue;
      warned++;
      const { notifyStaff } = await import('../notifications/index.ts');
      await notifyStaff(
        ctx,
        null,
        'staff_low_availability',
        { item: v.name !== v.product_name ? `${v.product_name} (${v.name})` : v.product_name, available: r.available, threshold: v.threshold, location: l.name, days: daysAhead, product_id: v.product_id },
        `lowavail:${v.id}:${l.id}:${day}`,
      );
    }
  return { checked: variants.length, warned };
}

