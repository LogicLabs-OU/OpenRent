import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError } from '../errors.ts';
import { many, must } from '../sql.ts';
import { zonedParts, zonedTimeToUtc } from '../time.ts';
import { issueConsolidatedInvoice } from '../documents/index.ts';

/**
 * Monthly invoicing for customers on account (FR-CUS-7): their finished bookings are not invoiced one by
 * one but go on one invoice per month, issued in the first days of the next month (or at once by staff).
 */
async function uninvoiced(ctx: Ctx, customerId: string, endedBefore: Date) {
  return many<{ id: string; starts_at: Date; ends_at: Date }>(
    ctx,
    `SELECT o.id, o.starts_at, o.ends_at FROM orders o
      WHERE o.customer_id = $1 AND o.invoice_id IS NULL AND o.status IN ('returned', 'inspected', 'closed') AND o.ends_at < $2
        AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.order_id = o.id AND d.type = 'invoice' AND d.status <> 'voided')
      ORDER BY o.starts_at`,
    [customerId, endedBefore],
  );
}

async function invoiceOrders(ctx: Ctx, customerId: string, orders: { id: string; starts_at: Date; ends_at: Date }[]) {
  const from = new Date(Math.min(...orders.map((o) => new Date(o.starts_at).getTime()))).toISOString();
  const to = new Date(Math.max(...orders.map((o) => new Date(o.ends_at).getTime()))).toISOString();
  return issueConsolidatedInvoice(ctx, customerId, orders.map((o) => o.id), { from, to });
}

/** Staff: every finished booking not invoiced yet goes on one invoice now. */
export async function invoiceNow(ctx: Ctx, customerId: string) {
  const c = await must<any>(ctx, `SELECT on_account, invoice_schedule FROM customers WHERE id = $1 AND deleted_at IS NULL`, [customerId], 'customer', customerId);
  if (!c.on_account || c.invoice_schedule !== 'monthly') throw new AppError('not_invoiced_monthly', 409, msg('error.customer_not_invoiced_monthly'));
  // Returned is finished, even before the booked end.
  const orders = await uninvoiced(ctx, customerId, new Date(8.64e15));
  if (!orders.length) throw new AppError('nothing_to_invoice', 409, msg('error.nothing_to_invoice'));
  return invoiceOrders(ctx, customerId, orders);
}

/**
 * Worker, daily: bookings of monthly customers that ended before this month (shop time) go on one
 * invoice per customer. Each customer is invoiced on its own, so one problem does not hold up the rest.
 */
export async function consolidateMonthly(ctx: Ctx): Promise<number> {
  const tenant = await must<any>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const p = zonedParts(ctx.now, tenant.timezone);
  const monthStart = zonedTimeToUtc(p.year, p.month, 1, 0, 0, tenant.timezone);
  const customers = await many<{ id: string }>(ctx, `SELECT id FROM customers WHERE on_account AND invoice_schedule = 'monthly' AND deleted_at IS NULL`);
  let issued = 0;
  for (const c of customers) {
    const orders = await uninvoiced(ctx, c.id, monthStart);
    if (!orders.length) continue;
    await ctx.db.query('SAVEPOINT consolidate');
    try {
      await invoiceOrders(ctx, c.id, orders);
      await ctx.db.query('RELEASE SAVEPOINT consolidate');
      issued++;
    } catch (err) {
      await ctx.db.query('ROLLBACK TO SAVEPOINT consolidate');
      ctx.logger.warn({ err, customer: c.id }, 'monthly invoice not issued');
    }
  }
  return issued;
}
