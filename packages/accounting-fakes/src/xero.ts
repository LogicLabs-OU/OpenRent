import { id, json, round, startFake, type FakeReply, type FakeRequest, type FakeServer } from './common.ts';

/**
 * A stateful stand-in for the Xero Accounting API (api.xro/2.0) with the rules a real organisation
 * enforces, from Xero's API documentation: a `xero-tenant-id` header naming a connected organisation;
 * account codes that exist and fit the document; tax computed per line (an explicit TaxAmount may differ
 * by at most 0.01); unique invoice numbers; enabled currencies only; payments only to BANK accounts,
 * only on AUTHORISED documents and never above what is due; no voiding once paid; balanced manual
 * journals; bank transactions with a contact. Dates come back in Xero's `/Date(ms+0000)/` form.
 */
export interface XeroAccount { AccountID: string; Code: string; Name: string; Type: string; Status: 'ACTIVE' | 'ARCHIVED' }
export interface XeroTaxRate { TaxType: string; Name: string; EffectiveRate: number; Status: 'ACTIVE' | 'DELETED' }
interface Doc { id: string; number: string; type: 'ACCREC' | 'ACCRECCREDIT'; contactId: string; status: string; currency: string; total: number; due: number; lines: any[]; date: string; reference?: string; attachments: string[] }
interface Payment { PaymentID: string; docId: string; amount: number; date: string; account: string; reference?: string; status: 'AUTHORISED' | 'DELETED'; updated: number; fromOpenRent: boolean }

export interface XeroOrg {
  tenantId: string;
  name: string;
  baseCurrency: string;
  currencies: string[];
  accounts: XeroAccount[];
  taxRates: XeroTaxRate[];
  contacts: { ContactID: string; Name: string; EmailAddress?: string; TaxNumber?: string }[];
  docs: Doc[];
  payments: Payment[];
  bankTransactions: { id: string; type: string; account: string; total: number; status: string; contactId: string; lines: any[] }[];
  /** Money received before an invoice: credit on the customer's account until allocated or refunded. */
  overpayments: { id: string; contactId: string; total: number; remaining: number; status: string }[];
  journals: { id: string; status: string; lines: { AccountCode: string; LineAmount: number }[] }[];
}

const a = (Code: string, Name: string, Type: string): XeroAccount => ({ AccountID: id(), Code, Name, Type, Status: 'ACTIVE' });

export function xeroOrg(name = 'Kayak Hire Ltd', currency = 'EUR'): XeroOrg {
  return {
    tenantId: id(), name, baseCurrency: currency, currencies: [currency],
    accounts: [
      a('090', 'Business Bank Account', 'BANK'), a('091', 'Cash Float', 'BANK'), a('092', 'Stripe Clearing', 'BANK'),
      a('200', 'Sales', 'REVENUE'), a('201', 'Rental Income', 'REVENUE'), a('205', 'Damage Recovered', 'OTHERINCOME'), a('260', 'Other Revenue', 'OTHERINCOME'),
      a('480', 'Discounts Given', 'REVENUE'), a('610', 'Accounts Receivable', 'CURRENT'), a('820', 'VAT', 'CURRLIAB'), a('835', 'Customer Deposits', 'CURRLIAB'),
      a('860', 'Rounding', 'ROUNDING'), a('400', 'Advertising', 'EXPENSE'),
    ],
    taxRates: [
      { TaxType: 'OUTPUT2', Name: '20% (VAT on Income)', EffectiveRate: 20, Status: 'ACTIVE' },
      { TaxType: 'RROUTPUT', Name: '5% (VAT on Income)', EffectiveRate: 5, Status: 'ACTIVE' },
      { TaxType: 'ZERORATEDOUTPUT', Name: 'Zero Rated Income', EffectiveRate: 0, Status: 'ACTIVE' },
      { TaxType: 'NONE', Name: 'No VAT', EffectiveRate: 0, Status: 'ACTIVE' },
    ],
    contacts: [], docs: [], payments: [], bankTransactions: [], journals: [], overpayments: [],
  };
}

const xdate = (iso: string | number) => `/Date(${typeof iso === 'number' ? iso : Date.parse(iso)}+0000)/`;
const invalid = (...messages: string[]): FakeReply =>
  json(400, { ErrorNumber: 10, Type: 'ValidationException', Message: 'A validation exception occurred', Elements: [{ ValidationErrors: messages.map((Message) => ({ Message })) }] });
const notFound = () => json(404, { Title: 'Resource not found', Status: 404 });
const docView = (d: Doc) => ({
  [d.type === 'ACCREC' ? 'InvoiceID' : 'CreditNoteID']: d.id, [d.type === 'ACCREC' ? 'InvoiceNumber' : 'CreditNoteNumber']: d.number, Type: d.type, Status: d.status,
  CurrencyCode: d.currency, Total: d.total, AmountDue: d.due, SubTotal: round(d.lines.reduce((s, l) => s + l.LineAmount, 0)), TotalTax: round(d.lines.reduce((s, l) => s + l.TaxAmount, 0)),
  Date: xdate(d.date), Reference: d.reference ?? '', Contact: { ContactID: d.contactId }, LineItems: d.lines,
});

export interface XeroFake extends FakeServer {
  orgs: XeroOrg[];
  /** A payment entered in Xero itself (e.g. from a bank feed) against an invoice. */
  payInXero(orgId: string, invoiceId: string, amount: number): string;
  /** An invoice voided in Xero itself. */
  voidInXero(orgId: string, invoiceId: string): void;
}

export async function startXeroFake(opts: { clientId?: string; clientSecret?: string; orgs?: XeroOrg[] } = {}): Promise<XeroFake> {
  const orgs = opts.orgs ?? [xeroOrg(), xeroOrg('Kayak Hire Events Ltd')];

  const api = (req: FakeRequest): FakeReply => {
    if (req.method === 'GET' && req.path === '/connections') return json(200, orgs.map((o) => ({ id: id(), tenantId: o.tenantId, tenantName: o.name, tenantType: 'ORGANISATION' })));
    const m = req.path.match(/^\/api\.xro\/2\.0\/(.+)$/);
    if (!m) return notFound();
    const org = orgs.find((o) => o.tenantId === req.headers['xero-tenant-id']);
    if (!org) return json(403, { Type: 'AuthorizationUnsuccessful', Title: 'Forbidden', Detail: 'AuthorizationUnsuccessful' });
    const [res, rid, sub] = m[1]!.split('/');
    const account = (code?: string, accountId?: string) => org.accounts.find((x) => x.Status === 'ACTIVE' && (code ? x.Code === code : x.AccountID === accountId));

    if (req.method === 'GET') {
      if (res === 'Organisation') return json(200, { Organisations: [{ Name: org.name, BaseCurrency: org.baseCurrency }] });
      if (res === 'Currencies') return json(200, { Currencies: org.currencies.map((Code) => ({ Code })) });
      if (res === 'Accounts') return json(200, { Accounts: org.accounts });
      if (res === 'TaxRates') return json(200, { TaxRates: org.taxRates.map((t) => ({ ...t, EffectiveRate: t.EffectiveRate.toFixed(4) })) });
      if (res === 'Contacts') {
        const where = req.query.get('where') ?? '';
        const email = where.match(/EmailAddress=="([^"]*)"/)?.[1];
        const name = where.match(/Name=="([^"]*)"/)?.[1];
        return json(200, { Contacts: org.contacts.filter((c) => (email ? c.EmailAddress === email : name ? c.Name === name : true)) });
      }
      if (res === 'Invoices' || res === 'CreditNotes') {
        const type = res === 'Invoices' ? 'ACCREC' : 'ACCRECCREDIT';
        const ids = (rid ? [rid] : (req.query.get('IDs') ?? '').split(',')).filter(Boolean);
        const list = org.docs.filter((d) => d.type === type && (!ids.length || ids.includes(d.id)));
        if (rid && !list.length) return notFound();
        return json(200, { [res]: list.map(docView) });
      }
      if (res === 'Payments') {
        const since = Date.parse(String(req.headers['if-modified-since'] ?? '')) || 0;
        const list = org.payments.filter((p) => (rid ? p.PaymentID === rid : p.updated > since));
        if (rid && !list.length) return notFound();
        return json(200, {
          Payments: list.map((p) => {
            const d = org.docs.find((x) => x.id === p.docId)!;
            return {
              PaymentID: p.PaymentID, Amount: p.amount, Date: xdate(p.date), Status: p.status, Reference: p.reference ?? '', UpdatedDateUTC: xdate(p.updated),
              ...(d.type === 'ACCREC' ? { Invoice: { InvoiceID: d.id, InvoiceNumber: d.number } } : { CreditNote: { CreditNoteID: d.id, CreditNoteNumber: d.number } }),
            };
          }),
        });
      }
      return notFound();
    }

    if (res === 'Contacts' && (req.method === 'POST' || req.method === 'PUT')) {
      const out = [];
      for (const c of req.body?.Contacts ?? []) {
        if (!c.Name?.trim()) return invalid('Contact name is required.');
        if (org.contacts.some((x) => x.Name.toLowerCase() === c.Name.toLowerCase())) return invalid(`The contact name ${c.Name} is already assigned to another contact. The contact name must be unique across all active contacts.`);
        const row = { ContactID: id(), Name: c.Name, EmailAddress: c.EmailAddress, TaxNumber: c.TaxNumber };
        org.contacts.push(row);
        out.push(row);
      }
      return json(200, { Contacts: out });
    }

    if ((res === 'Invoices' || res === 'CreditNotes') && !rid && (req.method === 'POST' || req.method === 'PUT')) {
      const isInv = res === 'Invoices';
      const out = [];
      for (const x of req.body?.[res] ?? []) {
        const existingId = x.InvoiceID ?? x.CreditNoteID;
        if (existingId) {
          const d = org.docs.find((y) => y.id === existingId);
          if (!d) return notFound();
          if (x.Status === 'VOIDED') {
            if (org.payments.some((p) => p.docId === d.id && p.status === 'AUTHORISED') || d.due !== d.total) return invalid('This document cannot be edited as it has a payment or credit note allocated to it.');
            d.status = 'VOIDED';
            d.due = 0;
          }
          out.push(docView(d));
          continue;
        }
        const type = x.Type ?? (isInv ? 'ACCREC' : 'ACCRECCREDIT');
        if (type !== (isInv ? 'ACCREC' : 'ACCRECCREDIT')) return invalid('Unsupported document type for this test server.');
        const errors: string[] = [];
        if (!org.contacts.some((c) => c.ContactID === x.Contact?.ContactID)) errors.push('A Contact must be specified for this type of transaction');
        const number = isInv ? x.InvoiceNumber : x.CreditNoteNumber;
        if (number && org.docs.some((d) => d.type === type && d.number === number)) errors.push(`${isInv ? 'Invoice' : 'Credit Note'} # must be unique.`);
        const currency = x.CurrencyCode ?? org.baseCurrency;
        if (!org.currencies.includes(currency)) errors.push(`The currency ${currency} has not been enabled for this organisation.`);
        if (x.LineAmountTypes && x.LineAmountTypes !== 'Exclusive') errors.push('This test server only accepts LineAmountTypes Exclusive.');
        const lines = [];
        for (const l of x.LineItems ?? []) {
          const acc = account(l.AccountCode);
          if (!acc) errors.push(`Account code '${l.AccountCode}' is not a valid code for this document.`);
          else if (!['REVENUE', 'SALES', 'OTHERINCOME', 'ROUNDING'].includes(acc.Type)) errors.push(`Account code '${l.AccountCode}' is not a valid code for this document.`);
          const tax = org.taxRates.find((t) => t.TaxType === l.TaxType && t.Status === 'ACTIVE');
          if (!tax) errors.push(`The TaxType code '${l.TaxType}' does not exist or cannot be used for this type of transaction.`);
          const qty = Number(l.Quantity ?? 1);
          const lineAmount = round(qty * Number(l.UnitAmount ?? 0));
          const computed = round((lineAmount * (tax?.EffectiveRate ?? 0)) / 100);
          if (l.TaxAmount !== undefined && Math.abs(Number(l.TaxAmount) - computed) > 0.0100001) errors.push(`The TaxAmount ${l.TaxAmount} must be within 0.01 of the calculated tax ${computed.toFixed(2)}.`);
          lines.push({ LineItemID: id(), Description: l.Description, Quantity: qty, UnitAmount: l.UnitAmount, AccountCode: l.AccountCode, TaxType: l.TaxType, LineAmount: lineAmount, TaxAmount: l.TaxAmount !== undefined ? round(Number(l.TaxAmount)) : computed });
        }
        if (!lines.length) errors.push('At least one line item is required.');
        if (errors.length) return invalid(...errors);
        const total = round(lines.reduce((s, l) => s + l.LineAmount + l.TaxAmount, 0));
        const status = x.Status ?? 'DRAFT';
        const d: Doc = { id: id(), number: number ?? `${isInv ? 'INV' : 'CN'}-${org.docs.length + 1}`, type, contactId: x.Contact.ContactID, status, currency, total, due: total, lines, date: x.Date ?? new Date().toISOString().slice(0, 10), reference: x.Reference, attachments: [] };
        org.docs.push(d);
        out.push(docView(d));
      }
      return json(200, { [res]: out });
    }

    if (res === 'Overpayments' && rid && sub === 'Allocations' && req.method === 'PUT') {
      const ov = org.overpayments.find((x) => x.id === rid);
      if (!ov) return notFound();
      for (const al of req.body?.Allocations ?? []) {
        const inv = org.docs.find((d) => d.id === al.Invoice?.InvoiceID && d.type === 'ACCREC');
        if (!inv || inv.status !== 'AUTHORISED') return invalid('Allocations can only be made to authorised invoices.');
        if (inv.contactId !== ov.contactId) return invalid('The overpayment and the invoice must be for the same contact.');
        if (al.Amount > inv.due + 1e-9 || al.Amount > ov.remaining + 1e-9) return invalid('The amount being allocated exceeds the amount outstanding.');
        inv.due = round(inv.due - al.Amount);
        ov.remaining = round(ov.remaining - al.Amount);
        if (!inv.due) inv.status = 'PAID';
      }
      return json(200, { Allocations: req.body?.Allocations ?? [] });
    }
    if (res === 'Overpayments' && rid && req.method === 'GET') {
      const ov = org.overpayments.find((x) => x.id === rid);
      return ov ? json(200, { Overpayments: [{ OverpaymentID: ov.id, Total: ov.total, RemainingCredit: ov.remaining, Status: ov.status }] }) : notFound();
    }

    if (res === 'CreditNotes' && rid && sub === 'Allocations' && req.method === 'PUT') {
      const cn = org.docs.find((d) => d.id === rid && d.type === 'ACCRECCREDIT');
      if (!cn) return notFound();
      for (const al of req.body?.Allocations ?? []) {
        const inv = org.docs.find((d) => d.id === al.Invoice?.InvoiceID && d.type === 'ACCREC');
        if (!inv) return invalid('Invoice could not be found.');
        if (cn.status !== 'AUTHORISED' || inv.status !== 'AUTHORISED') return invalid('Allocations can only be made between authorised documents.');
        if (al.Amount > inv.due + 1e-9) return invalid('The amount being allocated exceeds the amount outstanding on the invoice.');
        if (al.Amount > cn.due + 1e-9) return invalid('The amount being allocated exceeds the remaining credit on the credit note.');
        inv.due = round(inv.due - al.Amount);
        cn.due = round(cn.due - al.Amount);
        if (!inv.due) inv.status = 'PAID';
        if (!cn.due) cn.status = 'PAID';
      }
      return json(200, { Allocations: req.body?.Allocations ?? [] });
    }

    if (res === 'Payments' && !rid && (req.method === 'PUT' || req.method === 'POST')) {
      const out = [];
      for (const p of req.body?.Payments ?? []) {
        if (p.Overpayment) {
          // A refund of money held as an overpayment.
          const ov = org.overpayments.find((x) => x.id === p.Overpayment.OverpaymentID);
          const acc = account(p.Account?.Code, p.Account?.AccountID);
          if (!ov) return invalid('Overpayment could not be found.');
          if (!acc || acc.Type !== 'BANK') return invalid('Payment Account must be of type BANK or have payments enabled.');
          if (Number(p.Amount) > ov.remaining + 1e-9) return invalid('Payment amount exceeds the remaining credit on this overpayment.');
          ov.remaining = round(ov.remaining - Number(p.Amount));
          out.push({ PaymentID: id(), Amount: Number(p.Amount), Status: 'AUTHORISED' });
          continue;
        }
        const d = org.docs.find((x) => x.id === (p.Invoice?.InvoiceID ?? p.CreditNote?.CreditNoteID));
        if (!d) return invalid('Invoice or credit note could not be found.');
        const acc = account(p.Account?.Code, p.Account?.AccountID);
        if (!acc || acc.Type !== 'BANK') return invalid('Payment Account must be of type BANK or have payments enabled.');
        if (d.status !== 'AUTHORISED') return invalid('Payments can only be made against Authorised documents.');
        if (Number(p.Amount) <= 0) return invalid('Payment amount must be greater than zero.');
        if (Number(p.Amount) > d.due + 1e-9) return invalid('Payment amount exceeds the amount outstanding on this document.');
        d.due = round(d.due - Number(p.Amount));
        if (!d.due) d.status = 'PAID';
        const row: Payment = { PaymentID: id(), docId: d.id, amount: Number(p.Amount), date: p.Date, account: acc.AccountID, reference: p.Reference, status: 'AUTHORISED', updated: Date.now(), fromOpenRent: true };
        org.payments.push(row);
        out.push({ PaymentID: row.PaymentID, Amount: row.amount, Status: row.status });
      }
      return json(200, { Payments: out });
    }
    if (res === 'Payments' && rid && req.method === 'POST') {
      const p = org.payments.find((x) => x.PaymentID === rid);
      if (!p) return notFound();
      if (req.body?.Payments?.[0]?.Status === 'DELETED' && p.status !== 'DELETED') {
        const d = org.docs.find((x) => x.id === p.docId)!;
        p.status = 'DELETED';
        p.updated = Date.now();
        d.due = round(d.due + p.amount);
        d.status = 'AUTHORISED';
      }
      return json(200, { Payments: [{ PaymentID: p.PaymentID, Status: p.status }] });
    }

    if (res === 'BankTransactions' && (req.method === 'PUT' || req.method === 'POST')) {
      const out = [];
      for (const b of req.body?.BankTransactions ?? []) {
        if (b.BankTransactionID) {
          const row = org.bankTransactions.find((x) => x.id === b.BankTransactionID);
          if (!row) return notFound();
          if (b.Status === 'DELETED') row.status = 'DELETED';
          out.push({ BankTransactionID: row.id, Status: row.status });
          continue;
        }
        if (!['RECEIVE', 'SPEND', 'RECEIVE-OVERPAYMENT'].includes(b.Type)) return invalid('Type must be RECEIVE, SPEND or RECEIVE-OVERPAYMENT.');
        if (!org.contacts.some((c) => c.ContactID === b.Contact?.ContactID)) return invalid('A Contact must be specified for this type of transaction');
        const bank = account(b.BankAccount?.Code, b.BankAccount?.AccountID);
        if (!bank || bank.Type !== 'BANK') return invalid('The BankAccount must be a valid bank account.');
        if (b.Type === 'RECEIVE-OVERPAYMENT') {
          // Overpayment lines carry no account: Xero books them to Accounts Receivable.
          if ((b.LineItems ?? []).some((l: any) => l.AccountCode)) return invalid('Overpayment line items must not have an AccountCode.');
          const total = round((b.LineItems ?? []).reduce((s: number, l: any) => s + Number(l.LineAmount ?? Number(l.Quantity ?? 1) * Number(l.UnitAmount)), 0));
          const ov = { id: id(), contactId: b.Contact.ContactID, total, remaining: total, status: 'AUTHORISED' };
          org.overpayments.push(ov);
          const row = { id: id(), type: b.Type, account: bank.AccountID, total, status: 'AUTHORISED', contactId: b.Contact.ContactID, lines: b.LineItems };
          org.bankTransactions.push(row);
          out.push({ BankTransactionID: row.id, OverpaymentID: ov.id, Total: total, Status: row.status });
          continue;
        }
        for (const l of b.LineItems ?? []) {
          const acc = account(l.AccountCode);
          if (!acc || acc.Type === 'BANK') return invalid(`Account code '${l.AccountCode}' is not a valid code for this document.`);
        }
        const total = round((b.LineItems ?? []).reduce((s: number, l: any) => s + Number(l.Quantity ?? 1) * Number(l.UnitAmount), 0));
        const row = { id: id(), type: b.Type, account: bank.AccountID, total, status: 'AUTHORISED', contactId: b.Contact.ContactID, lines: b.LineItems };
        org.bankTransactions.push(row);
        out.push({ BankTransactionID: row.id, Total: total, Status: row.status });
      }
      return json(200, { BankTransactions: out });
    }

    if (res === 'ManualJournals' && (req.method === 'PUT' || req.method === 'POST')) {
      const out = [];
      for (const j of req.body?.ManualJournals ?? []) {
        if (j.ManualJournalID) {
          const row = org.journals.find((x) => x.id === j.ManualJournalID);
          if (!row) return notFound();
          if (j.Status === 'VOIDED') row.status = 'VOIDED';
          out.push({ ManualJournalID: row.id, Status: row.status });
          continue;
        }
        if (!j.Narration) return invalid('Narration is required.');
        const lines = j.JournalLines ?? [];
        if (lines.length < 2) return invalid('A manual journal must have at least two lines.');
        for (const l of lines) if (!account(l.AccountCode)) return invalid(`Account code '${l.AccountCode}' is not a valid code.`);
        if (Math.abs(round(lines.reduce((s: number, l: any) => s + Number(l.LineAmount), 0))) > 1e-9) return invalid('The total debits must equal the total credits.');
        const row = { id: id(), status: j.Status ?? 'POSTED', lines };
        org.journals.push(row);
        out.push({ ManualJournalID: row.id, Status: row.status });
      }
      return json(200, { ManualJournals: out });
    }

    if ((res === 'Invoices' || res === 'CreditNotes') && rid && sub === 'Attachments' && (req.method === 'PUT' || req.method === 'POST')) {
      const d = org.docs.find((x) => x.id === rid);
      if (!d) return notFound();
      const name = decodeURIComponent(req.path.split('/').pop()!);
      d.attachments.push(name);
      return json(200, { Attachments: [{ AttachmentID: id(), FileName: name }] });
    }
    return notFound();
  };

  const fake = (await startFake(
    { clientId: opts.clientId ?? 'xero-client', clientSecret: opts.clientSecret ?? 'xero-secret', clientAuth: 'basic', tokenPrefix: 'Bearer' },
    api,
  )) as XeroFake;
  fake.orgs = orgs;
  fake.payInXero = (orgId, invoiceId, amount) => {
    const org = orgs.find((o) => o.tenantId === orgId)!;
    const d = org.docs.find((x) => x.id === invoiceId)!;
    const p: Payment = { PaymentID: id(), docId: d.id, amount, date: new Date().toISOString().slice(0, 10), account: org.accounts[0]!.AccountID, reference: 'Bank feed', status: 'AUTHORISED', updated: Date.now(), fromOpenRent: false };
    org.payments.push(p);
    d.due = round(d.due - amount);
    if (!d.due) d.status = 'PAID';
    return p.PaymentID;
  };
  fake.voidInXero = (orgId, invoiceId) => {
    const d = orgs.find((o) => o.tenantId === orgId)!.docs.find((x) => x.id === invoiceId)!;
    d.status = 'VOIDED';
  };
  return fake;
}
