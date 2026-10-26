import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountingEntry, AccountingInvoice, AccountingPayment } from '@openrent/plugin-sdk';
import { memoryContext, startQuickBooksFake, type MemoryData, type QboFake } from '@openrent/accounting-fakes';
import { quickbooksIntegration } from '../src/index.ts';

const contact = { id: 'cus_1', name: 'Ada Lovelace', company_name: null, email: 'ada@example.org', phone: null, tax_id: null, address: null };
const invoice: AccountingInvoice = {
  id: 'doc_1', type: 'invoice', number: 'INV-2026-00001', issued_at: '2026-10-20T10:00:00.000Z', due_at: null, currency: 'EUR', contact, order_number: 1042,
  // Two lines whose tax QuickBooks would round to a different total: OpenRent's total wins.
  lines: [
    { description: 'Kayak', quantity: 3, unit_amount: 1111, net_amount: 3333, tax_amount: 667, tax_rate_bp: 2000, kind: 'rental' },
    { description: 'Paddle', quantity: 1, unit_amount: 3333, net_amount: 3333, tax_amount: 667, tax_rate_bp: 2000, kind: 'rental' },
  ],
  net_total: 6666, tax_total: 1334, total: 8000, credit_for: null, status: 'issued', order_payments: [{ id: 'pay_1', amount: 3000 }],
};
const credit: AccountingInvoice = { ...invoice, id: 'doc_2', type: 'credit_note', number: 'CN-2026-00001', credit_for: { id: 'doc_1', number: invoice.number }, order_payments: [] };
const pay = (id: string, amount: number, invoiceId: string | null, kind: 'payment' | 'refund' = 'payment'): AccountingPayment => ({
  id, kind, purpose: 'rental', amount, currency: 'EUR', paid_at: '2026-10-21T09:00:00.000Z', method: 'card', provider: 'stripe', invoice_id: invoiceId, order_number: 1042,
});
const entry = (id: string, kind: AccountingEntry['kind'], source: AccountingEntry['source'], lines: [string, number, number][], reverses: AccountingEntry['reverses'] = null): AccountingEntry => ({
  id, number: Number(id.slice(4)), kind, date: '2026-10-21', currency: 'EUR', total: lines.reduce((s, l) => s + l[1], 0), reference: '#1042', source, reverses, contact,
  lines: lines.map(([account_key, debit, credit]) => ({ account_key, debit, credit, tax_rate_bp: null, description: kind })),
});
const task = (id: string) => ({ id, event: 'accounting.entry_posted', object: { type: 'accounting_entry', id }, attempt: 1 });

describe('QuickBooks integration against the QuickBooks fake', () => {
  let fake: QboFake;
  const mapping = {
    'items.rental': '1', 'items.other': '3', 'accounts.receivable': '84', 'accounts.deposits': '89', 'accounts.revenue_damage': '82',
    'payment_accounts.bank': '35', 'payment_accounts.card_clearing': '37', 'payment_accounts.cash': '36', 'taxes.2000': '3', 'taxes.0': '6',
  };
  beforeAll(async () => {
    fake = await startQuickBooksFake();
  });
  afterAll(() => fake.close());
  const setup = (data: MemoryData) => memoryContext(fake, { settings: { mapping }, account: { realm_id: fake.companies[0]!.realmId, base_currency: 'EUR' }, data: { contacts: [contact], ...data } });

  it('reads the company on connect and lists accounts, items and tax codes with their rates', async () => {
    const { ctx } = setup({});
    const q = quickbooksIntegration();
    expect(await q.onConnected!(ctx, { realmId: fake.companies[0]!.realmId })).toMatchObject({ accountName: 'Kayak Hire Ltd', account: { realm_id: fake.companies[0]!.realmId, base_currency: 'EUR' } });
    const l = await q.lookups!(ctx);
    expect(l.taxRates!.find((t) => t.id === '3')!.rateBp).toBe(2000);
    expect(l.items!.map((i) => i.name)).toContain('Rental');
    expect(l.paymentAccounts!.map((a) => a.id)).toEqual(['35', '36', '37']);
  });

  it('keeps an early payment unapplied, applies it to the invoice, and the totals match OpenRent', async () => {
    const { ctx, links } = setup({
      invoices: [invoice], payments: [pay('pay_1', 3000, null)],
      entries: [
        entry('ace_1', 'payment', { type: 'payment', id: 'pay_1' }, [['card_clearing', 3000, 0], ['receivable', 0, 3000]]),
        entry('ace_2', 'invoice', { type: 'document', id: 'doc_1' }, [['receivable', 8000, 0], ['revenue_rental', 0, 6666], ['tax', 0, 1334]]),
      ],
    });
    const q = quickbooksIntegration();
    expect((await q.handle(ctx, task('ace_1'))).message).toBe('Payment recorded in QuickBooks, unapplied until the invoice arrives');
    expect((await q.handle(ctx, task('ace_2'))).message).toBe('Invoice INV-2026-00001 sent to QuickBooks');
    const inv = fake.companies[0]!.txns.find((t) => t.DocNumber === invoice.number)!;
    expect([inv.total, inv.balance]).toEqual([80, 50]);
    expect(links.get('document:doc_1')!.extra).toMatchObject({ remote_total: 8000, mismatch: false });
  });

  it('applies a credit memo to its invoice and books the refund as a journal entry naming the customer', async () => {
    const { ctx, links } = setup({
      invoices: [invoice, credit], payments: [pay('pay_9', 3000, 'doc_1', 'refund')],
      entries: [
        entry('ace_3', 'credit_note', { type: 'document', id: 'doc_2' }, [['receivable', 0, 8000], ['revenue_rental', 6666, 0], ['tax', 1334, 0]]),
        entry('ace_4', 'refund', { type: 'payment', id: 'pay_9' }, [['receivable', 3000, 0], ['card_clearing', 0, 3000]]),
      ],
    });
    const inv = fake.companies[0]!.txns.find((t) => t.DocNumber === invoice.number)!;
    links.set('document:doc_1', { remoteId: inv.Id, extra: { kind: 'invoice' } });
    const q = quickbooksIntegration();
    await q.handle(ctx, task('ace_3'));
    const cm = fake.companies[0]!.txns.find((t) => t.DocNumber === credit.number)!;
    expect([inv.balance, cm.balance]).toEqual([0, 30]);
    expect((await q.handle(ctx, task('ace_4'))).message).toBe('Refund booked in QuickBooks');
    const j = fake.companies[0]!.journals.at(-1)!;
    expect(j.lines.map((l: any) => [l.JournalEntryLineDetail.PostingType, l.JournalEntryLineDetail.AccountRef.value, l.JournalEntryLineDetail.Entity?.Type ?? null])).toEqual([['Debit', '84', 'Customer'], ['Credit', '37', null]]);
  });

  it('books deposits as journal entries and deletes one that is reversed', async () => {
    const held = entry('ace_10', 'deposit_received', { type: 'payment', id: 'pay_d1' }, [['cash', 10000, 0], ['deposits', 0, 10000]]);
    const undo = entry('ace_11', 'deposit_received', { type: 'entry', id: 'ace_10' }, [['cash', 0, 10000], ['deposits', 10000, 0]], { id: 'ace_10', kind: 'deposit_received', source: { type: 'payment', id: 'pay_d1' } });
    const { ctx, links } = setup({ entries: [held, undo] });
    const q = quickbooksIntegration();
    await q.handle(ctx, task('ace_10'));
    // The reversal looks the journal up by the payment it came from.
    links.set('payment:pay_d1', links.get('entry:ace_10')!);
    expect((await q.handle(ctx, task('ace_11'))).message).toBe('Entry 11: undone in QuickBooks');
    expect(fake.companies[0]!.journals.find((j) => j.Id === links.get('entry:ace_10')!.remoteId)!.status).toBe('Deleted');
  });

  it('brings back payments recorded in QuickBooks through the change feed', async () => {
    const { ctx } = setup({});
    const before = new Date(Date.now() - 1000).toISOString();
    const inv = fake.companies[0]!.txns.find((t) => t.DocNumber === 'INV-2026-00001')!;
    inv.balance = 20;
    const id = fake.payInQbo(fake.companies[0]!.realmId, inv.Id, 20);
    expect((await quickbooksIntegration().pullPayments!(ctx, before)).find((p) => p.remoteId === id)).toMatchObject({ invoiceRemoteId: inv.Id, amount: 2000 });
  });
});
