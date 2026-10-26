import type { Ctx } from '../context.ts';
import { AppError, conflict, invalid, notFound, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { addMinutes, localDate } from '../time.ts';
import * as availability from '../availability/index.ts';
import { issueDocument } from '../documents/index.ts';
import { notifyCustomer, notifyStaff } from '../notifications/index.ts';
import { photosOf } from '../maintenance/index.ts';
import { setOwner } from '../files/index.ts';
import { runAction } from '../orders/index.ts';

/**
 * Deliveries and collections (FR-OR-12). A delivery hands an order over at the customer's address, a
 * collection brings it back. Their time windows may lie outside the rental: the order's bookings are
 * stretched to cover them (and shrunk back when the window moves or the delivery is cancelled), checked
 * like any other change to a booking.
 */
export type DeliveryKind = 'delivery' | 'collection';
const ACTIVE = ['scheduled', 'dispatched'];

export interface DeliveryInput {
  kind?: DeliveryKind;
  window_start?: string;
  window_end?: string;
  address?: Record<string, unknown>;
  contact?: { name?: string; phone?: string };
  driver_user_id?: string | null;
  notes?: string;
}

export function deliveryToApi(d: any, photos: unknown[] = []) {
  return {
    id: d.id, object: 'delivery', order_id: d.order_id, order_number: d.order_number ?? null, kind: d.kind, status: d.status,
    address: d.address ?? {}, contact: d.contact ?? {}, window_start: d.window_start, window_end: d.window_end, route_date: String(d.route_date).slice(0, 10),
    position: d.position, driver_user_id: d.driver_user_id, driver_name: d.driver_name ?? null, notes: d.notes, signed_name: d.signed_name,
    signature_file_id: d.signature_file_id, failure_reason: d.failure_reason, dispatched_at: d.dispatched_at, completed_at: d.completed_at,
    customer_name: d.customer_name ?? null, photos, created_at: d.created_at, updated_at: d.updated_at,
  };
}

const SELECT = `SELECT d.*, o.number AS order_number, c.name AS customer_name, u.name AS driver_name FROM deliveries d
  JOIN orders o ON o.id = d.order_id LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = d.driver_user_id`;

async function row(ctx: Ctx, id: string, lock = false) {
  const d = await one<any>(ctx, `${SELECT} WHERE d.id = $1${lock ? ' FOR UPDATE OF d' : ''}`, [id]);
  if (!d) throw notFound('delivery', id);
  return d;
}

async function api(ctx: Ctx, id: string) {
  const d = await row(ctx, id);
  return deliveryToApi(d, (await photosOf(ctx, 'delivery', [id])).get(id) ?? []);
}

export async function getDelivery(ctx: Ctx, id: string) {
  return api(ctx, id);
}

/** Deliveries by route day, driver, order or status; a day's run comes back in route order. */
export async function listDeliveries(ctx: Ctx, f: { date?: string; driver_user_id?: string; order_id?: string; status?: string; location_id?: string } = {}) {
  const rows = await many<any>(
    ctx,
    `${SELECT} WHERE ($1::date IS NULL OR d.route_date = $1) AND ($2::text IS NULL OR d.driver_user_id = $2) AND ($3::text IS NULL OR d.order_id = $3)
       AND ($4::text IS NULL OR d.status = $4) AND ($5::text IS NULL OR o.location_id = $5)
     ORDER BY d.route_date, d.position, d.window_start LIMIT 500`,
    [f.date ?? null, f.driver_user_id ?? null, f.order_id ?? null, f.status ?? null, f.location_id ?? null],
  );
  const photos = await photosOf(ctx, 'delivery', rows.map((r) => r.id));
  return rows.map((r) => deliveryToApi(r, photos.get(r.id) ?? []));
}

/**
 * Stretches (or shrinks back) the order's running bookings so they cover the active delivery and
 * collection windows. Bookings of units already returned are left alone.
 */
async function coverWindows(ctx: Ctx, order: any) {
  const active = await many<{ kind: DeliveryKind; window_start: Date; window_end: Date }>(
    ctx,
    `SELECT kind, window_start, window_end FROM deliveries WHERE order_id = $1 AND status = ANY($2)`,
    [order.id, ACTIVE],
  );
  const delivery = active.find((d) => d.kind === 'delivery');
  const collection = active.find((d) => d.kind === 'collection');
  const start = new Date(order.starts_at);
  const end = new Date(order.ends_at);
  const allocs = await many<{ id: string; s: Date; e: Date | null; before: number; after: number; out: boolean }>(
    ctx,
    `SELECT a.id, lower(a.period) AS s, upper(a.period) AS e, l.buffer_before_min AS before, l.buffer_after_min AS after,
            EXISTS (SELECT 1 FROM order_line_units u WHERE u.allocation_id = a.id AND u.checked_out_at IS NOT NULL) AS out
       FROM allocations a JOIN order_lines l ON l.id = a.order_line_id WHERE a.order_id = $1 AND a.kind = 'reservation'`,
    [order.id],
  );
  const changes: availability.Resize[] = [];
  for (const a of allocs) {
    const booked = addMinutes(end, a.after);
    if (a.e && a.e < booked && !collection) continue; // returned early and not collected
    const change: availability.Resize = { allocationId: a.id };
    // Units already handed over keep their start; otherwise the start covers the delivery.
    if (!a.out && order.status !== 'out') {
      const from = addMinutes(start, -a.before);
      change.from = delivery && new Date(delivery.window_start) < from ? new Date(delivery.window_start) : from;
    }
    if (a.e && a.e >= booked) change.to = collection && new Date(collection.window_end) > booked ? new Date(collection.window_end) : booked;
    if (change.from !== undefined || change.to !== undefined) changes.push(change);
  }
  await availability.resizeAllocations(ctx, changes);
}

function checkWindow(start: Date, end: Date): FieldError[] {
  const errors: FieldError[] = [];
  if (Number.isNaN(start.getTime())) errors.push({ field: 'window_start', code: 'invalid', message: msg('error.field.invalid_date_time') });
  if (Number.isNaN(end.getTime())) errors.push({ field: 'window_end', code: 'invalid', message: msg('error.field.invalid_date_time') });
  if (!errors.length && end <= start) errors.push({ field: 'window_end', code: 'invalid_range', message: msg('error.delivery_window_order') });
  return errors;
}

async function orderFor(ctx: Ctx, orderId: string) {
  return must<any>(ctx, `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.addresses FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1 FOR UPDATE OF o`, [orderId], 'order', orderId);
}

const routeDate = async (ctx: Ctx, order: any, at: Date) => {
  const loc = await one<{ timezone: string }>(ctx, `SELECT timezone FROM locations WHERE id = $1`, [order.location_id]);
  return localDate(at, loc?.timezone ?? order.timezone);
};

/** Books a delivery or a collection for an order; the address and contact default to the customer's. */
export async function scheduleDelivery(ctx: Ctx, orderId: string, input: DeliveryInput) {
  const order = await orderFor(ctx, orderId);
  const kind = input.kind ?? 'delivery';
  const allowed = kind === 'delivery' ? ['quote', 'reserved', 'prepared'] : ['quote', 'reserved', 'prepared', 'out', 'returned_partial'];
  if (!allowed.includes(order.status)) throw new AppError('delivery_not_allowed', 409, msg('error.delivery_not_allowed', { status: order.status }));
  const start = new Date(input.window_start ?? '');
  const end = new Date(input.window_end ?? '');
  const errors = checkWindow(start, end);
  if (errors.length) throw invalid(msg('error.delivery_invalid'), errors);
  const exists = await one(ctx, `SELECT 1 FROM deliveries WHERE order_id = $1 AND kind = $2 AND status = ANY($3)`, [order.id, kind, ACTIVE]);
  if (exists) throw conflict('delivery_exists', msg('error.delivery_exists'));
  // The customer's shipping address, else the billing one.
  const address = input.address && Object.keys(input.address).length ? input.address : (order.addresses?.shipping ?? order.addresses?.billing ?? {});
  const contact = { name: input.contact?.name ?? order.customer_name ?? '', phone: input.contact?.phone ?? order.customer_phone ?? '' };
  const date = await routeDate(ctx, order, start);
  const pos = (await one<{ n: number }>(ctx, `SELECT coalesce(max(position), 0) + 1 AS n FROM deliveries WHERE route_date = $1`, [date]))!.n;
  const id = newId('dlv');
  await exec(
    ctx,
    `INSERT INTO deliveries (id, tenant_id, order_id, kind, address, contact, window_start, window_end, route_date, position, driver_user_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, ctx.tenantId, order.id, kind, json(address), json(contact), start, end, date, pos, input.driver_user_id ?? null, input.notes ?? ''],
  );
  await coverWindows(ctx, order);
  const out = await api(ctx, id);
  await audit(ctx, { entity_type: 'delivery', entity_id: id, action: 'create', after: out });
  await emit(ctx, 'delivery.scheduled', { type: 'delivery', id }, out);
  return out;
}

/** Reschedules, re-addresses or assigns a driver. Moving the window re-checks the order's bookings. */
export async function updateDelivery(ctx: Ctx, id: string, patch: DeliveryInput) {
  const before = await row(ctx, id, true);
  if (!ACTIVE.includes(before.status)) throw conflict('delivery_closed', msg('error.delivery_closed', { status: before.status }));
  const start = new Date(patch.window_start ?? before.window_start);
  const end = new Date(patch.window_end ?? before.window_end);
  const errors = checkWindow(start, end);
  if (errors.length) throw invalid(msg('error.delivery_invalid'), errors);
  const order = await orderFor(ctx, before.order_id);
  const date = await routeDate(ctx, order, start);
  await exec(
    ctx,
    `UPDATE deliveries SET window_start = $2, window_end = $3, route_date = $4, address = coalesce($5, address), contact = contact || $6,
       driver_user_id = CASE WHEN $7::boolean THEN $8 ELSE driver_user_id END, notes = coalesce($9, notes) WHERE id = $1`,
    [id, start, end, date, patch.address ? json(patch.address) : null, json(patch.contact ?? {}), patch.driver_user_id !== undefined, patch.driver_user_id ?? null, patch.notes ?? null],
  );
  if (patch.window_start || patch.window_end) await coverWindows(ctx, order);
  const out = await api(ctx, id);
  await audit(ctx, { entity_type: 'delivery', entity_id: id, action: 'update', before: deliveryToApi(before), after: out });
  await emit(ctx, 'delivery.updated', { type: 'delivery', id }, out);
  return out;
}

/** Sets the run order of a day: the ids in the order they are driven. */
export async function reorderRoute(ctx: Ctx, date: string, ids: string[]) {
  const rows = await many<{ id: string }>(ctx, `SELECT id FROM deliveries WHERE route_date = $1 AND id = ANY($2)`, [date, ids]);
  if (rows.length !== new Set(ids).size) throw invalid(msg('error.delivery_route_mismatch'), [{ field: 'ids', code: 'invalid', message: msg('error.delivery_route_mismatch') }]);
  for (const [i, id] of ids.entries()) await exec(ctx, `UPDATE deliveries SET position = $2 WHERE id = $1`, [id, i + 1]);
  await audit(ctx, { entity_type: 'delivery_route', entity_id: date, action: 'reorder', extra: { ids } });
  return listDeliveries(ctx, { date });
}

/** On its way: the delivery note is issued for deliveries and the customer gets an email. */
export async function dispatchDelivery(ctx: Ctx, id: string) {
  const d = await row(ctx, id, true);
  if (d.status !== 'scheduled') throw conflict('delivery_closed', msg('error.delivery_closed', { status: d.status }));
  await exec(ctx, `UPDATE deliveries SET status = 'dispatched', dispatched_at = $2 WHERE id = $1`, [id, ctx.now]);
  if (d.kind === 'delivery') await issueDocument(ctx, d.order_id, 'delivery_note');
  await notifyCustomer(ctx, d.order_id, d.kind === 'delivery' ? 'delivery_dispatched' : 'collection_dispatched', { window_start: d.window_start, window_end: d.window_end });
  const out = await api(ctx, id);
  await audit(ctx, { entity_type: 'delivery', entity_id: id, action: 'dispatch' });
  await emit(ctx, 'delivery.dispatched', { type: 'delivery', id }, out);
  return out;
}

/**
 * Done at the door: who signed, photos, and (by default) the order's pickup or return is recorded too,
 * so a delivered order is out and a collected one is back.
 */
export async function completeDelivery(ctx: Ctx, id: string, input: { signed_name?: string; signature_file_id?: string; photo_file_ids?: string[]; record_on_order?: boolean } = {}) {
  const d = await row(ctx, id, true);
  if (!ACTIVE.includes(d.status)) throw conflict('delivery_closed', msg('error.delivery_closed', { status: d.status }));
  if (input.signature_file_id) await setOwner(ctx, input.signature_file_id, 'delivery', id);
  for (const f of input.photo_file_ids ?? []) await setOwner(ctx, f, 'delivery', id);
  await exec(ctx, `UPDATE deliveries SET status = 'completed', completed_at = $2, signed_name = $3, signature_file_id = $4 WHERE id = $1`, [
    id, ctx.now, input.signed_name?.trim() || null, input.signature_file_id ?? null,
  ]);
  if (input.record_on_order !== false) {
    const o = await must<any>(ctx, `SELECT status FROM orders WHERE id = $1`, [d.order_id], 'order');
    const signature = input.signed_name ? { name: input.signed_name, method: input.signature_file_id ? 'drawn' : 'typed', file_id: input.signature_file_id } : undefined;
    if (d.kind === 'delivery' && ['reserved', 'prepared'].includes(o.status)) await runAction(ctx, d.order_id, 'check_out', { signature, allow_partial: true });
    if (d.kind === 'collection' && ['out', 'returned_partial'].includes(o.status)) await runAction(ctx, d.order_id, 'check_in', { all: true });
  }
  const out = await api(ctx, id);
  await audit(ctx, { entity_type: 'delivery', entity_id: id, action: 'complete', extra: { signed_name: input.signed_name } });
  await emit(ctx, 'delivery.completed', { type: 'delivery', id }, out);
  return out;
}

/** Could not hand over or collect: staff are told, the bookings stay until it is rescheduled or cancelled. */
export async function failDelivery(ctx: Ctx, id: string, reason: string) {
  const d = await row(ctx, id, true);
  if (!ACTIVE.includes(d.status)) throw conflict('delivery_closed', msg('error.delivery_closed', { status: d.status }));
  const text = String(reason ?? '').trim().slice(0, 500);
  if (!text) throw invalid(msg('error.delivery_reason'), [{ field: 'reason', code: 'required', message: msg('error.delivery_reason') }]);
  await exec(ctx, `UPDATE deliveries SET status = 'failed', failure_reason = $2 WHERE id = $1`, [id, text]);
  await notifyStaff(ctx, d.order_id, 'staff_delivery_failed', { reason: text, kind: d.kind });
  const out = await api(ctx, id);
  await audit(ctx, { entity_type: 'delivery', entity_id: id, action: 'fail', extra: { reason: text } });
  await emit(ctx, 'delivery.failed', { type: 'delivery', id }, out);
  return out;
}

/** Cancels a delivery that has not happened; the order's bookings go back to the rental period. */
export async function cancelDelivery(ctx: Ctx, id: string) {
  const d = await row(ctx, id, true);
  if (!['scheduled', 'dispatched', 'failed'].includes(d.status)) throw conflict('delivery_closed', msg('error.delivery_closed', { status: d.status }));
  await exec(ctx, `UPDATE deliveries SET status = 'cancelled' WHERE id = $1`, [id]);
  await coverWindows(ctx, await orderFor(ctx, d.order_id));
  const out = await api(ctx, id);
  await audit(ctx, { entity_type: 'delivery', entity_id: id, action: 'cancel' });
  await emit(ctx, 'delivery.cancelled', { type: 'delivery', id }, out);
  return out;
}

/** A day's run as CSV (stops in order) for drivers' phones or route planners. */
export async function routeCsv(ctx: Ctx, date: string, driverUserId?: string | null) {
  const list = (await listDeliveries(ctx, { date, driver_user_id: driverUserId ?? undefined })).filter((d) => d.status !== 'cancelled');
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const addr = (a: any) => [a.line1, a.line2, a.postal_code, a.city, a.country].filter(Boolean).join(', ');
  const head = ['stop', 'kind', 'order', 'customer', 'phone', 'address', 'window_start', 'window_end', 'driver', 'status', 'notes'];
  const rows = list.map((d, i) => [i + 1, d.kind, d.order_number, d.contact?.name || d.customer_name, d.contact?.phone, addr(d.address), d.window_start, d.window_end, d.driver_name, d.status, d.notes]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** The stops that have coordinates (`address.lat`, `address.lng`) as a GPX route. */
export async function routeGpx(ctx: Ctx, date: string, driverUserId?: string | null) {
  const list = (await listDeliveries(ctx, { date, driver_user_id: driverUserId ?? undefined })).filter((d) => d.status !== 'cancelled');
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const points = list
    .filter((d) => Number.isFinite(Number(d.address?.lat)) && Number.isFinite(Number(d.address?.lng)))
    .map((d, i) => `<rtept lat="${Number(d.address.lat)}" lon="${Number(d.address.lng)}"><name>${esc(`${i + 1}. #${d.order_number} ${d.contact?.name || d.customer_name || ''}`)}</name><desc>${esc(d.kind)}</desc></rtept>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OpenRent" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>${esc(date)}</name>${points.join('')}</rte></gpx>\n`;
}
