import type { EInvoiceData, EInvoiceFormat, EInvoiceLine } from '@openrent/plugin-sdk';
import { t as msg, type MessageKey } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { AppError } from '../errors.ts';
import { must, one } from '../sql.ts';
import { pluginConfig } from '../plugins/index.ts';
import * as files from '../files/index.ts';
import { documentPdf, getDocument } from './index.ts';

/**
 * E-invoices (FR-DOC-6): an issued invoice or credit note in a format a plugin offers (Peppol UBL,
 * Factur-X, e-arve), for customers whose billing details ask for it. The file is made once from the
 * document's frozen data and kept with it, like its PDF.
 */

/** The formats the shop can use now: their plugin is on and set up. */
export async function einvoiceFormats(ctx: Ctx, locale?: string | null) {
  const out = [];
  for (const { pluginId, format } of ctx.plugins.einvoiceFormats?.() ?? []) {
    const { enabled, config } = await pluginConfig(ctx, pluginId);
    if (!enabled || !format.isConfigured({ tenantId: ctx.tenantId, config, logger: ctx.logger })) continue;
    const name = (locale && format.name[locale]) || format.name.en || format.id;
    out.push({ id: format.id, object: 'einvoice_format', name, endpoint: format.endpoint, plugin_id: pluginId });
  }
  return out;
}

/** One usable format with what its plugin needs to render, or null. */
export async function einvoiceFormat(ctx: Ctx, id: string): Promise<(EInvoiceFormat & { pluginId: string; config: Record<string, unknown> }) | null> {
  const hit = (ctx.plugins.einvoiceFormats?.() ?? []).find((x) => x.format.id === id);
  if (!hit) return null;
  const { enabled, config } = await pluginConfig(ctx, hit.pluginId);
  if (!enabled || !hit.format.isConfigured({ tenantId: ctx.tenantId, config, logger: ctx.logger })) return null;
  return Object.assign(Object.create(hit.format), { pluginId: hit.pluginId, config });
}

const day = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** `0191:10002345` → its parts. */
function endpoint(v: string | null | undefined) {
  const m = /^(\d{4}):(\S+)$/.exec(String(v ?? '').trim());
  return m ? { scheme: m[1]!, id: m[2]! } : null;
}

/**
 * The document in neutral form. Lines are as printed; where discounts on the whole booking make the
 * printed lines differ from the tax breakdown, a line per tax rate makes up the difference, so lines,
 * categories and totals add up as EN 16931 requires.
 */
export async function einvoiceData(ctx: Ctx, doc: any): Promise<EInvoiceData> {
  const d = doc.data ?? {};
  const tenant = await must<any>(ctx, `SELECT * FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const tz = d.order?.timezone ?? tenant.timezone ?? 'UTC';
  const locale = d.customer?.locale || tenant.locale || 'en';
  const reverse = !!d.totals?.tax_note;
  const category = (rateBp: number): EInvoiceLine['taxCategory'] => (rateBp > 0 ? 'S' : reverse ? 'AE' : 'Z');
  const lines: EInvoiceLine[] = (d.lines ?? []).map((l: any, i: number) => {
    const quantity = Math.max(1, Number(l.quantity ?? 1));
    const net = Number(l.total ?? 0) - Number(l.tax ?? 0);
    return {
      id: String(i + 1), name: String(l.name ?? ''), quantity, unitCode: 'C62', netAmount: net, unitPrice: Math.round(net / quantity), taxAmount: Number(l.tax ?? 0),
      taxRateBp: Number(l.tax_rate_bp ?? 0), taxCategory: category(Number(l.tax_rate_bp ?? 0)),
    };
  });
  const breakdown = ((d.tax_breakdown ?? d.totals?.tax_breakdown ?? []) as { rate_bp: number; net: number; tax: number }[]).map((b) => ({
    category: category(Number(b.rate_bp)), rateBp: Number(b.rate_bp), taxable: Number(b.net), tax: Number(b.tax),
  }));
  for (const b of breakdown) {
    const own = lines.filter((l) => l.taxRateBp === b.rateBp);
    const net = b.taxable - own.reduce((n, l) => n + l.netAmount, 0);
    const tax = b.tax - own.reduce((n, l) => n + l.taxAmount, 0);
    if (net || tax) lines.push({ id: String(lines.length + 1), name: msg('doc.discount', {}, locale), quantity: net < 0 ? -1 : 1, unitCode: 'C62', netAmount: net, unitPrice: Math.abs(net), taxAmount: tax, taxRateBp: b.rateBp, taxCategory: b.category });
  }
  const lineNet = lines.reduce((n, l) => n + l.netAmount, 0);
  const tax = breakdown.reduce((n, b) => n + b.tax, 0);
  const credit = doc.type === 'credit_note';
  const prepaid = credit ? 0 : Math.max(0, Math.min(lineNet + tax, Number(d.totals?.paid ?? 0)));
  const preceding = d.credit_for?.id ? await one<any>(ctx, `SELECT number, issued_at FROM documents WHERE id = $1`, [d.credit_for.id]) : null;
  const addr = d.tenant?.address ?? tenant.address ?? {};
  const billing = d.customer?.billing ?? {};
  const buyerEndpoint = endpoint(d.einvoice?.endpoint);
  const vat = (d.tenant?.tax_ids ?? tenant.tax_ids ?? []).find((x: any) => String(x.type ?? 'VAT').toUpperCase() === 'VAT')?.value ?? null;
  return {
    type: credit ? 'credit_note' : 'invoice',
    number: doc.number,
    issueDate: day(doc.issued_at, tz),
    dueDate: credit ? null : (d.due_at ?? d.document?.due_at) ? day(d.due_at ?? d.document.due_at, tz) : null,
    currency: String(doc.currency).trim(),
    buyerReference: d.order?.po_number || (d.order?.number ? `#${d.order.number}` : doc.number),
    orderReference: d.order?.number ? `#${d.order.number}` : null,
    precedingInvoice: preceding ? { number: preceding.number, issueDate: day(preceding.issued_at, tz) } : null,
    period: d.order?.starts_at && d.order?.ends_at ? { start: day(d.order.starts_at, tz), end: day(d.order.ends_at, tz) } : null,
    note: d.totals?.tax_note ? (d.totals.tax_note[locale] ?? d.totals.tax_note.en ?? Object.values(d.totals.tax_note)[0] ?? null) : null,
    paymentTerms: null,
    seller: {
      name: d.tenant?.name ?? tenant.name, legalName: d.tenant?.legal_name ?? tenant.legal_name ?? tenant.name, companyId: d.tenant?.registry_code ?? null, vatId: vat,
      address: { lines: [addr.line1, addr.line2].filter(Boolean), city: addr.city ?? null, postalCode: addr.postal_code ?? null, country: addr.country ?? null },
    },
    buyer: {
      name: d.customer?.name ?? '', legalName: d.customer?.company_name || d.customer?.name || '', companyId: buyerEndpoint?.scheme === '0191' ? buyerEndpoint.id : null, vatId: d.customer?.tax_id ?? null,
      address: { lines: [billing.line1, billing.line2].filter(Boolean), city: billing.city ?? null, postalCode: billing.postal_code ?? null, country: billing.country ?? null },
      endpoint: buyerEndpoint, email: d.customer?.email ?? null, phone: d.customer?.phone ?? null,
    },
    lines,
    taxBreakdown: breakdown,
    totals: { lineNet, taxExclusive: lineNet, tax, taxInclusive: lineNet + tax, prepaid, payable: lineNet + tax - prepaid },
    payment: d.tenant?.bank ? { iban: d.tenant.bank.iban, bic: d.tenant.bank.bic, reference: doc.number } : null,
  };
}

const MISSING: Record<string, MessageKey> = {
  'seller.endpoint': 'einvoice.missing.seller_endpoint',
  'buyer.endpoint': 'einvoice.missing.buyer_endpoint',
  buyerReference: 'einvoice.missing.reference',
  'seller.companyId': 'einvoice.missing.registry_code',
  'payment.iban': 'einvoice.missing.iban',
  'seller.vatId': 'einvoice.missing.seller_vat',
  'buyer.vatId': 'einvoice.missing.buyer_vat',
  'seller.address.country': 'einvoice.missing.seller_country',
  'buyer.address.country': 'einvoice.missing.buyer_country',
  currency: 'einvoice.missing.currency',
  pdf: 'einvoice.missing.pdf',
};

/** The e-invoice of an issued invoice or credit note, made once and kept with it. */
export async function einvoiceFile(ctx: Ctx, documentId: string): Promise<{ filename: string; contentType: string; content: Buffer; format: string }> {
  const doc = await getDocument(ctx, documentId);
  const wanted = doc.data?.einvoice?.format as string | undefined;
  if (!['invoice', 'credit_note'].includes(doc.type) || !wanted) throw new AppError('no_einvoice', 404, msg('einvoice.none'));
  const kept = await files.findFile(ctx, 'document', doc.id, 'einvoice');
  if (kept) return { filename: kept.filename, contentType: kept.content_type, content: await files.readFile(ctx, kept), format: wanted };
  const format = await einvoiceFormat(ctx, wanted);
  if (!format) throw new AppError('einvoice_unavailable', 409, msg('einvoice.unavailable'));
  const data = await einvoiceData(ctx, doc);
  const r = await format.render({ tenantId: ctx.tenantId, config: format.config, logger: ctx.logger }, data, { pdf: async () => (await documentPdf(ctx, doc))?.body ?? null });
  if ('missing' in r) {
    const reasons = r.missing.map((m) => (MISSING[m] ? msg(MISSING[m]!) : m));
    throw new AppError('einvoice_incomplete', 422, msg('einvoice.incomplete', { reasons: reasons.join('; ') }), { extra: { missing: r.missing } });
  }
  const content = typeof r.content === 'string' ? Buffer.from(r.content, 'utf8') : Buffer.from(r.content);
  await files.putFile(ctx, { kind: 'einvoice', ownerType: 'document', ownerId: doc.id, filename: r.filename, contentType: r.contentType, body: content });
  return { filename: r.filename, contentType: r.contentType, content, format: wanted };
}
