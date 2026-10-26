import { id, json, round, startFake, type FakeReply, type FakeRequest, type FakeServer } from './common.ts';

/**
 * A stateful stand-in for the QuickBooks Online Accounting API (v3) of a non-US company, with the rules
 * from Intuit's documentation: `/v3/company/{realmId}/...` with the realm the sign-in returned; the
 * query language for lists; SyncToken on updates; SalesItemLineDetail lines need an item and an Amount
 * equal to UnitPrice × Qty; every line needs a TaxCodeRef; tax is worked out per tax code and may be
 * overridden through TxnTaxDetail within 0.01 per line; DocNumber unique; the home currency only;
 * payments never above the balance; no voiding once paid; journal lines on Accounts Receivable must name
 * the customer. Errors come back as `Fault` objects.
 */
export interface QboAccount { Id: string; Name: string; AccountType: string; AcctNum?: string; Active: boolean }
interface Txn { Id: string; type: 'Invoice' | 'CreditMemo'; SyncToken: string; DocNumber: string; customer: string; total: number; balance: number; status: 'Open' | 'Voided'; date: string; lines: any[] }
interface Pay { Id: string; SyncToken: string; customer: string; amount: number; links: { id: string; amount: number }[]; status: 'Open' | 'Deleted'; updated: number; account: string }

export interface QboCompany {
  realmId: string;
  name: string;
  currency: string;
  accounts: QboAccount[];
  items: { Id: string; Name: string; Type: 'Service'; IncomeAccountRef: { value: string } }[];
  taxCodes: { Id: string; Name: string; rate: number }[];
  customers: { Id: string; DisplayName: string; email?: string }[];
  txns: Txn[];
  payments: Pay[];
  journals: { Id: string; SyncToken: string; status: string; lines: any[] }[];
}

const acct = (Id: string, Name: string, AccountType: string, AcctNum?: string): QboAccount => ({ Id, Name, AccountType, AcctNum, Active: true });

export function qboCompany(name = 'Kayak Hire Ltd', currency = 'EUR'): QboCompany {
  return {
    realmId: String(9130000000000 + Math.floor(Math.random() * 1e6)), name, currency,
    accounts: [
      acct('35', 'Checking', 'Bank', '1000'), acct('36', 'Cash on hand', 'Bank', '1010'), acct('37', 'Stripe clearing', 'Bank', '1150'),
      acct('79', 'Rental income', 'Income', '4000'), acct('80', 'Sales', 'Income', '4010'), acct('81', 'Fees', 'Income', '4020'), acct('82', 'Damage recovered', 'Other Income', '4030'),
      acct('84', 'Accounts Receivable (A/R)', 'Accounts Receivable', '1200'), acct('89', 'Customer deposits', 'Other Current Liability', '2300'), acct('90', 'Rounding', 'Expense', '8990'),
    ],
    items: [
      { Id: '1', Name: 'Rental', Type: 'Service', IncomeAccountRef: { value: '79' } },
      { Id: '2', Name: 'Sales', Type: 'Service', IncomeAccountRef: { value: '80' } },
      { Id: '3', Name: 'Fees', Type: 'Service', IncomeAccountRef: { value: '81' } },
      { Id: '4', Name: 'Damage', Type: 'Service', IncomeAccountRef: { value: '82' } },
    ],
    taxCodes: [
      { Id: '3', Name: '20.0% S', rate: 20 }, { Id: '4', Name: '5.0% R', rate: 5 }, { Id: '6', Name: '0.0% Z', rate: 0 }, { Id: '9', Name: 'Exempt', rate: 0 },
    ],
    customers: [], txns: [], payments: [], journals: [],
  };
}

const fault = (message: string, detail = message, code = '6000', status = 400): FakeReply => json(status, { Fault: { Error: [{ Message: message, Detail: detail, code }], type: 'ValidationFault' }, time: new Date().toISOString() });
const txnView = (t: Txn) => ({ Id: t.Id, SyncToken: t.SyncToken, DocNumber: t.DocNumber, TotalAmt: t.total, Balance: t.balance, TxnDate: t.date, CustomerRef: { value: t.customer }, PrivateNote: t.status === 'Voided' ? 'Voided' : '', Line: t.lines });

export interface QboFake extends FakeServer {
  companies: QboCompany[];
  /** A payment recorded in QuickBooks itself against an invoice. */
  payInQbo(realmId: string, invoiceId: string, amount: number): string;
}

export async function startQuickBooksFake(opts: { clientId?: string; clientSecret?: string; company?: QboCompany } = {}): Promise<QboFake> {
  const company = opts.company ?? qboCompany();

  const api = (req: FakeRequest): FakeReply => {
    const m = req.path.match(/^\/v3\/company\/([^/]+)\/(.+)$/);
    if (!m) return json(404, { error: 'not found' });
    if (m[1] !== company.realmId) return fault('ApplicationAuthorizationFailed', 'Not authorized for this company', '003100', 403);
    if (!req.query.get('minorversion')) return fault('minorversion is required by this test server', 'Send minorversion', '9000');
    const [res, rid] = m[2]!.split('/');
    const accById = (v?: string) => company.accounts.find((a) => a.Id === v && a.Active);

    if (req.method === 'GET') {
      if (res === 'companyinfo') return json(200, { CompanyInfo: { CompanyName: company.name, Id: company.realmId } });
      if (res === 'preferences') return json(200, { Preferences: { CurrencyPrefs: { HomeCurrency: { value: company.currency }, MultiCurrencyEnabled: false } } });
      if (res === 'query') {
        const q = String(req.query.get('query') ?? '');
        const entity = q.match(/from\s+(\w+)/i)?.[1]?.toLowerCase();
        const email = q.match(/PrimaryEmailAddr\s*=\s*'([^']*)'/i)?.[1];
        const display = q.match(/DisplayName\s*=\s*'([^']*)'/i)?.[1];
        const ids = q.match(/Id\s+in\s+\(([^)]*)\)/i)?.[1]?.split(',').map((s) => s.trim().replace(/'/g, ''));
        if (entity === 'account') return json(200, { QueryResponse: { Account: company.accounts.filter((a) => a.Active) } });
        if (entity === 'item') return json(200, { QueryResponse: { Item: company.items } });
        if (entity === 'taxcode') return json(200, { QueryResponse: { TaxCode: company.taxCodes.map((t) => ({ Id: t.Id, Name: t.Name, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: `r${t.Id}`, name: t.Name } }] } })) } });
        if (entity === 'taxrate') return json(200, { QueryResponse: { TaxRate: company.taxCodes.map((t) => ({ Id: `r${t.Id}`, Name: t.Name, RateValue: t.rate })) } });
        if (entity === 'customer') return json(200, { QueryResponse: { Customer: company.customers.filter((c) => (!email || c.email === email) && (!display || c.DisplayName === display)).map((c) => ({ Id: c.Id, DisplayName: c.DisplayName, PrimaryEmailAddr: c.email ? { Address: c.email } : undefined })) } });
        if (entity === 'invoice' || entity === 'creditmemo') {
          const type = entity === 'invoice' ? 'Invoice' : 'CreditMemo';
          return json(200, { QueryResponse: { [type]: company.txns.filter((t) => t.type === type && (!ids || ids.includes(t.Id))).map(txnView) } });
        }
        if (entity === 'payment') return json(200, { QueryResponse: { Payment: company.payments.filter((p) => !ids || ids.includes(p.Id)).map((p) => ({ Id: p.Id, TotalAmt: p.status === 'Deleted' ? 0 : p.amount, status: p.status })) } });
        return fault(`Unsupported query: ${q}`);
      }
      if (res === 'cdc') {
        const since = Date.parse(String(req.query.get('changedSince')));
        const list = company.payments.filter((p) => p.updated > since);
        return json(200, {
          CDCResponse: [{ QueryResponse: [{ Payment: list.map((p) => ({ Id: p.Id, TotalAmt: p.amount, TxnDate: new Date(p.updated).toISOString().slice(0, 10), status: p.status === 'Deleted' ? 'Deleted' : undefined, Line: p.links.map((l) => ({ Amount: l.amount, LinkedTxn: [{ TxnId: l.id, TxnType: 'Invoice' }] })), MetaData: { LastUpdatedTime: new Date(p.updated).toISOString() } })) }] }],
        });
      }
      if (res === 'invoice' || res === 'creditmemo') {
        const t = company.txns.find((x) => x.Id === rid);
        return t ? json(200, { [t.type]: txnView(t) }) : fault('Object Not Found', 'Object Not Found', '610');
      }
      return json(404, { error: 'not found' });
    }

    if (req.method !== 'POST') return json(405, { error: 'method' });
    const op = req.query.get('operation');
    const b = req.body ?? {};

    if (res === 'customer') {
      if (!b.DisplayName?.trim()) return fault('Required param missing, need to supply the required value for the API', 'Required parameter DisplayName is missing', '2020');
      if (company.customers.some((c) => c.DisplayName.toLowerCase() === b.DisplayName.toLowerCase())) return fault('Duplicate Name Exists Error', 'The name supplied already exists.', '6240');
      const c = { Id: String(company.customers.length + 100), DisplayName: b.DisplayName, email: b.PrimaryEmailAddr?.Address };
      company.customers.push(c);
      return json(200, { Customer: { Id: c.Id, DisplayName: c.DisplayName, SyncToken: '0' } });
    }

    if ((res === 'invoice' || res === 'creditmemo') && op === 'void') {
      const t = company.txns.find((x) => x.Id === b.Id);
      if (!t) return fault('Object Not Found', 'Object Not Found', '610');
      if (b.SyncToken !== t.SyncToken) return fault('Stale Object Error', 'You and someone else are editing the same object.', '5010');
      if (t.balance !== t.total) return fault('A business validation error has occurred while processing your request', 'Transaction has payments or credits applied; delete them first.', '6000');
      t.status = 'Voided';
      t.balance = 0;
      t.total = 0;
      t.SyncToken = String(Number(t.SyncToken) + 1);
      return json(200, { [t.type]: txnView(t) });
    }

    if (res === 'invoice' || res === 'creditmemo') {
      const type = res === 'invoice' ? 'Invoice' : 'CreditMemo';
      if (!company.customers.some((c) => c.Id === b.CustomerRef?.value)) return fault('Invalid Reference Id', 'Invalid Reference Id : Customer assigned to this transaction has been deleted or is invalid.', '2500');
      if (b.DocNumber && company.txns.some((t) => t.type === type && t.DocNumber === b.DocNumber)) return fault('Duplicate Document Number Error', `Duplicate Document Number Error : You must specify a different number. This number has already been used. DocNumber=${b.DocNumber}`, '6140');
      if (b.CurrencyRef && b.CurrencyRef.value !== company.currency) return fault('Business Validation Error', 'Multicurrency is not enabled for this company.', '6000');
      const lines: any[] = [];
      let sub = 0;
      const taxBy = new Map<string, number>();
      for (const l of b.Line ?? []) {
        if (l.DetailType !== 'SalesItemLineDetail') return fault('Unsupported line type for this test server');
        const d = l.SalesItemLineDetail ?? {};
        if (!company.items.some((i) => i.Id === d.ItemRef?.value)) return fault('Invalid Reference Id', 'Invalid Reference Id : Item assigned to this transaction has been deleted or is invalid.', '2500');
        const code = company.taxCodes.find((t) => t.Id === d.TaxCodeRef?.value);
        if (!code) return fault('Business Validation Error', 'Make sure all your transactions have a VAT rate before you save.', '6000');
        const amount = Number(l.Amount);
        if (Math.abs(round(Number(d.Qty ?? 1) * Number(d.UnitPrice ?? amount)) - amount) > 1e-9) return fault('Amount is not equal to UnitPrice * Qty', `Amount is not equal to UnitPrice * Qty. Supplied value:${amount}`, '6070');
        sub = round(sub + amount);
        taxBy.set(code.Id, round((taxBy.get(code.Id) ?? 0) + amount));
        lines.push(l);
      }
      if (!lines.length) return fault('Required param missing, need to supply the required value for the API', 'Line is required', '2020');
      const computed = round([...taxBy].reduce((s, [code, amount]) => s + round((amount * company.taxCodes.find((t) => t.Id === code)!.rate) / 100), 0));
      const given = b.TxnTaxDetail?.TotalTax;
      if (given !== undefined && Math.abs(Number(given) - computed) > 0.01 * lines.length + 1e-9) return fault('Business Validation Error', `The tax override ${given} is too far from the calculated tax ${computed}.`, '6000');
      const total = round(sub + (given !== undefined ? Number(given) : computed));
      const t: Txn = { Id: String(1000 + company.txns.length), type, SyncToken: '0', DocNumber: b.DocNumber ?? String(company.txns.length + 1), customer: b.CustomerRef.value, total, balance: total, status: 'Open', date: b.TxnDate, lines };
      company.txns.push(t);
      return json(200, { [type]: txnView(t) });
    }

    if (res === 'payment' && op === 'delete') {
      const p = company.payments.find((x) => x.Id === b.Id);
      if (!p) return fault('Object Not Found', 'Object Not Found', '610');
      if (b.SyncToken !== p.SyncToken) return fault('Stale Object Error', 'You and someone else are editing the same object.', '5010');
      p.status = 'Deleted';
      p.updated = Date.now();
      for (const l of p.links) {
        const t = company.txns.find((x) => x.Id === l.id)!;
        t.balance = round(t.balance + l.amount);
      }
      return json(200, { Payment: { Id: p.Id, status: 'Deleted' } });
    }
    if (res === 'payment' && b.Id && b.sparse) {
      // Applying an unapplied payment later: the new lines replace the old ones.
      const p = company.payments.find((x) => x.Id === b.Id && x.status === 'Open');
      if (!p) return fault('Object Not Found', 'Object Not Found', '610');
      if (b.SyncToken !== p.SyncToken) return fault('Stale Object Error', 'You and someone else are editing the same object.', '5010');
      for (const l of p.links) company.txns.find((x) => x.Id === l.id)!.balance = round(company.txns.find((x) => x.Id === l.id)!.balance + l.amount);
      const links: { id: string; amount: number }[] = [];
      for (const l of b.Line ?? []) {
        for (const lt of l.LinkedTxn ?? []) {
          const t = company.txns.find((x) => x.Id === lt.TxnId && x.type === 'Invoice');
          if (!t || t.status === 'Voided' || Number(l.Amount) > t.balance + 1e-9) return fault('Business Validation Error', 'The amount applied to the invoice is more than its balance.', '6000');
          links.push({ id: t.Id, amount: Number(l.Amount) });
        }
      }
      if (round(links.reduce((s, l) => s + l.amount, 0)) > p.amount + 1e-9) return fault('Business Validation Error', 'The applied amount exceeds the payment total.', '6000');
      for (const l of links) company.txns.find((x) => x.Id === l.id)!.balance = round(company.txns.find((x) => x.Id === l.id)!.balance - l.amount);
      p.links = links;
      p.SyncToken = String(Number(p.SyncToken) + 1);
      return json(200, { Payment: { Id: p.Id, SyncToken: p.SyncToken, TotalAmt: p.amount } });
    }
    if (res === 'payment') {
      if (!company.customers.some((c) => c.Id === b.CustomerRef?.value)) return fault('Invalid Reference Id', 'Invalid Reference Id : Customer is invalid.', '2500');
      const dep = accById(b.DepositToAccountRef?.value);
      if (b.DepositToAccountRef && (!dep || !['Bank', 'Other Current Asset'].includes(dep.AccountType))) return fault('Business Validation Error', 'Deposit to account must be a Bank or Other Current Asset account.', '6000');
      const links: { id: string; amount: number }[] = [];
      let credits = 0;
      for (const l of b.Line ?? []) {
        for (const lt of l.LinkedTxn ?? []) {
          // A credit memo in a payment offsets the invoices it is paid against.
          const t = company.txns.find((x) => x.Id === lt.TxnId && x.type === lt.TxnType);
          if (!t || t.status === 'Voided') return fault('Invalid Reference Id', `Invalid Reference Id : ${lt.TxnType} is invalid.`, '2500');
          if (Number(l.Amount) > t.balance + 1e-9) return fault('Business Validation Error', `The amount applied to the ${lt.TxnType} is more than its balance.`, '6000');
          if (t.type === 'CreditMemo') credits = round(credits + Number(l.Amount));
          links.push({ id: t.Id, amount: Number(l.Amount) });
        }
      }
      const applied = round(links.filter((l) => company.txns.find((x) => x.Id === l.id)!.type === 'Invoice').reduce((s, l) => s + l.amount, 0) - credits);
      if (applied > Number(b.TotalAmt) + 1e-9) return fault('Business Validation Error', 'The applied amount exceeds the payment total.', '6000');
      for (const l of links) {
        const t = company.txns.find((x) => x.Id === l.id)!;
        t.balance = round(t.balance - l.amount);
      }
      const p: Pay = { Id: String(5000 + company.payments.length), SyncToken: '0', customer: b.CustomerRef.value, amount: Number(b.TotalAmt), links, status: 'Open', updated: Date.now(), account: dep?.Id ?? '' };
      company.payments.push(p);
      return json(200, { Payment: { Id: p.Id, SyncToken: p.SyncToken, TotalAmt: p.amount } });
    }

    if (res === 'journalentry' && op === 'delete') {
      const j = company.journals.find((x) => x.Id === b.Id);
      if (!j) return fault('Object Not Found', 'Object Not Found', '610');
      j.status = 'Deleted';
      return json(200, { JournalEntry: { Id: j.Id, status: 'Deleted' } });
    }
    if (res === 'journalentry') {
      let debit = 0;
      let credit = 0;
      for (const l of b.Line ?? []) {
        const d = l.JournalEntryLineDetail ?? {};
        const a = accById(d.AccountRef?.value);
        if (!a) return fault('Invalid Reference Id', 'Invalid Reference Id : Account is invalid.', '2500');
        if (a.AccountType === 'Accounts Receivable' && d.Entity?.Type !== 'Customer') return fault('Business Validation Error', 'When you use Accounts Receivable, you must choose a customer in the Name field.', '6000');
        if (d.PostingType === 'Debit') debit = round(debit + Number(l.Amount));
        else if (d.PostingType === 'Credit') credit = round(credit + Number(l.Amount));
        else return fault('PostingType must be Debit or Credit');
      }
      if (!debit || debit !== credit) return fault('Business Validation Error', 'Transaction must balance: debits and credits must be equal.', '6000');
      const j = { Id: String(7000 + company.journals.length), SyncToken: '0', status: 'Open', lines: b.Line };
      company.journals.push(j);
      return json(200, { JournalEntry: { Id: j.Id, SyncToken: j.SyncToken, TotalAmt: debit } });
    }

    if (res === 'upload') return json(200, { AttachableResponse: [{ Attachable: { Id: id() } }] });
    return json(404, { error: 'not found' });
  };

  const fake = (await startFake(
    {
      clientId: opts.clientId ?? 'qbo-client', clientSecret: opts.clientSecret ?? 'qbo-secret', clientAuth: 'basic', tokenPrefix: 'Bearer',
      callbackParams: { realmId: company.realmId }, authorizePath: '/connect/oauth2', tokenPath: '/oauth2/v1/tokens/bearer', ttl: 3600,
    },
    api,
  )) as QboFake;
  fake.companies = [company];
  fake.payInQbo = (_realm, invoiceId, amount) => {
    const t = company.txns.find((x) => x.Id === invoiceId)!;
    t.balance = round(t.balance - amount);
    const p: Pay = { Id: String(5000 + company.payments.length), SyncToken: '0', customer: t.customer, amount, links: [{ id: t.Id, amount }], status: 'Open', updated: Date.now(), account: '35' };
    company.payments.push(p);
    return p.Id;
  };
  return fake;
}
