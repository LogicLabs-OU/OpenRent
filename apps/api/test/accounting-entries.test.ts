import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounting, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/**
 * Accounting entries (ADR 0009): database triggers queue every invoice, credit note, void and settled
 * payment whatever wrote it; posting turns them into balanced, numbered, unchangeable entries.
 */
suite('accounting entries', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  let variant: string;

  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'http://shop.test', livemode: false }, logger: quietLogger }),
    );
  const post = () => inTenant((ctx) => accounting.postPending(ctx));
  /** Entries for an order (or all), as [kind, [account, debit, credit]…]. */
  const booked = async (orderId?: string) =>
    (
      await withTenant(t.deps.db, tenantId, (c) =>
        c.query(
          `SELECT e.kind, e.number, e.total::int AS total, json_agg(json_build_array(l.account_key, l.debit::int, l.credit::int) ORDER BY l.position) AS lines
             FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id
            WHERE $1::text IS NULL OR e.order_id = $1 GROUP BY e.id ORDER BY e.number`,
          [orderId ?? null],
        ),
      )
    ).rows;
  const order = async (deposit = 0) => {
    const c = await admin.post('/api/v1/customers', { name: 'Ada Books', email: `ada-${Date.now()}-${Math.random()}@test.dev` });
    return (await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(5), ends_at: isoIn(7), lines: [{ variant_id: variant, quantity: 1 }], deposit: { mode: 'fixed', amount: deposit } })).body;
  };

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('books an invoice, a cash payment and the credit note of a void, numbered without gaps', async () => {
    const o = await order();
    const inv = (await admin.post(`/api/v1/orders/${o.id}/documents`, { type: 'invoice' })).body;
    expect((await admin.post(`/api/v1/orders/${o.id}/payments`, { amount: 12000, method: 'cash' })).status).toBe(201);
    expect((await admin.post(`/api/v1/documents/${inv.id}/actions/void`, { reason: 'test' })).status).toBe(200);
    await post();
    expect((await booked(o.id)).map((e) => [e.kind, e.lines])).toEqual([
      ['invoice', [['receivable', 12000, 0], ['revenue_rental', 0, 10000], ['tax', 0, 2000]]],
      ['payment', [['cash', 12000, 0], ['receivable', 0, 12000]]],
      // The credit note mirrors the invoice; the void itself books nothing more.
      ['credit_note', [['receivable', 0, 12000], ['revenue_rental', 10000, 0], ['tax', 2000, 0]]],
    ]);
    const numbers = (await booked()).map((e) => e.number);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    // Posting again books nothing twice.
    expect(await post()).toBe(0);
  });

  it('books the deposit cycle: held money, damage kept from it, and the rest returned', async () => {
    const o = await order(10000);
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    const dep = (await admin.get(`/api/v1/orders/${o.id}?expand=deposits`)).body.deposits[0];
    expect((await admin.post(`/api/v1/deposits/${dep.id}/actions/authorize`, { method: 'cash' })).body.status).toBe('held');
    expect((await admin.post(`/api/v1/deposits/${dep.id}/actions/capture`, { amount: 1500 })).status).toBe(200);
    await post();
    expect((await booked(o.id)).map((e) => [e.kind, e.lines])).toEqual([
      ['deposit_received', [['cash', 10000, 0], ['deposits', 0, 10000]]],
      ['deposit_applied', [['deposits', 1500, 0], ['revenue_damage', 0, 1500]]],
      ['deposit_returned', [['deposits', 8500, 0], ['cash', 0, 8500]]],
    ]);
  });

  it('catches a payment confirmed outside a request, and reverses one the provider takes back', async () => {
    const o = await order();
    const id = `pay_hook${Date.now()}`;
    await withSystem(t.deps.db, (db) =>
      db.query(`INSERT INTO payments (id, tenant_id, order_id, provider, kind, purpose, method, amount, currency, status) VALUES ($1,$2,$3,'stripe','charge','rental','card',3000,'EUR','pending')`, [id, tenantId, o.id]),
    );
    // A webhook confirms it later, without any OpenRent service call.
    await withSystem(t.deps.db, (db) => db.query(`UPDATE payments SET status = 'succeeded' WHERE id = $1`, [id]));
    await post();
    await withSystem(t.deps.db, (db) => db.query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [id]));
    await post();
    expect((await booked(o.id)).map((e) => [e.kind, e.lines])).toEqual([
      ['payment', [['card_clearing', 3000, 0], ['receivable', 0, 3000]]],
      ['payment', [['card_clearing', 0, 3000], ['receivable', 3000, 0]]],
    ]);
  });

  it('dates entries after the lock date and keeps the real date', async () => {
    // The shop's day (Europe/Tallinn), which differs from the UTC day around midnight.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn' }).format(new Date());
    const bad = await admin.patch('/api/v1/tenant/settings', { accounting: { locked_until: '2999-01-01' } });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field)).toEqual(['accounting.locked_until']);
    await admin.patch('/api/v1/tenant/settings', { accounting: { locked_until: today } });
    const o = await order();
    await admin.post(`/api/v1/orders/${o.id}/payments`, { amount: 500, method: 'bank_transfer' });
    await post();
    const e = (await withTenant(t.deps.db, tenantId, (c) => c.query(`SELECT entry_date::text, original_date::text FROM accounting_entries WHERE order_id = $1`, [o.id]))).rows[0];
    expect(e.entry_date > today).toBe(true);
    expect(e.original_date).toBe(today);
    await admin.patch('/api/v1/tenant/settings', { accounting: { locked_until: null } });
  });

  it('never changes an entry, and refuses one that does not balance', async () => {
    const [e] = (await withTenant(t.deps.db, tenantId, (c) => c.query(`SELECT id FROM accounting_entries LIMIT 1`))).rows;
    await expect(withTenant(t.deps.db, tenantId, (c) => c.query(`UPDATE accounting_entries SET total = 1 WHERE id = $1`, [e.id]))).rejects.toThrow(/cannot be changed/);
    await expect(withTenant(t.deps.db, tenantId, (c) => c.query(`DELETE FROM accounting_entry_lines WHERE entry_id = $1`, [e.id]))).rejects.toThrow(/cannot be changed/);
    await expect(
      withTenant(t.deps.db, tenantId, async (c) => {
        await c.query(`INSERT INTO accounting_entries (id, tenant_id, number, kind, source_type, source_id, entry_date, currency, total, reference) VALUES ('ace_bad', $1, 9999, 'payment', 'payment', 'pay_x', current_date, 'EUR', 100, 'x')`, [tenantId]);
        await c.query(`INSERT INTO accounting_entry_lines (id, tenant_id, entry_id, position, account_key, account_code, debit, credit, description) VALUES ('acl_bad', $1, 'ace_bad', 1, 'bank', '1000', 100, 0, 'x')`, [tenantId]);
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it('books history from before the triggers existed, once', async () => {
    const o = await order();
    await admin.post(`/api/v1/orders/${o.id}/payments`, { amount: 700, method: 'cash' });
    // As if the payment was recorded before the triggers existed: nothing queued.
    await withSystem(t.deps.db, (db) => db.query(`DELETE FROM accounting_queue WHERE source_id IN (SELECT id FROM payments WHERE order_id = $1)`, [o.id]));
    await post();
    expect(await booked(o.id)).toEqual([]);
    expect(await inTenant((ctx) => accounting.backfill(ctx))).toBeGreaterThanOrEqual(1);
    await post();
    expect((await booked(o.id)).map((e) => e.kind)).toEqual(['payment']);
    await inTenant((ctx) => accounting.backfill(ctx));
    await post();
    expect(await booked(o.id)).toHaveLength(1);
  });

  it('exports the journal from the stored entries, balanced, with the shop’s account codes', async () => {
    const j = (await admin.get(`/api/v1/accounting/journal?from=${encodeURIComponent(isoIn(-1))}&to=${encodeURIComponent(isoIn(3))}`)).body.data;
    expect(j.reduce((s: number, r: any) => s + r.debit, 0)).toBe(j.reduce((s: number, r: any) => s + r.credit, 0));
    expect(j.find((r: any) => r.description === 'Invoice' && r.credit === 10000).account).toBe('4000');
    const csv = String((await admin.get(`/api/v1/accounting/journal?from=${encodeURIComponent(isoIn(-1))}&to=${encodeURIComponent(isoIn(3))}&format=csv`)).body);
    expect(csv.split('\n')[0]).toContain('number');
  });
});
