import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { money } from '../crud.ts';
import { exec, many, one } from '../sql.ts';
import { newId } from '../ids.ts';
import { putFile } from '../files/index.ts';
import { addAttachment } from '../attachments/index.ts';
import { accountTermsFor } from '../customers/b2b.ts';
import { normalizeEmail } from '../customers/index.ts';
import { activeProvider, createPaymentIntent, createPaymentRequest, listCustomerInvoices, requestInvoicePayment } from '../payments/index.ts';
import { storefrontBase } from '../notifications/index.ts';
import { ownedOrder, overview } from '../accounts/index.ts';

/**
 * The customer portal (FR-CUS-6, PRD §5.4 `/portal`): what a signed-in customer sees and does, on top
 * of the storefront account. The customer is the email they signed in with, and so every customer
 * record with that email. Balances are paid online, insurance documents uploaded (FR-PAY-8).
 */

/** File types a customer may upload: documents and photos of them. */
export const UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_UPLOAD = 10 * 1024 * 1024;

async function customerIds(ctx: Ctx, email: string) {
  return (await many<{ id: string }>(ctx, `SELECT id FROM customers WHERE lower(email) = $1 AND deleted_at IS NULL AND merged_into_id IS NULL AND anonymized_at IS NULL ORDER BY created_at`, [normalizeEmail(email)])).map((c) => c.id);
}

async function currency(ctx: Ctx) {
  return (await one<{ currency: string }>(ctx, `SELECT currency FROM tenants WHERE id = $1`, [ctx.tenantId]))!.currency.trim();
}

/** Bookings with what is left to pay and the page to pay it on. */
export async function orders(ctx: Ctx, email: string, loaded?: Awaited<ReturnType<typeof overview>>['orders']) {
  const list = loaded ?? (await overview(ctx, email)).orders;
  const owed = new Map(
    (await many<{ id: string; balance: string; currency: string }>(ctx, `SELECT id, coalesce((totals->>'balance')::bigint, (totals->>'total')::bigint, 0) AS balance, currency FROM orders WHERE id = ANY($1)`, [list.map((o) => o.id)])).map((r) => [r.id, r]),
  );
  const base = await storefrontBase(ctx);
  return list.map((o) => {
    const b = owed.get(o.id);
    const balance = ['cancelled', 'expired'].includes(o.status) ? 0 : Math.max(0, Number(b?.balance ?? 0));
    return { ...o, balance: money(balance, String(b?.currency ?? '').trim()), order_url: `${base}/order/${o.token}` };
  });
}

/**
 * Monthly invoices of the customer with something left to pay (ADR 0012): what each still owes is
 * what its bookings still owe.
 */
async function openInvoices(ctx: Ctx, ids: string[]) {
  if (!ids.length) return [];
  const rows = await many<any>(
    ctx,
    `SELECT d.id, d.number, d.issued_at, d.currency, d.data, sum(greatest((o.totals->>'balance')::bigint, 0))::bigint AS due, min(o.starts_at) AS first
       FROM documents d JOIN orders o ON o.invoice_id = d.id
      WHERE d.type = 'invoice' AND d.status IN ('issued', 'sent') AND d.customer_id = ANY($1) AND d.order_id IS NULL
      GROUP BY d.id HAVING sum(greatest((o.totals->>'balance')::bigint, 0)) > 0 ORDER BY d.issued_at`,
    [ids],
  );
  const ofBookings = rows.map((d) => ({ id: d.id, object: 'invoice', number: d.number, issued_at: d.issued_at, due_at: d.data?.due_at ?? null, due: money(Number(d.due), String(d.currency).trim()) }));
  // The customer's own invoices without bookings (ADR 0014), such as a membership fee.
  const own = [];
  for (const id of ids) {
    for (const b of await listCustomerInvoices(ctx, id, { open: true })) {
      const d = await one<any>(ctx, `SELECT issued_at, data FROM documents WHERE id = $1`, [b.id]);
      own.push({ id: b.id, object: 'invoice', number: b.number, issued_at: d.issued_at, due_at: d.data?.due_at ?? null, due: b.due });
    }
  }
  return [...ofBookings, ...own].sort((a, b) => new Date(a.issued_at).getTime() - new Date(b.issued_at).getTime());
}

/**
 * Starts paying a monthly invoice as a whole: one payment for what its bookings still owe, shared out
 * over them when it succeeds. Paid on the first booking's page, where the payment form takes over.
 */
export async function payInvoice(ctx: Ctx, email: string, invoiceId: string) {
  const ids = await customerIds(ctx, email);
  const open = (await openInvoices(ctx, ids)).find((i) => i.id === invoiceId);
  if (!open) throw new AppError('not_payable', 409, msg('payments.not_payable'));
  if (!(await activeProvider(ctx))) throw new AppError('online_payment_unavailable', 409, msg('portal.online_payment_unavailable'));
  const anchor = await one<{ id: string; public_token: string }>(ctx, `SELECT id, public_token FROM orders WHERE invoice_id = $1 AND (totals->>'balance')::bigint > 0 ORDER BY starts_at, number LIMIT 1`, [invoiceId]);
  // No bookings on it: the customer pays on the provider's page and comes back to their account.
  if (!anchor) {
    const req = await requestInvoicePayment(ctx, invoiceId, { notify: false, returnUrl: `${(await storefrontBase(ctx)).replace(/\/$/, '')}/account` });
    return { object: 'payment_intent', invoice_id: invoiceId, redirect_url: req.url };
  }
  const c = await currency(ctx);
  // One open request per invoice: a new attempt replaces the last.
  await exec(ctx, `UPDATE payment_requests SET status = 'cancelled' WHERE invoice_id = $1 AND status = 'open'`, [invoiceId]);
  const request = (await many<{ id: string }>(ctx, `INSERT INTO payment_requests (id, tenant_id, order_id, amount, currency, kind, status, invoice_id) VALUES ($1,$2,$3,$4,$5,'invoice','open',$6) RETURNING id`, [newId('prq'), ctx.tenantId, anchor.id, open.due.amount, c, invoiceId]))[0]!;
  const intent = await createPaymentIntent(ctx, anchor.id, { purpose: 'rental', amount: open.due.amount, paymentRequestId: request.id });
  return { ...intent, invoice_id: invoiceId, order_url: `${await storefrontBase(ctx)}/order/${anchor.public_token}` };
}

/** Profile, account terms, what is owed, insurance documents and signatures waiting. */
export async function me(ctx: Ctx, email: string) {
  const { orders: list, ...profile } = await overview(ctx, email);
  const ids = await customerIds(ctx, email);
  const terms = await accountTermsFor(ctx, email);
  const c = await currency(ctx);
  const all = await orders(ctx, email, list);
  const owing = all.filter((o) => o.balance.amount > 0 && !['cancelled', 'expired', 'draft'].includes(o.status));
  const owed = owing.reduce((s, o) => s + o.balance.amount, 0);
  const insurance = await many<any>(
    ctx,
    `SELECT a.id, a.label, a.created_at, f.filename FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.owner_type = 'customer' AND a.owner_id = ANY($1) AND a.kind = 'insurance' ORDER BY a.created_at DESC`,
    [ids],
  );
  const signatures = await many<any>(
    ctx,
    `SELECT s.id, s.created_at, d.type, d.number, d.order_id FROM signature_requests s JOIN documents d ON d.id = s.document_id
      WHERE s.status = 'pending' AND lower(s.signer_email) = $1 ORDER BY s.created_at DESC`,
    [normalizeEmail(email)],
  );
  return {
    ...profile,
    invoices: await openInvoices(ctx, ids),
    b2b: terms ? { on_account: true, po_required: terms.po_required, payment_terms_days: terms.payment_terms_days, available_credit: terms.available_credit } : null,
    open_balance: money(owed, c),
    owing: owing.map((o) => ({ id: o.id, number: o.number, status: o.status, balance: o.balance, order_url: o.order_url })),
    insurance: insurance.map((a) => ({ id: a.id, object: 'insurance_document', label: a.label || a.filename, filename: a.filename, created_at: a.created_at })),
    signature_requests: signatures.map((s) => ({ id: s.id, object: 'signature_request', document: { type: s.type, number: s.number }, order_id: s.order_id, created_at: s.created_at })),
  };
}

/** One booking: lines, totals, payments, deliveries and what the customer may ask for. */
export async function order(ctx: Ctx, email: string, orderId: string) {
  const { order: o } = await ownedOrder(ctx, email, orderId);
  const summary = (await orders(ctx, email)).find((x) => x.id === o.id)!;
  const c = String(o.currency).trim();
  const lines = await many<any>(ctx, `SELECT description, quantity, total FROM order_lines WHERE order_id = $1 AND parent_line_id IS NULL ORDER BY position, created_at`, [o.id]);
  const payments = await many<any>(ctx, `SELECT amount, method, kind, created_at FROM payments WHERE order_id = $1 AND status = 'succeeded' AND kind <> 'authorization' ORDER BY created_at`, [o.id]);
  const deliveries = await many<any>(ctx, `SELECT kind, status, window_start, window_end FROM deliveries WHERE order_id = $1 AND status <> 'cancelled' ORDER BY window_start`, [o.id]);
  return {
    ...summary,
    po_number: o.po_number ?? null,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, total: money(l.total, c) })),
    totals: { total: money(o.totals?.total ?? 0, c), paid: money(o.totals?.paid ?? 0, c), balance: summary.balance },
    payments: payments.map((p) => ({ amount: money(Math.abs(Number(p.amount)) * (p.kind === 'refund' ? -1 : 1), c), method: p.method, created_at: p.created_at })),
    deliveries: deliveries.map((d) => ({ kind: d.kind, status: d.status, window_start: d.window_start, window_end: d.window_end })),
  };
}

/** Starts an online payment of what is left on a booking (PRD §5.4 /portal/orders/{id}/payment_intents). */
export async function payBalance(ctx: Ctx, email: string, orderId: string) {
  const { order: o } = await ownedOrder(ctx, email, orderId);
  const balance = Number(o.totals?.balance ?? o.totals?.total ?? 0);
  if (['cancelled', 'expired', 'draft'].includes(o.status) || balance <= 0) throw new AppError('not_payable', 409, msg('payments.not_payable'));
  if (!(await activeProvider(ctx))) throw new AppError('online_payment_unavailable', 409, msg('portal.online_payment_unavailable'));
  const open = await one<{ id: string; amount: string }>(ctx, `SELECT id, amount FROM payment_requests WHERE order_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [o.id]);
  const request = open ?? (await createPaymentRequest(ctx, o.id, { amount: balance, kind: 'balance', notify: false }));
  return createPaymentIntent(ctx, o.id, { purpose: 'rental', amount: open ? Number(open.amount) : balance, paymentRequestId: request.id });
}

/**
 * An insurance certificate the customer uploads (FR-PAY-8). It goes on their customer record, where
 * the pickup check looks for it.
 */
export async function uploadInsurance(ctx: Ctx, email: string, file: { filename: string; contentType: string; body: Buffer }, label?: string) {
  const ids = await customerIds(ctx, email);
  if (!ids.length) throw new AppError('unauthenticated', 401, msg('account.signed_out'));
  if (!UPLOAD_TYPES.includes(file.contentType)) throw invalid(msg('portal.upload_type'), [{ field: 'file', code: 'unsupported_type', message: msg('portal.upload_type') }]);
  if (file.body.length > MAX_UPLOAD) throw invalid(msg('portal.upload_size', { mb: MAX_UPLOAD / 1024 / 1024 }), [{ field: 'file', code: 'too_large', message: msg('portal.upload_size', { mb: MAX_UPLOAD / 1024 / 1024 }) }]);
  const f = await putFile(ctx, { kind: 'attachment', filename: file.filename, contentType: file.contentType, body: file.body });
  const as: Ctx = { ...ctx, actor: { type: 'customer', id: ids[0]! } };
  const a = await addAttachment(as, 'customer', ids[0]!, { file_id: f.id, label: label?.trim() || file.filename, kind: 'insurance', visibility: 'customer' });
  return { id: a.id, object: 'insurance_document', label: a.label, filename: a.filename, created_at: a.created_at };
}
