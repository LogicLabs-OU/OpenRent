import {
  definePlugin, mapped, RetryLater, type AccountingEntry, type AccountingInvoice, type IntegrationContext, type IntegrationProvider, type IntegrationResult, type MappingSlot,
} from '@openrent/plugin-sdk';

/**
 * Zoho Books (FR-INT-3, ADR 0009). Each OpenRent accounting entry goes to the organisation the shop
 * chose, in the shop's Zoho data centre:
 * - invoices and credit notes with OpenRent's numbers, accounts and taxes from the mapping; Zoho works
 *   out tax per line itself, so any rounding difference to OpenRent's total goes in the invoice's
 *   adjustment and the totals match; invoices are marked sent; credit notes are applied to their invoice;
 * - payments go to the mapped bank or cash account and are applied to the invoice, or wait as excess
 *   payments until the invoice arrives, then are applied;
 * - refunds come out of the credit note, or are booked as a journal; deposits and damage kept from them
 *   become journals;
 * - reversals void the invoice or delete what the reversed entry created.
 */
const DATA_CENTRES = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa', 'com.cn'];
const MONEY = ['cash', 'bank', 'card_clearing'];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const digits = (currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
/** Minor units to the currency's decimal amount (2 digits, or 0 for currencies like JPY). */
export const major = (n: number, currency: string) => Number((n / 10 ** digits(currency)).toFixed(digits(currency)));
export const minor = (n: number, currency: string) => Math.round(Number(n) * 10 ** digits(currency));
const round2 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100;

const dc = (ctx: IntegrationContext) => str(ctx.config.data_center) ?? 'com';
const apiBase = (ctx: IntegrationContext) => str(ctx.config.api_base_url) ?? `https://www.zohoapis.${dc(ctx)}/books/v3`;

async function call(ctx: IntegrationContext, method: string, path: string, body?: unknown, organisation = String(ctx.connection.account.organization_id ?? '')) {
  const url = new URL(`${apiBase(ctx)}${path}`);
  if (organisation) url.searchParams.set('organization_id', organisation);
  const res = await ctx.fetch(url.href, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 429) throw new RetryLater('Zoho Books asked to slow down', (Number(res.headers?.get('retry-after')) || 60) * 1000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data?.code === 'number' && data.code !== 0)) throw new Error(`Zoho Books: ${data?.message ?? `HTTP ${res.status}`}`);
  return data;
}

function need(ctx: IntegrationContext, slot: string, fallback?: string) {
  const id = mapped(ctx, slot) ?? (fallback ? mapped(ctx, fallback) : null);
  if (!id) throw new Error(`Map "${slot}" on the Accounting page first`);
  return id;
}
const revenueSlot = (kind: string) =>
  kind === 'rental' ? 'accounts.revenue_rental' : kind === 'sale' ? 'accounts.revenue_sale' : ['fee', 'late_fee', 'service'].includes(kind) ? 'accounts.revenue_fees' : kind === 'damage' ? 'accounts.revenue_damage' : kind === 'discount' ? 'accounts.discounts' : 'accounts.revenue_other';
const accountFor = (ctx: IntegrationContext, key: string) =>
  MONEY.includes(key) ? need(ctx, `payment_accounts.${key}`, 'payment_accounts.bank') : key === 'receivable' ? need(ctx, 'accounts.receivable') : key === 'deposits' ? need(ctx, 'accounts.deposits') : need(ctx, 'accounts.revenue_damage', 'accounts.revenue_other');

/** The contact for an OpenRent customer, found by email or created once. */
async function contactId(ctx: IntegrationContext, customerId: string | null) {
  const key = customerId ?? 'walk-in';
  const known = await ctx.links.get('customer', key);
  if (known) return known.remoteId;
  const c = customerId ? await ctx.data.contact(customerId) : null;
  let id: string | undefined;
  if (c?.email) id = (await call(ctx, 'GET', `/contacts?email=${encodeURIComponent(c.email)}`))?.contacts?.[0]?.contact_id;
  if (!id) {
    const name = c ? c.company_name || c.name : 'OpenRent customers';
    const [first, ...rest] = (c?.name ?? name).trim().split(/\s+/);
    const body = (contactName: string) => ({
      contact_name: contactName, company_name: c?.company_name ?? undefined, contact_type: 'customer',
      billing_address: c?.address ? { address: c.address.line1, street2: c.address.line2, city: c.address.city, zip: c.address.postal_code, country: c.address.country } : undefined,
      contact_persons: c ? [{ first_name: first, last_name: rest.join(' ') || undefined, email: c.email ?? undefined, phone: c.phone ?? undefined, is_primary_contact: true }] : undefined,
    });
    // Contact names are unique in Zoho Books: a namesake gets her email added.
    const created = await call(ctx, 'POST', '/contacts', body(name)).catch(async (e: Error) => {
      if (c?.email && /already exists/i.test(e.message)) return call(ctx, 'POST', '/contacts', body(`${name} (${c.email})`));
      throw e;
    });
    id = created?.contact?.contact_id;
  }
  if (!id) throw new Error('Zoho Books did not return a contact');
  await ctx.links.set('customer', key, String(id));
  return String(id);
}

/** Lines as Zoho wants them, and the adjustment that makes Zoho's per-line tax add up to OpenRent's total. */
export function zohoLines(ctx: IntegrationContext, inv: AccountingInvoice) {
  let zohoTotal = 0;
  const items = inv.lines.map((l) => {
    const tax = mapped(ctx, `taxes.${l.tax_rate_bp}`);
    if (!tax) throw new Error(`Map the ${l.tax_rate_bp / 100} % tax rate on the Accounting page first`);
    const rate = round2(major(l.net_amount, inv.currency) / l.quantity);
    const amount = round2(l.quantity * rate);
    // The mapped Zoho tax has the same rate (checked when the mapping is saved).
    zohoTotal = round2(zohoTotal + amount + round2((amount * (l.tax_rate_bp / 100)) / 100));
    return {
      name: l.description.slice(0, 100), description: l.description.length > 100 ? l.description : undefined, quantity: l.quantity, rate,
      account_id: need(ctx, revenueSlot(l.kind), 'accounts.revenue_other'), tax_id: tax,
    };
  });
  return { items, adjustment: round2(major(inv.total, inv.currency) - zohoTotal) };
}

async function sendDocument(ctx: IntegrationContext, documentId: string): Promise<IntegrationResult> {
  const inv = await ctx.data.accounting.invoice(documentId);
  if (!inv) return { status: 'skipped', message: 'Not an invoice or credit note with a customer' };
  if (await ctx.links.get('document', inv.id)) return { status: 'skipped', message: `${inv.number} is already in Zoho Books` };
  const customer = await contactId(ctx, inv.contact.id);
  const { items, adjustment } = zohoLines(ctx, inv);
  const common = {
    customer_id: customer, date: inv.issued_at.slice(0, 10), reference_number: inv.order_number ? `#${inv.order_number}` : undefined, is_inclusive_tax: false, line_items: items,
    adjustment: adjustment || undefined, adjustment_description: adjustment ? 'Rounding (OpenRent)' : undefined,
  };
  const asDraft = str(ctx.connection.settings.invoice_status) === 'draft';
  const isInv = inv.type === 'invoice';
  const r = isInv
    ? await call(ctx, 'POST', '/invoices?ignore_auto_number_generation=true', { ...common, invoice_number: inv.number, due_date: (inv.due_at ?? inv.issued_at).slice(0, 10) })
    : await call(ctx, 'POST', '/creditnotes?ignore_auto_number_generation=true', { ...common, creditnote_number: inv.number });
  const doc = isInv ? r?.invoice : r?.creditnote;
  const id = isInv ? doc?.invoice_id : doc?.creditnote_id;
  if (!id) throw new Error(`Zoho Books did not return the ${isInv ? 'invoice' : 'credit note'}`);
  const total = minor(doc.total, inv.currency);
  await ctx.links.set('document', inv.id, String(id), { kind: inv.type, customer, remote_number: inv.number, remote_total: total, mismatch: total !== inv.total });
  if (isInv) {
    if (!asDraft) {
      await call(ctx, 'POST', `/invoices/${id}/status/sent`);
      await applyEarlierPayments(ctx, inv, String(id));
    }
  } else if (inv.credit_for) {
    const original = await ctx.links.get('document', inv.credit_for.id);
    await ctx.links.set('credit_for', inv.credit_for.id, String(id), { customer });
    if (original) {
      const due = minor((await call(ctx, 'GET', `/invoices/${original.remoteId}`))?.invoice?.balance ?? 0, inv.currency);
      const amount = Math.min(due, inv.total);
      if (amount > 0) await call(ctx, 'POST', `/creditnotes/${id}/invoices`, { invoices: [{ invoice_id: original.remoteId, amount_applied: major(amount, inv.currency) }] });
    }
  }
  return { status: 'done', message: `${isInv ? 'Invoice' : 'Credit note'} ${inv.number} sent to Zoho Books` };
}

/** Excess payments that reached Zoho before this invoice are applied to it now. */
async function applyEarlierPayments(ctx: IntegrationContext, inv: AccountingInvoice, invoiceId: string) {
  let due = inv.total;
  const apply = [];
  for (const p of inv.order_payments) {
    if (due <= 0) break;
    const link = await ctx.links.get('payment', p.id);
    const left = Number(link?.extra.unapplied ?? 0);
    if (!link || left <= 0) continue;
    const amount = Math.min(left, due);
    apply.push({ payment_id: link.remoteId, amount_applied: major(amount, inv.currency) });
    await ctx.links.set('payment', p.id, link.remoteId, { ...link.extra, unapplied: left - amount });
    due -= amount;
  }
  if (apply.length) await call(ctx, 'POST', `/invoices/${invoiceId}/credits`, { invoice_payments: apply });
}

async function journal(ctx: IntegrationContext, e: AccountingEntry, customer: string | null) {
  const r = await call(ctx, 'POST', '/journals', {
    journal_date: e.date, reference_number: `OR-${e.number}`, notes: `OpenRent ${e.number} ${e.reference}`,
    line_items: e.lines.map((l) => ({
      account_id: accountFor(ctx, l.account_key), debit_or_credit: l.debit ? 'debit' : 'credit', amount: major(l.debit || l.credit, e.currency), description: l.description,
      customer_id: l.account_key === 'receivable' ? customer ?? undefined : undefined,
    })),
  });
  return String(r?.journal?.journal_id);
}

async function sendPayment(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  const p = await ctx.data.accounting.payment(e.source.id);
  if (!p) return { status: 'skipped', message: 'Not a completed payment' };
  if (await ctx.links.get('payment', p.id)) return { status: 'skipped', message: 'Already in Zoho Books' };
  const customer = await contactId(ctx, e.contact?.id ?? null);
  const money = e.lines.find((l) => MONEY.includes(l.account_key))!;
  if (p.kind === 'refund') {
    const credit = p.invoice_id ? await ctx.links.get('credit_for', p.invoice_id) : null;
    if (credit) {
      const r = await call(ctx, 'POST', `/creditnotes/${credit.remoteId}/refunds`, {
        date: p.paid_at.slice(0, 10), refund_mode: p.method === 'cash' ? 'cash' : 'creditcard', amount: major(p.amount, p.currency), from_account_id: accountFor(ctx, money.account_key),
      });
      await ctx.links.set('payment', p.id, String(r?.creditnote_refund?.creditnote_refund_id ?? 'refund'), { kind: 'refund' });
      return { status: 'done', message: 'Refund paid from the credit note in Zoho Books' };
    }
    const j = await journal(ctx, e, customer);
    await ctx.links.set('payment', p.id, j, { kind: 'journal', remote_total: p.amount });
    return { status: 'done', message: 'Refund booked in Zoho Books as a journal' };
  }
  const invoice = p.invoice_id ? await ctx.links.get('document', p.invoice_id) : null;
  if (p.invoice_id && !invoice) throw new RetryLater('The invoice is not in Zoho Books yet', 120_000);
  let due = 0;
  if (invoice) {
    const remote = (await call(ctx, 'GET', `/invoices/${invoice.remoteId}`))?.invoice;
    // Payments wait while the invoice is a draft (the shop chose to approve invoices in Zoho).
    if (remote?.status === 'draft') throw new RetryLater('The invoice is still a draft in Zoho Books', 3600_000);
    due = minor(remote?.balance ?? 0, p.currency);
  }
  const applied = Math.min(due, p.amount);
  const r = await call(ctx, 'POST', '/customerpayments', {
    customer_id: customer, payment_mode: p.method === 'cash' ? 'cash' : p.method === 'bank_transfer' ? 'banktransfer' : 'creditcard', amount: major(p.amount, p.currency), date: p.paid_at.slice(0, 10),
    reference_number: p.order_number ? `#${p.order_number}` : p.id, account_id: accountFor(ctx, money.account_key),
    invoices: applied > 0 ? [{ invoice_id: invoice!.remoteId, amount_applied: major(applied, p.currency) }] : [],
  });
  const id = r?.payment?.payment_id;
  if (!id) throw new Error('Zoho Books did not return a payment');
  await ctx.links.set('payment', p.id, String(id), { kind: 'payment', unapplied: p.amount - applied, remote_total: p.amount });
  return { status: 'done', message: applied === p.amount ? 'Payment applied in Zoho Books' : applied ? 'Payment applied in Zoho Books; the rest is held as excess' : 'Payment recorded in Zoho Books as excess until the invoice arrives' };
}

async function sendOther(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  if (await ctx.links.get('entry', e.id)) return { status: 'skipped', message: 'Already in Zoho Books' };
  if (e.kind.startsWith('deposit_') && ctx.connection.settings.send_deposits === false) return { status: 'skipped', message: 'Deposits are not sent (connection setting)' };
  const customer = e.lines.some((l) => l.account_key === 'receivable') ? await contactId(ctx, e.contact?.id ?? null) : null;
  const j = await journal(ctx, e, customer);
  await ctx.links.set('entry', e.id, j, { kind: 'journal', remote_total: e.total });
  return { status: 'done', message: `Entry ${e.number} sent to Zoho Books as a journal` };
}

async function reverse(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  const r = e.reverses!;
  if (await ctx.links.get('entry', e.id)) return { status: 'skipped', message: 'Already undone in Zoho Books' };
  const link = r.source.type === 'document' || r.source.type === 'payment' ? await ctx.links.get(r.source.type, r.source.id) : await ctx.links.get('entry', r.id);
  if (!link) return { status: 'skipped', message: 'The reversed entry never reached Zoho Books' };
  if (r.source.type === 'document') await call(ctx, 'POST', `/${link.extra.kind === 'credit_note' ? 'creditnotes' : 'invoices'}/${link.remoteId}/status/void`);
  else if (link.extra.kind === 'journal') await call(ctx, 'DELETE', `/journals/${link.remoteId}`);
  else await call(ctx, 'DELETE', `/customerpayments/${link.remoteId}`);
  await ctx.links.set('entry', e.id, link.remoteId, { kind: 'reversal' });
  return { status: 'done', message: `Entry ${e.number}: undone in Zoho Books` };
}

export function zohoBooksIntegration(): IntegrationProvider {
  const income = ['income', 'other_income'];
  const slots: MappingSlot[] = [
    { key: 'accounts.revenue_rental', list: 'accounts', types: income, required: true },
    { key: 'accounts.revenue_sale', list: 'accounts', types: income },
    { key: 'accounts.revenue_fees', list: 'accounts', types: income },
    { key: 'accounts.revenue_damage', list: 'accounts', types: income },
    { key: 'accounts.revenue_other', list: 'accounts', types: income, required: true },
    { key: 'accounts.discounts', list: 'accounts', types: income },
    { key: 'accounts.receivable', list: 'accounts', types: ['accounts_receivable'], required: true },
    { key: 'accounts.deposits', list: 'accounts', types: ['other_current_liability', 'other_liability'], required: true },
    { key: 'payment_accounts.bank', list: 'paymentAccounts', required: true },
    { key: 'payment_accounts.cash', list: 'paymentAccounts' },
    { key: 'payment_accounts.card_clearing', list: 'paymentAccounts' },
  ];
  return {
    id: 'zoho-books',
    name: 'Zoho Books',
    category: 'accounting',
    auth: {
      type: 'oauth2', clientAuth: 'body', tokenPrefix: 'Zoho-oauthtoken', baseUrlSetting: 'auth_base_url',
      authorizeUrl: 'https://accounts.zoho.{data_center}/oauth/v2/auth', tokenUrl: 'https://accounts.zoho.{data_center}/oauth/v2/token',
      // Zoho separates scopes with commas.
      scopes: ['ZohoBooks.contacts.ALL,ZohoBooks.invoices.ALL,ZohoBooks.creditnotes.ALL,ZohoBooks.customerpayments.ALL,ZohoBooks.accountants.ALL,ZohoBooks.settings.READ'],
      authorizeParams: { access_type: 'offline', prompt: 'consent' },
      clientIdSetting: 'client_id', clientSecretSetting: 'client_secret',
    },
    events: ['accounting.entry_posted', 'customer.updated'],
    mapping: slots,
    mapsTaxes: true,
    settings: [
      { key: 'invoice_status', label: 'Invoices in Zoho Books', type: 'select', options: ['sent', 'draft'], help: 'draft leaves invoices for you to approve; payments then wait' },
      { key: 'send_deposits', label: 'Send deposits', type: 'boolean', help: 'Deposits held, returned and kept, booked to the deposits account' },
    ],
    async onConnected(ctx) {
      const orgs = await this.organisations!(ctx);
      const org = orgs[0];
      if (!org) throw new Error('No Zoho Books organisation was found');
      return this.useOrganisation!(ctx, org.id);
    },
    async organisations(ctx) {
      const list = ((await call(ctx, 'GET', '/organizations', undefined, ''))?.organizations ?? []) as { organization_id: string; name: string; is_default_org?: boolean }[];
      return [...list].sort((a, b) => Number(!!b.is_default_org) - Number(!!a.is_default_org)).map((o) => ({ id: String(o.organization_id), name: o.name }));
    },
    async useOrganisation(ctx, id) {
      const list = ((await call(ctx, 'GET', '/organizations', undefined, ''))?.organizations ?? []) as any[];
      const org = list.find((o) => String(o.organization_id) === id);
      return { accountName: org?.name, account: { organization_id: id, organisation_id: id, base_currency: org?.currency_code ?? null, data_center: dc(ctx) } };
    },
    async lookups(ctx) {
      const accounts = ((await call(ctx, 'GET', '/chartofaccounts'))?.chartofaccounts ?? []) as any[];
      const taxes = ((await call(ctx, 'GET', '/settings/taxes'))?.taxes ?? []) as any[];
      return {
        accounts: accounts.filter((a) => !['bank', 'cash'].includes(a.account_type)).map((a) => ({ id: String(a.account_id), code: a.account_code || undefined, name: a.account_name, type: a.account_type })),
        paymentAccounts: accounts.filter((a) => ['bank', 'cash'].includes(a.account_type)).map((a) => ({ id: String(a.account_id), code: a.account_code || undefined, name: a.account_name, type: a.account_type })),
        taxRates: taxes.map((t) => ({ id: String(t.tax_id), name: t.tax_name, rateBp: Math.round(Number(t.tax_percentage) * 100) })),
        currencies: (((await call(ctx, 'GET', '/settings/currencies'))?.currencies ?? []) as any[]).map((c) => c.currency_code),
      };
    },
    async handle(ctx, task) {
      if (task.object.type === 'customer') return { status: 'skipped', message: 'Customer details are kept as first sent' };
      if (task.object.type !== 'accounting_entry') return { status: 'skipped', message: `Nothing to do for ${task.event}` };
      const e = await ctx.data.accounting.entry(task.object.id);
      if (!e) return { status: 'skipped', message: 'Entry not found' };
      if (e.reverses) return reverse(ctx, e);
      if (e.source.type === 'document') return sendDocument(ctx, e.source.id);
      const money = e.lines.some((l) => MONEY.includes(l.account_key));
      if (money && e.lines.some((l) => l.account_key === 'receivable')) return sendPayment(ctx, e);
      return sendOther(ctx, e);
    },
    async pullPayments(ctx, since) {
      const r = await call(ctx, 'GET', `/customerpayments?last_modified_time=${encodeURIComponent(new Date(since).toISOString())}`);
      const currency = String(ctx.connection.account.base_currency ?? 'EUR');
      const out = [];
      for (const p of (r?.customerpayments ?? []) as any[]) {
        const invs = (p.invoices ?? []) as any[];
        for (const i of invs) out.push({ remoteId: invs.length > 1 ? `${p.payment_id}:${i.invoice_id}` : String(p.payment_id), invoiceRemoteId: String(i.invoice_id), amount: minor(i.amount_applied, currency), currency, date: p.last_modified_time ?? p.date });
      }
      return out;
    },
    async check(ctx, records) {
      const currency = String(ctx.connection.account.base_currency ?? 'EUR');
      const out = [];
      for (const r of records.filter((x) => x.localType === 'document')) {
        const inv = await call(ctx, 'GET', `/invoices/${r.remoteId}`).catch(() => null);
        const cn = inv ? null : await call(ctx, 'GET', `/creditnotes/${r.remoteId}`).catch(() => null);
        const d = inv?.invoice ?? cn?.creditnote;
        if (!d) out.push({ remoteId: r.remoteId, total: null, status: 'deleted' as const });
        else out.push({ remoteId: r.remoteId, total: d.status === 'void' ? 0 : minor(d.total, currency), status: d.status === 'void' ? 'voided' as const : d.status === 'paid' ? 'paid' as const : d.status === 'draft' ? 'draft' as const : 'open' as const });
      }
      return out;
    },
    remoteUrl(localType, remoteId, account) {
      if (localType !== 'document') return null;
      return `https://books.zoho.${account.data_center ?? 'com'}/app/${account.organization_id}#/invoices/${encodeURIComponent(remoteId)}`;
    },
  };
}

export default definePlugin({
  id: 'accounting-zoho-books',
  name: 'Zoho Books accounting',
  version: '0.2.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.4.0',
  permissions: ['integrations', 'network', 'documents:read', 'payments:read', 'customers:read'],
  settings: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true, help: 'From api-console.zoho.com (server-based app); redirect URL as shown on the Accounting page' },
    { key: 'client_secret', label: 'Client secret', type: 'secret', required: true },
    { key: 'data_center', label: 'Zoho data centre', type: 'select', options: DATA_CENTRES, help: 'Where your Zoho account lives: com (US), eu, in, com.au, jp, ca, sa, com.cn' },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
    { key: 'auth_base_url', label: 'Sign-in base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ client_id: api.env('ZOHO_CLIENT_ID'), client_secret: api.env('ZOHO_CLIENT_SECRET'), data_center: api.env('ZOHO_DATA_CENTER') ?? 'com' });
    api.registerIntegration(zohoBooksIntegration());
  },
});
