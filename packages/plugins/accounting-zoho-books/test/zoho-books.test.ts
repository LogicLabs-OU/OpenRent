import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountingEntry, AccountingInvoice, AccountingPayment } from '@openrent/plugin-sdk';
import { memoryContext, startZohoFake, type MemoryData, type ZohoFake } from '@openrent/accounting-fakes';
import { zohoBooksIntegration, zohoLines } from '../src/index.ts';

const contact = { id: 'cus_1', name: 'Ada Lovelace', company_name: null, email: 'ada@example.org', phone: null, tax_id: null, address: null };
const invoice: AccountingInvoice = {
  id: 'doc_1', type: 'invoice', number: 'INV-2026-00001', issued_at: '2026-10-20T10:00:00.000Z', due_at: '2026-11-03T10:00:00.000Z', currency: 'EUR', contact, order_number: 1042,
  // 3 × 33.33 with 20 % tax per line: Zoho's own sum differs from OpenRent's by a cent.
  lines: [{ description: 'Kayak · 3 days', quantity: 3, unit_amount: 3333, net_amount: 10000, tax_amount: 2000, tax_rate_bp: 2000, kind: 'rental' }],
  net_total: 10000, tax_total: 2000, total: 12000, credit_for: null, status: 'issued', order_payments: [{ id: 'pay_1', amount: 4000 }],
};
const credit: AccountingInvoice = { ...invoice, id: 'doc_2', type: 'credit_note', number: 'CN-2026-00001', credit_for: { id: 'doc_1', number: invoice.number }, order_payments: [] };
const pay = (id: string, amount: number, invoiceId: string | null, kind: 'payment' | 'refund' = 'payment'): AccountingPayment => ({
  id, kind, purpose: 'rental', amount, currency: 'EUR', paid_at: '2026-10-21T09:00:00.000Z', method: 'bank_transfer', provider: 'manual', invoice_id: invoiceId, order_number: 1042,
});
const entry = (id: string, kind: AccountingEntry['kind'], source: AccountingEntry['source'], lines: [string, number, number][]): AccountingEntry => ({
  id, number: Number(id.slice(4)), kind, date: '2026-10-21', currency: 'EUR', total: lines.reduce((s, l) => s + l[1], 0), reference: '#1042', source, reverses: null, contact,
  lines: lines.map(([account_key, debit, credit]) => ({ account_key, debit, credit, tax_rate_bp: null, description: kind })),
});
const task = (id: string) => ({ id, event: 'accounting.entry_posted', object: { type: 'accounting_entry', id }, attempt: 1 });

describe('Zoho Books integration against the Zoho fake', () => {
  let fake: ZohoFake;
  let mapping: Record<string, string>;
  beforeAll(async () => {
    fake = await startZohoFake();
    const a = (code: string) => fake.orgs[0]!.accounts.find((x) => x.account_code === code)!.account_id;
    mapping = {
      'accounts.revenue_rental': a('4000'), 'accounts.revenue_other': a('4020'), 'accounts.receivable': a('1200'), 'accounts.deposits': a('2300'), 'accounts.revenue_damage': a('4030'),
      'payment_accounts.bank': a('1000'), 'payment_accounts.cash': a('1010'), 'taxes.2000': '460000000050', 'taxes.0': '460000000052',
    };
  });
  afterAll(() => fake.close());
  const setup = (data: MemoryData) => memoryContext(fake, { tokenPrefix: 'Zoho-oauthtoken', config: { api_base_url: `${fake.url}/books/v3` }, settings: { mapping }, account: { organization_id: fake.orgs[0]!.organization_id, base_currency: 'EUR' }, data: { contacts: [contact], ...data } });

  it('picks the default organisation and lists its accounts and taxes', async () => {
    const { ctx } = setup({});
    const z = zohoBooksIntegration();
    expect(await z.onConnected!(ctx, {})).toMatchObject({ accountName: 'Kayak Hire OÜ', account: { organization_id: fake.orgs[0]!.organization_id, base_currency: 'EUR' } });
    const l = await z.lookups!(ctx);
    expect(l.taxRates!.find((t) => t.id === '460000000050')!.rateBp).toBe(2000);
    expect(l.paymentAccounts!.map((p) => p.code)).toEqual(['1000', '1010', '1150']);
  });

  it('carries the rounding difference in the adjustment, so the totals match', () => {
    const { ctx } = setup({});
    expect(zohoLines(ctx, invoice)).toMatchObject({ items: [{ quantity: 3, rate: 33.33 }], adjustment: 0.01 });
  });

  it('holds an early payment as excess, applies it when the invoice is sent, refunds from the credit note', async () => {
    const { ctx, links } = setup({
      invoices: [invoice, credit], payments: [pay('pay_1', 4000, null), pay('pay_r', 4000, 'doc_1', 'refund')],
      entries: [
        entry('ace_1', 'payment', { type: 'payment', id: 'pay_1' }, [['bank', 4000, 0], ['receivable', 0, 4000]]),
        entry('ace_2', 'invoice', { type: 'document', id: 'doc_1' }, [['receivable', 12000, 0], ['revenue_rental', 0, 10000], ['tax', 0, 2000]]),
        entry('ace_3', 'credit_note', { type: 'document', id: 'doc_2' }, [['receivable', 0, 12000], ['revenue_rental', 10000, 0], ['tax', 2000, 0]]),
        entry('ace_4', 'refund', { type: 'payment', id: 'pay_r' }, [['receivable', 4000, 0], ['bank', 0, 4000]]),
      ],
    });
    const z = zohoBooksIntegration();
    expect((await z.handle(ctx, task('ace_1'))).message).toBe('Payment recorded in Zoho Books as excess until the invoice arrives');
    expect((await z.handle(ctx, task('ace_2'))).message).toBe('Invoice INV-2026-00001 sent to Zoho Books');
    const org = fake.orgs[0]!;
    const inv = org.docs.find((d) => d.number === invoice.number)!;
    expect([inv.total, inv.balance, inv.status]).toEqual([120, 80, 'sent']);
    expect(links.get('document:doc_1')!.extra).toMatchObject({ remote_total: 12000, mismatch: false });
    await z.handle(ctx, task('ace_3'));
    const cn = org.docs.find((d) => d.number === credit.number)!;
    expect([inv.balance, cn.balance]).toEqual([0, 40]);
    expect((await z.handle(ctx, task('ace_4'))).message).toBe('Refund paid from the credit note in Zoho Books');
    expect(cn.balance).toBe(0);
  });

  it('books a deposit as a journal on the mapped accounts', async () => {
    const { ctx } = setup({ entries: [entry('ace_10', 'deposit_received', { type: 'payment', id: 'pay_d' }, [['cash', 10000, 0], ['deposits', 0, 10000]])] });
    await zohoBooksIntegration().handle(ctx, task('ace_10'));
    expect(fake.orgs[0]!.journals.at(-1)!.lines.map((l: any) => [l.debit_or_credit, l.amount])).toEqual([['debit', 100], ['credit', 100]]);
  });

  it('brings back payments recorded in Zoho Books', async () => {
    const { ctx } = setup({});
    const before = new Date(Date.now() - 1000).toISOString();
    const inv = fake.orgs[0]!.docs.find((d) => d.number === 'INV-2026-00001')!;
    inv.balance = 10;
    const id = fake.payInZoho(fake.orgs[0]!.organization_id, inv.id, 10);
    expect((await zohoBooksIntegration().pullPayments!(ctx, before)).find((p) => p.remoteId === id)).toMatchObject({ invoiceRemoteId: inv.id, amount: 1000 });
  });

  it('attaches the issued PDF to invoices when the shop asks for it, and tries again after a failed upload', async () => {
    const inv = { ...invoice, id: 'doc_pdf', number: 'INV-2026-00090', order_payments: [] };
    const e = entry('ace_90', 'invoice', { type: 'document', id: 'doc_pdf' }, [['receivable', 12000, 0], ['revenue_rental', 0, 10000], ['tax', 0, 2000]]);
    const pdf = { filename: 'invoice-INV-2026-00090.pdf', contentType: 'application/pdf' as const, body: new Uint8Array() };
    const { ctx, links } = memoryContext(fake, {
      tokenPrefix: 'Zoho-oauthtoken', config: { api_base_url: `${fake.url}/books/v3` }, settings: { mapping, attach_pdf: true }, account: { organization_id: fake.orgs[0]!.organization_id },
      data: { contacts: [contact], invoices: [inv], entries: [e], pdfs: { doc_pdf: pdf } },
    });
    const z = zohoBooksIntegration();
    expect((await z.handle(ctx, task('ace_90'))).message).toBe('Invoice INV-2026-00090 sent to Zoho Books; the PDF was not attached (Zoho Books: Please attach a file.)');
    expect(links.get('document:doc_pdf')!.extra.pdf).toBe('failed');
    pdf.body = new TextEncoder().encode('%PDF-1.7 test');
    expect((await z.handle(ctx, task('ace_90'))).message).toBe('INV-2026-00090 is already in Zoho Books with its PDF');
    expect(fake.orgs[0]!.docs.find((d) => d.number === 'INV-2026-00090')!.attachments).toEqual([{ name: pdf.filename, type: 'application/pdf', size: 13 }]);
  });
});
