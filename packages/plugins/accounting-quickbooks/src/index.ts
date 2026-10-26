import {
  definePlugin, mapped, RetryLater, type AccountingEntry, type AccountingInvoice, type IntegrationContext, type IntegrationProvider, type IntegrationResult, type MappingSlot,
} from '@openrent/plugin-sdk';

/**
 * QuickBooks Online (FR-INT-3, ADR 0009). Each OpenRent accounting entry goes to the company the shop
 * connected:
 * - invoices and credit memos with OpenRent's numbers; QuickBooks books revenue through items (one
 *   mapped per kind of line), tax through tax codes (mapped per rate), with OpenRent's tax total so the
 *   totals match the issued documents; credit memos are applied to their invoice;
 * - payments go to the mapped bank or clearing account and are applied to the invoice, or stay
 *   unapplied until the invoice arrives, then are applied;
 * - refunds, deposits and damage kept from them become journal entries;
 * - reversals void the document or delete what the reversed entry created.
 */
const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const PRODUCTION = 'https://quickbooks.api.intuit.com';
const SANDBOX = 'https://sandbox-quickbooks.api.intuit.com';
const MONEY = ['cash', 'bank', 'card_clearing'];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const digits = (currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
/** Minor units to the currency's decimal amount (2 digits, or 0 for currencies like JPY). */
export const major = (n: number, currency: string) => Number((n / 10 ** digits(currency)).toFixed(digits(currency)));
export const minor = (n: number, currency: string) => Math.round(Number(n) * 10 ** digits(currency));

const sandbox = (ctx: IntegrationContext) => ctx.config.environment === 'sandbox';
const baseUrl = (ctx: IntegrationContext) => str(ctx.config.api_base_url) ?? (sandbox(ctx) ? SANDBOX : PRODUCTION);

async function call(ctx: IntegrationContext, method: string, path: string, body?: unknown, realm = String(ctx.connection.account.realm_id ?? '')) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await ctx.fetch(`${baseUrl(ctx)}/v3/company/${realm}${path}${sep}minorversion=75`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) throw new RetryLater('QuickBooks asked to slow down', (Number(res.headers?.get('retry-after')) || 60) * 1000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QuickBooks: ${data?.Fault?.Error?.map((e: any) => e.Detail ?? e.Message).join('; ') ?? `HTTP ${res.status}`}`);
  return data;
}
/** A multipart/form-data body (the upload endpoint takes files no other way). */
function formData(parts: { name: string; filename?: string; type: string; data: Uint8Array | string }[]) {
  const boundary = `openrent${Math.random().toString(36).slice(2)}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename.replace(/"/g, '')}"` : ''}\r\nContent-Type: ${p.type}\r\n\r\n`));
    chunks.push(typeof p.data === 'string' ? enc.encode(p.data) : p.data, enc.encode('\r\n'));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Attaches the issued PDF to the QuickBooks copy (an Attachable) unless the shop turned it off. A failed
 * upload never undoes the invoice: the link notes it, and sending the invoice again tries once more.
 */
async function attachPdf(ctx: IntegrationContext, inv: AccountingInvoice, remoteId: string): Promise<string> {
  if (ctx.connection.settings.attach_pdf === false) return '';
  const link = (await ctx.links.get('document', inv.id))!;
  const pdf = await ctx.data.accounting.documentPdf(inv.id);
  if (!pdf) return '';
  try {
    const meta = { AttachableRef: [{ EntityRef: { type: inv.type === 'invoice' ? 'Invoice' : 'CreditMemo', value: remoteId }, IncludeOnSend: true }], FileName: pdf.filename, ContentType: pdf.contentType };
    const form = formData([
      { name: 'file_metadata_0', type: 'application/json', data: JSON.stringify(meta) },
      { name: 'file_content_0', filename: pdf.filename, type: pdf.contentType, data: pdf.body },
    ]);
    const res = await ctx.fetch(`${baseUrl(ctx)}/v3/company/${ctx.connection.account.realm_id}/upload?minorversion=75`, { method: 'POST', headers: { 'content-type': form.contentType }, body: form.body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`QuickBooks: ${data?.Fault?.Error?.map((e: any) => e.Detail ?? e.Message).join('; ') ?? `HTTP ${res.status}`}`);
    await ctx.links.set('document', inv.id, remoteId, { ...link.extra, pdf: 'attached' });
    return ' with its PDF';
  } catch (e) {
    await ctx.links.set('document', inv.id, remoteId, { ...link.extra, pdf: 'failed' });
    return `; the PDF was not attached (${(e as Error).message})`;
  }
}

const query = async (ctx: IntegrationContext, q: string) => (await call(ctx, 'GET', `/query?query=${encodeURIComponent(q)}`)).QueryResponse ?? {};

function need(ctx: IntegrationContext, slot: string, fallback?: string) {
  const id = mapped(ctx, slot) ?? (fallback ? mapped(ctx, fallback) : null);
  if (!id) throw new Error(`Map "${slot}" on the Accounting page first`);
  return id;
}
const itemSlot = (kind: string) =>
  kind === 'rental' ? 'items.rental' : kind === 'sale' ? 'items.sale' : ['fee', 'late_fee', 'service'].includes(kind) ? 'items.fees' : kind === 'damage' ? 'items.damage' : 'items.other';
const accountFor = (ctx: IntegrationContext, key: string) =>
  MONEY.includes(key) ? need(ctx, `payment_accounts.${key}`, 'payment_accounts.bank') : key === 'receivable' ? need(ctx, 'accounts.receivable') : key === 'deposits' ? need(ctx, 'accounts.deposits') : need(ctx, 'accounts.revenue_damage');

/** The customer for an OpenRent customer, found by email or created once. */
async function customerId(ctx: IntegrationContext, id: string | null) {
  const key = id ?? 'walk-in';
  const known = await ctx.links.get('customer', key);
  if (known) return known.remoteId;
  const c = id ? await ctx.data.contact(id) : null;
  let found: string | undefined;
  if (c?.email) found = (await query(ctx, `select * from Customer where PrimaryEmailAddr = '${c.email.replace(/'/g, "\\'")}'`)).Customer?.[0]?.Id;
  if (!found) {
    const name = c ? c.company_name || c.name : 'OpenRent customers';
    // Display names are unique in QuickBooks: a namesake gets her email added.
    const taken = !!(await query(ctx, `select * from Customer where DisplayName = '${name.replace(/'/g, "\\'")}'`)).Customer?.length;
    const r = await call(ctx, 'POST', '/customer', {
      DisplayName: taken && c?.email ? `${name} (${c.email})` : name, CompanyName: c?.company_name ?? undefined, PrimaryEmailAddr: c?.email ? { Address: c.email } : undefined,
      PrimaryPhone: c?.phone ? { FreeFormNumber: c.phone } : undefined,
      BillAddr: c?.address ? { Line1: c.address.line1, Line2: c.address.line2, City: c.address.city, PostalCode: c.address.postal_code, Country: c.address.country } : undefined,
    });
    found = r?.Customer?.Id;
  }
  if (!found) throw new Error('QuickBooks did not return a customer');
  await ctx.links.set('customer', key, found);
  return found;
}

function lines(ctx: IntegrationContext, inv: AccountingInvoice) {
  return inv.lines.map((l) => {
    const tax = mapped(ctx, `taxes.${l.tax_rate_bp}`);
    if (!tax) throw new Error(`Map the ${l.tax_rate_bp / 100} % tax rate on the Accounting page first`);
    const amount = major(l.net_amount, inv.currency);
    return {
      Amount: amount, Description: l.description, DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { ItemRef: { value: need(ctx, itemSlot(l.kind), 'items.other') }, Qty: l.quantity, UnitPrice: Number((amount / l.quantity).toFixed(6)), TaxCodeRef: { value: tax } },
    };
  });
}

async function sendDocument(ctx: IntegrationContext, documentId: string): Promise<IntegrationResult> {
  const inv = await ctx.data.accounting.invoice(documentId);
  if (!inv) return { status: 'skipped', message: 'Not an invoice or credit note with a customer' };
  const known = await ctx.links.get('document', inv.id);
  if (known?.extra.pdf === 'failed') return { status: 'done', message: `${inv.number} is already in QuickBooks${await attachPdf(ctx, inv, known.remoteId)}` };
  if (known) return { status: 'skipped', message: `${inv.number} is already in QuickBooks` };
  const customer = await customerId(ctx, inv.contact.id);
  const isInv = inv.type === 'invoice';
  const body = {
    CustomerRef: { value: customer }, DocNumber: inv.number.slice(0, 21), TxnDate: inv.issued_at.slice(0, 10), PrivateNote: inv.order_number ? `OpenRent #${inv.order_number}` : undefined,
    GlobalTaxCalculation: 'TaxExcluded', Line: lines(ctx, inv), TxnTaxDetail: { TotalTax: major(inv.tax_total, inv.currency) },
    ...(isInv ? { DueDate: (inv.due_at ?? inv.issued_at).slice(0, 10) } : {}),
  };
  const r = await call(ctx, 'POST', isInv ? '/invoice' : '/creditmemo', body);
  const doc = isInv ? r?.Invoice : r?.CreditMemo;
  if (!doc?.Id) throw new Error(`QuickBooks did not return the ${isInv ? 'invoice' : 'credit memo'}`);
  const total = minor(doc.TotalAmt, inv.currency);
  await ctx.links.set('document', inv.id, doc.Id, { kind: inv.type, sync_token: doc.SyncToken, customer, remote_number: doc.DocNumber, remote_total: total, mismatch: total !== inv.total });
  if (isInv) await applyEarlierPayments(ctx, inv, doc.Id);
  else if (inv.credit_for) {
    const original = await ctx.links.get('document', inv.credit_for.id);
    if (original) {
      await ctx.links.set('credit_for', inv.credit_for.id, doc.Id, { customer });
      // A credit memo is applied in a zero payment that links it and the invoice, up to what is still due;
      // what is left stays as credit for a refund.
      const due = minor((await call(ctx, 'GET', `/invoice/${original.remoteId}`))?.Invoice?.Balance ?? 0, inv.currency);
      const amount = major(Math.min(due, inv.total), inv.currency);
      if (amount > 0) await call(ctx, 'POST', '/payment', {
        CustomerRef: { value: customer }, TotalAmt: 0, TxnDate: inv.issued_at.slice(0, 10),
        Line: [{ Amount: amount, LinkedTxn: [{ TxnId: original.remoteId, TxnType: 'Invoice' }] }, { Amount: amount, LinkedTxn: [{ TxnId: doc.Id, TxnType: 'CreditMemo' }] }],
      }).catch(() => undefined);
    }
  }
  const attached = await attachPdf(ctx, inv, doc.Id);
  return { status: 'done', message: `${isInv ? 'Invoice' : 'Credit memo'} ${inv.number} sent to QuickBooks${attached}` };
}

/** Payments that reached QuickBooks before this invoice (unapplied) are applied to it now. */
async function applyEarlierPayments(ctx: IntegrationContext, inv: AccountingInvoice, invoiceId: string) {
  let due = inv.total;
  for (const p of inv.order_payments) {
    if (due <= 0) break;
    const link = await ctx.links.get('payment', p.id);
    const left = Number(link?.extra.unapplied ?? 0);
    if (!link || left <= 0) continue;
    const amount = Math.min(left, due);
    const r = await call(ctx, 'POST', '/payment', {
      Id: link.remoteId, SyncToken: link.extra.sync_token, sparse: true, CustomerRef: { value: link.extra.customer },
      Line: [{ Amount: major(amount, inv.currency), LinkedTxn: [{ TxnId: invoiceId, TxnType: 'Invoice' }] }],
    });
    await ctx.links.set('payment', p.id, link.remoteId, { ...link.extra, sync_token: r?.Payment?.SyncToken, unapplied: left - amount });
    due -= amount;
  }
}

async function journal(ctx: IntegrationContext, e: AccountingEntry, customer: string | null) {
  const r = await call(ctx, 'POST', '/journalentry', {
    TxnDate: e.date, DocNumber: `OR-${e.number}`, PrivateNote: `OpenRent ${e.number} ${e.reference}`,
    Line: e.lines.map((l) => ({
      Amount: major(l.debit || l.credit, e.currency), Description: l.description, DetailType: 'JournalEntryLineDetail',
      JournalEntryLineDetail: { PostingType: l.debit ? 'Debit' : 'Credit', AccountRef: { value: accountFor(ctx, l.account_key) }, Entity: l.account_key === 'receivable' && customer ? { Type: 'Customer', EntityRef: { value: customer } } : undefined },
    })),
  });
  return r?.JournalEntry as { Id: string; SyncToken: string };
}

async function sendPayment(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  const p = await ctx.data.accounting.payment(e.source.id);
  if (!p) return { status: 'skipped', message: 'Not a completed payment' };
  if (await ctx.links.get('payment', p.id)) return { status: 'skipped', message: 'Already in QuickBooks' };
  const customer = await customerId(ctx, e.contact?.id ?? null);
  if (p.kind === 'refund') {
    // Money back to the customer: receivables against the bank, as a journal entry.
    const j = await journal(ctx, e, customer);
    await ctx.links.set('payment', p.id, j.Id, { kind: 'journal', sync_token: j.SyncToken, remote_total: p.amount });
    return { status: 'done', message: 'Refund booked in QuickBooks' };
  }
  const money = e.lines.find((l) => MONEY.includes(l.account_key))!;
  const invoice = p.invoice_id ? await ctx.links.get('document', p.invoice_id) : null;
  if (p.invoice_id && !invoice) throw new RetryLater('The invoice is not in QuickBooks yet', 120_000);
  let due = 0;
  if (invoice) due = minor((await call(ctx, 'GET', `/invoice/${invoice.remoteId}`))?.Invoice?.Balance ?? 0, p.currency);
  const applied = Math.min(due, p.amount);
  const r = await call(ctx, 'POST', '/payment', {
    CustomerRef: { value: customer }, TotalAmt: major(p.amount, p.currency), TxnDate: p.paid_at.slice(0, 10), PaymentRefNum: (p.order_number ? `#${p.order_number}` : p.id).slice(0, 21),
    DepositToAccountRef: { value: accountFor(ctx, money.account_key) },
    Line: applied > 0 ? [{ Amount: major(applied, p.currency), LinkedTxn: [{ TxnId: invoice!.remoteId, TxnType: 'Invoice' }] }] : [],
  });
  await ctx.links.set('payment', p.id, r?.Payment?.Id, { kind: 'payment', sync_token: r?.Payment?.SyncToken, customer, unapplied: p.amount - applied, remote_total: p.amount });
  return { status: 'done', message: applied === p.amount ? 'Payment applied in QuickBooks' : applied ? 'Payment applied in QuickBooks; the rest stays unapplied' : 'Payment recorded in QuickBooks, unapplied until the invoice arrives' };
}

async function sendOther(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  if (await ctx.links.get('entry', e.id)) return { status: 'skipped', message: 'Already in QuickBooks' };
  if (e.kind.startsWith('deposit_') && ctx.connection.settings.send_deposits === false) return { status: 'skipped', message: 'Deposits are not sent (connection setting)' };
  const customer = e.lines.some((l) => l.account_key === 'receivable') ? await customerId(ctx, e.contact?.id ?? null) : null;
  const j = await journal(ctx, e, customer);
  await ctx.links.set('entry', e.id, j.Id, { kind: 'journal', sync_token: j.SyncToken, remote_total: e.total });
  return { status: 'done', message: `Entry ${e.number} sent to QuickBooks as a journal entry` };
}

async function reverse(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  const r = e.reverses!;
  if (await ctx.links.get('entry', e.id)) return { status: 'skipped', message: 'Already undone in QuickBooks' };
  const link = r.source.type === 'document' || r.source.type === 'payment' ? await ctx.links.get(r.source.type, r.source.id) : await ctx.links.get('entry', r.id);
  if (!link) return { status: 'skipped', message: 'The reversed entry never reached QuickBooks' };
  if (r.source.type === 'document') {
    const kind = link.extra.kind === 'credit_note' ? 'creditmemo' : 'invoice';
    const current = (await call(ctx, 'GET', `/${kind}/${link.remoteId}`))?.[kind === 'invoice' ? 'Invoice' : 'CreditMemo'];
    await call(ctx, 'POST', `/${kind}?operation=void`, { Id: link.remoteId, SyncToken: current?.SyncToken ?? link.extra.sync_token });
  } else {
    const entity = link.extra.kind === 'journal' ? 'journalentry' : 'payment';
    await call(ctx, 'POST', `/${entity}?operation=delete`, { Id: link.remoteId, SyncToken: link.extra.sync_token });
  }
  await ctx.links.set('entry', e.id, link.remoteId, { kind: 'reversal' });
  return { status: 'done', message: `Entry ${e.number}: undone in QuickBooks` };
}

export function quickbooksIntegration(): IntegrationProvider {
  const income = ['Income', 'Other Income'];
  const slots: MappingSlot[] = [
    { key: 'items.rental', list: 'items', required: true },
    { key: 'items.sale', list: 'items' },
    { key: 'items.fees', list: 'items' },
    { key: 'items.damage', list: 'items' },
    { key: 'items.other', list: 'items', required: true },
    { key: 'accounts.receivable', list: 'accounts', types: ['Accounts Receivable'], required: true },
    { key: 'accounts.deposits', list: 'accounts', types: ['Other Current Liability', 'Long Term Liability'], required: true },
    { key: 'accounts.revenue_damage', list: 'accounts', types: income, required: true },
    { key: 'payment_accounts.bank', list: 'paymentAccounts', required: true },
    { key: 'payment_accounts.cash', list: 'paymentAccounts' },
    { key: 'payment_accounts.card_clearing', list: 'paymentAccounts' },
  ];
  return {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    category: 'accounting',
    auth: { type: 'oauth2', authorizeUrl: AUTHORIZE, tokenUrl: TOKEN, baseUrlSetting: 'auth_base_url', scopes: ['com.intuit.quickbooks.accounting'], clientIdSetting: 'client_id', clientSecretSetting: 'client_secret' },
    events: ['accounting.entry_posted', 'customer.updated'],
    mapping: slots,
    mapsTaxes: true,
    settings: [
      { key: 'send_deposits', label: 'Send deposits', type: 'boolean', help: 'Deposits held, returned and kept, booked to the deposits account' },
      { key: 'attach_pdf', label: 'Attach the invoice PDF', type: 'boolean', help: 'The issued PDF goes onto the invoice or credit memo in QuickBooks and is sent with it' },
    ],
    async onConnected(ctx, params) {
      const realm = params.realmId;
      if (!realm) throw new Error('QuickBooks did not say which company was chosen');
      const info = await call(ctx, 'GET', `/companyinfo/${realm}`, undefined, realm);
      const prefs = await call(ctx, 'GET', '/preferences', undefined, realm);
      return {
        accountName: info?.CompanyInfo?.CompanyName ?? realm,
        account: { realm_id: realm, organisation_id: realm, base_currency: prefs?.Preferences?.CurrencyPrefs?.HomeCurrency?.value ?? null, sandbox: sandbox(ctx) },
      };
    },
    async lookups(ctx) {
      const accounts = ((await query(ctx, 'select * from Account where Active = true maxresults 1000')).Account ?? []) as any[];
      const rates = new Map((((await query(ctx, 'select * from TaxRate maxresults 1000')).TaxRate ?? []) as any[]).map((r) => [r.Id, Number(r.RateValue ?? 0)]));
      const codes = ((await query(ctx, 'select * from TaxCode maxresults 1000')).TaxCode ?? []) as any[];
      const prefs = await call(ctx, 'GET', '/preferences');
      return {
        accounts: accounts.filter((a) => !['Bank'].includes(a.AccountType)).map((a) => ({ id: a.Id, code: a.AcctNum ?? undefined, name: a.Name, type: a.AccountType })),
        paymentAccounts: accounts.filter((a) => ['Bank', 'Other Current Asset'].includes(a.AccountType)).map((a) => ({ id: a.Id, code: a.AcctNum ?? undefined, name: a.Name, type: a.AccountType })),
        items: (((await query(ctx, "select * from Item where Type = 'Service' maxresults 1000")).Item ?? []) as any[]).map((i) => ({ id: i.Id, name: i.Name })),
        taxRates: codes.map((c) => ({
          id: c.Id, name: c.Name,
          rateBp: Math.round(((c.SalesTaxRateList?.TaxRateDetail ?? []) as any[]).reduce((s, d) => s + (rates.get(d.TaxRateRef?.value) ?? 0), 0) * 100),
        })),
        currencies: [prefs?.Preferences?.CurrencyPrefs?.HomeCurrency?.value].filter(Boolean),
      };
    },
    async handle(ctx, task) {
      if (task.object.type === 'customer') {
        const link = await ctx.links.get('customer', task.object.id);
        return link ? { status: 'skipped', message: 'Customer details are kept as first sent' } : { status: 'skipped', message: 'Not in QuickBooks yet' };
      }
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
      const r = await call(ctx, 'GET', `/cdc?entities=Payment&changedSince=${encodeURIComponent(new Date(since).toISOString())}`);
      const currency = String(ctx.connection.account.base_currency ?? 'EUR');
      const out = [];
      for (const q of r?.CDCResponse?.[0]?.QueryResponse ?? []) {
        for (const p of q.Payment ?? []) {
          if (p.status === 'Deleted') continue;
          const lines = ((p.Line ?? []) as any[]).filter((l) => l.LinkedTxn?.[0]?.TxnType === 'Invoice');
          for (const l of lines) {
            out.push({ remoteId: lines.length > 1 ? `${p.Id}:${l.LinkedTxn[0].TxnId}` : p.Id, invoiceRemoteId: l.LinkedTxn[0].TxnId, amount: minor(l.Amount, currency), currency, date: p.MetaData?.LastUpdatedTime ?? p.TxnDate });
          }
        }
      }
      return out;
    },
    async check(ctx, records) {
      const currency = String(ctx.connection.account.base_currency ?? 'EUR');
      const ids = records.filter((r) => r.localType === 'document').map((r) => r.remoteId);
      if (!ids.length) return [];
      const list = `(${ids.map((id) => `'${id.replace(/'/g, '')}'`).join(',')})`;
      const found = [...(((await query(ctx, `select * from Invoice where Id in ${list}`)).Invoice ?? []) as any[]), ...(((await query(ctx, `select * from CreditMemo where Id in ${list}`)).CreditMemo ?? []) as any[])];
      return ids.map((id) => {
        const d = found.find((x) => x.Id === id);
        if (!d) return { remoteId: id, total: null, status: 'deleted' as const };
        const voided = d.PrivateNote === 'Voided' || (Number(d.TotalAmt) === 0 && Number(d.Balance) === 0);
        return { remoteId: id, total: minor(d.TotalAmt, currency), status: voided ? 'voided' as const : Number(d.Balance) === 0 ? 'paid' as const : 'open' as const };
      });
    },
    remoteUrl(localType, remoteId, account) {
      if (localType !== 'document') return null;
      return `https://app.${account.sandbox ? 'sandbox.' : ''}qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(remoteId)}`;
    },
  };
}

export default definePlugin({
  id: 'accounting-quickbooks',
  name: 'QuickBooks Online accounting',
  version: '0.2.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.5.0',
  permissions: ['integrations', 'network', 'documents:read', 'payments:read', 'customers:read'],
  settings: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true, help: 'From your app at developer.intuit.com; redirect URL as shown on the Accounting page' },
    { key: 'client_secret', label: 'Client secret', type: 'secret', required: true },
    { key: 'environment', label: 'Companies', type: 'select', options: ['production', 'sandbox'], help: 'sandbox for Intuit development companies' },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
    { key: 'auth_base_url', label: 'Sign-in base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ client_id: api.env('QUICKBOOKS_CLIENT_ID'), client_secret: api.env('QUICKBOOKS_CLIENT_SECRET') });
    api.registerIntegration(quickbooksIntegration());
  },
});
