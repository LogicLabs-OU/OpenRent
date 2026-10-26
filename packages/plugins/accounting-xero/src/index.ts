import {
  definePlugin, mapped, RetryLater, type AccountingEntry, type AccountingInvoice, type IntegrationContext, type IntegrationProvider, type IntegrationResult, type LookupItem, type MappingSlot,
} from '@openrent/plugin-sdk';

/**
 * Xero (FR-INT-3, ADR 0009). OpenRent books every invoice, credit note, payment and deposit as an
 * accounting entry; this plugin sends each entry to the organisation the shop chose:
 * - invoices and credit notes go across with their own numbers and OpenRent's tax per line, so totals
 *   match the issued documents to the cent; credit notes are allocated to the invoice they correct;
 * - payments are applied to the order's invoice, or held as an overpayment until the invoice arrives;
 * - refunds are paid out of the credit note or overpayment they belong to;
 * - deposits and damage kept from them become bank transactions (money moved) or manual journals;
 * - reversals void or delete what the reversed entry created.
 * Accounts and tax rates come from the shop's mapping, chosen from the organisation's own lists.
 */
const LOGIN = 'https://login.xero.com/identity/connect/authorize';
const TOKEN = 'https://identity.xero.com/connect/token';
const API = 'https://api.xero.com';
const REVENUE_TYPES = ['REVENUE', 'SALES', 'OTHERINCOME'];
const MONEY = ['cash', 'bank', 'card_clearing'];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** Minor units to the currency's decimal amount (2 digits, or 0 for currencies like JPY). */
export const major = (n: number, currency: string) => {
  const d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return Number((n / 10 ** d).toFixed(d));
};
/** The currency's decimal amount back to minor units. */
export const minor = (n: number, currency: string) => {
  const d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return Math.round(Number(n) * 10 ** d);
};
/** Xero dates come as `/Date(1700000000000+0000)/` or ISO. */
export const xeroDate = (v: unknown) => {
  const m = String(v ?? '').match(/\/Date\((-?\d+)/);
  return m ? new Date(Number(m[1])).toISOString() : new Date(String(v)).toISOString();
};

const base = (ctx: IntegrationContext) => str(ctx.config.api_base_url) ?? API;

async function call(ctx: IntegrationContext, method: string, path: string, body?: unknown, tenantId = String(ctx.connection.account.tenant_id ?? ''), headers: Record<string, string> = {}) {
  const res = await ctx.fetch(`${base(ctx)}/api.xro/2.0${path}`, {
    method,
    headers: { 'xero-tenant-id': tenantId, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  if (res.status === 429) throw new RetryLater('Xero asked to slow down', (Number(res.headers?.get('retry-after')) || 60) * 1000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.Elements?.[0]?.ValidationErrors?.map((e: any) => e.Message).join('; ') ?? data?.Message ?? data?.Detail ?? `HTTP ${res.status}`;
    throw new Error(`Xero: ${detail}`);
  }
  return data;
}

/** The organisation's accounts by id (cached for the run), to send codes where Xero wants codes. */
const accountCache = new Map<string, { at: number; byId: Map<string, { code: string | null; type: string }> }>();
async function accounts(ctx: IntegrationContext) {
  const key = `${ctx.connection.id}:${ctx.connection.account.tenant_id}`;
  const hit = accountCache.get(key);
  if (hit && Date.now() - hit.at < 300_000) return hit.byId;
  const list = ((await call(ctx, 'GET', '/Accounts')).Accounts ?? []) as any[];
  const byId = new Map(list.map((a) => [a.AccountID as string, { code: (a.Code as string) ?? null, type: a.Type as string }]));
  accountCache.set(key, { at: Date.now(), byId });
  return byId;
}
async function codeOf(ctx: IntegrationContext, slot: string, fallback?: string) {
  const id = mapped(ctx, slot) ?? (fallback ? mapped(ctx, fallback) : null);
  if (!id) throw new Error(`Map "${slot}" on the Accounting page first`);
  const a = (await accounts(ctx)).get(id);
  if (!a?.code) throw new Error(`The account mapped to "${slot}" has no code in Xero; give it one or map another`);
  return a.code;
}
const revenueSlot = (kind: string) =>
  kind === 'rental' ? 'accounts.revenue_rental' : kind === 'sale' ? 'accounts.revenue_sale' : ['fee', 'late_fee', 'service'].includes(kind) ? 'accounts.revenue_fees' : kind === 'damage' ? 'accounts.revenue_damage' : kind === 'discount' ? 'accounts.discounts' : 'accounts.revenue_other';
const moneySlot = (key: string) => `payment_accounts.${MONEY.includes(key) ? key : 'bank'}`;
const moneyAccountId = (ctx: IntegrationContext, key: string) => {
  const id = mapped(ctx, moneySlot(key)) ?? mapped(ctx, 'payment_accounts.bank');
  if (!id) throw new Error('Map the bank account for payments on the Accounting page first');
  return id;
};

/** The contact for an OpenRent customer, found by email or name, created once, kept up to date. */
async function contactId(ctx: IntegrationContext, customerId: string | null) {
  if (!customerId) return genericContact(ctx);
  const known = await ctx.links.get('customer', customerId);
  if (known) return known.remoteId;
  const c = await ctx.data.contact(customerId);
  if (!c) return genericContact(ctx);
  const name = c.company_name || c.name;
  const q = c.email ? `EmailAddress=="${c.email.replace(/"/g, '')}"` : `Name=="${name.replace(/"/g, '')}"`;
  let id: string | undefined = (await call(ctx, 'GET', `/Contacts?where=${encodeURIComponent(q)}`))?.Contacts?.[0]?.ContactID;
  if (!id) {
    // Xero contact names are unique: a second "Ada Lovelace" gets her email added.
    const taken = !!(await call(ctx, 'GET', `/Contacts?where=${encodeURIComponent(`Name=="${name.replace(/"/g, '')}"`)}`))?.Contacts?.length;
    const created = await call(ctx, 'POST', '/Contacts', {
      Contacts: [{
        Name: taken && c.email ? `${name} (${c.email})` : name, FirstName: c.company_name ? undefined : c.name.split(' ')[0], EmailAddress: c.email ?? undefined, TaxNumber: c.tax_id ?? undefined,
        Phones: c.phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] : undefined,
        Addresses: c.address ? [{ AddressType: 'POBOX', AddressLine1: c.address.line1, AddressLine2: c.address.line2, City: c.address.city, PostalCode: c.address.postal_code, Country: c.address.country }] : undefined,
      }],
    });
    id = created?.Contacts?.[0]?.ContactID;
  }
  if (!id) throw new Error('Xero did not return a contact');
  await ctx.links.set('customer', customerId, id);
  return id;
}
/** Walk-in movements without a customer book to one "OpenRent" contact. */
async function genericContact(ctx: IntegrationContext) {
  const known = await ctx.links.get('contact', 'openrent');
  if (known) return known.remoteId;
  const found = (await call(ctx, 'GET', `/Contacts?where=${encodeURIComponent('Name=="OpenRent customers"')}`))?.Contacts?.[0]?.ContactID;
  const id = found ?? (await call(ctx, 'POST', '/Contacts', { Contacts: [{ Name: 'OpenRent customers' }] }))?.Contacts?.[0]?.ContactID;
  await ctx.links.set('contact', 'openrent', id);
  return id as string;
}

async function lineItems(ctx: IntegrationContext, inv: AccountingInvoice) {
  const out = [];
  for (const l of inv.lines) {
    const tax = mapped(ctx, `taxes.${l.tax_rate_bp}`);
    if (!tax) throw new Error(`Map the ${l.tax_rate_bp / 100} % tax rate on the Accounting page first`);
    out.push({
      Description: l.description, Quantity: l.quantity, UnitAmount: Number((major(l.net_amount, inv.currency) / l.quantity).toFixed(4)),
      AccountCode: await codeOf(ctx, revenueSlot(l.kind), 'accounts.revenue_other'), TaxType: tax, TaxAmount: major(l.tax_amount, inv.currency),
    });
  }
  return out;
}

/**
 * Attaches the issued PDF to the Xero copy unless the shop turned it off. A failed upload never undoes the
 * invoice: the link notes it, and sending the invoice again tries the PDF once more.
 */
async function attachPdf(ctx: IntegrationContext, inv: AccountingInvoice, remoteId: string): Promise<string> {
  if (ctx.connection.settings.attach_pdf === false) return '';
  const link = (await ctx.links.get('document', inv.id))!;
  const pdf = await ctx.data.accounting.documentPdf(inv.id);
  if (!pdf) return '';
  try {
    const kind = inv.type === 'invoice' ? 'Invoices' : 'CreditNotes';
    await call(ctx, 'PUT', `/${kind}/${remoteId}/Attachments/${encodeURIComponent(pdf.filename)}?IncludeOnline=true`, pdf.body, undefined, { 'content-type': pdf.contentType });
    await ctx.links.set('document', inv.id, remoteId, { ...link.extra, pdf: 'attached' });
    return ' with its PDF';
  } catch (e) {
    await ctx.links.set('document', inv.id, remoteId, { ...link.extra, pdf: 'failed' });
    return `; the PDF was not attached (${(e as Error).message})`;
  }
}

async function sendDocument(ctx: IntegrationContext, documentId: string): Promise<IntegrationResult> {
  const inv = await ctx.data.accounting.invoice(documentId);
  if (!inv) return { status: 'skipped', message: 'Not an invoice or credit note with a customer' };
  const known = await ctx.links.get('document', inv.id);
  if (known?.extra.pdf === 'failed') return { status: 'done', message: `${inv.number} is already in Xero${await attachPdf(ctx, inv, known.remoteId)}` };
  if (known) return { status: 'skipped', message: `${inv.number} is already in Xero` };
  const contact = await contactId(ctx, inv.contact.id);
  const status = str(ctx.connection.settings.invoice_status) === 'DRAFT' ? 'DRAFT' : 'AUTHORISED';
  const common = {
    Contact: { ContactID: contact }, Date: inv.issued_at.slice(0, 10), CurrencyCode: inv.currency, LineAmountTypes: 'Exclusive', Status: status,
    Reference: inv.order_number ? `#${inv.order_number}` : undefined, LineItems: await lineItems(ctx, inv),
  };
  const isInv = inv.type === 'invoice';
  const r = isInv
    ? await call(ctx, 'POST', '/Invoices?unitdp=4', { Invoices: [{ ...common, Type: 'ACCREC', InvoiceNumber: inv.number, DueDate: (inv.due_at ?? inv.issued_at).slice(0, 10) }] })
    : await call(ctx, 'POST', '/CreditNotes?unitdp=4', { CreditNotes: [{ ...common, Type: 'ACCRECCREDIT', CreditNoteNumber: inv.number }] });
  const doc = isInv ? r?.Invoices?.[0] : r?.CreditNotes?.[0];
  const id = isInv ? doc?.InvoiceID : doc?.CreditNoteID;
  if (!id) throw new Error(`Xero did not return the ${isInv ? 'invoice' : 'credit note'}`);
  const total = minor(doc.Total, inv.currency);
  await ctx.links.set('document', inv.id, id, { kind: inv.type, remote_number: inv.number, remote_total: total, mismatch: total !== inv.total });
  if (status === 'AUTHORISED') {
    if (isInv) await allocateEarlierPayments(ctx, inv, id);
    else if (inv.credit_for) {
      const original = await ctx.links.get('document', inv.credit_for.id);
      // Allocated up to what the invoice still owes; the rest of the credit stays for a refund.
      if (original) {
        const due = minor((await call(ctx, 'GET', `/Invoices/${original.remoteId}`))?.Invoices?.[0]?.AmountDue ?? 0, inv.currency);
        const amount = Math.min(due, inv.total);
        if (amount > 0) await call(ctx, 'PUT', `/CreditNotes/${id}/Allocations`, { Allocations: [{ Invoice: { InvoiceID: original.remoteId }, Amount: major(amount, inv.currency), Date: inv.issued_at.slice(0, 10) }] });
      }
    }
  }
  const attached = await attachPdf(ctx, inv, id);
  return { status: 'done', message: `${isInv ? 'Invoice' : 'Credit note'} ${inv.number} sent to Xero${attached}` };
}

/** Money that reached Xero before this invoice (held as overpayments) is allocated to it now. */
async function allocateEarlierPayments(ctx: IntegrationContext, inv: AccountingInvoice, invoiceId: string) {
  let due = inv.total;
  for (const p of inv.order_payments) {
    if (due <= 0) break;
    const link = await ctx.links.get('payment', p.id);
    const left = Number(link?.extra.unapplied ?? 0);
    if (!link || link.extra.kind !== 'overpayment' || left <= 0) continue;
    const amount = Math.min(left, due);
    await call(ctx, 'PUT', `/Overpayments/${link.extra.overpayment_id}/Allocations`, { Allocations: [{ Invoice: { InvoiceID: invoiceId }, Amount: major(amount, inv.currency), Date: inv.issued_at.slice(0, 10) }] });
    await ctx.links.set('payment', p.id, link.remoteId, { ...link.extra, unapplied: left - amount });
    due -= amount;
  }
}

/** A customer's payment or refund (receivables against money). */
async function sendPayment(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  const p = await ctx.data.accounting.payment(e.source.id);
  if (!p) return { status: 'skipped', message: 'Not a completed payment' };
  if (await ctx.links.get('payment', p.id)) return { status: 'skipped', message: 'Already in Xero' };
  const money = e.lines.find((l) => MONEY.includes(l.account_key))!;
  const account = moneyAccountId(ctx, money.account_key);
  const date = p.paid_at.slice(0, 10);
  const reference = p.order_number ? `#${p.order_number}` : p.id;
  if (p.kind === 'refund') {
    // Paid out of the order's credit note, or of the overpayment the money came in as.
    const order = p.invoice_id ? await ctx.data.accounting.invoice(p.invoice_id) : null;
    for (const op of order?.order_payments ?? []) {
      const l = await ctx.links.get('payment', op.id);
      if (l?.extra.kind === 'overpayment' && Number(l.extra.unapplied ?? 0) >= p.amount) {
        const r = await call(ctx, 'PUT', '/Payments', { Payments: [{ Overpayment: { OverpaymentID: l.extra.overpayment_id }, Account: { AccountID: account }, Date: date, Amount: major(p.amount, p.currency), Reference: reference }] });
        await ctx.links.set('payment', op.id, l.remoteId, { ...l.extra, unapplied: Number(l.extra.unapplied) - p.amount });
        await ctx.links.set('payment', p.id, r?.Payments?.[0]?.PaymentID ?? 'refund', { kind: 'refund' });
        return { status: 'done', message: 'Refund paid from the overpayment in Xero' };
      }
    }
    const credit = p.invoice_id ? (await ctx.links.get('credit_for', p.invoice_id))?.remoteId : null;
    if (!credit) throw new Error('No credit note or overpayment in Xero to refund from yet; issue a credit note in OpenRent');
    const r = await call(ctx, 'PUT', '/Payments', { Payments: [{ CreditNote: { CreditNoteID: credit }, Account: { AccountID: account }, Date: date, Amount: major(p.amount, p.currency), Reference: reference }] });
    await ctx.links.set('payment', p.id, r?.Payments?.[0]?.PaymentID, { kind: 'refund' });
    return { status: 'done', message: 'Refund paid from the credit note in Xero' };
  }
  const invoice = p.invoice_id ? await ctx.links.get('document', p.invoice_id) : null;
  // The invoice task may still be waiting: try again shortly.
  if (p.invoice_id && !invoice) throw new RetryLater('The invoice is not in Xero yet', 120_000);
  let due = 0;
  if (invoice) due = minor((await call(ctx, 'GET', `/Invoices/${invoice.remoteId}`))?.Invoices?.[0]?.AmountDue ?? 0, p.currency);
  const toInvoice = Math.min(due, p.amount);
  let paymentId: string | null = null;
  if (toInvoice > 0) {
    const r = await call(ctx, 'PUT', '/Payments', { Payments: [{ Invoice: { InvoiceID: invoice!.remoteId }, Account: { AccountID: account }, Date: date, Amount: major(toInvoice, p.currency), Reference: reference }] });
    paymentId = r?.Payments?.[0]?.PaymentID ?? null;
  }
  const rest = p.amount - toInvoice;
  if (rest > 0) {
    // Paid before the invoice (or more than it): an overpayment, allocated when the invoice comes.
    const r = await call(ctx, 'PUT', '/BankTransactions', {
      BankTransactions: [{ Type: 'RECEIVE-OVERPAYMENT', Contact: { ContactID: await contactId(ctx, e.contact?.id ?? null) }, BankAccount: { AccountID: account }, Date: date, Reference: reference, LineAmountTypes: 'NoTax', CurrencyCode: p.currency, LineItems: [{ Description: e.lines[0]!.description, LineAmount: major(rest, p.currency) }] }],
    });
    const bt = r?.BankTransactions?.[0];
    await ctx.links.set('payment', p.id, paymentId ?? bt?.BankTransactionID, { kind: 'overpayment', overpayment_id: bt?.OverpaymentID, bank_transaction_id: bt?.BankTransactionID, payment_id: paymentId, unapplied: rest, remote_total: p.amount });
    return { status: 'done', message: paymentId ? 'Payment applied in Xero; the rest is held as an overpayment' : 'Payment held as an overpayment in Xero until the invoice arrives' };
  }
  await ctx.links.set('payment', p.id, paymentId!, { kind: 'payment', remote_total: p.amount });
  return { status: 'done', message: 'Payment applied in Xero' };
}

/** Deposits, damage kept from them and the like: a bank transaction when money moved, else a journal. */
async function sendOther(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  if (await ctx.links.get('entry', e.id)) return { status: 'skipped', message: 'Already in Xero' };
  if (e.kind.startsWith('deposit_') && ctx.connection.settings.send_deposits === false) return { status: 'skipped', message: 'Deposits are not sent (connection setting)' };
  if (e.lines.some((l) => l.account_key === 'receivable')) {
    throw new Error('Xero cannot take a deposit against an invoice automatically; record it in Xero and mark it as handled');
  }
  const money = e.lines.filter((l) => MONEY.includes(l.account_key));
  const slotOf = (key: string) => (key === 'deposits' ? 'accounts.deposits' : key === 'revenue_damage' ? 'accounts.revenue_damage' : `accounts.${key}`);
  if (money.length === 1) {
    const m = money[0]!;
    const items = [];
    for (const l of e.lines.filter((x) => x !== m)) {
      items.push({ Description: l.description, Quantity: 1, UnitAmount: major(l.debit || l.credit, e.currency), AccountCode: await codeOf(ctx, slotOf(l.account_key), 'accounts.revenue_other'), TaxType: 'NONE' });
    }
    const r = await call(ctx, 'PUT', '/BankTransactions', {
      BankTransactions: [{ Type: m.debit ? 'RECEIVE' : 'SPEND', Contact: { ContactID: await contactId(ctx, e.contact?.id ?? null) }, BankAccount: { AccountID: moneyAccountId(ctx, m.account_key) }, Date: e.date, Reference: e.reference, LineAmountTypes: 'NoTax', CurrencyCode: e.currency, LineItems: items }],
    });
    const id = r?.BankTransactions?.[0]?.BankTransactionID;
    await ctx.links.set('entry', e.id, id, { kind: 'bank_transaction', remote_total: e.total });
    return { status: 'done', message: `Entry ${e.number} sent to Xero as a bank transaction` };
  }
  const lines = [];
  for (const l of e.lines) lines.push({ LineAmount: major(l.debit ? l.debit : -l.credit, e.currency), AccountCode: await codeOf(ctx, slotOf(l.account_key), 'accounts.revenue_other'), Description: l.description });
  const r = await call(ctx, 'PUT', '/ManualJournals', { ManualJournals: [{ Narration: `OpenRent ${e.number} ${e.reference}`, Date: e.date, Status: 'POSTED', JournalLines: lines }] });
  await ctx.links.set('entry', e.id, r?.ManualJournals?.[0]?.ManualJournalID, { kind: 'manual_journal', remote_total: e.total });
  return { status: 'done', message: `Entry ${e.number} sent to Xero as a manual journal` };
}

/** Undoes in Xero what the reversed entry created: voids the document, deletes the payment or transaction. */
async function reverse(ctx: IntegrationContext, e: AccountingEntry): Promise<IntegrationResult> {
  const r = e.reverses!;
  if (await ctx.links.get('entry', e.id)) return { status: 'skipped', message: 'Already undone in Xero' };
  const link = r.source.type === 'document' || r.source.type === 'payment' ? await ctx.links.get(r.source.type, r.source.id) : await ctx.links.get('entry', r.id);
  if (!link) return { status: 'skipped', message: 'The reversed entry never reached Xero' };
  if (r.source.type === 'document') {
    const isInv = link.extra.kind !== 'credit_note';
    await call(ctx, 'POST', isInv ? '/Invoices' : '/CreditNotes', { [isInv ? 'Invoices' : 'CreditNotes']: [{ [isInv ? 'InvoiceID' : 'CreditNoteID']: link.remoteId, Status: 'VOIDED' }] });
  } else if (link.extra.kind === 'manual_journal') {
    await call(ctx, 'POST', '/ManualJournals', { ManualJournals: [{ ManualJournalID: link.remoteId, Status: 'VOIDED' }] });
  } else if (link.extra.kind === 'bank_transaction' || (link.extra.kind === 'overpayment' && !link.extra.payment_id)) {
    await call(ctx, 'POST', '/BankTransactions', { BankTransactions: [{ BankTransactionID: link.extra.bank_transaction_id ?? link.remoteId, Status: 'DELETED' }] });
  } else {
    await call(ctx, 'POST', `/Payments/${link.extra.payment_id ?? link.remoteId}`, { Payments: [{ Status: 'DELETED' }] });
  }
  await ctx.links.set('entry', e.id, link.remoteId, { kind: 'reversal' });
  return { status: 'done', message: `Entry ${e.number}: undone in Xero` };
}

export function xeroIntegration(): IntegrationProvider {
  const slots: MappingSlot[] = [
    { key: 'accounts.revenue_rental', list: 'accounts', types: REVENUE_TYPES, required: true },
    { key: 'accounts.revenue_sale', list: 'accounts', types: REVENUE_TYPES },
    { key: 'accounts.revenue_fees', list: 'accounts', types: REVENUE_TYPES },
    { key: 'accounts.revenue_damage', list: 'accounts', types: REVENUE_TYPES },
    { key: 'accounts.revenue_other', list: 'accounts', types: REVENUE_TYPES, required: true },
    { key: 'accounts.discounts', list: 'accounts', types: REVENUE_TYPES },
    { key: 'accounts.deposits', list: 'accounts', types: ['CURRLIAB', 'LIABILITY', 'TERMLIAB'], required: true },
    { key: 'payment_accounts.bank', list: 'paymentAccounts', required: true },
    { key: 'payment_accounts.cash', list: 'paymentAccounts' },
    { key: 'payment_accounts.card_clearing', list: 'paymentAccounts' },
  ];
  return {
    id: 'xero',
    name: 'Xero',
    category: 'accounting',
    auth: {
      type: 'oauth2', authorizeUrl: LOGIN, tokenUrl: TOKEN, baseUrlSetting: 'auth_base_url',
      scopes: ['openid', 'profile', 'email', 'offline_access', 'accounting.transactions', 'accounting.contacts', 'accounting.settings.read'],
      clientIdSetting: 'client_id', clientSecretSetting: 'client_secret',
    },
    events: ['accounting.entry_posted', 'customer.updated'],
    mapping: slots,
    mapsTaxes: true,
    settings: [
      { key: 'invoice_status', label: 'Invoices in Xero', type: 'select', options: ['AUTHORISED', 'DRAFT'], help: 'DRAFT leaves invoices for you to approve; payments then wait' },
      { key: 'send_deposits', label: 'Send deposits', type: 'boolean', help: 'Deposits held, returned and kept, booked to the deposits account' },
      { key: 'attach_pdf', label: 'Attach the invoice PDF', type: 'boolean', help: 'The issued PDF goes onto the invoice or credit note in Xero, so it shows online too' },
    ],
    async onConnected(ctx) {
      // Which organisations the shop shared on Xero's consent screen; the first one is used until another is chosen.
      const res = await ctx.fetch(`${base(ctx)}/connections`);
      const list = (await res.json().catch(() => [])) as { tenantId: string; tenantName: string; tenantType: string }[];
      const org = list.find((t) => t.tenantType === 'ORGANISATION') ?? list[0];
      if (!res.ok || !org) throw new Error('No Xero organisation was shared');
      const info = (await call(ctx, 'GET', '/Organisation', undefined, org.tenantId)).Organisations?.[0];
      return { accountName: org.tenantName, account: { tenant_id: org.tenantId, organisation_id: org.tenantId, base_currency: info?.BaseCurrency ?? null } };
    },
    async organisations(ctx) {
      const list = (await (await ctx.fetch(`${base(ctx)}/connections`)).json().catch(() => [])) as { tenantId: string; tenantName: string; tenantType: string }[];
      return list.filter((t) => t.tenantType === 'ORGANISATION').map((t) => ({ id: t.tenantId, name: t.tenantName }));
    },
    async useOrganisation(ctx, id) {
      const info = (await call(ctx, 'GET', '/Organisation', undefined, id)).Organisations?.[0];
      return { accountName: info?.Name, account: { tenant_id: id, base_currency: info?.BaseCurrency ?? null } };
    },
    async lookups(ctx) {
      const accs = ((await call(ctx, 'GET', '/Accounts')).Accounts ?? []).filter((a: any) => a.Status === 'ACTIVE') as any[];
      const item = (a: any): LookupItem => ({ id: a.AccountID, code: a.Code ?? undefined, name: a.Name, type: a.Type });
      return {
        accounts: accs.filter((a) => a.Type !== 'BANK').map(item),
        paymentAccounts: accs.filter((a) => a.Type === 'BANK').map(item),
        taxRates: ((await call(ctx, 'GET', '/TaxRates')).TaxRates ?? []).filter((t: any) => t.Status === 'ACTIVE').map((t: any) => ({ id: t.TaxType, name: t.Name, rateBp: Math.round(Number(t.EffectiveRate) * 100) })),
        currencies: ((await call(ctx, 'GET', '/Currencies')).Currencies ?? []).map((c: any) => c.Code),
      };
    },
    async handle(ctx, task) {
      if (task.object.type === 'customer') {
        const link = await ctx.links.get('customer', task.object.id);
        if (!link) return { status: 'skipped', message: 'Not in Xero yet' };
        const c = await ctx.data.contact(task.object.id);
        if (!c) return { status: 'skipped', message: 'Customer not found' };
        await call(ctx, 'POST', '/Contacts', { Contacts: [{ ContactID: link.remoteId, EmailAddress: c.email ?? undefined, TaxNumber: c.tax_id ?? undefined }] });
        return { status: 'done', message: 'Contact updated in Xero' };
      }
      if (task.object.type !== 'accounting_entry') return { status: 'skipped', message: `Nothing to do for ${task.event}` };
      const e = await ctx.data.accounting.entry(task.object.id);
      if (!e) return { status: 'skipped', message: 'Entry not found' };
      if (e.reverses) return reverse(ctx, e);
      if (e.source.type === 'document') {
        const r = await sendDocument(ctx, e.source.id);
        const inv = await ctx.data.accounting.invoice(e.source.id);
        if (inv?.type === 'credit_note' && inv.credit_for) {
          const link = await ctx.links.get('document', inv.id);
          if (link) await ctx.links.set('credit_for', inv.credit_for.id, link.remoteId);
        }
        return r;
      }
      const money = e.lines.some((l) => MONEY.includes(l.account_key));
      if (money && e.lines.some((l) => l.account_key === 'receivable')) return sendPayment(ctx, e);
      return sendOther(ctx, e);
    },
    async pullPayments(ctx, since) {
      const res = await call(ctx, 'GET', '/Payments?where=' + encodeURIComponent('Status=="AUTHORISED"'), undefined, undefined, { 'if-modified-since': new Date(since).toUTCString() });
      const currency = String(ctx.connection.account.base_currency ?? 'EUR');
      return ((res?.Payments ?? []) as any[])
        .filter((p) => p.Invoice?.InvoiceID)
        .map((p) => ({ remoteId: p.PaymentID, invoiceRemoteId: p.Invoice.InvoiceID, amount: minor(p.Amount, currency), currency, date: xeroDate(p.UpdatedDateUTC ?? p.Date), reference: p.Reference || undefined }));
    },
    async check(ctx, records) {
      const currency = String(ctx.connection.account.base_currency ?? 'EUR');
      const docs = records.filter((r) => r.localType === 'document').map((r) => r.remoteId);
      const out = [];
      if (docs.length) {
        for (const kind of ['Invoices', 'CreditNotes']) {
          const list = (await call(ctx, 'GET', `/${kind}?IDs=${docs.join(',')}`))?.[kind] ?? [];
          for (const d of list) {
            out.push({ remoteId: d.InvoiceID ?? d.CreditNoteID, total: d.Status === 'VOIDED' || d.Status === 'DELETED' ? 0 : minor(d.Total, currency), status: d.Status === 'VOIDED' ? 'voided' as const : d.Status === 'DELETED' ? 'deleted' as const : d.Status === 'PAID' ? 'paid' as const : d.Status === 'DRAFT' ? 'draft' as const : 'open' as const });
          }
        }
        for (const id of docs) if (!out.some((o) => o.remoteId === id)) out.push({ remoteId: id, total: null, status: 'deleted' as const });
      }
      return out;
    },
    remoteUrl(localType, remoteId) {
      return localType === 'document' ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(remoteId)}` : null;
    },
  };
}

export default definePlugin({
  id: 'accounting-xero',
  name: 'Xero accounting',
  version: '0.2.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.5.0',
  permissions: ['integrations', 'network', 'documents:read', 'payments:read', 'customers:read'],
  settings: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true, help: 'From your app at developer.xero.com; redirect URL as shown on the Accounting page' },
    { key: 'client_secret', label: 'Client secret', type: 'secret', required: true },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
    { key: 'auth_base_url', label: 'Sign-in base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ client_id: api.env('XERO_CLIENT_ID'), client_secret: api.env('XERO_CLIENT_SECRET') });
    api.registerIntegration(xeroIntegration());
  },
});
