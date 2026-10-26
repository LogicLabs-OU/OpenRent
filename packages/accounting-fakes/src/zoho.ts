import { id, json, multipart, round, startFake, type FakeReply, type FakeRequest, type FakeServer } from './common.ts';

/**
 * A stateful stand-in for the Zoho Books API (v3), with the rules from Zoho's documentation: a
 * `Zoho-oauthtoken` header and an `organization_id` on every call but /organizations; answers carry
 * `code` 0 on success; contact names are unique; with `ignore_auto_number_generation` the number is
 * required and unique; invoices start as drafts, are marked sent, and can only be voided while nothing
 * is paid; tax is worked out per line, and the invoice `adjustment` carries any rounding difference;
 * payments need a sent invoice and never exceed its balance; journals balance and name the customer on
 * receivables lines.
 */
export interface ZohoAccount { account_id: string; account_name: string; account_code: string; account_type: string }
interface ZDoc { id: string; kind: 'invoice' | 'creditnote'; number: string; customer: string; status: string; total: number; balance: number; date: string; lines: any[]; adjustment: number; attachments: { name: string; type: string; size: number }[] }
interface ZPay { id: string; customer: string; amount: number; links: { id: string; amount: number }[]; deleted: boolean; updated: number }

export interface ZohoOrg {
  organization_id: string;
  name: string;
  currency: string;
  accounts: ZohoAccount[];
  taxes: { tax_id: string; tax_name: string; tax_percentage: number }[];
  contacts: { contact_id: string; contact_name: string; email?: string }[];
  docs: ZDoc[];
  payments: ZPay[];
  journals: { id: string; deleted: boolean; lines: any[] }[];
  refunds: { id: string; creditnote: string; amount: number }[];
}

const zacc = (account_id: string, account_name: string, account_type: string, account_code: string): ZohoAccount => ({ account_id, account_name, account_type, account_code });

export function zohoOrg(name = 'Kayak Hire OÜ', currency = 'EUR'): ZohoOrg {
  return {
    organization_id: String(60000000 + Math.floor(Math.random() * 1e6)), name, currency,
    accounts: [
      zacc('460000000001', 'Business Bank', 'bank', '1000'), zacc('460000000002', 'Petty Cash', 'cash', '1010'), zacc('460000000003', 'Stripe Clearing', 'bank', '1150'),
      zacc('460000000010', 'Rental Income', 'income', '4000'), zacc('460000000011', 'Sales', 'income', '4010'), zacc('460000000012', 'Fees', 'income', '4020'),
      zacc('460000000013', 'Damage Recovered', 'other_income', '4030'), zacc('460000000014', 'Discount', 'income', '4900'),
      zacc('460000000020', 'Accounts Receivable', 'accounts_receivable', '1200'), zacc('460000000021', 'Customer Deposits', 'other_current_liability', '2300'),
      zacc('460000000030', 'Rounding', 'expense', '8990'),
    ],
    taxes: [{ tax_id: '460000000050', tax_name: 'VAT 20%', tax_percentage: 20 }, { tax_id: '460000000051', tax_name: 'VAT 9%', tax_percentage: 9 }, { tax_id: '460000000052', tax_name: 'Zero rate', tax_percentage: 0 }],
    contacts: [], docs: [], payments: [], journals: [], refunds: [],
  };
}

const ok = (body: Record<string, unknown>, status = 200): FakeReply => json(status, { code: 0, message: 'success', ...body });
const err = (code: number, message: string, status = 400): FakeReply => json(status, { code, message });
const docView = (d: ZDoc) => ({
  [`${d.kind}_id`]: d.id, [`${d.kind}_number`]: d.number, customer_id: d.customer, status: d.status, total: d.total, balance: d.balance, date: d.date, adjustment: d.adjustment, line_items: d.lines,
});

export interface ZohoFake extends FakeServer {
  orgs: ZohoOrg[];
  /** A payment recorded in Zoho Books itself against an invoice. */
  payInZoho(orgId: string, invoiceId: string, amount: number): string;
}

export async function startZohoFake(opts: { clientId?: string; clientSecret?: string; orgs?: ZohoOrg[] } = {}): Promise<ZohoFake> {
  const orgs = opts.orgs ?? [zohoOrg()];

  const api = (req: FakeRequest): FakeReply => {
    const m = req.path.match(/^\/books\/v3\/(.+)$/);
    if (!m) return err(5, 'Invalid URL Passed', 404);
    const parts = m[1]!.split('/');
    if (parts[0] === 'organizations') return ok({ organizations: orgs.map((o, i) => ({ organization_id: o.organization_id, name: o.name, is_default_org: i === 0, currency_code: o.currency })) });
    const org = orgs.find((o) => o.organization_id === req.query.get('organization_id'));
    if (!org) return err(6041, 'This user is not associated with the CompanyID/CompanyName.', 401);
    const [res, rid, sub, act] = parts;
    const acc = (v?: string) => org.accounts.find((a) => a.account_id === v);
    const b = req.body ?? {};

    if (req.method === 'GET') {
      if (res === 'chartofaccounts') return ok({ chartofaccounts: org.accounts });
      if (res === 'settings' && rid === 'taxes') return ok({ taxes: org.taxes });
      if (res === 'settings' && rid === 'currencies') return ok({ currencies: [{ currency_id: '1', currency_code: org.currency }] });
      if (res === 'contacts') return ok({ contacts: org.contacts.filter((c) => !req.query.get('email') || c.email === req.query.get('email')) });
      if (res === 'invoices' || res === 'creditnotes') {
        const kind = res === 'invoices' ? 'invoice' : 'creditnote';
        const d = org.docs.find((x) => x.kind === kind && x.id === rid);
        return d ? ok({ [kind]: docView(d) }) : err(1002, `${kind === 'invoice' ? 'Invoice' : 'Credit note'} does not exist.`, 404);
      }
      if (res === 'customerpayments') {
        if (rid) {
          const p = org.payments.find((x) => x.id === rid && !x.deleted);
          return p ? ok({ payment: { payment_id: p.id, amount: p.amount } }) : err(1002, 'Payment does not exist.', 404);
        }
        const since = Date.parse(String(req.query.get('last_modified_time') ?? '')) || 0;
        return ok({
          customerpayments: org.payments.filter((p) => p.updated > since && !p.deleted).map((p) => ({
            payment_id: p.id, customer_id: p.customer, amount: p.amount, date: new Date(p.updated).toISOString().slice(0, 10), last_modified_time: new Date(p.updated).toISOString(),
            invoices: p.links.map((l) => ({ invoice_id: l.id, amount_applied: l.amount })),
          })),
        });
      }
      return err(5, 'Invalid URL Passed', 404);
    }

    if (req.method === 'DELETE') {
      if (res === 'customerpayments') {
        const p = org.payments.find((x) => x.id === rid && !x.deleted);
        if (!p) return err(1002, 'Payment does not exist.', 404);
        p.deleted = true;
        p.updated = Date.now();
        for (const l of p.links) {
          const d = org.docs.find((x) => x.id === l.id)!;
          d.balance = round(d.balance + l.amount);
          d.status = 'sent';
        }
        return ok({ message: 'The payment has been deleted.' });
      }
      if (res === 'journals') {
        const j = org.journals.find((x) => x.id === rid);
        if (!j) return err(1002, 'Journal does not exist.', 404);
        j.deleted = true;
        return ok({ message: 'The journal has been deleted.' });
      }
      return err(5, 'Invalid URL Passed', 404);
    }

    if (res === 'contacts') {
      if (!b.contact_name?.trim()) return err(4, 'Contact name is required.');
      if (org.contacts.some((c) => c.contact_name.toLowerCase() === b.contact_name.toLowerCase())) return err(3062, 'The contact name already exists. Please specify a different name.');
      const c = { contact_id: String(460000001000 + org.contacts.length), contact_name: b.contact_name, email: b.contact_persons?.[0]?.email };
      org.contacts.push(c);
      return ok({ contact: c }, 201);
    }

    if ((res === 'invoices' || res === 'creditnotes') && rid && sub === 'status') {
      const d = org.docs.find((x) => x.id === rid);
      if (!d) return err(1002, 'Invoice does not exist.', 404);
      if (act === 'sent') {
        if (d.status === 'draft') d.status = 'sent';
        return ok({ message: 'Invoice status has been changed to Sent.' });
      }
      if (act === 'void') {
        if (d.balance !== d.total) return err(1016, 'The invoice cannot be voided as payments or credits have been applied to it.');
        d.status = 'void';
        d.balance = 0;
        return ok({ message: 'Invoice status has been changed to Void.' });
      }
    }

    if ((res === 'invoices' || res === 'creditnotes') && !rid) {
      const kind = res === 'invoices' ? 'invoice' : 'creditnote';
      const number = b[`${kind}_number`];
      if (!org.contacts.some((c) => c.contact_id === b.customer_id)) return err(1002, 'Customer does not exist.');
      if (req.query.get('ignore_auto_number_generation') === 'true' && !number) return err(4, `${kind === 'invoice' ? 'Invoice' : 'Credit note'} number is required.`);
      if (number && org.docs.some((d) => d.kind === kind && d.number === number)) return err(1001, `${kind === 'invoice' ? 'Invoice' : 'Credit note'} "${number}" already exists.`);
      if (b.currency_code && b.currency_code !== org.currency) return err(1015, 'Foreign currency transactions are not enabled for this organization.');
      let total = 0;
      for (const l of b.line_items ?? []) {
        if (!l.name && !l.item_id) return err(4, 'Please enter an item name or select an item.');
        if (l.account_id && !['income', 'other_income', 'expense'].includes(acc(l.account_id)?.account_type ?? '')) return err(1002, 'Account does not exist or cannot be used for sales.');
        const tax = l.tax_id ? org.taxes.find((t) => t.tax_id === l.tax_id) : null;
        if (l.tax_id && !tax) return err(1002, 'Tax does not exist.');
        const amount = round(Number(l.quantity ?? 1) * Number(l.rate ?? 0));
        total = round(total + amount + round((amount * (tax?.tax_percentage ?? 0)) / 100));
      }
      if (!(b.line_items ?? []).length) return err(4, 'Line items are required.');
      const adjustment = round(Number(b.adjustment ?? 0));
      if (Math.abs(adjustment) > 1) return err(4, 'Adjustment is too large for this test server.');
      total = round(total + adjustment);
      const d: ZDoc = { id: String(460000002000 + org.docs.length), kind, number: number ?? `${kind}-${org.docs.length + 1}`, customer: b.customer_id, status: kind === 'invoice' ? 'draft' : 'open', total, balance: total, date: b.date, lines: b.line_items, adjustment, attachments: [] };
      org.docs.push(d);
      return ok({ [kind]: docView(d) }, 201);
    }

    if (res === 'invoices' && rid && sub === 'credits') {
      // Excess payments (and credit notes) applied to an invoice later.
      const inv = org.docs.find((x) => x.id === rid && x.kind === 'invoice');
      if (!inv || inv.status === 'void') return err(1002, 'Invoice does not exist.', 404);
      for (const a of b.invoice_payments ?? []) {
        const p = org.payments.find((x) => x.id === a.payment_id && !x.deleted);
        if (!p) return err(1002, 'Payment does not exist.');
        const unapplied = round(p.amount - p.links.reduce((s, l) => s + l.amount, 0));
        if (a.amount_applied > unapplied + 1e-9 || a.amount_applied > inv.balance + 1e-9) return err(1037, 'Amount applied is more than the available credit.');
        p.links.push({ id: inv.id, amount: a.amount_applied });
        inv.balance = round(inv.balance - a.amount_applied);
        if (!inv.balance) inv.status = 'paid';
      }
      return ok({ message: 'Credits have been applied to the invoice.' });
    }

    if (res === 'creditnotes' && rid && sub === 'invoices') {
      const cn = org.docs.find((x) => x.id === rid && x.kind === 'creditnote');
      if (!cn) return err(1002, 'Credit note does not exist.', 404);
      for (const a of b.invoices ?? []) {
        const inv = org.docs.find((x) => x.id === a.invoice_id && x.kind === 'invoice');
        if (!inv || inv.status === 'void') return err(1002, 'Invoice does not exist.');
        if (a.amount_applied > inv.balance + 1e-9 || a.amount_applied > cn.balance + 1e-9) return err(1037, 'Amount applied is more than the balance.');
        inv.balance = round(inv.balance - a.amount_applied);
        cn.balance = round(cn.balance - a.amount_applied);
        if (!inv.balance) inv.status = 'paid';
        if (!cn.balance) cn.status = 'closed';
      }
      return ok({ apply_to_invoices: { invoices: b.invoices } });
    }
    if (res === 'creditnotes' && rid && sub === 'refunds') {
      const cn = org.docs.find((x) => x.id === rid && x.kind === 'creditnote');
      if (!cn) return err(1002, 'Credit note does not exist.', 404);
      if (!['bank', 'cash'].includes(acc(b.from_account_id)?.account_type ?? '')) return err(1002, 'Please select a bank or cash account to refund from.');
      if (Number(b.amount) > cn.balance + 1e-9) return err(1037, 'Refund amount is more than the credits available.');
      cn.balance = round(cn.balance - Number(b.amount));
      const r = { id: id(), creditnote: cn.id, amount: Number(b.amount) };
      org.refunds.push(r);
      return ok({ creditnote_refund: { creditnote_refund_id: r.id, amount: r.amount } }, 201);
    }

    if (res === 'customerpayments') {
      if (!org.contacts.some((c) => c.contact_id === b.customer_id)) return err(1002, 'Customer does not exist.');
      if (b.account_id && !['bank', 'cash', 'other_current_asset'].includes(acc(b.account_id)?.account_type ?? '')) return err(1002, 'Please select a bank or cash account to deposit to.');
      const links: { id: string; amount: number }[] = [];
      for (const a of b.invoices ?? []) {
        const inv = org.docs.find((x) => x.id === a.invoice_id && x.kind === 'invoice');
        if (!inv || inv.status === 'void') return err(1002, 'Invoice does not exist.');
        if (inv.status === 'draft') return err(1044, 'Payments cannot be recorded for draft invoices.');
        if (a.amount_applied > inv.balance + 1e-9) return err(1037, 'Amount applied is more than the balance due.');
        links.push({ id: inv.id, amount: a.amount_applied });
      }
      if (round(links.reduce((s, l) => s + l.amount, 0)) > Number(b.amount) + 1e-9) return err(1037, 'Amount applied is more than the payment amount.');
      for (const l of links) {
        const inv = org.docs.find((x) => x.id === l.id)!;
        inv.balance = round(inv.balance - l.amount);
        if (!inv.balance) inv.status = 'paid';
      }
      const p: ZPay = { id: String(460000003000 + org.payments.length), customer: b.customer_id, amount: Number(b.amount), links, deleted: false, updated: Date.now() };
      org.payments.push(p);
      return ok({ payment: { payment_id: p.id, amount: p.amount } }, 201);
    }

    if (res === 'journals') {
      let debit = 0;
      let credit = 0;
      for (const l of b.line_items ?? []) {
        const a = acc(l.account_id);
        if (!a) return err(1002, 'Account does not exist.');
        if (a.account_type === 'accounts_receivable' && !l.customer_id) return err(4, 'Please select a customer for the Accounts Receivable account.');
        if (l.debit_or_credit === 'debit') debit = round(debit + Number(l.amount));
        else if (l.debit_or_credit === 'credit') credit = round(credit + Number(l.amount));
        else return err(4, 'debit_or_credit must be debit or credit.');
      }
      if (!debit || debit !== credit) return err(4, 'The total debits and credits of the journal must be equal.');
      const j = { id: String(460000004000 + org.journals.length), deleted: false, lines: b.line_items };
      org.journals.push(j);
      return ok({ journal: { journal_id: j.id, total: debit } }, 201);
    }

    if (res === 'invoices' && rid && sub === 'attachment' && req.method === 'POST') {
      // multipart/form-data with the file in the field "attachment".
      const d = org.docs.find((x) => x.kind === 'invoice' && x.id === rid);
      if (!d) return err(1002, 'Invoice does not exist.', 404);
      const file = multipart(req).find((p) => p.name === 'attachment');
      if (!file || !file.data.length) return err(4, 'Please attach a file.');
      d.attachments.push({ name: file.filename ?? 'file', type: file.contentType ?? '', size: file.data.length });
      return ok({ message: 'Your file has been attached.' });
    }
    return err(5, 'Invalid URL Passed', 404);
  };

  const fake = (await startFake({ clientId: opts.clientId ?? 'zoho-client', clientSecret: opts.clientSecret ?? 'zoho-secret', clientAuth: 'body', tokenPrefix: 'Zoho-oauthtoken', ttl: 3600 }, api)) as ZohoFake;
  fake.orgs = orgs;
  fake.payInZoho = (orgId, invoiceId, amount) => {
    const org = orgs.find((o) => o.organization_id === orgId)!;
    const d = org.docs.find((x) => x.id === invoiceId)!;
    d.balance = round(d.balance - amount);
    const p: ZPay = { id: String(460000003000 + org.payments.length), customer: d.customer, amount, links: [{ id: d.id, amount }], deleted: false, updated: Date.now() };
    org.payments.push(p);
    return p.id;
  };
  return fake;
}
