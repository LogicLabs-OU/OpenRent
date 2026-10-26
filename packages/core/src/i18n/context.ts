import type { Ctx } from '../context.ts';
import { one } from '../sql.ts';

/** The shop's default language (storefront default, also used for staff email and provider texts). */
export async function tenantLocale(ctx: Ctx): Promise<string> {
  return (await one<{ locale: string }>(ctx, `SELECT locale FROM tenants WHERE id = $1`, [ctx.tenantId]))?.locale ?? 'en';
}

/** The language an order's documents use: the customer's, else the shop's. Texts stored on the order follow it. */
export async function orderLocale(ctx: Ctx, orderId: string): Promise<string> {
  const r = await one<{ locale: string }>(
    ctx,
    `SELECT coalesce(c.locale, t.locale) AS locale FROM orders o JOIN tenants t ON t.id = o.tenant_id LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
    [orderId],
  );
  return r?.locale ?? 'en';
}
