import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountingEntry, AccountingInvoice, AccountingPayment } from '@openrent/plugin-sdk';
import { memoryContext, startXeroFake, type MemoryData, type XeroFake } from '@openrent/accounting-fakes';
import { major, minor, xeroDate, xeroIntegration } from '../src/index.ts';

const contact = { id: 'cus_1', name: 'Ada Lovelace', company_name: null, email: 'ada@example.org', phone: null, tax_id: 'EE123', address: null };
const line = { description: 'Kayak · 3 days', quantity: 3, unit_amount: 3333, net_amount: 10000, tax_amount: 2000, tax_rate_bp: 2000, kind: 'rental' as const };
const invoice: AccountingInvoice = {
  id: 'doc_1', type: 'invoice', number: 'INV-2026-00001', issued_at: '2026-10-20T10:00:00.000Z', due_at: null, currency: 'EUR', contact, order_number: 1042,
  lines: [line], net_total: 10000, tax_total: 2000, total: 12000, credit_for: null, status: 'issued', order_payments: [{ id: 'pay_1', amount: 5000 }, { id: 'pay_2', amount: 7000 }],
};
const pay = (id: string, amount: number, kind: 'payment' | 'refund' = 'payment', method = 'card'): AccountingPayment => ({
  id, kind, purpose: 'rental', amount, currency: 'EUR', paid_at: '2026-10-21T09:00:00.000Z', method, provider: 'stripe', invoice_id: 'doc_1', order_number: 1042,
});
const entry = (id: string, kind: AccountingEntry['kind'], source: AccountingEntry['source'], lines: [string, number, number][], reverses: AccountingEntry['reverses'] = null): AccountingEntry => ({
  id, number: Number(id.slice(4)), kind, date: '2026-10-21', currency: 'EUR', total: lines.reduce((s, l) => s + l[1], 0), reference: '#1042', source, reverses, contact,
  lines: lines.map(([account_key, debit, credit]) => ({ account_key, debit, credit, tax_rate_bp: null, description: kind })),
});

describe('Xero integration against the Xero fake', () => {
  let fake: XeroFake;
  let mapping: Record<string, string>;
  beforeAll(async () => {
    fake = await startXeroFake();
    const org = fake.orgs[0]!;
    const acc = (code: string) => org.accounts.find((a) => a.Code === code)!.AccountID;
    mapping = {
      'accounts.revenue_rental': acc('201'), 'accounts.revenue_other': acc('260'), 'accounts.revenue_damage': acc('205'), 'accounts.deposits': acc('835'),
      'payment_accounts.bank': acc('090'), 'payment_accounts.card_clearing': acc('092'), 'payment_accounts.cash': acc('091'), 'taxes.2000': 'OUTPUT2', 'taxes.0': 'NONE',
    };
  });
  afterAll(() => fake.close());
  const setup = (data: MemoryData) =>
    memoryContext(fake, { settings: { mapping }, account: { tenant_id: fake.orgs[0]!.tenantId, base_currency: 'EUR' }, data: { contacts: [contact], ...data } });

  it('converts amounts and Xero dates', () => {
    expect([major(12000, 'EUR'), major(1200, 'JPY'), minor(120, 'EUR')]).toEqual([120, 1200, 12000]);
    expect(xeroDate('/Date(1700000000000+0000)/')).toBe('2023-11-14T22:13:20.000Z');
  });

  it('connects, lists organisations and the organisation’s accounts and taxes', async () => {
    const { ctx } = setup({});
    const x = xeroIntegration();
    expect(await x.onConnected!(ctx, {})).toEqual({ accountName: 'Kayak Hire Ltd', account: { tenant_id: fake.orgs[0]!.tenantId, organisation_id: fake.orgs[0]!.tenantId, base_currency: 'EUR' } });
    expect((await x.organisations!(ctx)).map((o) => o.name)).toEqual(['Kayak Hire Ltd', 'Kayak Hire Events Ltd']);
    const l = await x.lookups!(ctx);
    expect(l.paymentAccounts!.map((a) => a.code)).toEqual(['090', '091', '092']);
    expect(l.taxRates!.find((t) => t.id === 'OUTPUT2')!.rateBp).toBe(2000);
    expect(l.currencies).toEqual(['EUR']);
  });

  it('holds a payment made before the invoice, then allocates it; a later payment settles the rest', async () => {
    const e1 = entry('ace_1', 'payment', { type: 'payment', id: 'pay_1' }, [['card_clearing', 5000, 0], ['receivable', 0, 5000]]);
    const e2 = entry('ace_2', 'invoice', { type: 'document', id: 'doc_1' }, [['receivable', 12000, 0], ['revenue_rental', 0, 10000], ['tax', 0, 2000]]);
    const e3 = entry('ace_3', 'payment', { type: 'payment', id: 'pay_2' }, [['card_clearing', 7000, 0], ['receivable', 0, 7000]]);
    const first = { ...pay('pay_1', 5000), invoice_id: null };
    const { ctx, links } = setup({ invoices: [invoice], payments: [first, pay('pay_2', 7000)], entries: [e1, e2, e3] });
    const x = xeroIntegration();
    expect(await x.handle(ctx, { id: 't1', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'ace_1' }, attempt: 1 })).toEqual({ status: 'done', message: 'Payment held as an overpayment in Xero until the invoice arrives' });
    expect(await x.handle(ctx, { id: 't2', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'ace_2' }, attempt: 1 })).toEqual({ status: 'done', message: 'Invoice INV-2026-00001 sent to Xero' });
    const org = fake.orgs[0]!;
    const inv = org.docs.find((d) => d.number === invoice.number)!;
    // Tax as OpenRent worked it out, so the total matches the issued invoice; 50.00 already allocated.
    expect([inv.total, inv.due]).toEqual([120, 70]);
    expect(links.get('document:doc_1')!.extra).toMatchObject({ remote_total: 12000, mismatch: false });
    expect(await x.handle(ctx, { id: 't3', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'ace_3' }, attempt: 1 })).toEqual({ status: 'done', message: 'Payment applied in Xero' });
    expect([inv.due, inv.status]).toEqual([0, 'PAID']);
    expect(org.payments.at(-1)!.account).toBe(mapping['payment_accounts.card_clearing']);
  });

  it('books deposits as bank transactions and damage kept from them as a manual journal', async () => {
    const held = entry('ace_10', 'deposit_received', { type: 'payment', id: 'pay_d1' }, [['cash', 10000, 0], ['deposits', 0, 10000]]);
    const kept = entry('ace_11', 'deposit_applied', { type: 'payment', id: 'pay_d2' }, [['deposits', 1500, 0], ['revenue_damage', 0, 1500]]);
    const back = entry('ace_12', 'deposit_returned', { type: 'payment', id: 'pay_d3' }, [['deposits', 8500, 0], ['cash', 0, 8500]]);
    const { ctx } = setup({ entries: [held, kept, back] });
    const x = xeroIntegration();
    for (const id of ['ace_10', 'ace_11', 'ace_12']) expect((await x.handle(ctx, { id, event: 'accounting.entry_posted', object: { type: 'accounting_entry', id }, attempt: 1 })).status).toBe('done');
    const org = fake.orgs[0]!;
    expect(org.bankTransactions.slice(-2).map((b) => [b.type, b.total])).toEqual([['RECEIVE', 100], ['SPEND', 85]]);
    expect(org.journals.at(-1)!.lines.map((l) => [l.AccountCode, l.LineAmount])).toEqual([['835', 15], ['205', -15]]);
  });

  it('voids an invoice, deletes a reversed payment, and refuses to void a paid one with Xero’s reason', async () => {
    const inv2 = { ...invoice, id: 'doc_5', number: 'INV-2026-00005', order_payments: [] };
    const e = entry('ace_20', 'invoice', { type: 'document', id: 'doc_5' }, [['receivable', 12000, 0], ['revenue_rental', 0, 10000], ['tax', 0, 2000]]);
    const v = entry('ace_21', 'invoice_void', { type: 'entry', id: 'ace_20' }, [['receivable', 0, 12000], ['revenue_rental', 10000, 0], ['tax', 2000, 0]], { id: 'ace_20', kind: 'invoice', source: { type: 'document', id: 'doc_5' } });
    const voidPaid = entry('ace_22', 'invoice_void', { type: 'entry', id: 'ace_2' }, [['receivable', 0, 12000]], { id: 'ace_2', kind: 'invoice', source: { type: 'document', id: 'doc_1' } });
    const { ctx, links } = setup({ invoices: [inv2], entries: [e, v, voidPaid] });
    links.set('document:doc_1', { remoteId: fake.orgs[0]!.docs.find((d) => d.number === invoice.number)!.id, extra: { kind: 'invoice' } });
    const x = xeroIntegration();
    await x.handle(ctx, { id: 'a', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'ace_20' }, attempt: 1 });
    expect((await x.handle(ctx, { id: 'b', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'ace_21' }, attempt: 1 })).status).toBe('done');
    expect(fake.orgs[0]!.docs.find((d) => d.number === 'INV-2026-00005')!.status).toBe('VOIDED');
    await expect(x.handle(ctx, { id: 'c', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'ace_22' }, attempt: 1 })).rejects.toThrow(/payment or credit note allocated/);
  });

  it('waits when Xero asks to slow down', async () => {
    const { ctx } = setup({});
    fake.rateLimit(1, 7);
    await expect(xeroIntegration().lookups!(ctx)).rejects.toMatchObject({ name: 'RetryLater', retryAfterMs: 7000 });
  });

  it('brings back payments entered in Xero and sees invoices voided there', async () => {
    const { ctx } = setup({});
    const org = fake.orgs[0]!;
    const inv = org.docs.find((d) => d.number === 'INV-2026-00001')!;
    const before = new Date(Date.now() - 1000).toISOString();
    inv.due = 30;
    inv.status = 'AUTHORISED';
    const remote = fake.payInXero(org.tenantId, inv.id, 30);
    const pulled = await xeroIntegration().pullPayments!(ctx, before);
    expect(pulled.find((p) => p.remoteId === remote)).toMatchObject({ invoiceRemoteId: inv.id, amount: 3000, currency: 'EUR' });
    fake.voidInXero(org.tenantId, inv.id);
    const checked = await xeroIntegration().check!(ctx, [{ localType: 'document', remoteId: inv.id }, { localType: 'document', remoteId: 'gone' }]);
    expect(checked).toEqual([{ remoteId: inv.id, total: 0, status: 'voided' }, { remoteId: 'gone', total: null, status: 'deleted' }]);
  });

  it('attaches the issued PDF when the shop asks for it, and tries again after a failed upload', async () => {
    const inv = { ...invoice, id: 'doc_pdf', number: 'INV-2026-00090', order_payments: [] };
    const e = entry('ace_90', 'invoice', { type: 'document', id: 'doc_pdf' }, [['receivable', 12000, 0], ['revenue_rental', 0, 10000], ['tax', 0, 2000]]);
    const pdf = { filename: 'invoice-INV-2026-00090.pdf', contentType: 'application/pdf' as const, body: new Uint8Array() };
    const { ctx, links } = memoryContext(fake, { settings: { mapping, attach_pdf: true }, account: { tenant_id: fake.orgs[0]!.tenantId }, data: { contacts: [contact], invoices: [inv], entries: [e], pdfs: { doc_pdf: pdf } } });
    const x = xeroIntegration();
    const task = { id: 't', event: 'accounting.entry_posted', object: { type: 'accounting_entry', id: 'ace_90' }, attempt: 1 };
    // An empty file is refused; the invoice stays and the link remembers the PDF is missing.
    expect((await x.handle(ctx, task)).message).toMatch(/^Invoice INV-2026-00090 sent to Xero; the PDF was not attached \(Xero: The attachment needs a body/);
    expect(links.get('document:doc_pdf')!.extra.pdf).toBe('failed');
    pdf.body = new TextEncoder().encode('%PDF-1.7 test');
    expect(await x.handle(ctx, task)).toEqual({ status: 'done', message: 'INV-2026-00090 is already in Xero with its PDF' });
    const doc = fake.orgs[0]!.docs.find((d) => d.number === 'INV-2026-00090')!;
    expect(doc.attachments).toEqual([{ name: pdf.filename, type: 'application/pdf', size: 13 }]);
    expect(fake.orgs[0]!.docs.filter((d) => d.number === 'INV-2026-00090')).toHaveLength(1);
    expect((await x.handle(ctx, task)).status).toBe('skipped');
  });
});
