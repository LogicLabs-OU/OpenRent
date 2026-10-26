import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { exec, json, many, one } from '../sql.ts';
import { newId } from '../ids.ts';
import { can } from '../permissions.ts';
import { zonedTimeToUtc } from '../time.ts';
import { createCustomer, normalizeEmail, updateCustomer } from '../customers/index.ts';
import { createOrder, runAction } from '../orders/index.ts';
import type { CellError, RowResult } from './index.ts';

/**
 * Customers and bookings from another system (FR-MIG-2). Customers are found again by their id in
 * that system (kept in `provider_refs`) or their email; bookings by their id there (`external_ref`),
 * so running the same import twice changes nothing. Future bookings hold their stock; past ones are
 * kept as closed history for the reports.
 */

/** What earlier imports of the same batch will create, so later ones can refer to it before it exists. */
export interface Pending {
  skus: Map<string, string>;
  customerRefs: Set<string>;
  emails: Set<string>;
}
export const noPending = (): Pending => ({ skus: new Map(), customerRefs: new Set(), emails: new Set() });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const err = (field: string, key: MessageKey, params?: Record<string, string | number>): CellError => ({ field, message: t(key, params ?? {}) });
/** The key a source's ids are kept under: `provider_refs.booqable`, or `import` for files. */
export const refKey = (source: string) => (source === 'file' ? 'import' : source);

async function customerByRef(ctx: Ctx, source: string, ref: string) {
  return one<any>(ctx, `SELECT * FROM customers WHERE provider_refs->>$1 = $2 AND deleted_at IS NULL AND merged_into_id IS NULL LIMIT 1`, [refKey(source), ref]);
}
async function customerByEmail(ctx: Ctx, email: string) {
  return one<any>(ctx, `SELECT * FROM customers WHERE lower(email) = $1 AND deleted_at IS NULL AND merged_into_id IS NULL ORDER BY created_at LIMIT 1`, [normalizeEmail(email)]);
}

// --- Customers ------------------------------------------------------------------------

const CUSTOMER_FIELDS = ['name', 'phone', 'type', 'company_name', 'tax_id', 'locale', 'notes'] as const;

export async function analyseCustomers(ctx: Ctx, rows: RowResult[], source: string) {
  const seenEmail = new Set<string>();
  const seenRef = new Set<string>();
  for (const r of rows) {
    r.key = String(r.data.reference ?? r.data.email ?? r.data.name ?? '');
    if (r.errors.length) continue;
    if (r.data.email) {
      r.data.email = normalizeEmail(r.data.email);
      if (!EMAIL.test(r.data.email)) {
        r.errors.push(err('email', 'imports.invalid_email'));
        continue;
      }
      if (seenEmail.has(r.data.email)) r.errors.push(err('email', 'imports.duplicate_in_file'));
      seenEmail.add(r.data.email);
    }
    if (r.data.reference) {
      if (seenRef.has(r.data.reference)) r.errors.push(err('reference', 'imports.duplicate_in_file'));
      seenRef.add(r.data.reference);
    }
    if (r.errors.length) continue;
    const c = (r.data.reference ? await customerByRef(ctx, source, r.data.reference) : null) ?? (r.data.email ? await customerByEmail(ctx, r.data.email) : null);
    if (!c) {
      r.action = 'create';
      continue;
    }
    r.data._customer_id = c.id;
    const billing = c.addresses?.billing ?? {};
    const changed =
      CUSTOMER_FIELDS.some((k) => r.data[k] !== undefined && r.data[k] !== (c[k] ?? null)) ||
      (r.data.address !== undefined && r.data.address !== billing.line1) ||
      (r.data.city !== undefined && r.data.city !== billing.city) ||
      (r.data.postal_code !== undefined && r.data.postal_code !== billing.postal_code) ||
      (r.data.reference !== undefined && c.provider_refs?.[refKey(source)] !== r.data.reference) ||
      (r.data.email !== undefined && normalizeEmail(c.email) !== r.data.email);
    r.action = changed ? 'update' : 'unchanged';
  }
}

function customerInput(d: Record<string, any>, existing: any = null) {
  const billing = d.address || d.city || d.postal_code || d.country
    ? { ...(existing?.addresses?.billing ?? {}), ...(d.address ? { line1: d.address } : {}), ...(d.postal_code ? { postal_code: d.postal_code } : {}), ...(d.city ? { city: d.city } : {}), ...(d.country ? { country: String(d.country).toUpperCase().slice(0, 2) } : {}) }
    : null;
  return {
    ...Object.fromEntries(CUSTOMER_FIELDS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])),
    ...(d.email !== undefined ? { email: d.email } : {}),
    ...(d.company_name && !d.type ? { type: 'company' } : {}),
    ...(d.tags ? { tags: d.tags } : {}),
    ...(d.marketing_consent !== undefined ? { marketing_consent: d.marketing_consent } : {}),
    ...(billing ? { addresses: { ...(existing?.addresses ?? {}), billing } } : {}),
  };
}

async function keepRef(ctx: Ctx, customerId: string, source: string, ref: unknown) {
  if (ref) await exec(ctx, `UPDATE customers SET provider_refs = provider_refs || jsonb_build_object($2::text, $3::text) WHERE id = $1`, [customerId, refKey(source), String(ref)]);
}

export async function applyCustomers(ctx: Ctx, rows: RowResult[], source: string) {
  for (const r of rows.filter((x) => x.action !== 'unchanged')) {
    if (r.data._customer_id) {
      const existing = await one<any>(ctx, `SELECT * FROM customers WHERE id = $1`, [r.data._customer_id]);
      await updateCustomer(ctx, r.data._customer_id, customerInput(r.data, existing));
      await keepRef(ctx, r.data._customer_id, source, r.data.reference);
      continue;
    }
    const c = await createCustomer(ctx, { type: 'person', ...customerInput(r.data) });
    await keepRef(ctx, c.id, source, r.data.reference);
  }
}

// --- Bookings ---------------------------------------------------------------------------

/** Wall-clock times from the file are the location's; instants with a zone stay as they are. */
function instant(v: string, tz: string) {
  if (/Z$/.test(v)) return new Date(v);
  const [d, hm] = v.split('T');
  const [y, mo, day] = d!.split('-').map(Number);
  const [h, mi] = (hm ?? '00:00').split(':').map(Number);
  return zonedTimeToUtc(y!, mo!, day!, h!, mi!, tz);
}

/** Rows of one booking (one line each), in file order. */
function groups(rows: RowResult[]) {
  const out = new Map<string, RowResult[]>();
  for (const r of rows) if (r.data.reference) out.set(String(r.data.reference), [...(out.get(String(r.data.reference)) ?? []), r]);
  return out;
}

export async function analyseOrders(ctx: Ctx, rows: RowResult[], source: string, pending: Pending) {
  const locs = await many<{ id: string; name: string; timezone: string }>(ctx, `SELECT id, name, timezone FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at`);
  const skus = [...new Set(rows.map((r) => r.data.sku).filter(Boolean))];
  const variants = new Map((skus.length ? await many<any>(ctx, `SELECT id, sku, tracking FROM variants WHERE sku = ANY($1) AND deleted_at IS NULL`, [skus]) : []).map((v) => [v.sku as string, v]));
  for (const [ref, group] of groups(rows)) {
    const first = group[0]!.data;
    for (const r of group) r.key = ref;
    const fail = (field: string, key: MessageKey) => group[0]!.errors.push(err(field, key));
    if (group.some((r) => r.errors.length)) continue;
    const existing = await one(ctx, `SELECT id FROM orders WHERE external_ref = $1`, [`${refKey(source)}:${ref}`]);
    if (existing) {
      for (const r of group) r.action = 'unchanged';
      continue;
    }
    const loc = first.location ? locs.find((l) => l.name.trim().toLowerCase() === String(first.location).trim().toLowerCase()) : locs[0];
    if (!loc) {
      fail('location', 'imports.unknown_location');
      continue;
    }
    const starts = instant(first.starts_at, loc.timezone);
    const ends = instant(first.ends_at, loc.timezone);
    if (!(ends > starts)) {
      fail('ends_at', 'imports.ends_before_start');
      continue;
    }
    for (const r of group) {
      if (!variants.has(r.data.sku) && !pending.skus.has(r.data.sku)) r.errors.push(err('sku', 'imports.unknown_sku'));
      if (r.data.quantity === 0) r.errors.push(err('quantity', 'imports.invalid_integer'));
    }
    if (first.customer_email && !EMAIL.test(String(first.customer_email).trim())) fail('customer_email', 'imports.invalid_email');
    if (first.customer_reference && !first.customer_email && !first.customer_name && !pending.customerRefs.has(first.customer_reference) && !(await customerByRef(ctx, source, first.customer_reference))) {
      fail('customer_reference', 'imports.unknown_customer');
    }
    if (group.some((r) => r.errors.length)) continue;
    // A booking that is over is history; one still to come holds its stock.
    const status = first.status ?? (ends < ctx.now ? 'closed' : 'reserved');
    const data = { _location_id: loc.id, _starts_at: starts.toISOString(), _ends_at: ends.toISOString(), _status: status === 'reserved' && ends < ctx.now ? 'closed' : status };
    for (const r of group) {
      Object.assign(r.data, data);
      r.action = 'create';
    }
  }
}

async function bookingCustomer(ctx: Ctx, d: Record<string, any>, source: string) {
  const byRef = d.customer_reference ? await customerByRef(ctx, source, d.customer_reference) : null;
  if (byRef) return byRef.id as string;
  const email = d.customer_email ? normalizeEmail(String(d.customer_email)) : null;
  const byEmail = email ? await customerByEmail(ctx, email) : null;
  if (byEmail) return byEmail.id as string;
  if (!d.customer_name && !email) return null;
  const c = await createCustomer(ctx, { type: 'person', name: d.customer_name || email, email });
  await keepRef(ctx, c.id, source, d.customer_reference);
  return c.id;
}

export async function applyOrders(ctx: Ctx, rows: RowResult[], source: string) {
  for (const [ref, group] of groups(rows.filter((r) => r.action === 'create'))) {
    const d = group[0]!.data;
    const variants = new Map((await many<any>(ctx, `SELECT id, sku FROM variants WHERE sku = ANY($1) AND deleted_at IS NULL`, [group.map((r) => r.data.sku)])).map((v) => [v.sku as string, v.id as string]));
    const order = await createOrder(ctx, {
      customer_id: await bookingCustomer(ctx, d, source),
      location_id: d._location_id,
      starts_at: d._starts_at,
      ends_at: d._ends_at,
      lines: group.map((r) => ({ variant_id: variants.get(r.data.sku)!, quantity: r.data.quantity ?? 1 })),
      notes: d.notes ? { internal: d.notes } : undefined,
      source: 'import',
    } as any);
    await exec(ctx, `UPDATE orders SET external_ref = $2 WHERE id = $1`, [order.id, `${refKey(source)}:${ref}`]);
    try {
      if (d._status === 'reserved') {
        // Stock taken twice in the other system is still imported, and shows as an overbooking to settle.
        const overbook = can(ctx.actor, 'orders:overbook') ? { overbook: { reason: t('imports.overbook_reason') } } : {};
        await runAction(ctx, order.id, 'reserve', { notify: false, ...overbook });
      } else if (d._status === 'quote') {
        await exec(ctx, `UPDATE orders SET status = 'quote' WHERE id = $1`, [order.id]);
      } else if (d._status === 'closed') {
        await exec(ctx, `UPDATE orders SET status = 'closed', closed_at = ends_at WHERE id = $1`, [order.id]);
      } else if (d._status === 'cancelled') {
        await exec(ctx, `UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3 WHERE id = $1`, [order.id, ctx.now, t('imports.cancelled_reason')]);
      }
    } catch (e) {
      // Name the booking, so the shop knows which row to look at.
      if (e instanceof AppError) throw invalid(t('imports.has_errors'), [{ field: `row_${group[0]!.row}.reference`, code: e.code, message: t('imports.booking_failed', { reference: ref, error: e.message }) }]);
      throw e;
    }
    if (d._status !== 'draft' && d._status !== 'reserved') {
      await exec(ctx, `INSERT INTO order_events (id, tenant_id, order_id, type, from_status, to_status, payload, actor) VALUES ($1,$2,$3,'imported','draft',$4,$5,$6)`, [
        newId('oev'), ctx.tenantId, order.id, d._status, json({ source, reference: ref }), json({ type: ctx.actor.type, id: ctx.actor.id }),
      ]);
    }
  }
}
