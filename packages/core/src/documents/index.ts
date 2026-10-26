import { t as msg } from '../i18n/index.ts';
import Handlebars from 'handlebars';
import QRCode from 'qrcode';
import type { Ctx } from '../context.ts';
import { hookContext } from '../plugins/scope.ts';
import { overridesFor } from '../strings/index.ts';
import { withStrings } from '../i18n/index.ts';
import { storefrontBase } from '../domains/index.ts';
import { AppError, invalid, notFound } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId, sha256 } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { resolveSettings } from '../tenancy/settings.ts';
import { BASE_CSS, DEFAULT_TEMPLATES, LEGAL_NUMBERED } from './templates.ts';
import { tAny } from '../i18n/index.ts';
import { invoiceDueAt } from '../customers/b2b.ts';
import { periodsText } from '../pricing/engine.ts';
import * as files from '../files/index.ts';

export type DocumentType = keyof typeof DEFAULT_TEMPLATES;
export const DOCUMENT_TYPES = Object.keys(DEFAULT_TEMPLATES) as DocumentType[];

export function makeHandlebars(currency: string, tz: string, locale: string) {
  const hb = Handlebars.create();
  hb.registerHelper('money', (v: unknown) => formatMoney(Number(v ?? 0), currency, locale));
  hb.registerHelper('date', (v: unknown) => (v ? formatDate(v as string, tz, locale) : ''));
  hb.registerHelper('datetime', (v: unknown) => (v ? formatDateTime(v as string, tz, locale) : ''));
  hb.registerHelper('percent', (bp: unknown) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(Number(bp ?? 0) / 10_000));
  // {{t "doc.total" name=value}}: core catalogue text in the render language; Handlebars escapes it.
  hb.registerHelper('t', (key: unknown, options: { hash?: Record<string, unknown> }) => tAny(String(key), Object.fromEntries(Object.entries(options?.hash ?? {}).map(([k, v]) => [k, typeof v === 'number' ? v : String(v ?? '')])), locale));
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  return hb;
}

export function documentToApi(d: any) {
  return {
    id: d.id, object: 'document', type: d.type, number: d.number, status: d.status, order_id: d.order_id, customer_id: d.customer_id,
    issued_at: d.issued_at, total: d.total == null ? null : { amount: Number(d.total), currency: d.currency?.trim() },
    voided_by_id: d.voided_by_id, template_id: d.template_id, due_at: d.data?.due_at ?? null,
    orders: d.data?.orders?.map((o: any) => ({ id: o.id, number: o.number })) ?? null, created_at: d.created_at,
  };
}

/** Frozen data snapshot rendered into a document (also stored as structured JSON, FR-DOC-3). */
export async function buildOrderData(ctx: Ctx, orderId: string) {
  const order = await must<any>(ctx, `SELECT * FROM orders WHERE id = $1`, [orderId], 'order', orderId);
  const tenant = await must<any>(ctx, `SELECT * FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const settings = resolveSettings(tenant.settings);
  const customer = order.customer_id ? await one(ctx, `SELECT * FROM customers WHERE id = $1`, [order.customer_id]) : null;
  const location = await one(ctx, `SELECT * FROM locations WHERE id = $1`, [order.location_id]);
  const lines = await many(
    ctx,
    `SELECT l.*, coalesce((SELECT array_agg(s.barcode || coalesce(' · ' || s.serial, '') || coalesce(' · ' || s.bin, '') ORDER BY s.bin NULLS LAST, s.barcode) FROM order_line_units u JOIN stock_items s ON s.id = u.stock_item_id WHERE u.order_line_id = l.id AND u.replaced_by_id IS NULL), '{}') AS units
       FROM order_lines l WHERE l.order_id = $1 AND l.parent_line_id IS NULL AND l.type <> 'discount' ORDER BY l.position, l.created_at`,
    [orderId],
  );
  const payments = await many(ctx, `SELECT * FROM payments WHERE order_id = $1 AND status = 'succeeded' ORDER BY created_at`, [orderId]);
  const deposit = await one(ctx, `SELECT * FROM deposits WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [orderId]);
  const addr = tenant.address ?? {};
  const orderUrl = `${await storefrontBase(ctx)}/order/${order.public_token}`;
  const qr_svg = await QRCode.toString(orderUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return {
    qr_svg,
    order_url: orderUrl,
    tenant: {
      name: tenant.name,
      legal_name: tenant.legal_name || tenant.name,
      address_lines: [addr.line1, addr.line2, [addr.postal_code, addr.city].filter(Boolean).join(' '), addr.country].filter(Boolean),
      // A branch registered on its own shows its tax ids instead of the shop's.
      tax_ids: location?.tax_ids?.length ? location.tax_ids : tenant.tax_ids ?? [],
      branding: tenant.branding ?? {},
      currency: tenant.currency.trim(),
      locale: tenant.locale,
    },
    order: {
      id: order.id, number: order.number, status: order.status, starts_at: order.starts_at, ends_at: order.ends_at,
      quote_expires_at: order.quote_expires_at, timezone: order.timezone, public_token: order.public_token, po_number: order.po_number ?? null,
    },
    customer: customer ? { name: customer.name, email: customer.email, phone: customer.phone, company_name: customer.company_name, tax_id: customer.tax_id, locale: customer.locale, addresses: customer.addresses, billing: customer.addresses?.billing ?? null } : { name: tAny('doc.walk_in', {}, tenant.locale) },
    location: location
      ? {
          name: location.name, address: location.address, phone: location.phone, email: location.email,
          address_lines: [location.address?.line1, location.address?.line2, [location.address?.postal_code, location.address?.city].filter(Boolean).join(' ')].filter(Boolean),
        }
      : null,
    lines: lines.map((l: any) => ({
      name: l.description,
      type: l.type,
      quantity: l.quantity,
      unit_price: Number(l.unit_price),
      discount: Number(l.discount),
      tax_rate_bp: l.price_snapshot?.tax_rate_bp ?? 0,
      tax: Number(l.tax),
      total: Number(l.total),
      // The label itself is written in the document's language at render time.
      period_label: l.price_snapshot?.period_label ?? null,
      charge_periods: l.price_snapshot?.charge_periods ?? null,
      period_unit: l.price_snapshot?.period_unit ?? null,
      units: l.units,
    })),
    totals: order.totals,
    tax_breakdown: order.totals?.tax_breakdown ?? [],
    payments: payments.map((p: any) => ({ amount: Number(p.amount), method: p.method, created_at: p.created_at })),
    deposit: deposit ? { amount: Number(deposit.amount), method: deposit.method, status: deposit.status } : null,
    terms: settings.terms,
    signature: order.terms_acceptance ?? null,
    pickup_signature: await pickupSignature(ctx, order.terms_acceptance?.pickup_signature),
  };
}

/** The signature taken at pickup, with a drawn signature inlined so the frozen document keeps it. */
async function pickupSignature(ctx: Ctx, sig: any) {
  if (!sig) return null;
  let image: string | null = null;
  if (sig.file_id) {
    const f = await files.findById(ctx, sig.file_id);
    if (f) image = `data:${f.content_type};base64,${(await files.readFile(ctx, f)).toString('base64')}`;
  }
  return { ...sig, image };
}

async function nextNumber(ctx: Ctx, type: DocumentType, orderNumber: number | null, prefix: string): Promise<string> {
  if (LEGAL_NUMBERED.has(type)) {
    // Gap-free sequence per tenant, type and year; the row lock serialises issuers (PRD §8.3).
    const year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'UTC' }).format(ctx.now));
    await exec(
      ctx,
      `INSERT INTO document_sequences (tenant_id, type, year, prefix, next_value) VALUES ($1, $2, $3, $4, 1) ON CONFLICT DO NOTHING`,
      [ctx.tenantId, type, year, prefix],
    );
    const seq = await must<{ next_value: number; prefix: string }>(
      ctx,
      `SELECT next_value, prefix FROM document_sequences WHERE tenant_id = $1 AND type = $2 AND year = $3 FOR UPDATE`,
      [ctx.tenantId, type, year],
      'document_sequence',
    );
    await exec(ctx, `UPDATE document_sequences SET next_value = next_value + 1 WHERE tenant_id = $1 AND type = $2 AND year = $3`, [ctx.tenantId, type, year]);
    return `${seq.prefix}-${year}-${String(seq.next_value).padStart(5, '0')}`;
  }
  const base = `${prefix}-${orderNumber ?? 0}`;
  const n = (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM documents WHERE type = $1 AND (number = $2 OR number LIKE $2 || '-%')`, [type, base]))?.n ?? 0;
  return n === 0 ? base : `${base}-${n + 1}`;
}

async function templateFor(ctx: Ctx, type: DocumentType, locale: string) {
  const t = await one(
    ctx,
    `SELECT * FROM document_templates WHERE type = $1 AND (locale = $2 OR locale = 'en') ORDER BY (locale = $2) DESC, is_default DESC, updated_at DESC LIMIT 1`,
    [type, locale],
  );
  if (t) return { id: t.id, version: t.version, body: t.body, css: t.css, title: t.name };
  const d = DEFAULT_TEMPLATES[type];
  if (!d) throw invalid(msg('error.unknown_document_type', { type }));
  return { id: null, version: 0, body: d.body, css: '', title: tAny(d.title, {}, locale) };
}

export function renderHtml(
  tpl: { body: string; css: string; title: string },
  data: Record<string, any>,
  fmt: { currency: string; tz: string; locale: string },
): string {
  const hb = makeHandlebars(fmt.currency, fmt.tz, fmt.locale);
  const lines = Array.isArray(data.lines)
    ? data.lines.map((l: any) => (l?.period_unit && l.charge_periods ? { ...l, period_label: periodsText(Number(l.charge_periods), l.period_unit, fmt.locale) } : l))
    : data.lines;
  const body = hb.compile(tpl.body, { noEscape: false, strict: false })({ ...data, lines });
  const brand = String(data.tenant?.branding?.primary_color ?? '#0891b2').replace(/[^#0-9a-zA-Z(),. %]/g, '');
  return `<!doctype html><html lang="${fmt.locale}"><head><meta charset="utf-8"><title>${tpl.title} ${data.document?.number ?? ''}</title>
<style>:root{--brand:${brand}}${BASE_CSS}${tpl.css}</style></head><body>${body}</body></html>`;
}

export interface IssueOptions {
  extra?: Record<string, unknown>;
  /** Override lines/totals (credit notes, damage invoices). */
  overrides?: Partial<{ lines: any[]; totals: any; tax_breakdown: any[] }>;
}

export async function issueDocument(ctx: Ctx, orderId: string, type: DocumentType, opts: IssueOptions = {}) {
  if (!DEFAULT_TEMPLATES[type]) throw invalid(msg('error.unknown_document_type', { type }));
  const data: Record<string, any> = { ...(await buildOrderData(ctx, orderId)), ...opts.overrides, ...opts.extra };
  // Plugins may add to the data a template sees (e.g. a loyalty balance) before it is rendered and frozen.
  await ctx.plugins.runHook('before', 'documents.render', { type, order_id: orderId, data }, hookContext(ctx));
  const order = await must<any>(ctx, `SELECT number, customer_id, currency, timezone FROM orders WHERE id = $1`, [orderId], 'order');
  if (type === 'invoice' && !order.customer_id) throw new AppError('customer_required', 422, msg('error.add_a_customer_before_issuing_an_invoice'));
  return saveIssued(ctx, type, data, { orderId, orderNumber: order.number, customerId: order.customer_id, currency: order.currency.trim(), timezone: order.timezone });
}

/** Numbers, renders and stores an issued document; invoices to customers on account get their due date. */
async function saveIssued(ctx: Ctx, type: DocumentType, data: Record<string, any>, at: { orderId: string | null; orderNumber: number | null; customerId: string | null; currency: string; timezone: string }) {
  const tenant = await must<any>(ctx, `SELECT settings, locale FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const settings = resolveSettings(tenant.settings);
  const locale = (data.customer?.locale as string) || tenant.locale || 'en';
  const tpl = await templateFor(ctx, type, locale);
  const number = await nextNumber(ctx, type, at.orderNumber, settings.document_prefixes[type] ?? type.toUpperCase().slice(0, 3));
  const due = type === 'invoice' ? await invoiceDueAt(ctx, at.customerId, ctx.now) : null;
  if (due) data.due_at = due;
  data.document = { type, title: tpl.title, number, number_label: tAny(LEGAL_NUMBERED.has(type) ? 'doc.number_label' : 'doc.ref_label', {}, locale), issued_at: ctx.now.toISOString(), due_at: due };
  const html = withStrings(locale, await overridesFor(ctx, 'documents', locale), () => renderHtml(tpl, data, { currency: at.currency, tz: at.timezone, locale }));
  const row = (
    await many(
      ctx,
      `INSERT INTO documents (id, tenant_id, order_id, customer_id, type, number, issued_at, status, html, data, total, currency, template_id, template_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'issued',$8,$9,$10,$11,$12,$13) RETURNING *`,
      [newId('doc'), ctx.tenantId, at.orderId, at.customerId, type, number, ctx.now, html, json({ ...data, html_sha256: sha256(html) }),
        data.totals?.total ?? null, at.currency, tpl.id, tpl.version],
    )
  )[0];
  await audit(ctx, { entity_type: 'document', entity_id: row.id, action: 'issue', extra: { type, number } });
  const api = documentToApi(row);
  await emit(ctx, 'document.issued', { type: 'document', id: row.id }, api);
  return api;
}

const TOTAL_KEYS = ['subtotal', 'discount', 'fees', 'tax', 'total', 'paid', 'refunded', 'balance'] as const;

/**
 * One invoice for several finished bookings of a customer invoiced monthly (FR-CUS-7). Each line names
 * its booking; totals and tax add up; every booking points at the invoice, so none is invoiced twice.
 */
export async function issueConsolidatedInvoice(ctx: Ctx, customerId: string, orderIds: string[], period: { from: string; to: string }) {
  const orders = await many<any>(
    ctx,
    `SELECT id, number, po_number, currency, timezone, totals FROM orders WHERE id = ANY($1) AND customer_id = $2 AND invoice_id IS NULL ORDER BY starts_at, number FOR UPDATE`,
    [orderIds, customerId],
  );
  if (!orders.length || orders.length !== new Set(orderIds).size) throw new AppError('already_invoiced', 409, msg('error.bookings_already_invoiced'));
  const currency = orders[0].currency.trim();
  if (orders.some((o) => o.currency.trim() !== currency)) throw invalid(msg('error.one_currency_per_invoice'));
  const base = await buildOrderData(ctx, orders[0].id);
  const lines: any[] = [];
  const payments: any[] = [];
  for (const o of orders) {
    const d = o.id === orders[0].id ? base : await buildOrderData(ctx, o.id);
    lines.push(...d.lines.map((l: any) => ({ ...l, name: `#${o.number} · ${l.name}` })));
    payments.push(...d.payments);
  }
  const totals: Record<string, number> = { deposit: 0 };
  for (const k of TOTAL_KEYS) totals[k] = orders.reduce((s, o) => s + Number(o.totals?.[k] ?? 0), 0);
  const rates = new Map<number, { rate_bp: number; net: number; tax: number }>();
  for (const o of orders) {
    for (const x of o.totals?.tax_breakdown ?? []) {
      const r = rates.get(x.rate_bp) ?? { rate_bp: x.rate_bp, net: 0, tax: 0 };
      rates.set(x.rate_bp, { ...r, net: r.net + Number(x.net), tax: r.tax + Number(x.tax) });
    }
  }
  const data: Record<string, any> = {
    ...base, lines, payments, deposit: null, qr_svg: null, order_url: null,
    totals: { ...totals, tax_breakdown: [...rates.values()] }, tax_breakdown: [...rates.values()],
    orders: orders.map((o) => ({ id: o.id, number: o.number, po_number: o.po_number ?? null })),
    order: { ...base.order, id: null, number: null, status: null, public_token: null, po_number: null, starts_at: period.from, ends_at: period.to },
  };
  await ctx.plugins.runHook('before', 'documents.render', { type: 'invoice', order_id: null, data }, hookContext(ctx));
  const doc = await saveIssued(ctx, 'invoice', data, { orderId: null, orderNumber: null, customerId, currency, timezone: orders[0].timezone });
  await exec(ctx, `UPDATE orders SET invoice_id = $2 WHERE id = ANY($1)`, [orders.map((o) => o.id), doc.id]);
  return doc;
}

export async function getDocument(ctx: Ctx, id: string) {
  return must(ctx, `SELECT * FROM documents WHERE id = $1`, [id], 'document', id);
}

export async function listDocuments(ctx: Ctx, filter: { order_id?: string; type?: string; limit?: number } = {}) {
  const rows = await many(
    ctx,
    `SELECT * FROM documents WHERE ($1::text IS NULL OR order_id = $1) AND ($2::text IS NULL OR type = $2) ORDER BY created_at DESC LIMIT $3`,
    [filter.order_id ?? null, filter.type ?? null, Math.min(filter.limit ?? 100, 200)],
  );
  return rows.map(documentToApi);
}

/** Voiding an invoice issues a credit note mirroring it (FR-DOC-3: the invoice itself never changes). */
export async function voidDocument(ctx: Ctx, id: string, reason?: string) {
  const doc = await getDocument(ctx, id);
  if (doc.status === 'voided') throw new AppError('already_voided', 409, msg('error.this_document_is_already_voided'));
  let creditNote: any = null;
  if (doc.type === 'invoice') {
    const d = doc.data;
    creditNote = await issueDocument(ctx, doc.order_id, 'credit_note', {
      overrides: { lines: d.lines, totals: d.totals, tax_breakdown: d.tax_breakdown },
      extra: { credit_for: { id: doc.id, number: doc.number }, reason: reason ?? null },
    });
  }
  await exec(ctx, `UPDATE documents SET status = 'voided', voided_by_id = $2 WHERE id = $1`, [id, creditNote?.id ?? null]);
  await emit(ctx, 'document.voided', { type: 'document', id }, { ...documentToApi(doc), status: 'voided' });
  return { document: documentToApi({ ...doc, status: 'voided', voided_by_id: creditNote?.id ?? null }), credit_note: creditNote };
}

export async function markSent(ctx: Ctx, id: string) {
  const doc = await getDocument(ctx, id);
  if (doc.status === 'issued') await exec(ctx, `UPDATE documents SET status = 'sent' WHERE id = $1`, [id]);
  await emit(ctx, 'document.sent', { type: 'document', id }, { ...documentToApi(doc), status: 'sent' });
}

// --- templates -------------------------------------------------------------

export function templateToApi(t: any) {
  return { id: t.id, object: 'document_template', type: t.type, name: t.name, locale: t.locale, body: t.body, css: t.css, version: t.version, is_default: t.is_default, updated_at: t.updated_at };
}

/**
 * Templates in use. With `locale`, one per document type: the shop's own for that language, else the
 * built-in one (named in that language). Without, every shop template and every built-in one.
 */
export async function listTemplates(ctx: Ctx, locale?: string) {
  // Older rows stored the title key as their name.
  const custom = (await many(ctx, `SELECT * FROM document_templates ORDER BY type, locale`)).map((r) => templateToApi({ ...r, name: r.name?.startsWith('doc.title.') ? tAny(r.name, {}, r.locale) : r.name }));
  const builtin = (type: DocumentType, l: string) => ({
    id: `builtin:${type}`, object: 'document_template', type, name: tAny(DEFAULT_TEMPLATES[type]!.title, {}, l), locale: l, body: DEFAULT_TEMPLATES[type]!.body, css: '', version: 0,
    is_default: !custom.some((c) => c.type === type), builtin: true,
  });
  if (locale) return DOCUMENT_TYPES.map((type) => custom.find((c) => c.type === type && c.locale === locale) ?? builtin(type, locale));
  return [...custom, ...DOCUMENT_TYPES.map((type) => builtin(type, 'en'))];
}

/**
 * The PDF of an issued document. Issued documents never change, so it is rendered once and stored;
 * null when it was never rendered and this process has no renderer.
 */
export async function documentPdf(ctx: Ctx, doc: { id: string; type: string; number: string | null; html: string }, render = ctx.config.renderPdf): Promise<{ filename: string; body: Buffer } | null> {
  const existing = await files.findFile(ctx, 'document', doc.id, 'pdf');
  if (existing) return { filename: existing.filename, body: await files.readFile(ctx, existing) };
  if (!render) return null;
  const body = await render(doc.html);
  const filename = `${doc.type}-${(doc.number ?? doc.id).replace(/[^\w.-]+/g, '-')}.pdf`;
  await files.putFile(ctx, { kind: 'pdf', ownerType: 'document', ownerId: doc.id, filename, contentType: 'application/pdf', body });
  return { filename, body };
}

/** One template by id: the shop's own, or `builtin:<type>` for the built-in one in English. */
export async function getTemplate(ctx: Ctx, id: string) {
  const tpl = (await listTemplates(ctx)).find((t) => t.id === id);
  if (!tpl) throw notFound('document_template', id);
  return tpl;
}

/** Changes a template by id. Changing a built-in one creates the shop's own for that type and language. */
export async function updateTemplate(ctx: Ctx, id: string, input: { name?: string; locale?: string; body?: string; css?: string }) {
  const tpl = await getTemplate(ctx, id);
  return upsertTemplate(ctx, { type: tpl.type, name: input.name, locale: id.startsWith('builtin:') ? (input.locale ?? tpl.locale) : tpl.locale, body: input.body ?? tpl.body, css: input.css ?? tpl.css });
}

/** Goes back to the built-in template for this type and language (FR-DOC-2). Issued documents keep their HTML. */
export async function resetTemplate(ctx: Ctx, id: string) {
  const row = await must<any>(ctx, `SELECT * FROM document_templates WHERE id = $1`, [id], 'document_template', id);
  await exec(ctx, `DELETE FROM document_templates WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'document_template', entity_id: id, action: 'delete', before: row });
}

/** The data a document template can use, for the editor's help panel. */
export const TEMPLATE_VARIABLES = {
  values: [
    'tenant.name', 'tenant.legal_name', 'tenant.address_lines', 'tenant.tax_ids', 'tenant.branding.logo_url',
    'document.title', 'document.number', 'document.number_label', 'document.issued_at',
    'order.number', 'order.starts_at', 'order.ends_at', 'order.quote_expires_at', 'location.name', 'location.address_lines', 'location.phone', 'location.email',
    'customer.name', 'customer.company_name', 'customer.email', 'customer.phone', 'customer.tax_id', 'customer.billing.line1', 'customer.billing.city',
    'lines[].name', 'lines[].quantity', 'lines[].unit_price', 'lines[].discount', 'lines[].tax_rate_bp', 'lines[].total', 'lines[].period_label', 'lines[].units',
    'totals.subtotal', 'totals.discount', 'totals.fees', 'totals.total', 'totals.paid', 'totals.balance', 'totals.deposit',
    'tax_breakdown[].rate_bp', 'tax_breakdown[].tax', 'payments[].amount', 'payments[].method', 'payments[].created_at', 'deposit.amount', 'terms.text', 'qr_svg', 'signature.name', 'signature.signed_at',
  ],
  helpers: ['{{money totals.total}}', '{{date order.starts_at}}', '{{datetime order.starts_at}}', '{{percent this.tax_rate_bp}}', '{{t "doc.total"}}', '{{#each lines}}…{{/each}}', '{{#if totals.paid}}…{{/if}}'],
};

export async function upsertTemplate(ctx: Ctx, input: { type: DocumentType; name?: string; locale?: string; body: string; css?: string }) {
  try {
    Handlebars.precompile(input.body);
  } catch (err) {
    const m = msg('error.template_does_not_compile', { message: (err as Error).message });
    throw invalid(m, [{ field: 'body', code: 'template_syntax', message: m }]);
  }
  const locale = input.locale ?? 'en';
  const existing = await one(ctx, `SELECT * FROM document_templates WHERE type = $1 AND locale = $2`, [input.type, locale]);
  let row;
  if (existing) {
    row = (await many(ctx, `UPDATE document_templates SET body = $2, css = $3, name = coalesce($4, name), version = version + 1 WHERE id = $1 RETURNING *`, [existing.id, input.body, input.css ?? '', input.name ?? null]))[0];
  } else {
    row = (
      await many(ctx, `INSERT INTO document_templates (id, tenant_id, type, name, locale, body, css, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`, [
        newId('dtp'), ctx.tenantId, input.type, input.name ?? (DEFAULT_TEMPLATES[input.type] ? tAny(DEFAULT_TEMPLATES[input.type]!.title, {}, locale) : input.type), locale, input.body, input.css ?? '',
      ])
    )[0];
  }
  await audit(ctx, { entity_type: 'document_template', entity_id: row.id, action: existing ? 'update' : 'create', before: existing, after: row });
  return templateToApi(row);
}

/** Renders a template (the stored one, or `body` while editing) against a real order, in `locale`. */
export async function previewTemplate(ctx: Ctx, input: { type: DocumentType; body?: string; css?: string; order_id?: string; locale?: string }) {
  const tenant = await must<any>(ctx, `SELECT * FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  if (!DEFAULT_TEMPLATES[input.type]) throw invalid(msg('error.unknown_document_type', { type: input.type }), [{ field: 'type', code: 'invalid', message: msg('error.unknown_document_type', { type: input.type }) }]);
  const orderId = input.order_id ?? (await one(ctx, `SELECT id FROM orders ORDER BY created_at DESC LIMIT 1`))?.id;
  if (!orderId) throw new AppError('no_orders', 409, msg('error.create_an_order_to_preview_templates_with'));
  const locale = input.locale || tenant.locale;
  const data: Record<string, any> = await buildOrderData(ctx, orderId);
  const tpl = input.body !== undefined ? { body: input.body, css: input.css ?? '', title: tAny(DEFAULT_TEMPLATES[input.type]!.title, {}, locale) } : await templateFor(ctx, input.type, locale);
  data.document = { type: input.type, title: tpl.title, number: 'PREVIEW', number_label: tAny(LEGAL_NUMBERED.has(input.type) ? 'doc.number_label' : 'doc.ref_label', {}, locale), issued_at: ctx.now.toISOString() };
  try {
    return withStrings(locale, await overridesFor(ctx, 'documents', locale), () => renderHtml(tpl, data, { currency: tenant.currency.trim(), tz: tenant.timezone, locale }));
  } catch (err) {
    // Syntax errors and unknown helpers belong next to the template text.
    const m = msg('error.template_does_not_compile', { message: (err as Error).message });
    throw invalid(m, [{ field: 'body', code: 'template_syntax', message: m }]);
  }
}
