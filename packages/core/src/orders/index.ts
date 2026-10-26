import { t as msg } from '../i18n/index.ts';
import { validateCustomFields } from '../customfields/index.ts';
import { t } from '../i18n/index.ts';
import { orderLocale, tenantLocale } from '../i18n/context.ts';
import { setOwner } from '../files/index.ts';
import type { Ctx } from '../context.ts';
import { hookContext } from '../plugins/scope.ts';
import { enabledProvider } from '../plugins/index.ts';
import { money } from '../crud.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { can } from '../permissions.ts';
import { audit, emit } from '../events.ts';
import { newId, randomToken } from '../ids.ts';
import { allPages, exec, json, listPage, many, must, one, type ListParams } from '../sql.ts';
import { addMinutes } from '../time.ts';
import * as availability from '../availability/index.ts';
import { setStockItemStatus, createDowntime, adjustStockLevel } from '../inventory/index.ts';
import { ensureTicket, openTicketOf } from '../maintenance/tickets.ts';
import { needsInspectionOnReturn } from '../inspections/index.ts';
import { recordReadings } from '../servicing/index.ts';
import { issueDocument, voidDocument } from '../documents/index.ts';
import { notifyCustomer, notifyStaff } from '../notifications/index.ts';
import { ensureDeposit, recomputePaymentStatus, refundPayment, releaseDeposit, paymentToApi, paymentRequestToApi, depositToApi, listDamageCharges, createDamageCharge } from '../payments/index.ts';
import { getLocation } from '../tenancy/index.ts';
import { resolveSettings, type TenantSettings } from '../tenancy/settings.ts';
import { customerToApi } from '../customers/index.ts';
import { documentToApi } from '../documents/index.ts';
import { notificationToApi } from '../notifications/index.ts';
import { priceQuote, type QuoteRequestLine } from './quote.ts';
import { feeAmount, type QuoteBreakdown, type QuoteOptions } from '../pricing/engine.ts';
import { activeFeeRules } from '../catalog/index.ts';
import { availableActions, evaluate, HOLDING, transitionFor, type OrderAction, type OrderFacts, type OrderStatus } from './state.ts';

export * from './state.ts';
export * from './quote.ts';

const ACTIVE_UNIT_TRACKING = new Set(['serialized', 'bulk']);

// ---------------------------------------------------------------------------
// Loading and serialisation
// ---------------------------------------------------------------------------

export async function resolveOrderId(ctx: Ctx, ref: string): Promise<string> {
  const m = /^#?(\d+)$/.exec(ref);
  if (m) {
    const o = await one<{ id: string }>(ctx, `SELECT id FROM orders WHERE number = $1`, [Number(m[1])]);
    if (!o) throw new AppError('not_found', 404, msg('error.order_not_found_2', { number: m[1]! }));
    return o.id;
  }
  return ref;
}

async function orderRow(ctx: Ctx, ref: string, lock = false): Promise<any> {
  const id = await resolveOrderId(ctx, ref);
  return must(ctx, `SELECT * FROM orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id], 'order', ref);
}

/** Units on a line that still count: a unit swapped out (FR-OR-10) is replaced by the one after it. */
const activeUnits = (l: any): any[] => (l.units ?? []).filter((u: any) => !u.replaced);

async function lineRows(ctx: Ctx, orderId: string) {
  return many(
    ctx,
    `SELECT l.*, v.tracking, v.name AS variant_name, p.name AS product_name, p.type AS product_type, p.meter_unit,
            coalesce((SELECT jsonb_agg(jsonb_build_object('stock_item_id', u.stock_item_id, 'barcode', s.barcode, 'serial', s.serial, 'meter_value', s.meter_value,
                       'checked_out_at', u.checked_out_at, 'checked_in_at', u.checked_in_at, 'check_in_outcome', u.check_in_outcome,
                       'pinned', u.allocation_id IS NULL AND u.checked_out_at IS NULL, 'replaced', u.replaced_by_id IS NOT NULL, 'swapped_at', u.swapped_at)
                       ORDER BY u.replaced_by_id IS NOT NULL, s.barcode)
                      FROM order_line_units u JOIN stock_items s ON s.id = u.stock_item_id WHERE u.order_line_id = l.id), '[]') AS units
       FROM order_lines l LEFT JOIN variants v ON v.id = l.variant_id LEFT JOIN products p ON p.id = l.product_id
      WHERE l.order_id = $1 ORDER BY l.position, l.created_at`,
    [orderId],
  );
}

function lineToApi(l: any, currency: string, children: any[] = []): Record<string, any> {
  return {
    id: l.id, object: 'order_line', type: l.type, product_id: l.product_id, variant_id: l.variant_id, bundle_id: l.bundle_id, parent_line_id: l.parent_line_id,
    description: l.description, quantity: l.quantity, tracking: l.tracking ?? null, meter_unit: l.meter_unit ?? null, buffer_before_min: l.buffer_before_min, buffer_after_min: l.buffer_after_min,
    unit_price: money(l.unit_price, currency), subtotal: money(l.subtotal, currency), discount: money(l.discount, currency), tax: money(l.tax, currency),
    total: money(l.total, currency), deposit: money(l.deposit, currency), price_snapshot: l.price_snapshot, units: l.units ?? [],
    picked_up_qty: l.picked_up_qty, returned_qty: l.returned_qty, lost_qty: l.lost_qty, position: l.position,
    components: children.map((c) => lineToApi(c, currency)),
  };
}

function totalsToApi(t: any, currency: string) {
  const f = (k: string) => money(t?.[k] ?? 0, currency);
  return {
    subtotal: f('subtotal'), discount: f('discount'), fees: f('fees'), tax: f('tax'), total: f('total'), deposit: f('deposit'),
    paid: f('paid'), refunded: f('refunded'), balance: f('balance'),
    tax_breakdown: (t?.tax_breakdown ?? []).map((x: any) => ({ rate_bp: x.rate_bp, net: money(x.net, currency), tax: money(x.tax, currency) })),
    coupons_applied: (t?.coupons_applied ?? []).map((x: any) => ({ ...x, amount: money(x.amount, currency) })),
    coupon_errors: t?.coupon_errors ?? [],
    optional_fees: (t?.optional_fees ?? []).map((x: any) => ({ ...x, amount: money(x.amount, currency) })),
    fee_errors: t?.fee_errors ?? [],
  };
}

async function loadFacts(ctx: Ctx, o: any): Promise<OrderFacts> {
  const lines = await lineRows(ctx, o.id);
  const customer = o.customer_id ? await one(ctx, `SELECT flags FROM customers WHERE id = $1`, [o.customer_id]) : null;
  let unassigned = 0;
  let outstanding = 0;
  for (const l of lines) {
    if (l.type !== 'rental') continue;
    if (l.tracking === 'serialized') {
      unassigned += Math.max(0, l.quantity - activeUnits(l).length);
      outstanding += (l.units ?? []).filter((u: any) => u.checked_out_at && !u.checked_in_at).length;
    } else if (l.tracking === 'bulk') {
      outstanding += Math.max(0, l.picked_up_qty - l.returned_qty - l.lost_qty);
    }
  }
  const dep = await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM deposits WHERE order_id = $1 AND status = 'held'`, [o.id]);
  const dmg = await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM damage_charges WHERE order_id = $1 AND status = 'open'`, [o.id]);
  return {
    status: o.status,
    hasLines: lines.some((l) => !l.parent_line_id),
    hasCustomer: !!o.customer_id,
    customerBlocked: !!customer?.flags?.blocked,
    unassignedUnits: unassigned,
    outstandingUnits: outstanding,
    balance: Number(o.totals?.balance ?? o.totals?.total ?? 0),
    openDeposits: dep?.n ?? 0,
    openDamageCharges: dmg?.n ?? 0,
    currency: o.currency.trim(),
  };
}

export async function orderToApi(ctx: Ctx, o: any, expand: string[] = []): Promise<Record<string, any>> {
  const currency = o.currency.trim();
  const lines = await lineRows(ctx, o.id);
  const parents = lines.filter((l) => !l.parent_line_id);
  const facts = await loadFacts(ctx, o);
  const api: Record<string, any> = {
    id: o.id, object: 'order', number: o.number, status: o.status, payment_status: o.payment_status, source: o.source,
    customer_id: o.customer_id, location_id: o.location_id, starts_at: o.starts_at, ends_at: o.ends_at, timezone: o.timezone, currency,
    totals: totalsToApi(o.totals, currency), deposit_policy: o.deposit_policy, coupon_codes: o.coupon_codes, options: o.options ?? {}, terms_acceptance: o.terms_acceptance,
    quote_expires_at: o.quote_expires_at, notes: o.notes, tags: o.tags, custom_fields: o.custom_fields, public_token: o.public_token, public_url: `${ctx.config.storefrontUrl.replace(/\/$/, '')}/order/${o.public_token}`,
    version: o.version, closed_at: o.closed_at, cancelled_at: o.cancelled_at, cancel_reason: o.cancel_reason,
    lines: parents.map((p) => lineToApi(p, currency, lines.filter((c) => c.parent_line_id === p.id))),
    actions: availableActions(facts),
    fulfilment: { unassigned_units: facts.unassignedUnits, outstanding_units: facts.outstandingUnits, overdue: ['out', 'returned_partial'].includes(o.status) && new Date(o.ends_at) < ctx.now },
    // Quantity booked past stock on purpose (FR-AV-8) that is still held.
    overbookings: (await many(ctx, `SELECT id, variant_id, quantity, reason, created_at FROM overbookings WHERE order_id = $1 AND resolved_at IS NULL ORDER BY created_at`, [o.id])),
    created_at: o.created_at, updated_at: o.updated_at,
  };
  if (expand.includes('customer')) api.customer = o.customer_id ? customerToApi(await one(ctx, `SELECT * FROM customers WHERE id = $1`, [o.customer_id])) : null;
  if (expand.includes('location')) api.location = await one(ctx, `SELECT id, name, timezone, address, opening_hours FROM locations WHERE id = $1`, [o.location_id]);
  if (expand.includes('payments')) api.payments = (await many(ctx, `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at`, [o.id])).map(paymentToApi);
  if (expand.includes('payment_requests')) api.payment_requests = (await many(ctx, `SELECT * FROM payment_requests WHERE order_id = $1 ORDER BY created_at DESC`, [o.id])).map(paymentRequestToApi);
  if (expand.includes('deposits')) api.deposits = (await many(ctx, `SELECT * FROM deposits WHERE order_id = $1 ORDER BY created_at`, [o.id])).map(depositToApi);
  if (expand.includes('documents')) api.documents = (await many(ctx, `SELECT * FROM documents WHERE order_id = $1 ORDER BY created_at DESC`, [o.id])).map(documentToApi);
  if (expand.includes('damage_charges')) api.damage_charges = await listDamageCharges(ctx, o.id);
  if (expand.includes('notifications')) api.notifications = (await many(ctx, `SELECT * FROM notifications WHERE order_id = $1 ORDER BY created_at DESC`, [o.id])).map(notificationToApi);
  return api;
}

export async function getOrder(ctx: Ctx, ref: string, expand: string[] = []) {
  return orderToApi(ctx, await orderRow(ctx, ref), expand);
}

export async function listOrders(ctx: Ctx, p: ListParams) {
  const q = p.q?.trim();
  const numeric = q && /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  const page = await listPage<any>(
    ctx,
    {
      table: `(SELECT o.*, c.name AS customer_name, c.email AS customer_email FROM orders o LEFT JOIN customers c ON c.id = o.customer_id) o`,
      filters: {
        status: 'status', payment_status: 'payment_status', customer_id: 'customer_id', location_id: 'location_id', source: 'source',
        starts_at: 'starts_at', ends_at: 'ends_at', created_at: 'created_at', number: 'number',
      },
      sorts: { number: 'number', starts_at: 'starts_at', ends_at: 'ends_at', created_at: 'created_at', updated_at: 'updated_at' },
      defaultSort: '-created_at',
      search: numeric === null ? ['customer_name', 'customer_email', "array_to_string(tags, ' ')"] : [],
      baseWhere: numeric !== null ? `number = ${numeric}` : undefined,
    },
    { ...p, q: numeric !== null ? undefined : q },
  );
  return {
    ...page,
    data: page.data.map((o) => ({
      id: o.id, object: 'order', number: o.number, status: o.status, payment_status: o.payment_status, source: o.source, customer_id: o.customer_id,
      customer_name: o.customer_name, location_id: o.location_id, starts_at: o.starts_at, ends_at: o.ends_at, currency: o.currency.trim(),
      totals: totalsToApi(o.totals, o.currency.trim()), tags: o.tags, created_at: o.created_at, updated_at: o.updated_at,
    })),
  };
}

const major = (minor: number | null | undefined) => (minor == null ? '' : (Number(minor) / 100).toFixed(2));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '');

/** The order list as a spreadsheet, with the same filters and search as the list (FR-INT-2). */
export async function exportOrders(ctx: Ctx, p: ListParams) {
  const rows = await allPages((q) => listOrders(ctx, q), p);
  const locations = new Map((await many<{ id: string; name: string }>(ctx, `SELECT id, name FROM locations`)).map((l) => [l.id, l.name]));
  const emails = new Map((await many<{ id: string; email: string | null }>(ctx, `SELECT id, email FROM customers WHERE id = ANY($1)`, [[...new Set(rows.map((o) => o.customer_id).filter(Boolean))]])).map((c) => [c.id, c.email]));
  return {
    headers: ['number', 'status', 'payment_status', 'source', 'customer', 'customer_email', 'location', 'starts_at', 'ends_at', 'currency', 'subtotal', 'discount', 'tax', 'total', 'deposit', 'paid', 'balance', 'tags', 'created_at'],
    rows: rows.map((o) => [
      String(o.number), o.status, o.payment_status, o.source, o.customer_name ?? '', (o.customer_id && emails.get(o.customer_id)) ?? '', locations.get(o.location_id) ?? '', iso(o.starts_at), iso(o.ends_at), o.currency,
      major(o.totals.subtotal.amount), major(o.totals.discount.amount), major(o.totals.tax.amount), major(o.totals.total.amount), major(o.totals.deposit.amount), major(o.totals.paid.amount), major(o.totals.balance.amount),
      (o.tags ?? []).join(', '), iso(o.created_at),
    ]),
  };
}

// ---------------------------------------------------------------------------
// Creation, editing and pricing
// ---------------------------------------------------------------------------

export interface OrderLineInput extends QuoteRequestLine {
  stock_item_ids?: string[];
  buffer_before_min?: number;
  buffer_after_min?: number;
}

export interface CreateOrderInput {
  customer_id?: string | null;
  location_id?: string | null;
  starts_at: string;
  ends_at: string;
  lines?: OrderLineInput[];
  coupon_codes?: string[];
  deposit?: { mode: 'auto' | 'none' | 'fixed' | 'percent'; amount?: number; pct_bp?: number } | null;
  notes?: { internal?: string; customer?: string };
  tags?: string[];
  custom_fields?: Record<string, unknown>;
  source?: 'storefront' | 'admin' | 'api';
  /** Optional fees chosen and the delivery postcode (FR-PR-8). */
  options?: QuoteOptions;
}

async function nextOrderNumber(ctx: Ctx): Promise<number> {
  const r = await must<{ n: number }>(
    ctx,
    `INSERT INTO order_sequences (tenant_id, next_value) VALUES ($1, 1002)
     ON CONFLICT (tenant_id) DO UPDATE SET next_value = order_sequences.next_value + 1
     RETURNING next_value - 1 AS n`,
    [ctx.tenantId],
    'order_sequence',
  );
  return r.n;
}

async function insertLine(ctx: Ctx, order: any, input: OrderLineInput, position: number) {
  const [resolved] = await (await import('./quote.ts')).resolveLines(ctx, [input], null, order.location_id);
  const r = resolved!;
  const id = newId('oln');
  const qty = Math.max(1, Math.floor(input.quantity ?? 1));
  // The line's own buffer, else the variant's, else the product's (FR-AV-3).
  const before = input.buffer_before_min ?? r.variant?.buffer_before_min ?? r.product?.buffer_before_min ?? 0;
  const after = input.buffer_after_min ?? r.variant?.buffer_after_min ?? r.product?.buffer_after_min ?? 0;
  const bundleId = r.product?.type === 'bundle' ? (await one(ctx, `SELECT id FROM bundles WHERE product_id = $1`, [r.product.id]))?.id : null;
  await exec(
    ctx,
    `INSERT INTO order_lines (id, tenant_id, order_id, type, product_id, variant_id, bundle_id, quantity, buffer_before_min, buffer_after_min, description, unit_price, position, price_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id, ctx.tenantId, order.id, r.engine.type, r.product?.id ?? null, r.variant?.id ?? null, bundleId, qty, before, after, input.description || r.engine.name, input.amount ?? 0, position,
      // A percentage discount keeps its share; reprice() reads it back.
      json(r.engine.type === 'discount' && input.percent_bp != null ? { percent_bp: input.percent_bp } : {}),
    ],
  );
  for (const c of r.bundleComponents) {
    await exec(
      ctx,
      `INSERT INTO order_lines (id, tenant_id, order_id, type, product_id, variant_id, parent_line_id, quantity, buffer_before_min, buffer_after_min, description, position)
       SELECT $1,$2,$3,'rental',v.product_id,v.id,$4,$5,$6,$7,$8,$9 FROM variants v WHERE v.id = $10`,
      [newId('oln'), ctx.tenantId, order.id, id, qty * c.quantity, before, after, c.name, position, c.variant_id],
    );
  }
  for (const sti of input.stock_item_ids ?? []) {
    if (r.variant?.tracking !== 'serialized') throw invalid(msg('error.only_serialised_lines_can_pin_units'));
    await availability.assertUnitUsable(ctx, sti, r.variant.id, order.location_id);
    await exec(ctx, `INSERT INTO order_line_units (id, tenant_id, order_line_id, stock_item_id) VALUES ($1,$2,$3,$4)`, [newId('olu'), ctx.tenantId, id, sti]);
  }
  return id;
}

/** A damage waiver on the order, or an insurance document on the order or its customer (FR-PAY-8). */
export async function damageCovered(ctx: Ctx, o: { id: string; customer_id: string | null }): Promise<boolean> {
  const waiver = await one(ctx, `SELECT 1 FROM order_lines WHERE order_id = $1 AND type = 'fee' AND price_snapshot->>'fee_kind' = 'damage_waiver' LIMIT 1`, [o.id]);
  if (waiver) return true;
  const insurance = await one(
    ctx,
    `SELECT 1 FROM attachments WHERE kind = 'insurance' AND ((owner_type = 'order' AND owner_id = $1) OR (owner_type = 'customer' AND owner_id = $2)) LIMIT 1`,
    [o.id, o.customer_id],
  );
  return !!insurance;
}

/** Only known keys, trimmed: the fee rule ids chosen and the delivery postcode. */
function cleanOptions(o: QuoteOptions | null | undefined): QuoteOptions {
  const fees = [...new Set((o?.fees ?? []).filter((x) => typeof x === 'string' && x))];
  const postcode = typeof o?.postcode === 'string' && o.postcode.trim() ? o.postcode.trim().slice(0, 20) : null;
  const address = typeof o?.address === 'string' && o.address.trim() ? o.address.trim().slice(0, 300) : null;
  return { fees, postcode, address };
}

/**
 * Keeps one order line per fee rule the engine added: new ones are inserted (their key becomes the line
 * id), changed ones keep their id, and lines of rules that no longer apply are removed.
 */
async function syncRuleFees(ctx: Ctx, orderId: string, breakdown: QuoteBreakdown, existing: any[], count: number) {
  let pos = count;
  for (const b of breakdown.lines) {
    if (!b.fee_rule_id) continue;
    const row = existing.find((l) => l.price_snapshot?.fee_rule_id === b.fee_rule_id);
    if (row) {
      b.key = row.id;
      await exec(ctx, `UPDATE order_lines SET description = $2 WHERE id = $1`, [row.id, b.name]);
      continue;
    }
    const id = newId('oln');
    await exec(
      ctx,
      `INSERT INTO order_lines (id, tenant_id, order_id, type, quantity, description, unit_price, position, price_snapshot) VALUES ($1,$2,$3,'fee',1,$4,$5,$6,$7)`,
      [id, ctx.tenantId, orderId, b.name, b.unit_price, pos++, json({ fee_rule_id: b.fee_rule_id, fee_kind: b.fee_kind })],
    );
    b.key = id;
  }
  const keep = new Set(breakdown.lines.map((b) => b.fee_rule_id).filter(Boolean));
  const gone = existing.filter((l) => !keep.has(l.price_snapshot.fee_rule_id)).map((l) => l.id);
  if (gone.length) await exec(ctx, `DELETE FROM order_lines WHERE id = ANY($1)`, [gone]);
}

/** Recomputes every line's price snapshot and the order totals (draft and quote only). */
export async function reprice(ctx: Ctx, orderId: string) {
  const o = await must<any>(ctx, `SELECT * FROM orders WHERE id = $1`, [orderId], 'order', orderId);
  const all = (await lineRows(ctx, orderId)).filter((l) => !l.parent_line_id);
  // Fee lines added by a fee rule come back from the engine; send only the lines staff added.
  const ruleFees = all.filter((l) => l.price_snapshot?.fee_rule_id);
  const lines = all.filter((l) => !l.price_snapshot?.fee_rule_id);
  const { breakdown } = await priceQuote(ctx, {
    location_id: o.location_id,
    starts_at: o.starts_at,
    ends_at: o.ends_at,
    customer_id: o.customer_id,
    coupon_codes: o.coupon_codes,
    options: o.options ?? {},
    deposit: o.deposit_policy?.mode && o.deposit_policy.mode !== 'auto' ? o.deposit_policy : null,
    lines: lines.map((l) => ({
      key: l.id,
      type: l.type,
      variant_id: l.variant_id,
      quantity: l.quantity,
      amount: l.type === 'fee' || (l.type === 'discount' && l.price_snapshot?.percent_bp == null) ? Number(l.unit_price) : l.price_snapshot?.override_amount ?? null,
      percent_bp: l.type === 'discount' ? (l.price_snapshot?.percent_bp ?? null) : null,
      description: l.description,
    })),
  });
  await syncRuleFees(ctx, o.id, breakdown, ruleFees, all.length);
  for (const b of breakdown.lines) {
    const prev = all.find((l) => l.id === b.key)?.price_snapshot ?? {};
    const snapshot = { ...b, computed_at: ctx.now.toISOString(), ...(prev.override_amount != null ? { override_amount: prev.override_amount } : {}) };
    await exec(
      ctx,
      `UPDATE order_lines SET price_snapshot = $2, unit_price = $3, subtotal = $4, discount = $5, tax = $6, total = $7, deposit = $8 WHERE id = $1`,
      [b.key, json(snapshot), b.unit_price, b.subtotal, b.discount, b.tax, b.total, b.deposit],
    );
  }
  const totals = {
    ...(o.totals ?? {}),
    subtotal: breakdown.subtotal, discount: breakdown.discount, fees: breakdown.fees, tax: breakdown.tax, total: breakdown.total, deposit: breakdown.deposit,
    tax_breakdown: breakdown.tax_breakdown, coupons_applied: breakdown.coupons_applied, coupon_errors: breakdown.coupon_errors,
    optional_fees: breakdown.optional_fees, fee_errors: breakdown.fee_errors,
  };
  await exec(ctx, `UPDATE orders SET totals = $2 WHERE id = $1`, [orderId, json(totals)]);
  await recomputePaymentStatus(ctx, orderId);
}

/** After status leaves draft/quote, totals follow line rows (late fees and other added lines). */
async function recalcTotalsFromLines(ctx: Ctx, orderId: string) {
  const o = await must<any>(ctx, `SELECT totals FROM orders WHERE id = $1`, [orderId], 'order');
  const lines = await many(ctx, `SELECT type, subtotal, discount, tax, total, net, rate FROM (SELECT type, subtotal, discount, tax, total, subtotal - discount AS net, coalesce((price_snapshot->>'tax_rate_bp')::int, 0) AS rate FROM order_lines WHERE order_id = $1 AND parent_line_id IS NULL) x`, [orderId]);
  const sum = (f: (l: any) => number) => lines.reduce((a, l) => a + f(l), 0);
  const byRate = new Map<number, { net: number; tax: number }>();
  for (const l of lines) {
    const r = byRate.get(l.rate) ?? { net: 0, tax: 0 };
    r.net += Number(l.net);
    r.tax += Number(l.tax);
    byRate.set(l.rate, r);
  }
  const totals = {
    ...o.totals,
    subtotal: sum((l) => (l.type === 'fee' ? 0 : Number(l.subtotal))),
    fees: sum((l) => (l.type === 'fee' ? Number(l.subtotal) : 0)),
    discount: sum((l) => Number(l.discount)),
    tax: sum((l) => Number(l.tax)),
    total: sum((l) => Number(l.total)),
    tax_breakdown: [...byRate.entries()].map(([rate_bp, r]) => ({ rate_bp, ...r })),
  };
  await exec(ctx, `UPDATE orders SET totals = $2 WHERE id = $1`, [orderId, json(totals)]);
  await recomputePaymentStatus(ctx, orderId);
}

function reservationRequests(o: any, lines: any[]): availability.AllocationRequest[] {
  const reqs: availability.AllocationRequest[] = [];
  const parentsWithChildren = new Set(lines.filter((l) => l.parent_line_id).map((l) => l.parent_line_id));
  lines.forEach((l, i) => {
    if (l.type !== 'rental' || !l.variant_id || !ACTIVE_UNIT_TRACKING.has(l.tracking) || parentsWithChildren.has(l.id)) return;
    reqs.push({
      variantId: l.variant_id,
      locationId: o.location_id,
      from: addMinutes(new Date(o.starts_at), -l.buffer_before_min),
      to: addMinutes(new Date(o.ends_at), l.buffer_after_min),
      quantity: l.quantity,
      kind: 'reservation',
      orderId: o.id,
      orderLineId: l.id,
      stockItemIds: (l.units ?? []).map((u: any) => u.stock_item_id),
      ref: `lines[${i}].quantity`,
    });
  });
  return reqs;
}

/** Places allocations for every tracked rental line (bundles via their component lines). */
async function holdStock(ctx: Ctx, o: any, opts: { overbook?: { reason: string } } = {}) {
  const lines = await lineRows(ctx, o.id);
  await availability.releaseOrder(ctx, o.id).catch(() => undefined);
  // releaseOrder drops pins too; re-read pins captured before release.
  const reqs = reservationRequests(o, lines);
  await ctx.plugins.runHook('before', 'availability.check', { order_id: o.id, requests: reqs }, hookContext(ctx));
  await availability.reserve(ctx, reqs, opts);
}

/** Staff booking past stock on purpose (FR-AV-8): needs orders:overbook and a reason. */
function overbookOption(ctx: Ctx, body: any): { reason: string } | undefined {
  if (!body?.overbook) return undefined;
  if (!can(ctx.actor, 'orders:overbook')) throw new AppError('forbidden', 403, msg('error.overbook_not_allowed'));
  const reason = String(body.overbook.reason ?? '').trim().slice(0, 500);
  if (!reason) throw invalid(msg('error.overbook_reason'), [{ field: 'overbook.reason', code: 'required', message: msg('error.overbook_reason') }]);
  return { reason };
}

async function hasAllocations(ctx: Ctx, orderId: string) {
  return !!(await one(ctx, `SELECT 1 FROM allocations WHERE order_id = $1 AND kind = 'reservation' LIMIT 1`, [orderId]));
}

export async function availabilityCheck(ctx: Ctx, o: any) {
  const lines = await lineRows(ctx, o.id);
  const out = [];
  for (const l of lines.filter((x) => !x.parent_line_id && x.type === 'rental' && x.variant_id)) {
    const r = await availability.check(ctx, {
      variantId: l.variant_id,
      locationId: o.location_id,
      from: addMinutes(new Date(o.starts_at), -l.buffer_before_min),
      to: addMinutes(new Date(o.ends_at), l.buffer_after_min),
      excludeOrderId: o.id,
    });
    out.push({ line_id: l.id, variant_id: l.variant_id, requested: l.quantity, available: r.available, ok: r.available === null || r.available >= l.quantity });
  }
  return out;
}

export async function createOrder(ctx: Ctx, input: CreateOrderInput): Promise<Record<string, any>> {
  await ctx.plugins.runHook('before', 'orders.create', input, hookContext(ctx));
  const loc = await getLocation(ctx, input.location_id);
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);
  if (!(endsAt > startsAt)) throw invalid(msg('error.the_return_must_be_after_the_pickup'), [{ field: 'ends_at', code: 'invalid_range', message: msg('error.the_return_must_be_after_the_pickup') }]);
  if (input.customer_id) await must(ctx, `SELECT 1 FROM customers WHERE id = $1 AND deleted_at IS NULL`, [input.customer_id], 'customer', input.customer_id);
  input = { ...input, custom_fields: await validateCustomFields(ctx, 'order', input.custom_fields) };
  const tenant = await must<any>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const id = newId('ord');
  const number = await nextOrderNumber(ctx);
  await exec(
    ctx,
    `INSERT INTO orders (id, tenant_id, number, customer_id, location_id, starts_at, ends_at, timezone, currency, deposit_policy, coupon_codes, source, public_token, notes, tags, custom_fields, created_by, options)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [id, ctx.tenantId, number, input.customer_id ?? null, loc.id, startsAt, endsAt, loc.timezone, tenant.currency, json(input.deposit ?? { mode: 'auto' }),
      input.coupon_codes ?? [], input.source ?? (ctx.actor.type === 'api_key' ? 'api' : 'admin'), randomToken(24), json(input.notes ?? {}), input.tags ?? [],
      json(input.custom_fields ?? {}), ctx.actor.id, json(cleanOptions(input.options))],
  );
  const order = { id, location_id: loc.id };
  let pos = 0;
  for (const l of input.lines ?? []) await insertLine(ctx, order, l, pos++);
  await reprice(ctx, id);
  await event(ctx, id, 'created', null, 'draft', {});
  const row = await orderRow(ctx, id);
  await audit(ctx, { entity_type: 'order', entity_id: id, action: 'create', after: row });
  const api = await orderToApi(ctx, row);
  await emit(ctx, 'order.created', { type: 'order', id }, api);
  return { ...api, availability_check: await availabilityCheck(ctx, row) };
}

/** Runs fn on an order that must be editable; quotes holding stock are re-held afterwards. */
async function editable<T>(ctx: Ctx, ref: string, fn: (o: any) => Promise<T>, ifMatch?: number | null): Promise<any> {
  const o = await orderRow(ctx, ref, true);
  if (ifMatch != null && ifMatch !== o.version) throw new AppError('precondition_failed', 412, msg('error.the_order_changed_since_you_loaded_it'), { extra: { current_version: o.version } });
  if (!['draft', 'quote'].includes(o.status)) throw new AppError('order_locked', 409, msg('error.lines_and_dates_can_only_change_while', { status: o.status }));
  const held = o.status === 'quote' && (await hasAllocations(ctx, o.id));
  await fn(o);
  await reprice(ctx, o.id);
  const fresh = await orderRow(ctx, o.id);
  if (held) await holdStock(ctx, fresh);
  return fresh;
}

const ALWAYS_EDITABLE = ['notes', 'tags', 'custom_fields'];

export async function updateOrder(ctx: Ctx, ref: string, patch: Record<string, any>, ifMatch?: number | null): Promise<Record<string, any>> {
  const before = await orderRow(ctx, ref);
  if (patch.custom_fields !== undefined) patch = { ...patch, custom_fields: await validateCustomFields(ctx, 'order', patch.custom_fields) };
  const structural = Object.keys(patch).filter((k) => !ALWAYS_EDITABLE.includes(k) && patch[k] !== undefined);
  if (structural.length) {
    await editable(
      ctx,
      before.id,
      async (o) => {
        if (patch.location_id) {
          const loc = await getLocation(ctx, patch.location_id);
          await exec(ctx, `UPDATE orders SET location_id = $2, timezone = $3 WHERE id = $1`, [o.id, loc.id, loc.timezone]);
        }
        if (patch.customer_id !== undefined) {
          if (patch.customer_id) await must(ctx, `SELECT 1 FROM customers WHERE id = $1`, [patch.customer_id], 'customer');
          await exec(ctx, `UPDATE orders SET customer_id = $2 WHERE id = $1`, [o.id, patch.customer_id]);
        }
        if (patch.starts_at || patch.ends_at) {
          const s = new Date(patch.starts_at ?? o.starts_at);
          const e = new Date(patch.ends_at ?? o.ends_at);
          if (!(e > s)) throw invalid(msg('error.the_return_must_be_after_the_pickup'));
          await exec(ctx, `UPDATE orders SET starts_at = $2, ends_at = $3 WHERE id = $1`, [o.id, s, e]);
        }
        if (patch.coupon_codes) await exec(ctx, `UPDATE orders SET coupon_codes = $2 WHERE id = $1`, [o.id, patch.coupon_codes]);
        if (patch.deposit) await exec(ctx, `UPDATE orders SET deposit_policy = $2 WHERE id = $1`, [o.id, json(patch.deposit)]);
        if (patch.options) await exec(ctx, `UPDATE orders SET options = $2 WHERE id = $1`, [o.id, json(cleanOptions(patch.options))]);
      },
      ifMatch,
    );
  } else if (ifMatch != null && ifMatch !== before.version) {
    throw new AppError('precondition_failed', 412, msg('error.the_order_changed_since_you_loaded_it'), { extra: { current_version: before.version } });
  }
  if (patch.notes) await exec(ctx, `UPDATE orders SET notes = notes || $2 WHERE id = $1`, [before.id, json(patch.notes)]);
  if (patch.tags) await exec(ctx, `UPDATE orders SET tags = $2 WHERE id = $1`, [before.id, patch.tags]);
  if (patch.custom_fields) await exec(ctx, `UPDATE orders SET custom_fields = custom_fields || $2 WHERE id = $1`, [before.id, json(patch.custom_fields)]);
  const row = await orderRow(ctx, before.id);
  await audit(ctx, { entity_type: 'order', entity_id: before.id, action: 'update', before, after: row });
  const api = await orderToApi(ctx, row);
  await emit(ctx, 'order.updated', { type: 'order', id: before.id }, api);
  return { ...api, availability_check: await availabilityCheck(ctx, row) };
}

export async function addLine(ctx: Ctx, ref: string, input: OrderLineInput): Promise<Record<string, any>> {
  let lineId = '';
  const o = await editable(ctx, ref, async (o) => {
    const pos = (await one<{ n: number }>(ctx, `SELECT coalesce(max(position), -1) + 1 AS n FROM order_lines WHERE order_id = $1`, [o.id]))!.n;
    lineId = await insertLine(ctx, o, input, pos);
  });
  await audit(ctx, { entity_type: 'order_line', entity_id: lineId, action: 'create', after: input as any });
  const api = await orderToApi(ctx, o);
  await emit(ctx, 'order.updated', { type: 'order', id: o.id }, api);
  return { ...api, availability_check: await availabilityCheck(ctx, o) };
}

export async function updateLine(ctx: Ctx, ref: string, lineId: string, patch: { quantity?: number; amount?: number | null; description?: string; buffer_before_min?: number; buffer_after_min?: number; stock_item_ids?: string[] }) {
  const o = await editable(ctx, ref, async (o) => {
    const l = await must<any>(ctx, `SELECT l.*, v.tracking FROM order_lines l LEFT JOIN variants v ON v.id = l.variant_id WHERE l.id = $1 AND l.order_id = $2 AND l.parent_line_id IS NULL`, [lineId, o.id], 'order_line', lineId);
    if (patch.quantity !== undefined) {
      if (!Number.isInteger(patch.quantity) || patch.quantity < 1) throw invalid(msg('error.quantity_must_be_at_least_1'));
      await exec(ctx, `UPDATE order_lines SET quantity = $2 WHERE id = $1`, [lineId, patch.quantity]);
      const comps = await many(ctx, `SELECT bc.quantity, bc.variant_id FROM bundle_components bc WHERE bc.bundle_id = $1`, [l.bundle_id ?? '']);
      for (const c of comps) await exec(ctx, `UPDATE order_lines SET quantity = $3 WHERE parent_line_id = $1 AND variant_id = $2`, [lineId, c.variant_id, patch.quantity * c.quantity]);
    }
    if (patch.description !== undefined) await exec(ctx, `UPDATE order_lines SET description = $2 WHERE id = $1`, [lineId, patch.description]);
    if (patch.buffer_before_min !== undefined || patch.buffer_after_min !== undefined) {
      await exec(ctx, `UPDATE order_lines SET buffer_before_min = coalesce($2, buffer_before_min), buffer_after_min = coalesce($3, buffer_after_min) WHERE id = $1 OR parent_line_id = $1`, [lineId, patch.buffer_before_min ?? null, patch.buffer_after_min ?? null]);
    }
    if (patch.amount !== undefined) {
      if (l.type === 'fee') await exec(ctx, `UPDATE order_lines SET unit_price = $2 WHERE id = $1`, [lineId, patch.amount ?? 0]);
      else await exec(ctx, `UPDATE order_lines SET price_snapshot = price_snapshot || $2 WHERE id = $1`, [lineId, json({ override_amount: patch.amount })]);
    }
    if (patch.stock_item_ids) {
      if (l.tracking !== 'serialized') throw invalid(msg('error.only_serialised_lines_can_pin_units'));
      await exec(ctx, `DELETE FROM order_line_units WHERE order_line_id = $1 AND checked_out_at IS NULL`, [lineId]);
      for (const sti of patch.stock_item_ids) {
        await availability.assertUnitUsable(ctx, sti, l.variant_id, o.location_id);
        await exec(ctx, `INSERT INTO order_line_units (id, tenant_id, order_line_id, stock_item_id) VALUES ($1,$2,$3,$4)`, [newId('olu'), ctx.tenantId, lineId, sti]);
      }
    }
  });
  await audit(ctx, { entity_type: 'order_line', entity_id: lineId, action: 'update', after: patch as any });
  return orderToApi(ctx, o);
}

export async function removeLine(ctx: Ctx, ref: string, lineId: string) {
  const o = await editable(ctx, ref, async (o) => {
    const n = await exec(ctx, `DELETE FROM order_lines WHERE id = $1 AND order_id = $2 AND parent_line_id IS NULL`, [lineId, o.id]);
    if (!n) throw new AppError('not_found', 404, msg('error.line_not_found'));
  });
  await audit(ctx, { entity_type: 'order_line', entity_id: lineId, action: 'delete' });
  return orderToApi(ctx, o);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

async function event(ctx: Ctx, orderId: string, type: string, from: string | null, to: string | null, payload: Record<string, unknown>) {
  await exec(ctx, `INSERT INTO order_events (id, tenant_id, order_id, type, from_status, to_status, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    newId('oev'), ctx.tenantId, orderId, type, from, to, json(payload), json({ type: ctx.actor.type, id: ctx.actor.id }),
  ]);
}

const SET_COLUMNS = new Set(['quote_expires_at', 'closed_at', 'cancelled_at', 'cancel_reason']);

async function setStatus(ctx: Ctx, o: any, to: OrderStatus, eventName: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const cols = Object.keys(extra).filter((k) => SET_COLUMNS.has(k));
  const sets = cols.map((c, i) => `, ${c} = $${i + 3}`).join('');
  await exec(ctx, `UPDATE orders SET status = $2${sets} WHERE id = $1`, [o.id, to, ...cols.map((c) => extra[c])]);
  await event(ctx, o.id, eventName, o.status, to, payload);
  await audit(ctx, { entity_type: 'order', entity_id: o.id, action: `transition:${eventName}`, before: { status: o.status }, after: { status: to }, extra: payload });
  const api = await orderToApi(ctx, await orderRow(ctx, o.id));
  await emit(ctx, 'order.status_changed', { type: 'order', id: o.id }, { ...api, from: o.status, to }, { status: o.status });
  await emit(ctx, `order.${eventName}`, { type: 'order', id: o.id }, { ...api, ...payload });
  return api;
}

async function settings(ctx: Ctx): Promise<TenantSettings> {
  return resolveSettings((await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).settings);
}

type Handler = (ctx: Ctx, o: any, body: any, facts: OrderFacts) => Promise<unknown>;

async function resolveUnits(ctx: Ctx, body: { stock_item_ids?: string[]; barcodes?: string[] }) {
  const ids = [...(body.stock_item_ids ?? [])];
  for (const code of body.barcodes ?? []) {
    const s = await one<{ id: string }>(ctx, `SELECT id FROM stock_items WHERE barcode = $1`, [code.trim()]);
    if (!s) throw new AppError('unknown_barcode', 404, msg('error.no_unit_with_barcode', { code }));
    ids.push(s.id);
  }
  return [...new Set(ids)];
}

/** Assigns units to matching lines; explains wrong product, location or status (FR-OR-4). */
export async function assignUnits(ctx: Ctx, ref: string, body: { line_id?: string; stock_item_ids?: string[]; barcodes?: string[] }) {
  const o = await orderRow(ctx, ref, true);
  if (!['reserved', 'prepared', 'out', 'returned_partial'].includes(o.status)) throw new AppError('invalid_transition', 409, msg('error.units_can_be_assigned_once_the_order', { status: o.status }));
  const ids = await resolveUnits(ctx, body);
  if (!ids.length) throw invalid(msg('error.send_stock_item_ids_or_barcodes'));
  const assigned: string[] = [];
  for (const sti of ids) {
    const unit = await must<any>(ctx, `SELECT s.id, s.barcode, s.variant_id, s.status, s.location_id, l.name AS location_name FROM stock_items s JOIN locations l ON l.id = s.location_id WHERE s.id = $1`, [sti], 'stock_item', sti);
    if (unit.status === 'needs_inspection' || unit.status === 'hard_down') throw new AppError('unit_needs_inspection', 409, msg('error.unit_has_status', { barcode: unit.barcode, status: unit.status.replace('_', ' ') }));
    if (unit.status === 'in_transit') throw new AppError('unit_in_transit', 409, msg('error.unit_in_transit', { barcode: unit.barcode }));
    if (unit.location_id !== o.location_id) throw new AppError('wrong_location', 422, t('orders.wrong_location', { code: unit.barcode, location: unit.location_name }));
    const lines = await lineRows(ctx, o.id);
    const candidates = lines.filter((l) => l.type === 'rental' && l.tracking === 'serialized' && (body.line_id ? l.id === body.line_id || l.parent_line_id === body.line_id : true));
    const line = candidates.find((l) => l.variant_id === unit.variant_id && activeUnits(l).length < l.quantity);
    if (!line) {
      const sameProduct = candidates.find((l) => l.variant_id === unit.variant_id);
      if (sameProduct) throw new AppError('fully_assigned', 409, msg('error.every_on_this_order_already_has_a', { description: sameProduct.description }));
      throw new AppError('wrong_item', 422, msg('error.is_not_on_this_order', { barcode: unit.barcode }));
    }
    await availability.assignUnit(ctx, line, o.location_id, sti);
    assigned.push(unit.barcode);
  }
  await event(ctx, o.id, 'units_assigned', null, null, { barcodes: assigned });
  const api = await orderToApi(ctx, await orderRow(ctx, o.id));
  await emit(ctx, 'order.units_assigned', { type: 'order', id: o.id }, { ...api, barcodes: assigned });
  return api;
}

export async function unassignUnits(ctx: Ctx, ref: string, body: { stock_item_ids?: string[]; barcodes?: string[] }) {
  const o = await orderRow(ctx, ref, true);
  const ids = await resolveUnits(ctx, body);
  for (const sti of ids) {
    const u = await one<{ order_line_id: string }>(ctx, `SELECT u.order_line_id FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id WHERE l.order_id = $1 AND u.stock_item_id = $2`, [o.id, sti]);
    if (!u) throw new AppError('not_assigned', 404, msg('error.this_unit_is_not_assigned_to_the'));
    await availability.unassignUnit(ctx, u.order_line_id, sti);
  }
  await event(ctx, o.id, 'units_unassigned', null, null, { stock_item_ids: ids });
  return orderToApi(ctx, await orderRow(ctx, o.id));
}

const HANDLERS: Record<OrderAction, Handler> = {
  async send_quote(ctx, o, body) {
    const s = await settings(ctx);
    if (s.quote_holds_stock && body?.hold_stock !== false) await holdStock(ctx, o);
    const ttl = Number(body?.ttl_hours ?? s.quote_ttl_hours);
    const expires = addMinutes(ctx.now, ttl * 60);
    const api = await setStatus(ctx, o, 'quote', 'quote_sent', { holds_stock: s.quote_holds_stock, expires_at: expires.toISOString() }, { quote_expires_at: expires });
    if (body?.notify !== false) {
      const doc = await issueDocument(ctx, o.id, 'quote');
      await notifyCustomer(ctx, o.id, 'quote_sent', {}, undefined, { attachments: [doc.id] });
    }
    return api;
  },

  async reserve(ctx, o, body) {
    const overbook = overbookOption(ctx, body);
    if (o.status === 'draft' || !(await hasAllocations(ctx, o.id)) || overbook) await holdStock(ctx, o, { overbook });
    if (overbook) {
      const rows = await many(ctx, `SELECT * FROM overbookings WHERE order_id = $1 AND resolved_at IS NULL`, [o.id]);
      if (rows.length) {
        await audit(ctx, { entity_type: 'order', entity_id: o.id, action: 'overbooked', extra: { reason: overbook.reason, overbookings: rows.map((r) => ({ variant_id: r.variant_id, quantity: r.quantity })) } });
        await emit(ctx, 'order.overbooked', { type: 'order', id: o.id }, { id: o.id, object: 'order', reason: overbook.reason, overbookings: rows.map((r) => ({ id: r.id, variant_id: r.variant_id, location_id: r.location_id, quantity: r.quantity })) });
      }
    }
    if (o.source === 'storefront' && body?.enforce_rules !== false) {
      const errs: FieldError[] = [];
      for (const l of (await lineRows(ctx, o.id)).filter((x) => x.type === 'rental' && x.variant_id && !x.parent_line_id)) {
        errs.push(...(await availability.assertBookable(ctx, { variantId: l.variant_id, locationId: o.location_id, startsAt: new Date(o.starts_at), endsAt: new Date(o.ends_at), strict: true })));
      }
      if (errs.length) throw invalid(msg('error.these_dates_cannot_be_booked'), errs);
    }
    const api = await setStatus(ctx, o, 'reserved', 'reserved', {}, { quote_expires_at: null });
    for (const c of (o.totals?.coupons_applied ?? []) as { coupon_id: string; code: string }[]) {
      await exec(ctx, `UPDATE coupons SET uses_count = uses_count + 1 WHERE id = $1`, [c.coupon_id]);
      await emit(ctx, 'coupon.redeemed', { type: 'coupon', id: c.coupon_id }, { id: c.coupon_id, object: 'coupon', code: c.code, order_id: o.id });
    }
    await ensureDeposit(ctx, o.id);
    await recomputePaymentStatus(ctx, o.id);
    if (body?.notify !== false) {
      const doc = await issueDocument(ctx, o.id, 'confirmation');
      await notifyCustomer(ctx, o.id, 'order_confirmed', {}, undefined, { attachments: [doc.id] });
      if (o.source === 'storefront') await notifyStaff(ctx, o.id, 'staff_new_order');
    }
    return api;
  },

  async prepare(ctx, o) {
    return setStatus(ctx, o, 'prepared', 'prepared');
  },

  async check_out(ctx, o, body) {
    await recordReadings(ctx, o.id, 'check_out', body?.meter_readings);
    if ((await settings(ctx)).requires_waiver_or_insurance && !(await damageCovered(ctx, o))) {
      throw new AppError('waiver_or_insurance_required', 409, msg('error.waiver_or_insurance_required'));
    }
    const ids = await resolveUnits(ctx, body ?? {});
    if (ids.length) {
      const lines = await lineRows(ctx, o.id);
      const already = new Set(lines.flatMap((l) => (l.units ?? []).map((u: any) => u.stock_item_id)));
      const toAssign = ids.filter((id) => !already.has(id));
      if (toAssign.length) await assignUnits(ctx, o.id, { stock_item_ids: toAssign });
    }
    const lines = await lineRows(ctx, o.id);
    const missing: string[] = [];
    for (const l of lines.filter((x) => x.type === 'rental' && x.tracking === 'serialized')) {
      const n = l.quantity - activeUnits(l).length;
      if (n > 0) missing.push(`${n} × ${l.description}`);
    }
    if (missing.length && !body?.allow_partial) {
      throw new AppError('units_unassigned', 409, msg('error.assign_units_before_pickup', { join: missing.join(', ') }), { extra: { missing } });
    }
    // An early pickup occupies the stock from now on: the bookings start now, checked like any other growth (FR-AV-2).
    const early = await many<{ id: string }>(ctx, `SELECT id FROM allocations WHERE order_id = $1 AND kind = 'reservation' AND lower(period) > $2`, [o.id, ctx.now]);
    await availability.resizeAllocations(
      ctx,
      early.map((a) => ({ allocationId: a.id, from: ctx.now })),
      { unitConflict: msg('error.a_unit_is_still_booked_by_an') },
    );
    await exec(
      ctx,
      `UPDATE order_line_units SET checked_out_at = $2 WHERE checked_out_at IS NULL AND order_line_id IN (SELECT id FROM order_lines WHERE order_id = $1)`,
      [o.id, ctx.now],
    );
    await exec(
      ctx,
      `UPDATE stock_items SET status = 'out' WHERE id IN (SELECT u.stock_item_id FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id WHERE l.order_id = $1 AND u.checked_in_at IS NULL)`,
      [o.id],
    );
    const bulkQty = new Map<string, number>((body?.lines ?? []).map((x: any) => [x.line_id, x.quantity]));
    for (const l of lines.filter((x) => x.type === 'rental' && x.tracking === 'bulk')) {
      const q = Math.min(l.quantity, bulkQty.get(l.id) ?? bulkQty.get(l.parent_line_id) ?? l.quantity);
      await exec(ctx, `UPDATE order_lines SET picked_up_qty = $2 WHERE id = $1`, [l.id, q]);
      if (q < l.quantity) missing.push(`${l.quantity - q} × ${l.description}`);
    }
    if (body?.signature) {
      const sig = { name: body.signature.name, method: body.signature.method ?? 'click', file_id: body.signature.file_id ?? null, signed_at: ctx.now.toISOString(), ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null };
      if (sig.file_id) await setOwner(ctx, sig.file_id, 'order', o.id);
      await exec(ctx, `UPDATE orders SET terms_acceptance = coalesce(terms_acceptance, '{}'::jsonb) || $2 WHERE id = $1`, [o.id, json({ pickup_signature: sig })]);
    }
    const api = await setStatus(ctx, o, 'out', 'checked_out', { partial: missing.length > 0, missing });
    await issueDocument(ctx, o.id, 'contract');
    return api;
  },

  async check_in(ctx, o, body) {
    await recordReadings(ctx, o.id, 'check_in', body?.meter_readings);
    const s = await settings(ctx);
    const lines = await lineRows(ctx, o.id);
    const units: { stock_item_id: string; outcome: 'ok' | 'needs_inspection' | 'damaged' | 'lost' }[] = [];
    if (body?.all) {
      for (const l of lines) for (const u of l.units ?? []) if (u.checked_out_at && !u.checked_in_at) units.push({ stock_item_id: u.stock_item_id, outcome: 'ok' });
    }
    for (const u of body?.units ?? []) {
      let sti = u.stock_item_id;
      if (!sti && u.barcode) {
        sti = (await one(ctx, `SELECT id FROM stock_items WHERE barcode = $1`, [String(u.barcode).trim()]))?.id;
        if (!sti) throw new AppError('unknown_barcode', 404, msg('error.no_unit_with_barcode_2', { barcode: u.barcode }));
      }
      const idx = units.findIndex((x) => x.stock_item_id === sti);
      if (idx >= 0) units.splice(idx, 1);
      units.push({ stock_item_id: sti, outcome: u.outcome ?? 'ok' });
    }
    const returned: string[] = [];
    for (const u of units) {
      const row = await one<any>(
        ctx,
        `SELECT u.id, u.allocation_id, u.checked_out_at, u.checked_in_at, l.buffer_after_min, s.barcode FROM order_line_units u
           JOIN order_lines l ON l.id = u.order_line_id JOIN stock_items s ON s.id = u.stock_item_id
          WHERE l.order_id = $1 AND u.stock_item_id = $2`,
        [o.id, u.stock_item_id],
      );
      if (!row) throw new AppError('wrong_item', 422, msg('error.this_unit_is_not_on_this_order'));
      if (!row.checked_out_at) throw new AppError('not_checked_out', 409, msg('error.was_never_picked_up', { barcode: row.barcode }));
      if (row.checked_in_at) throw new AppError('already_returned', 409, msg('error.is_already_checked_in', { barcode: row.barcode }));
      await exec(ctx, `UPDATE order_line_units SET checked_in_at = $2, check_in_outcome = $3 WHERE id = $1`, [row.id, ctx.now, u.outcome]);
      const until = u.outcome === 'ok' ? addMinutes(ctx.now, row.buffer_after_min) : ctx.now;
      if (row.allocation_id) await availability.endAllocationsAt(ctx, { ids: [row.allocation_id] }, until);
      // A unit with a checklist waits for inspection when the shop asks for one on every return (FR-MNT-3).
      const inspect = u.outcome === 'ok' && (await needsInspectionOnReturn(ctx, u.stock_item_id, s.require_inspection_on_return));
      const status = inspect ? 'needs_inspection' : ({ ok: 'available', needs_inspection: 'needs_inspection', damaged: 'hard_down', lost: 'lost' }[u.outcome] as any);
      await setStockItemStatus(ctx, u.stock_item_id, status, `returned ${u.outcome} on order #${o.number}`, { system: true });
      returned.push(row.barcode);
    }
    // Bulk lines: returned / damaged / lost quantities.
    const bulkInput: any[] = body?.all
      ? lines.filter((l) => l.tracking === 'bulk' && l.type === 'rental').map((l) => ({ line_id: l.id, returned: l.picked_up_qty - l.returned_qty - l.lost_qty }))
      : body?.lines ?? [];
    for (const b of bulkInput) {
      const l = lines.find((x) => x.id === b.line_id);
      if (!l || l.tracking !== 'bulk') throw new AppError('wrong_line', 422, msg('error.line_is_not_a_bulk_rental_line', { line_id: b.line_id }));
      const ret = Math.max(0, Number(b.returned ?? 0));
      const damaged = Math.max(0, Number(b.damaged ?? 0));
      const lost = Math.max(0, Number(b.lost ?? 0));
      const open = l.picked_up_qty - l.returned_qty - l.lost_qty;
      if (ret + lost > open) throw invalid(msg('error.only_of_are_out', { open, description: l.description }));
      if (damaged > ret) throw invalid(msg('error.damaged_units_must_be_counted_in_returned'));
      await exec(ctx, `UPDATE order_lines SET returned_qty = returned_qty + $2, lost_qty = lost_qty + $3 WHERE id = $1`, [l.id, ret, lost]);
      if (damaged > 0) await createDowntime(ctx, { variant_id: l.variant_id, location_id: o.location_id, quantity: damaged, starts_at: ctx.now.toISOString(), reason: `damaged on return of order #${o.number}` });
      if (lost > 0) await adjustStockLevel(ctx, l.variant_id, o.location_id, -lost, `lost on order #${o.number}`, o.id);
      if (l.returned_qty + l.lost_qty + ret + lost >= l.picked_up_qty) {
        await availability.endAllocationsAt(ctx, { orderLineId: l.id }, addMinutes(ctx.now, l.buffer_after_min));
      }
    }
    // Late fee (FR-OR-6): price of the actual period minus the booked one.
    const graceEnd = addMinutes(new Date(o.ends_at), s.late_grace_minutes);
    const hasLateFee = !!(await one(ctx, `SELECT 1 FROM order_lines WHERE order_id = $1 AND type = 'fee' AND price_snapshot->>'kind' = 'late_fee'`, [o.id]));
    let lateFee = 0;
    if (s.late_fees_enabled && ctx.now > graceEnd && !hasLateFee) {
      const rentalLines = lines.filter((l) => !l.parent_line_id && l.type === 'rental' && l.variant_id).map((l) => ({ type: 'rental' as const, variant_id: l.variant_id, quantity: l.quantity }));
      if (rentalLines.length) {
        const booked = await priceQuote(ctx, { location_id: o.location_id, starts_at: o.starts_at, ends_at: o.ends_at, lines: rentalLines, deposit: { mode: 'none' } });
        // A late fee rule (FR-PR-8) prices the extra time itself; without one the rental is repriced for the actual period.
        const lateRule = (await activeFeeRules(ctx, null, ['late'], o.location_id))[0];
        let rate = booked.breakdown.lines[0]?.tax_rate_bp ?? 0;
        if (lateRule) {
          const lateMin = (ctx.now.getTime() - new Date(o.ends_at).getTime()) / 60_000;
          const priced = lines.filter((l) => !l.parent_line_id && l.type === 'rental').map((l) => ({ type: 'rental', productId: l.product_id, categoryIds: [], quantity: l.quantity, subtotal: Number(l.subtotal) }));
          const r = feeAmount(lateRule, priced, { durationMin: lateMin });
          lateFee = r && 'amount' in r ? r.amount : 0;
          rate = lateRule.tax_rate_bp;
        } else {
          const actual = await priceQuote(ctx, { location_id: o.location_id, starts_at: o.starts_at, ends_at: ctx.now, lines: rentalLines, deposit: { mode: 'none' } });
          lateFee = actual.breakdown.subtotal - booked.breakdown.subtotal;
        }
        if (lateFee > 0) {
          const tax = Math.round((lateFee * rate) / 10000);
          const pos = (await one<{ n: number }>(ctx, `SELECT coalesce(max(position), 0) + 1 AS n FROM order_lines WHERE order_id = $1`, [o.id]))!.n;
          await exec(
            ctx,
            `INSERT INTO order_lines (id, tenant_id, order_id, type, quantity, description, price_snapshot, unit_price, subtotal, tax, total, position)
             VALUES ($1,$2,$3,'fee',1,$4,$5,$6,$6,$7,$8,$9)`,
            [newId('oln'), ctx.tenantId, o.id, msg('order.line.late_return', {}, await orderLocale(ctx, o.id)), json({ kind: 'late_fee', tax_rate_bp: rate, returned_at: ctx.now.toISOString(), booked_until: o.ends_at }), lateFee, tax, lateFee + tax, pos],
          );
          await recalcTotalsFromLines(ctx, o.id);
        }
      }
    }
    const facts = await loadFacts(ctx, o);
    const unpicked = (await lineRows(ctx, o.id)).filter((l) => l.type === 'rental' && l.tracking === 'serialized' && activeUnits(l).length < l.quantity).length;
    const done = facts.outstandingUnits === 0;
    if (done && unpicked) await availability.releaseUnassignedHolds(ctx, o.id);
    const to: OrderStatus = done ? 'returned' : 'returned_partial';
    return setStatus(ctx, o, to, 'checked_in', { partial: !done, barcodes: returned, late_fee: lateFee });
  },

  async inspect(ctx, o, body) {
    for (const u of body?.units ?? []) {
      const ok = await one(ctx, `SELECT 1 FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id WHERE l.order_id = $1 AND u.stock_item_id = $2`, [o.id, u.stock_item_id]);
      if (!ok) throw new AppError('wrong_item', 422, msg('error.this_unit_is_not_on_this_order'));
      if (u.status) await setStockItemStatus(ctx, u.stock_item_id, u.status, u.notes ?? msg('order.note.inspected', { number: o.number }, await tenantLocale(ctx)), { system: true });
      if (u.condition || u.notes) await exec(ctx, `UPDATE stock_items SET condition = coalesce($2, condition), notes = CASE WHEN $3::text IS NULL THEN notes ELSE trim(notes || E'\n' || $3) END WHERE id = $1`, [u.stock_item_id, u.condition ?? null, u.notes ?? null]);
    }
    const charges = [];
    for (const d of body?.damage_charges ?? []) charges.push(await createDamageCharge(ctx, o.id, d));
    const api = await setStatus(ctx, o, 'inspected', 'inspected', { units: (body?.units ?? []).length, damage_charges: charges.map((c) => c.id) });
    // One message per inspection with every charge; photos added later show on the order page it links to.
    // The customer is told what they owe; a damage waiver covers the rest (FR-PAY-8).
    const billed = charges.filter((c) => c.customer_amount.amount > 0);
    if (billed.length && body?.notify !== false)
      await notifyCustomer(ctx, o.id, 'damage_charge_created', {
        damage: { charges: billed.map((c) => ({ description: c.description, amount: c.customer_amount.amount })), total: billed.reduce((a, c) => a + c.customer_amount.amount, 0) },
      });
    return api;
  },

  async close(ctx, o) {
    await exec(ctx, `UPDATE deposits SET status = 'released', released_at = now() WHERE order_id = $1 AND status = 'pending'`, [o.id]);
    return setStatus(ctx, o, 'closed', 'closed', {}, { closed_at: ctx.now });
  },

  async cancel(ctx, o, body) {
    const s = await settings(ctx);
    await availability.releaseOrder(ctx, o.id);
    const hoursBefore = (new Date(o.starts_at).getTime() - ctx.now.getTime()) / 3_600_000;
    const tier = [...s.cancellation_policy].sort((a, b) => b.hours_before - a.hours_before).find((t) => hoursBefore >= t.hours_before);
    const pct = body?.refund_pct ?? tier?.refund_pct ?? 0;
    let refunded = 0;
    if (body?.refund !== false && pct > 0) {
      const pays = await many(ctx, `SELECT * FROM payments WHERE order_id = $1 AND kind IN ('charge','manual') AND status = 'succeeded' AND purpose IN ('rental','late_fee') ORDER BY created_at`, [o.id]);
      for (const p of pays) {
        const already = Number((await one(ctx, `SELECT coalesce(sum(amount),0)::bigint AS n FROM payments WHERE parent_payment_id = $1 AND kind = 'refund'`, [p.id]))?.n ?? 0);
        const amount = Math.round(((Number(p.amount) - already) * pct) / 100);
        if (amount > 0) {
          await refundPayment(ctx, p.id, { amount, reason: msg('order.note.cancellation_refund', { percent: pct }, await tenantLocale(ctx)) });
          refunded += amount;
        }
      }
    }
    for (const d of await many(ctx, `SELECT id FROM deposits WHERE order_id = $1 AND status IN ('held','pending')`, [o.id])) await releaseDeposit(ctx, d.id);
    for (const inv of await many(ctx, `SELECT id FROM documents WHERE order_id = $1 AND type = 'invoice' AND status <> 'voided'`, [o.id])) await voidDocument(ctx, inv.id, msg('order.note.cancelled', {}, await orderLocale(ctx, o.id)));
    const api = await setStatus(ctx, o, 'cancelled', 'cancelled', { reason: body?.reason ?? null, refund_pct: pct, refunded }, { cancelled_at: ctx.now, cancel_reason: body?.reason ? String(body.reason).slice(0, 500) : null });
    if (o.status !== 'draft' && body?.notify !== false) await notifyCustomer(ctx, o.id, 'order_cancelled', { refund_amount: refunded });
    return api;
  },

  async expire(ctx, o) {
    await availability.releaseOrder(ctx, o.id);
    return setStatus(ctx, o, 'expired', 'expired');
  },

  async reopen(ctx, o) {
    const api = await setStatus(ctx, o, 'draft', 'reopened', {}, { cancelled_at: null, cancel_reason: null, quote_expires_at: null });
    await reprice(ctx, o.id);
    return api;
  },
};

export async function runAction(ctx: Ctx, ref: string, action: OrderAction, body: any = {}, opts: { ifMatch?: number | null } = {}) {
  const o = await orderRow(ctx, ref, true);
  if (opts.ifMatch != null && opts.ifMatch !== o.version) {
    throw new AppError('precondition_failed', 412, msg('error.the_order_changed_since_you_loaded_it'), { extra: { current_version: o.version } });
  }
  const t = transitionFor(action);
  if (t.systemOnly && ctx.actor.type !== 'system') throw new AppError('forbidden', 403, msg('error.is_performed_by_the_system', { action }));
  if (!t.from.includes(o.status)) {
    throw new AppError('invalid_transition', 409, msg('error.cannot_while_the_order_is', { action: t.label.toLowerCase(), status: o.status.replace('_', ' ') }), {
      extra: { current_status: o.status, allowed_from: t.from },
    });
  }
  const facts = await loadFacts(ctx, o);
  const blocked = evaluate(t, facts);
  if (blocked.length) {
    throw new AppError('transition_blocked', 409, blocked.map((b) => b.message).join('; '), {
      errors: blocked.map((b) => ({ field: 'order', code: b.code, message: b.message })),
    });
  }
  if (action === 'check_out') await assertIdentityChecked(ctx, o);
  const hookCtx = hookContext(ctx);
  await ctx.plugins.runHook('before', 'orders.transition', { order_id: o.id, from: o.status, action, body }, hookCtx);
  await HANDLERS[action](ctx, o, body, facts);
  const fresh = await orderRow(ctx, o.id);
  await ctx.plugins.runHook('after', 'orders.transition', { order_id: o.id, from: o.status, to: fresh.status, action }, hookCtx);
  return orderToApi(ctx, fresh, ['customer']);
}

/**
 * Customers marked "requires ID check" pick up only after the check (FR-PLG-1): an identity plugin
 * verifies them, or staff tick "ID checked" on the customer. A pending check returns where to do it.
 */
async function assertIdentityChecked(ctx: Ctx, o: any) {
  if (!o.customer_id) return;
  const c = await one<any>(ctx, `SELECT id, name, email, flags FROM customers WHERE id = $1`, [o.customer_id]);
  if (!c?.flags?.requires_id_check || c.flags.id_verified) return;
  const idp = await enabledProvider(ctx, ctx.plugins.identityProvider());
  let url: string | null = null;
  if (idp) {
    const r = await idp.provider.check(idp.pctx, { customer: { id: c.id, name: c.name, email: c.email }, orderId: o.id }).catch((err) => {
      ctx.logger.warn({ err, plugin: idp.pluginId }, 'identity check failed');
      return { status: 'pending' as const, url: null };
    });
    if (r.status === 'verified') {
      await exec(ctx, `UPDATE customers SET flags = coalesce(flags, '{}'::jsonb) || '{"id_verified": true}'::jsonb WHERE id = $1`, [c.id]);
      await audit(ctx, { entity_type: 'customer', entity_id: c.id, action: 'id_verified', extra: { provider: idp.provider.id, ref: r.ref ?? null } });
      return;
    }
    url = r.url ?? null;
  }
  const message = msg('order.guard.id_check');
  throw new AppError('id_check_required', 409, message, { errors: [{ field: 'order', code: 'id_check_required', message }], extra: { url } });
}

// ---------------------------------------------------------------------------
// Supporting reads and jobs
// ---------------------------------------------------------------------------

export async function timeline(ctx: Ctx, ref: string) {
  const o = await orderRow(ctx, ref);
  const events = await many(ctx, `SELECT id, type, from_status, to_status, payload, actor, created_at FROM order_events WHERE order_id = $1`, [o.id]);
  const payments = await many(ctx, `SELECT id, kind, purpose, amount, method, status, created_at FROM payments WHERE order_id = $1`, [o.id]);
  const notes = await many(ctx, `SELECT id, template_key, recipient, status, created_at FROM notifications WHERE order_id = $1`, [o.id]);
  const docs = await many(ctx, `SELECT id, type, number, created_at FROM documents WHERE order_id = $1`, [o.id]);
  const items = [
    ...events.map((e) => ({ id: e.id, kind: 'event', type: e.type, from_status: e.from_status, to_status: e.to_status, payload: e.payload, actor: e.actor, at: e.created_at })),
    ...payments.map((p) => ({ id: p.id, kind: 'payment', type: `${p.kind}.${p.status}`, payload: { amount: money(p.amount, o.currency), method: p.method, purpose: p.purpose }, at: p.created_at })),
    ...notes.map((n) => ({ id: n.id, kind: 'notification', type: n.template_key, payload: { recipient: n.recipient, status: n.status }, at: n.created_at })),
    ...docs.map((d) => ({ id: d.id, kind: 'document', type: d.type, payload: { number: d.number }, at: d.created_at })),
  ];
  items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return { object: 'list', data: items };
}

export async function pickList(ctx: Ctx, ref: string) {
  const o = await orderRow(ctx, ref);
  const lines = await lineRows(ctx, o.id);
  const parentsWithChildren = new Set(lines.filter((l) => l.parent_line_id).map((l) => l.parent_line_id));
  return {
    object: 'pick_list',
    order_id: o.id,
    number: o.number,
    starts_at: o.starts_at,
    items: (
      await Promise.all(
        lines
          .filter((l) => l.type === 'rental' && !parentsWithChildren.has(l.id))
          .map(async (l) => {
            const assigned = activeUnits(l).length
              ? await many(ctx, `SELECT id AS stock_item_id, barcode, serial, bin FROM stock_items WHERE id = ANY($1) ORDER BY bin NULLS LAST, barcode`, [activeUnits(l).map((u: any) => u.stock_item_id)])
              : [];
            const missing = l.tracking === 'serialized' ? Math.max(0, l.quantity - assigned.length) : 0;
            // Where free units of this variant sit, so staff know which shelf to go to (FR-OR-4).
            const bins = missing
              ? (await many<{ bin: string }>(ctx, `SELECT DISTINCT bin FROM stock_items WHERE variant_id = $1 AND location_id = $2 AND status = 'available' AND bin IS NOT NULL ORDER BY bin`, [l.variant_id, o.location_id])).map((b) => b.bin)
              : [];
            return {
              line_id: l.id, description: l.description, variant_id: l.variant_id, tracking: l.tracking, quantity: l.quantity, assigned, missing, bins: [...new Set([...assigned.map((a: any) => a.bin).filter(Boolean), ...bins])],
              bundle_line_id: l.parent_line_id,
            };
          }),
      )
    ).sort((a, b) => (a.bins[0] ?? '\uffff').localeCompare(b.bins[0] ?? '\uffff')),
  };
}

export async function duplicateOrder(ctx: Ctx, ref: string) {
  const o = await orderRow(ctx, ref);
  const lines = (await lineRows(ctx, o.id)).filter((l) => !l.parent_line_id && l.price_snapshot?.kind !== 'late_fee');
  return createOrder(ctx, {
    customer_id: o.customer_id, location_id: o.location_id, starts_at: o.starts_at, ends_at: o.ends_at, coupon_codes: o.coupon_codes, tags: o.tags,
    notes: o.notes, custom_fields: o.custom_fields,
    lines: lines.map((l) => ({ type: l.type, variant_id: l.variant_id, quantity: l.quantity, amount: l.type === 'fee' ? Number(l.unit_price) : undefined, description: l.description })),
  });
}

export async function expireQuotes(ctx: Ctx) {
  const due = await many<{ id: string }>(ctx, `SELECT id FROM orders WHERE status = 'quote' AND quote_expires_at < now() ORDER BY quote_expires_at LIMIT 200`);
  for (const d of due) await runAction(ctx, d.id, 'expire');
  return due.length;
}

/** Hourly: pickup and return reminders 24 h ahead, overdue notices (FR-NOT-1, FR-NOT-3). Deduplicated per order. */
export async function sendReminders(ctx: Ctx) {
  const pickups = await many<{ id: string }>(ctx, `SELECT id FROM orders WHERE status IN ('reserved','prepared') AND starts_at BETWEEN now() AND now() + interval '24 hours'`);
  for (const p of pickups) await notifyCustomer(ctx, p.id, 'pickup_reminder', {}, `pickup_reminder:${p.id}`);
  const returns = await many<{ id: string }>(ctx, `SELECT id FROM orders WHERE status IN ('out','returned_partial') AND ends_at BETWEEN now() AND now() + interval '24 hours'`);
  for (const r of returns) await notifyCustomer(ctx, r.id, 'return_reminder', {}, `return_reminder:${r.id}`);
  const s = await settings(ctx);
  const overdue = await many<{ id: string }>(ctx, `SELECT id FROM orders WHERE status IN ('out','returned_partial') AND ends_at + make_interval(mins => $1) < now()`, [s.late_grace_minutes]);
  for (const o of overdue) {
    const first = await notifyCustomer(ctx, o.id, 'order_overdue', {}, `order_overdue:${o.id}`);
    if (first) {
      await notifyStaff(ctx, o.id, 'staff_overdue', {}, `staff_overdue:${o.id}`);
      await exec(ctx, `UPDATE orders SET payment_status = payment_status WHERE id = $1`, [o.id]);
      await emit(ctx, 'order.overdue', { type: 'order', id: o.id }, await getOrder(ctx, o.id));
    }
  }
  return { pickups: pickups.length, returns: returns.length, overdue: overdue.length };
}

export { HOLDING };

// ---------------------------------------------------------------------------
// Extensions and early returns (FR-OR-9)
// ---------------------------------------------------------------------------

export interface EndChangeInput {
  ends_at: string;
  /** Only work out availability and the price difference; nothing changes. */
  dry_run?: boolean;
  /** Early returns: credit the unused time (default true). */
  credit?: boolean;
  /** Email the customer about an extension (default true). */
  notify?: boolean;
}

const END_CHANGEABLE: OrderStatus[] = ['reserved', 'prepared', 'out'];

/**
 * Moves the return of a confirmed rental later (extend) or earlier (return_early); the status stays.
 * Availability is checked by really resizing the bookings inside a savepoint, so a dry run gives the
 * exact answer. Prices already charged never change: the difference becomes a new fee line (extension,
 * from an extension fee rule if the shop has one, else the price of the longer rental minus the booked
 * one) or a credit line (early return). If the order was already invoiced, the difference gets its own
 * invoice or credit note.
 */
async function changeEnd(ctx: Ctx, ref: string, kind: 'extend' | 'return_early', input: EndChangeInput) {
  const o = await orderRow(ctx, ref, true);
  if (!END_CHANGEABLE.includes(o.status)) throw new AppError('order_locked', 409, msg('error.end_change_not_allowed', { status: o.status }));
  const start = new Date(o.starts_at);
  const oldEnd = new Date(o.ends_at);
  const newEnd = new Date(input.ends_at);
  const field = (message: string) => invalid(message, [{ field: 'ends_at', code: 'invalid', message }]);
  if (Number.isNaN(newEnd.getTime())) throw field(msg('error.field.invalid_date_time'));
  if (kind === 'extend' && !(newEnd > oldEnd)) throw field(msg('error.extend_after_current_end'));
  if (kind === 'return_early' && !(newEnd < oldEnd && newEnd > start)) throw field(msg('error.return_between_pickup_and_end'));

  // What the change costs: rental lines priced for both periods, before coupons; an extension fee rule replaces that.
  const lines = await lineRows(ctx, o.id);
  const rental = lines.filter((l) => !l.parent_line_id && l.type === 'rental' && l.variant_id);
  const req = { location_id: o.location_id, customer_id: o.customer_id, deposit: { mode: 'none' as const }, lines: rental.map((l) => ({ type: 'rental' as const, variant_id: l.variant_id, quantity: l.quantity })) };
  let net = 0;
  let tax = 0;
  let rate = 0;
  let feeRuleId: string | null = null;
  if (rental.length) {
    const before = (await priceQuote(ctx, { ...req, starts_at: o.starts_at, ends_at: o.ends_at })).breakdown;
    const after = (await priceQuote(ctx, { ...req, starts_at: o.starts_at, ends_at: newEnd })).breakdown;
    net = after.subtotal - before.subtotal;
    tax = after.tax - before.tax;
    rate = before.lines[0]?.tax_rate_bp ?? 0;
  }
  const rule = kind === 'extend' ? (await activeFeeRules(ctx, null, ['extension'], o.location_id))[0] : undefined;
  if (rule) {
    const priced = rental.map((l) => ({ type: 'rental', productId: l.product_id, categoryIds: [], quantity: l.quantity, subtotal: Number(l.subtotal) }));
    const r = feeAmount(rule, priced, { durationMin: (newEnd.getTime() - oldEnd.getTime()) / 60_000 });
    if (r && 'amount' in r) {
      net = r.amount;
      rate = rule.tax_rate_bp;
      tax = Math.round((net * rate) / 10000);
      feeRuleId = rule.id;
    }
  }
  if (kind === 'return_early' && input.credit === false) net = tax = 0;

  // Availability: resize the bookings still running to the booked end (units already returned keep theirs).
  await ctx.db.query('SAVEPOINT change_end');
  let problem: { code: string; message: string; shortages?: unknown } | null = null;
  try {
    const running = (
      await many<{ id: string; e: Date | null; buffer_after_min: number }>(
        ctx,
        `SELECT a.id, upper(a.period) AS e, l.buffer_after_min FROM allocations a JOIN order_lines l ON l.id = a.order_line_id WHERE a.order_id = $1 AND a.kind = 'reservation'`,
        [o.id],
      )
    ).filter((a) => a.e && a.e.getTime() === addMinutes(oldEnd, a.buffer_after_min).getTime());
    if (kind === 'extend') await availability.resizeAllocations(ctx, running.map((a) => ({ allocationId: a.id, to: addMinutes(newEnd, a.buffer_after_min) })));
    else for (const a of running) await availability.endAllocationsAt(ctx, { ids: [a.id] }, addMinutes(newEnd, a.buffer_after_min));
  } catch (err) {
    if (!(err instanceof AppError) || !['exceeds_availability', 'unit_unavailable'].includes(err.code)) {
      await ctx.db.query('ROLLBACK TO SAVEPOINT change_end');
      throw err;
    }
    problem = { code: err.code, message: err.message, shortages: (err.extra as any)?.shortages };
  }
  const currency = String(o.currency).trim();
  const proposal = {
    object: 'end_change', kind, from: oldEnd.toISOString(), to: newEnd.toISOString(), available: !problem, problem,
    net: money(net, currency), tax: money(tax, currency), amount: money(net + tax, currency), fee_rule_id: feeRuleId,
  };
  // A dry run answers with what would happen (including "not available"); a real change refuses with a 409.
  if (input.dry_run || problem) {
    await ctx.db.query('ROLLBACK TO SAVEPOINT change_end');
    if (problem && !input.dry_run) throw new AppError(problem.code, 409, problem.message, { extra: { shortages: problem.shortages } });
    return proposal;
  }
  await ctx.db.query('RELEASE SAVEPOINT change_end');

  await exec(ctx, `UPDATE orders SET ends_at = $2 WHERE id = $1`, [o.id, newEnd]);
  const locale = await orderLocale(ctx, o.id);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: o.timezone }).format(newEnd);
  let line: any;
  if (net !== 0) {
    const pos = (await one<{ n: number }>(ctx, `SELECT coalesce(max(position), 0) + 1 AS n FROM order_lines WHERE order_id = $1`, [o.id]))!.n;
    const snapshot = { kind: kind === 'extend' ? 'extension' : 'early_return', tax_rate_bp: rate, from: oldEnd.toISOString(), to: newEnd.toISOString(), extension_fee_rule_id: feeRuleId };
    const id = newId('oln');
    if (kind === 'extend') {
      const description = msg('order.line.extension', { date: when }, locale);
      await exec(
        ctx,
        `INSERT INTO order_lines (id, tenant_id, order_id, type, quantity, description, price_snapshot, unit_price, subtotal, tax, total, position) VALUES ($1,$2,$3,'fee',1,$4,$5,$6,$6,$7,$8,$9)`,
        [id, ctx.tenantId, o.id, description, json(snapshot), net, tax, net + tax, pos],
      );
      line = { name: description, type: 'fee', quantity: 1, unit_price: net, discount: 0, tax_rate_bp: rate, tax, total: net + tax, units: [] };
    } else {
      const credit = Math.abs(net);
      const creditTax = Math.abs(tax);
      const description = msg('order.line.early_return', { date: when }, locale);
      await exec(
        ctx,
        `INSERT INTO order_lines (id, tenant_id, order_id, type, quantity, description, price_snapshot, unit_price, subtotal, discount, tax, total, position) VALUES ($1,$2,$3,'discount',1,$4,$5,$6,0,$6,$7,$8,$9)`,
        [id, ctx.tenantId, o.id, description, json(snapshot), credit, -creditTax, -(credit + creditTax), pos],
      );
      line = { name: description, type: 'fee', quantity: 1, unit_price: credit, discount: 0, tax_rate_bp: rate, tax: creditTax, total: credit + creditTax, units: [] };
    }
    await recalcTotalsFromLines(ctx, o.id);
    // An invoiced order gets the difference on its own document; issued documents never change.
    const invoiced = await one(ctx, `SELECT 1 FROM documents WHERE order_id = $1 AND type = 'invoice' AND status = 'issued' LIMIT 1`, [o.id]);
    if (invoiced) {
      const amount = Math.abs(net);
      await issueDocument(ctx, o.id, kind === 'extend' ? 'invoice' : 'credit_note', {
        overrides: {
          lines: [line],
          totals: { subtotal: amount, discount: 0, fees: 0, tax: Math.abs(tax), total: amount + Math.abs(tax), deposit: 0 },
          tax_breakdown: [{ rate_bp: rate, net: amount, tax: Math.abs(tax) }],
        },
      });
    }
  }
  const name = kind === 'extend' ? 'extended' : 'returned_early';
  await event(ctx, o.id, name, o.status, o.status, { from: proposal.from, to: proposal.to, amount: proposal.amount });
  const fresh = await orderRow(ctx, o.id);
  await audit(ctx, { entity_type: 'order', entity_id: o.id, action: name, before: o, after: fresh });
  const api = await orderToApi(ctx, fresh);
  await emit(ctx, `order.${name}`, { type: 'order', id: o.id }, api);
  if (kind === 'extend' && input.notify !== false && o.customer_id) await notifyCustomer(ctx, o.id, 'order_extended', { previous_end: proposal.from });
  return { ...proposal, order: api };
}

export const extendOrder = (ctx: Ctx, ref: string, input: EndChangeInput) => changeEnd(ctx, ref, 'extend', input);
export const returnEarly = (ctx: Ctx, ref: string, input: EndChangeInput) => changeEnd(ctx, ref, 'return_early', input);

// ---------------------------------------------------------------------------
// Unit swap mid-rental (FR-OR-10)
// ---------------------------------------------------------------------------

export interface SwapInput {
  from_stock_item_id?: string;
  from_barcode?: string;
  to_stock_item_id?: string;
  to_barcode?: string;
  /** What happens to the unit taken back: inspected, or out of service with a ticket (default needs_inspection). */
  old_status?: 'needs_inspection' | 'soft_down' | 'hard_down';
  reason?: string;
}

/**
 * Replaces a unit that is out on a rental with another unit of the same item, from now on: the old
 * unit's booking ends now, the new unit's starts now (one allocation split, so the exclusion constraint
 * checks the new unit), the old unit gets a status and a maintenance ticket, and the new one goes out.
 */
export async function swapUnit(ctx: Ctx, ref: string, input: SwapInput) {
  const o = await orderRow(ctx, ref, true);
  if (!['out', 'returned_partial'].includes(o.status)) throw new AppError('order_not_out', 409, msg('error.swap_needs_out_order', { status: o.status }));
  const pick = async (id?: string, barcode?: string) => {
    if (id) return id;
    if (!barcode) return null;
    const s = await one<{ id: string }>(ctx, `SELECT id FROM stock_items WHERE barcode = $1`, [barcode.trim()]);
    if (!s) throw new AppError('unknown_barcode', 404, msg('error.no_unit_with_barcode', { code: barcode }));
    return s.id;
  };
  const fromId = await pick(input.from_stock_item_id, input.from_barcode);
  const toId = await pick(input.to_stock_item_id, input.to_barcode);
  if (!fromId) throw invalid(msg('error.swap_choose_units'), [{ field: 'from_stock_item_id', code: 'required', message: msg('error.swap_choose_units') }]);
  if (!toId) throw invalid(msg('error.swap_choose_units'), [{ field: 'to_stock_item_id', code: 'required', message: msg('error.swap_choose_units') }]);
  const old = await one<any>(
    ctx,
    `SELECT u.*, s.barcode FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id JOIN stock_items s ON s.id = u.stock_item_id
      WHERE l.order_id = $1 AND u.stock_item_id = $2 AND u.checked_out_at IS NOT NULL AND u.checked_in_at IS NULL AND u.replaced_by_id IS NULL FOR UPDATE OF u`,
    [o.id, fromId],
  );
  if (!old) throw new AppError('unit_not_out', 409, msg('error.swap_unit_not_out'));
  if (!old.allocation_id) throw new AppError('unit_not_booked', 409, msg('error.swap_unit_not_out'));
  const onLine = await one(ctx, `SELECT 1 FROM order_line_units WHERE order_line_id = $1 AND stock_item_id = $2`, [old.order_line_id, toId]);
  if (onLine) throw new AppError('already_assigned', 409, msg('error.swap_same_line'));

  const allocation = await availability.moveUnitAllocation(ctx, old.allocation_id, toId, ctx.now);
  const newRow = newId('olu');
  await exec(ctx, `INSERT INTO order_line_units (id, tenant_id, order_line_id, stock_item_id, allocation_id, checked_out_at) VALUES ($1,$2,$3,$4,$5,$6)`, [
    newRow, ctx.tenantId, old.order_line_id, toId, allocation, ctx.now,
  ]);
  await exec(ctx, `UPDATE order_line_units SET checked_in_at = $2, check_in_outcome = 'swapped', swapped_at = $2, replaced_by_id = $3, allocation_id = NULL WHERE id = $1`, [old.id, ctx.now, newRow]);
  await exec(ctx, `UPDATE stock_items SET status = 'out' WHERE id = $1`, [toId]);
  const reason = input.reason?.trim() || msg('order.swap_reason', { number: o.number }, await orderLocale(ctx, o.id));
  const status = input.old_status ?? 'needs_inspection';
  await setStockItemStatus(ctx, fromId, status, reason, { system: true });
  if (status === 'needs_inspection') await ensureTicket(ctx, fromId, 'soft_down', reason, o.id);
  // The ticket points to the order the unit came back from.
  else {
    const open = await openTicketOf(ctx, fromId);
    if (open) await exec(ctx, `UPDATE maintenance_tickets SET created_from_order_id = coalesce(created_from_order_id, $2) WHERE id = $1`, [open.id, o.id]);
  }
  const to = await one<{ barcode: string }>(ctx, `SELECT barcode FROM stock_items WHERE id = $1`, [toId]);
  await event(ctx, o.id, 'unit_swapped', o.status, o.status, { barcodes: [old.barcode, to?.barcode] });
  const fresh = await orderRow(ctx, o.id);
  await audit(ctx, { entity_type: 'order', entity_id: o.id, action: 'unit_swapped', extra: { from: fromId, to: toId, reason, old_status: status } });
  const api = await orderToApi(ctx, fresh);
  await emit(ctx, 'order.unit_swapped', { type: 'order', id: o.id }, { ...api, swap: { from_stock_item_id: fromId, to_stock_item_id: toId, old_status: status } });
  return api;
}
