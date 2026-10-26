import type { AccountingContact, AccountingInvoice, AccountingLineKind, AccountingPayment, IntegrationOrder } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { many, one } from '../sql.ts';

/**
 * Neutral accounting records (the "accounting" category of integrations): issued invoices and credit
 * notes, payments and refunds, and customers, in the shape the books need. They are read from the
 * frozen document data, so what is sent is exactly what was issued.
 */
const KINDS: Record<string, AccountingLineKind> = { rental: 'rental', sale: 'sale', service: 'service', fee: 'fee', consumable: 'sale', damage: 'damage', late_fee: 'late_fee', discount: 'discount' };

export async function contact(ctx: Ctx, customerId: string): Promise<AccountingContact | null> {
  const c = await one<any>(ctx, `SELECT * FROM customers WHERE id = $1`, [customerId]);
  if (!c) return null;
  const a = c.addresses?.billing ?? c.addresses?.shipping ?? null;
  return {
    id: c.id, name: c.name, company_name: c.company_name ?? null, email: c.email ?? null, phone: c.phone ?? null, tax_id: c.tax_id ?? null,
    address: a ? { line1: a.line1, line2: a.line2, postal_code: a.postal_code, city: a.city, country: a.country } : null,
  };
}

export async function invoice(ctx: Ctx, documentId: string): Promise<AccountingInvoice | null> {
  const d = await one<any>(ctx, `SELECT d.*, o.number AS order_number FROM documents d LEFT JOIN orders o ON o.id = d.order_id WHERE d.id = $1 AND d.type IN ('invoice', 'credit_note')`, [documentId]);
  if (!d || !d.customer_id) return null;
  const who = await contact(ctx, d.customer_id);
  if (!who) return null;
  const lines = ((d.data?.lines ?? []) as any[]).map((l) => {
    const tax = Math.round(Number(l.tax ?? 0));
    const net = Math.round(Number(l.total ?? 0)) - tax;
    const quantity = Math.max(1, Number(l.quantity ?? 1));
    return { description: String(l.name ?? ''), quantity, unit_amount: Math.round(net / quantity), net_amount: net, tax_amount: tax, tax_rate_bp: Number(l.tax_rate_bp ?? 0), kind: KINDS[l.type] ?? 'other' };
  });
  const net = lines.reduce((s, l) => s + l.net_amount, 0);
  const tax = lines.reduce((s, l) => s + l.tax_amount, 0);
  const pays = d.order_id
    ? await many<{ id: string; amount: string }>(
        ctx,
        `SELECT id, amount FROM payments WHERE order_id = $1 AND status = 'succeeded' AND kind IN ('charge', 'manual') AND purpose <> 'deposit' AND method IS DISTINCT FROM 'deposit' ORDER BY created_at`,
        [d.order_id],
      )
    : [];
  return {
    id: d.id, type: d.type, number: d.number, issued_at: new Date(d.issued_at ?? d.created_at).toISOString(), due_at: d.data?.due_at ?? null,
    currency: String(d.currency ?? '').trim(), contact: who, order_number: d.order_number ?? null, lines, net_total: net, tax_total: tax, total: net + tax,
    credit_for: d.data?.credit_for ?? null, status: d.status, order_payments: pays.map((p) => ({ id: p.id, amount: Number(p.amount) })),
  };
}

/** A booking in neutral form, for CRMs, review platforms and the like. */
export async function order(ctx: Ctx, orderId: string): Promise<IntegrationOrder | null> {
  const o = await one<any>(ctx, `SELECT o.*, l.name AS location_name FROM orders o JOIN locations l ON l.id = o.location_id WHERE o.id = $1`, [orderId]);
  if (!o) return null;
  const lines = await many<any>(
    ctx,
    `SELECT ol.description, ol.quantity, ol.total, ol.product_id, p.name AS product_name FROM order_lines ol LEFT JOIN products p ON p.id = ol.product_id
     WHERE ol.order_id = $1 AND ol.parent_line_id IS NULL ORDER BY ol.position, ol.created_at`,
    [orderId],
  );
  return {
    id: o.id, number: o.number, status: o.status, source: o.source, currency: String(o.currency).trim(),
    total: Number(o.totals?.total ?? 0), balance: Number(o.totals?.balance ?? o.totals?.total ?? 0),
    starts_at: new Date(o.starts_at).toISOString(), ends_at: new Date(o.ends_at).toISOString(), created_at: new Date(o.created_at).toISOString(),
    contact: o.customer_id ? await contact(ctx, o.customer_id) : null,
    location: { id: o.location_id, name: o.location_name },
    lines: lines.map((l) => ({ description: String(l.description || l.product_name || ''), quantity: Number(l.quantity), total: Number(l.total), product_id: l.product_id ?? null })),
  };
}

export async function payment(ctx: Ctx, paymentId: string): Promise<AccountingPayment | null> {
  const p = await one<any>(ctx, `SELECT p.*, o.number AS order_number FROM payments p LEFT JOIN orders o ON o.id = p.order_id WHERE p.id = $1 AND p.status = 'succeeded'`, [paymentId]);
  if (!p || p.kind === 'authorization') return null;
  // The order's latest invoice that still counts is what the money settles.
  const inv = p.order_id
    ? await one<{ id: string }>(ctx, `SELECT id FROM documents WHERE order_id = $1 AND type = 'invoice' AND status <> 'voided' ORDER BY issued_at DESC LIMIT 1`, [p.order_id])
    : null;
  return {
    id: p.id, kind: p.kind === 'refund' ? 'refund' : 'payment', purpose: p.purpose, amount: Math.abs(Number(p.amount)), currency: String(p.currency).trim(),
    paid_at: new Date(p.created_at).toISOString(), method: p.method ?? null, provider: p.provider ?? null, invoice_id: inv?.id ?? null, order_number: p.order_number ?? null,
  };
}
