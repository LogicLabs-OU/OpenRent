import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { invalid, type FieldError } from '../errors.ts';
import { formatMoney } from '../format.ts';
import { currentLocale } from '../i18n/index.ts';
import { many, one } from '../sql.ts';

/**
 * B2B accounts (FR-CUS-7): a customer on account books without paying first and settles invoices within
 * their payment terms, up to a credit limit; a purchase order number can be required on every booking;
 * finished bookings can go on one invoice a month instead of one each.
 */
export interface B2bTerms {
  on_account: boolean;
  payment_terms_days: number | null;
  /** Minor units; null means no limit. */
  credit_limit: number | null;
  po_required: boolean;
  invoice_schedule: 'per_order' | 'monthly';
}

/** Terms when an on-account customer has none of their own. */
export const DEFAULT_TERMS_DAYS = 14;

/** Orders whose amount the customer owes once booked. */
const BOOKED = `('reserved', 'prepared', 'out', 'returned_partial', 'returned', 'inspected', 'closed')`;

export function b2bToApi(c: any): B2bTerms {
  return {
    on_account: !!c.on_account,
    payment_terms_days: c.payment_terms_days ?? null,
    credit_limit: c.credit_limit == null ? null : Number(c.credit_limit),
    po_required: !!c.po_required,
    invoice_schedule: c.invoice_schedule === 'monthly' ? 'monthly' : 'per_order',
  };
}

/** Checks a change to the terms against what is stored and returns the column values to write. */
export function b2bColumns(before: any | null, input: Partial<B2bTerms> | undefined): Record<string, unknown> {
  if (!input) return {};
  const next = { ...b2bToApi(before ?? {}), ...input };
  const errors: FieldError[] = [];
  const days = next.payment_terms_days;
  if (days != null && (!Number.isInteger(days) || days < 0 || days > 365)) errors.push({ field: 'b2b.payment_terms_days', code: 'out_of_range', message: msg('error.field.payment_terms_days') });
  if (next.credit_limit != null && (!Number.isInteger(next.credit_limit) || next.credit_limit < 0)) errors.push({ field: 'b2b.credit_limit', code: 'out_of_range', message: msg('error.field.credit_limit') });
  if (next.invoice_schedule === 'monthly' && !next.on_account) errors.push({ field: 'b2b.invoice_schedule', code: 'needs_account', message: msg('error.field.monthly_needs_account') });
  if (errors.length) throw invalid(msg('error.check_the_account_terms'), errors);
  return { on_account: next.on_account, payment_terms_days: days, credit_limit: next.credit_limit, po_required: next.po_required, invoice_schedule: next.invoice_schedule };
}

/** What the customer owes now: the unpaid part of every booked order (other than `excludeOrderId`). */
export async function openBalance(ctx: Ctx, customerId: string, excludeOrderId?: string | null): Promise<number> {
  const r = await one<{ owed: string }>(
    ctx,
    `SELECT coalesce(sum(greatest(coalesce((totals->>'balance')::bigint, (totals->>'total')::bigint, 0), 0)), 0) AS owed
       FROM orders WHERE customer_id = $1 AND status IN ${BOOKED} AND id IS DISTINCT FROM $2`,
    [customerId, excludeOrderId ?? null],
  );
  return Number(r?.owed ?? 0);
}

/** Open balances of several customers at once (customer list). */
export async function openBalances(ctx: Ctx, customerIds: string[]): Promise<Map<string, number>> {
  if (!customerIds.length) return new Map();
  const rows = await many<{ customer_id: string; owed: string }>(
    ctx,
    `SELECT customer_id, sum(greatest(coalesce((totals->>'balance')::bigint, (totals->>'total')::bigint, 0), 0)) AS owed
       FROM orders WHERE customer_id = ANY($1) AND status IN ${BOOKED} GROUP BY customer_id`,
    [customerIds],
  );
  return new Map(rows.map((r) => [r.customer_id, Number(r.owed)]));
}

/**
 * Before a booking is confirmed with something left to pay: the purchase order number when the customer
 * needs one, and, for a customer on account, the credit limit (staff may book over it with `override`).
 * A booking paid in full (a card payment at checkout) needs neither.
 */
export async function checkAccountBooking(ctx: Ctx, o: { id: string; customer_id: string | null; po_number: string | null; currency: string; totals: any }, opts: { override?: boolean } = {}) {
  if (!o.customer_id) return;
  const c = await one<any>(ctx, `SELECT on_account, credit_limit, po_required FROM customers WHERE id = $1`, [o.customer_id]);
  if (!c) return;
  const amount = Number(o.totals?.balance ?? o.totals?.total ?? 0);
  if (amount <= 0) return;
  const errors: FieldError[] = [];
  if (c.po_required && !o.po_number?.trim()) errors.push({ field: 'po_number', code: 'required', message: msg('error.field.po_number_required') });
  if (c.on_account && c.credit_limit != null && !opts.override) {
    const owed = await openBalance(ctx, o.customer_id, o.id);
    const limit = Number(c.credit_limit);
    if (owed + amount > limit) {
      const money = (n: number) => formatMoney(n, o.currency, currentLocale());
      errors.push({ field: 'customer_id', code: 'credit_limit_exceeded', message: msg('error.field.credit_limit_exceeded', { limit: money(limit), available: money(Math.max(0, limit - owed)) }) });
    }
  }
  if (errors.length) throw invalid(msg('error.check_the_account_terms'), errors);
}

/** A signed-in storefront customer's account terms, for the checkout (null unless on account). */
export async function accountTermsFor(ctx: Ctx, email: string) {
  const c = await one<any>(ctx, `SELECT * FROM customers WHERE lower(email) = lower($1) AND on_account AND deleted_at IS NULL AND merged_into_id IS NULL ORDER BY created_at LIMIT 1`, [email]);
  if (!c) return null;
  const currency = (await one<{ currency: string }>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId]))!.currency.trim();
  const owed = await openBalance(ctx, c.id);
  return {
    customer_id: c.id as string, po_required: !!c.po_required, payment_terms_days: c.payment_terms_days ?? DEFAULT_TERMS_DAYS,
    available_credit: c.credit_limit == null ? null : { amount: Math.max(0, Number(c.credit_limit) - owed), currency },
  };
}

/** When an invoice to this customer falls due: issued plus their terms when on account, else null (paid up front). */
export async function invoiceDueAt(ctx: Ctx, customerId: string | null, issuedAt: Date): Promise<string | null> {
  if (!customerId) return null;
  const c = await one<any>(ctx, `SELECT on_account, payment_terms_days FROM customers WHERE id = $1`, [customerId]);
  if (!c?.on_account) return null;
  return new Date(issuedAt.getTime() + (c.payment_terms_days ?? DEFAULT_TERMS_DAYS) * 86_400_000).toISOString();
}
