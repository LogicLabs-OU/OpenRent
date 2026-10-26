import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { audit, emit } from '../events.ts';
import { many, must, one, exec } from '../sql.ts';
import { daysInMonth, zonedParts, zonedTimeToUtc } from '../time.ts';
import { tenantLocale } from '../i18n/context.ts';
import { formatDate } from '../format.ts';
import { issueDocument } from '../documents/index.ts';
import { chargeSavedCard, createPaymentRequest } from '../payments/index.ts';
import { notifyStaff } from '../notifications/index.ts';

/**
 * Long rentals billed per period while out (FR-OR-11). Each period is invoiced when it starts, for its
 * share of what is still to bill: every line's remaining amount times the period's part of the time left.
 * So an extension (more time, a higher total) and an early return (less) need nothing else: the next
 * period, or the last one at check-in, takes the difference, as a credit note when too much was billed.
 * A card the customer saved is charged; otherwise they get the invoice with a payment link.
 */
export const BILLING_CYCLES = ['weekly', 'monthly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** The start of the next period: a week later, or the same day next month in the shop's time zone. */
export function nextPeriodStart(from: Date, cycle: BillingCycle, tz: string): Date {
  if (cycle === 'weekly') {
    const p = zonedParts(from, tz);
    return zonedTimeToUtc(p.year, p.month, p.day + 7, p.hour, p.minute, tz);
  }
  const p = zonedParts(from, tz);
  const year = p.month === 12 ? p.year + 1 : p.year;
  const month = p.month === 12 ? 1 : p.month + 1;
  const last = daysInMonth(`${year}-${String(month).padStart(2, '0')}`).length;
  return zonedTimeToUtc(year, month, Math.min(p.day, last), p.hour, p.minute, tz);
}

interface Billed {
  total: number;
  tax: number;
}

/** What period invoices and credit notes of this booking have billed per order line so far. */
async function billedSoFar(ctx: Ctx, orderId: string): Promise<Map<string, Billed>> {
  const docs = await many<any>(ctx, `SELECT type, data FROM documents WHERE order_id = $1 AND type IN ('invoice', 'credit_note') AND data ? 'billing_period'`, [orderId]);
  const out = new Map<string, Billed>();
  for (const d of docs) {
    const sign = d.type === 'credit_note' ? -1 : 1;
    for (const l of d.data.lines ?? []) {
      if (!l.order_line_id) continue;
      const b = out.get(l.order_line_id) ?? { total: 0, tax: 0 };
      out.set(l.order_line_id, { total: b.total + sign * Number(l.total), tax: b.tax + sign * Number(l.tax) });
    }
  }
  return out;
}

/**
 * Bills one period [from, to). The last one (`final`) bills everything that is left, which after an
 * early return can be less than nothing: then it is a credit note.
 */
export async function billPeriod(ctx: Ctx, orderId: string, from: Date, to: Date, final: boolean) {
  const o = await must<any>(ctx, `SELECT * FROM orders WHERE id = $1`, [orderId], 'order', orderId);
  const lines = await many<any>(ctx, `SELECT id, type, description, quantity, total, tax, price_snapshot FROM order_lines WHERE order_id = $1 AND parent_line_id IS NULL ORDER BY position, created_at`, [o.id]);
  const billed = await billedSoFar(ctx, o.id);
  const left = Math.max(0, new Date(o.ends_at).getTime() - from.getTime());
  const share = final || left === 0 ? 1 : Math.min(1, Math.max(0, (to.getTime() - from.getTime()) / left));
  const locale = await tenantLocale(ctx);
  const label = msg('billing.period', { from: formatDate(from, o.timezone, locale), to: formatDate(new Date(to.getTime() - 1), o.timezone, locale) }, locale);
  const out = [];
  for (const l of lines) {
    const b = billed.get(l.id) ?? { total: 0, tax: 0 };
    const total = Math.round((Number(l.total) - b.total) * share);
    const tax = Math.round((Number(l.tax) - b.tax) * share);
    if (!total && !tax) continue;
    out.push({ order_line_id: l.id, name: `${l.description} · ${label}`, type: l.type, quantity: l.quantity, unit_price: Math.abs(total), discount: 0, tax_rate_bp: l.price_snapshot?.tax_rate_bp ?? 0, tax, total, period_label: null, units: [] });
  }
  await exec(ctx, `UPDATE orders SET billed_until = $2 WHERE id = $1`, [o.id, to]);
  const sum = out.reduce((s, l) => s + l.total, 0);
  if (!out.length || sum === 0) return null;
  const credit = sum < 0;
  // Billed too much (an early return): one credit line per tax rate, positive like an invoice's lines.
  const docLines = credit ? creditLines(out, msg('billing.credit_line', { period: label }, locale)) : out;
  const tax = docLines.reduce((s, l) => s + l.tax, 0);
  const total = docLines.reduce((s, l) => s + l.total, 0);
  const rates = new Map<number, { rate_bp: number; net: number; tax: number }>();
  for (const l of docLines) {
    const r = rates.get(l.tax_rate_bp) ?? { rate_bp: l.tax_rate_bp, net: 0, tax: 0 };
    rates.set(l.tax_rate_bp, { ...r, net: r.net + l.total - l.tax, tax: r.tax + l.tax });
  }
  const doc = await issueDocument(ctx, o.id, credit ? 'credit_note' : 'invoice', {
    overrides: { lines: docLines, totals: { subtotal: total - tax, discount: 0, fees: 0, tax, total, deposit: 0 }, tax_breakdown: [...rates.values()] },
    extra: { billing_period: { from: from.toISOString(), to: to.toISOString(), final } },
  });
  await audit(ctx, { entity_type: 'order', entity_id: o.id, action: 'billed', extra: { document_id: doc.id, from: from.toISOString(), to: to.toISOString(), amount: sum } });
  let payment: unknown = null;
  if (!credit) payment = await collect(ctx, o, doc, total, label);
  await emit(ctx, 'order.billed', { type: 'order', id: o.id }, { id: o.id, object: 'order', number: o.number, document_id: doc.id, period: { from: from.toISOString(), to: to.toISOString(), final }, amount: { amount: sum, currency: o.currency.trim() }, payment });
  return doc;
}

function creditLines(lines: { total: number; tax: number; tax_rate_bp: number; type: string }[], name: string) {
  const byRate = new Map<number, { total: number; tax: number }>();
  for (const l of lines) {
    const r = byRate.get(l.tax_rate_bp) ?? { total: 0, tax: 0 };
    byRate.set(l.tax_rate_bp, { total: r.total - l.total, tax: r.tax - l.tax });
  }
  return [...byRate].filter(([, r]) => r.total).map(([rate, r]) => ({ order_line_id: null, name, type: 'rental', quantity: 1, unit_price: r.total, discount: 0, tax_rate_bp: rate, tax: r.tax, total: r.total, period_label: null, units: [] }));
}

/** Charges the saved card, else asks for payment with a link; a refused card is told to staff too. */
async function collect(ctx: Ctx, o: any, doc: any, amount: number, label: string) {
  const owed = Number((await one<any>(ctx, `SELECT totals FROM orders WHERE id = $1`, [o.id]))?.totals?.balance ?? amount);
  const due = Math.min(amount, owed);
  if (due <= 0) return null;
  const description = msg('billing.charge_description', { number: o.number, period: label }, await tenantLocale(ctx));
  const charged = await chargeSavedCard(ctx, o.id, { amount: due, purpose: 'rental', description, key: `period:${doc.id}` });
  if (charged && 'payment' in charged) return { status: 'charged', payment_id: charged.payment.id };
  if (charged && 'failed' in charged) {
    await emit(ctx, 'payment.failed', { type: 'order', id: o.id }, { order_id: o.id, document_id: doc.id, amount: { amount: due, currency: o.currency.trim() }, error: charged.failed });
    await notifyStaff(ctx, o.id, 'staff_payment_failed', { error: msg('billing.card_refused', { error: charged.failed }, await tenantLocale(ctx)) });
  }
  const request = await createPaymentRequest(ctx, o.id, { amount: due, kind: 'custom', message: description, notify: true });
  return { status: 'requested', payment_request_id: request.id };
}

const DUE = `SELECT id, billing_cycle, timezone, ends_at, coalesce(billed_until, starts_at) AS next_from FROM orders
  WHERE billing_cycle IS NOT NULL AND status IN ('out', 'returned_partial') AND coalesce(billed_until, starts_at) <= $1 AND coalesce(billed_until, starts_at) < ends_at`;

/** Bills the periods of one booking that have started (catching up missed runs); returns how many documents. */
async function billStarted(ctx: Ctx, o: { id: string; billing_cycle: BillingCycle; timezone: string; ends_at: Date; next_from: Date }) {
  let issued = 0;
  let from = new Date(o.next_from);
  const end = new Date(o.ends_at);
  // At most five years of monthly periods per run, so a misconfigured booking cannot run away.
  for (let i = 0; i < 60 && from <= ctx.now && from < end; i++) {
    const next = nextPeriodStart(from, o.billing_cycle, o.timezone);
    const to = next < end ? next : end;
    if (await billPeriod(ctx, o.id, from, to, to >= end)) issued++;
    from = to;
  }
  return issued;
}

/** At pickup: the first period is billed at once. */
export async function billOrderNow(ctx: Ctx, orderId: string) {
  const o = await one<any>(ctx, `${DUE} AND id = $2`, [ctx.now, orderId]);
  return o ? billStarted(ctx, o) : 0;
}

/** Worker: bills every period that has started on recurring bookings that are out. Each booking on its own. */
export async function billRecurring(ctx: Ctx): Promise<number> {
  const due = await many<any>(ctx, `${DUE} FOR UPDATE SKIP LOCKED`, [ctx.now]);
  let issued = 0;
  for (const o of due) {
    await ctx.db.query('SAVEPOINT recurring');
    try {
      issued += await billStarted(ctx, o);
      await ctx.db.query('RELEASE SAVEPOINT recurring');
    } catch (err) {
      await ctx.db.query('ROLLBACK TO SAVEPOINT recurring');
      ctx.logger.warn({ err, order: o.id }, 'recurring invoice not issued');
    }
  }
  return issued;
}

/** At check-in: whatever is left to bill (or credit) goes on one last document. */
export async function billOnReturn(ctx: Ctx, orderId: string) {
  const o = await one<any>(ctx, `SELECT billing_cycle, starts_at, billed_until FROM orders WHERE id = $1`, [orderId]);
  if (!o?.billing_cycle) return null;
  const from = new Date(o.billed_until ?? o.starts_at);
  return billPeriod(ctx, orderId, from, new Date(Math.max(from.getTime(), ctx.now.getTime())), true);
}
